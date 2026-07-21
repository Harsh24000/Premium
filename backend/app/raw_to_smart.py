import json

import groq

from .config import get_settings
from .llm_client import _log_usage
from .raw_compute import FlatObservation, compute_wellness_score, flatten_observations, score_to_label
from .raw_models import RawLabExport
from .raw_to_smart_prompt import RAW_TO_SMART_SYSTEM

_settings = get_settings()
_client: groq.Groq | None = None


def _get_client() -> groq.Groq:
    global _client
    if _client is None:
        _client = groq.Groq(api_key=_settings.groq_api_key or None)
    return _client


def _build_llm_input(patient_name: str, score: int, label: str, flat: list[FlatObservation]) -> str:
    """
    Grouped by panel, with the panel name printed once rather than
    repeated on every observation line. Measured against a real 110-
    observation report: the old flat per-line format (which repeated the
    full panel name, e.g. "COMPLETE BLOOD COUNT (CBC/HAEMOGRAM) NRL", on
    all 25 lines of that one panel) cost ~4,325 tokens; this format cuts
    that meaningfully. That matters beyond raw cost — large real reports
    were hitting Groq's per-minute token limit outright (requested ~9,600
    against an 8,000 TPM cap on the on_demand tier), so this isn't just
    cheaper, it's the difference between the request succeeding at all
    on a larger account's default limits.
    """
    lines = [
        f"Patient: {patient_name}",
        f"Computed wellness score: {score} ({label}) — write your greeting/descriptor to match this band, don't invent your own score.",
        "",
    ]

    panels: dict[str, list[FlatObservation]] = {}
    for obs in flat:
        panels.setdefault(obs.panel_name, []).append(obs)

    for panel_name, obs_list in panels.items():
        lines.append(f"## {panel_name}")
        for obs in obs_list:
            range_str = f"[{obs.min_value}-{obs.max_value}]" if obs.min_value and obs.max_value else "[no range]"
            status_str = obs.status if obs.status is not None else "classify"
            unit = obs.unit or ""
            lines.append(f"{obs.name}: {obs.raw_value} {unit} {range_str} {status_str}")
        lines.append("")

    return "\n".join(lines)


def generate_smart_report_from_raw(raw_data: dict) -> dict:
    """
    Takes a raw diagnofirm-format lab export and produces a SmartReport
    dict. Deterministic data (name/value/unit/range, and status wherever
    a real numeric range exists) is computed in Python and is always
    authoritative — the LLM only classifies the subset with no computable
    range, and only ever generates narrative text (explanations, diet
    plan, panel groupings). It cannot alter a real number.
    """
    raw = RawLabExport(**raw_data)
    flat = flatten_observations(raw)

    # First pass score using only deterministic classifications, to give
    # the LLM a score band to write its greeting/descriptor around.
    provisional_score = compute_wellness_score(flat, llm_classified_abnormal=set())
    provisional_label = score_to_label(provisional_score)

    llm_input = _build_llm_input(raw.PName, provisional_score, provisional_label, flat)

    response = _get_client().chat.completions.create(
        model=_settings.chat_model,
        temperature=0.2,
        max_tokens=3500,
        # "low" — see llm_client._log_usage docstring for why this matters:
        # gpt-oss-120b defaults to "medium" reasoning effort, billed as
        # output tokens, unaccounted for until this was added. This call
        # writes a wellness narrative from already-classified data, which
        # doesn't need deep reasoning — the hard classification work
        # already happened deterministically in raw_compute.py.
        reasoning_effort="low",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": RAW_TO_SMART_SYSTEM},
            {"role": "user", "content": llm_input},
        ],
    )
    _log_usage("raw_to_smart", response)
    generated = json.loads(response.choices[0].message.content)

    # Apply LLM classifications ONLY to observations that had no
    # deterministic status. A classification for an already-classified
    # observation is ignored — deterministic numeric status is never
    # overridden by the LLM.
    classification_map = {
        c.get("name"): c.get("status")
        for c in generated.get("classifications", [])
        if isinstance(c, dict)
    }
    llm_classified_abnormal = set()
    for obs in flat:
        if obs.status is None:
            llm_status = classification_map.get(obs.name)
            if llm_status in ("normal", "low", "high", "borderline"):
                obs.status = llm_status
                if llm_status in ("low", "high", "borderline"):
                    llm_classified_abnormal.add(obs.name)
            else:
                obs.status = "normal"  # fail closed: unclassifiable -> not alarming, not a crash

    final_score = compute_wellness_score(flat, llm_classified_abnormal)
    final_label = score_to_label(final_score)

    # Build parameter lookup keyed by name — value/unit/range ALWAYS come
    # from our deterministic flat observations, never from the LLM.
    obs_by_name = {o.name: o for o in flat}
    param_details = generated.get("parameter_details", {}) or {}

    panels = []
    used_names: set[str] = set()
    for p in generated.get("panels", []):
        param_names = p.get("parameter_names", []) or []
        parameters = []
        for name in param_names:
            obs = obs_by_name.get(name)
            if obs is None:
                continue
            used_names.add(name)
            details = param_details.get(name, {}) if isinstance(param_details, dict) else {}
            parameters.append({
                "name": obs.name,
                "value": obs.raw_value,
                "unit": obs.unit or None,
                "status": obs.status or "normal",
                "range_low": _try_float(obs.min_value),
                "range_high": _try_float(obs.max_value),
                "explanation": details.get("explanation") if isinstance(details, dict) else None,
                "common_reasons": details.get("common_reasons") if isinstance(details, dict) else None,
                "diet_suggestions": details.get("diet_suggestions") if isinstance(details, dict) else None,
            })
        if not parameters:
            continue
        out_of_range = sum(1 for param in parameters if param["status"] in ("low", "high", "borderline"))
        panels.append({
            "name": p.get("name", "General"),
            "intro": p.get("intro"),
            "out_of_range": out_of_range,
            "total_tests": len(parameters),
            "parameters": parameters,
            "panel_diet_tips": p.get("panel_diet_tips"),
        })

    # Any observation the LLM didn't assign to a panel still needs to be
    # accounted for — drop it into a fallback "Other" panel rather than
    # silently losing data the patient's report actually contains.
    leftover = [o for o in flat if o.name not in used_names]
    if leftover:
        leftover_params = [{
            "name": o.name, "value": o.raw_value, "unit": o.unit or None,
            "status": o.status or "normal",
            "range_low": _try_float(o.min_value), "range_high": _try_float(o.max_value),
        } for o in leftover]
        panels.append({
            "name": "Other Results",
            "intro": None,
            "out_of_range": sum(1 for p in leftover_params if p["status"] in ("low", "high", "borderline")),
            "total_tests": len(leftover_params),
            "parameters": leftover_params,
            "panel_diet_tips": None,
        })

    abnormal_count = sum(1 for o in flat if o.status in ("low", "high"))
    borderline_count = sum(1 for o in flat if o.status == "borderline")
    normal_count = sum(1 for o in flat if o.status == "normal")

    body_summary = [
        {
            "panel_name": p["name"],
            "status": "watch_out" if p["out_of_range"] > 0 else "normal",
            "key_parameters": [
                f"{param['name']}: {param['value']} [{param['status']}]"
                for param in p["parameters"] if param["status"] in ("low", "high", "borderline")
            ][:3],
        }
        for p in panels
    ]

    return {
        "patient": {
            "name": raw.PName,
            "age": _try_float(raw.Age) or 0,
            "gender": raw.Gender,
            "accession_no": raw.WorkOrderID,
            "date_of_test": raw.Date or "",  # raw.Date is nullable; PatientInfo.date_of_test isn't (see models.py)
        },
        "wellness": {
            "score": final_score,
            "label": final_label,
            "descriptor": generated.get("wellness_descriptor", ""),
            "greeting": generated.get("wellness_greeting", ""),
            "critical_alert": None,
            "follow_up_required": generated.get("follow_up_required", ""),
            "dietary_recommendation": generated.get("dietary_recommendation", ""),
            "lifestyle_recommendation": generated.get("lifestyle_recommendation", ""),
            "score_breakdown": [],
            "symptoms_to_watch": generated.get("symptoms_to_watch", []),
            "next_steps": generated.get("next_steps", []),
        },
        "health_summary_index": {
            "abnormal_count": abnormal_count,
            "borderline_count": borderline_count,
            "normal_count": normal_count,
        },
        "body_summary": body_summary,
        "panels": panels,
        "diet_plan": generated.get("diet_plan"),
        "isolated_abnormalities": generated.get("isolated_abnormalities"),
    }


def _try_float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None
