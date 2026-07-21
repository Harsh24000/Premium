import json
from collections.abc import Iterator

import groq

from .config import get_settings
from .extraction_prompt import EXTRACTION_SYSTEM
from .models import SmartReport
from .pdf_utils import compact_for_extraction
from .store import Session

_settings = get_settings()
_client: groq.Groq | None = None


def _get_client() -> groq.Groq:
    """Lazy singleton — creating the client at import time means a missing
    key crashes the whole app on boot instead of just the request that
    needed it."""
    global _client
    if _client is None:
        _client = groq.Groq(api_key=_settings.groq_api_key or None)
    return _client


def extract_smart_report_from_text(report_text: str) -> dict:
    """
    Best-effort extraction of the SmartReport structure from raw PDF text.
    Since the schema itself makes most fields nullable, an incomplete
    extraction still produces a valid, honest SmartReport rather than a
    fabricated-looking complete one.

    Compacts input aggressively first (see pdf_utils.compact_for_extraction)
    to fit small-account Groq TPM limits (some accounts are capped at 8000
    tokens/minute for this model — a full 21-page report's raw text alone
    can exceed that). If it still hits a rate/size limit, retries once with
    a harder truncation before giving up with a clear error.
    """
    compacted = compact_for_extraction(report_text)

    last_error: Exception | None = None
    for attempt, (text, max_tokens) in enumerate([
        (compacted, 3500),
        (compacted[:6000], 2500),  # fallback: harder truncation if still too large
    ]):
        try:
            response = _get_client().chat.completions.create(
                model=_settings.chat_model,
                temperature=0.1,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": EXTRACTION_SYSTEM},
                    {"role": "user", "content": text},
                ],
            )
            return json.loads(response.choices[0].message.content)
        except groq.APIStatusError as e:
            last_error = e
            is_rate_or_size = e.status_code in (413, 429)
            if is_rate_or_size and attempt == 0:
                continue  # retry once with the harder-truncated fallback
            raise

    raise last_error  # pragma: no cover — unreachable, satisfies type checkers


def _report_context_block(report: SmartReport) -> str:
    """Serialize the full smart report into a compact text block for the
    system prompt — the chat is grounded in ALL of it, not just a summary,
    so answers can reference specific panels, ranges, and diet guidance
    exactly as the report states them."""
    lines = [
        f"Patient: {report.patient.name}, {report.patient.age} years, {report.patient.gender}",
        f"Wellness Score: {report.wellness.score} ({report.wellness.label}) — {report.wellness.descriptor}",
    ]
    if report.wellness.critical_alert:
        lines.append(f"Critical Alert: {report.wellness.critical_alert}")
    lines.append(
        f"Test Summary: {report.health_summary_index.abnormal_count} abnormal, "
        f"{report.health_summary_index.borderline_count} borderline, "
        f"{report.health_summary_index.normal_count} normal"
    )
    lines.append("")

    for panel in report.panels:
        lines.append(f"== {panel.name} ({panel.out_of_range}/{panel.total_tests} out of range) ==")
        for p in panel.parameters:
            range_str = f"{p.range_low}-{p.range_high}" if p.range_low is not None else (p.range_text or "")
            lines.append(f"  {p.name}: {p.value} {p.unit or ''} [{p.status.upper()}] (range: {range_str})")
            if p.explanation:
                lines.append(f"    -> {p.explanation}")
        lines.append("")

    if report.diet_plan:
        lines.append(f"Diet Plan: {report.diet_plan.plan_name} — {report.diet_plan.rationale}")
        lines.append("Avoid: " + "; ".join(f.name for f in report.diet_plan.avoid))
        lines.append("Include: " + "; ".join(f.name for f in report.diet_plan.include))
        lines.append("")

    if report.isolated_abnormalities:
        for ia in report.isolated_abnormalities:
            lines.append(
                f"Isolated Abnormality — {ia.panel_name} / {ia.parameter_name}: "
                f"recommended tests: {', '.join(t.label for t in ia.recommended_tests)}"
            )

    return "\n".join(lines)


CHAT_SYSTEM_TEMPLATE = """You are Dr. Gyan, an AI health companion helping a patient understand their own lab report. You are not a human physician — the UI already discloses this, so you never need to claim otherwise, but you also don't need to caveat every message with it.

=== FULL SMART REPORT ===
{report_context}
=== END REPORT ===

HOW TO BEHAVE:

1. LENGTH — THIS IS THE MOST IMPORTANT RULE: Keep answers SHORT. Give a direct, confident answer in a few sentences. Target 40-70 words for a normal question. Only go longer if the patient explicitly asks for detail ("explain more", "tell me everything about X", "explain that more simply"). A long answer to a simple question is a failure condition, exactly as much as an unformatted wall of text is.

2. LANGUAGE — PLAIN, EVERYDAY WORDS ONLY. Assume the patient has no medical background. Every time you use a clinical term (a test name, a body part, a mechanism), immediately explain it in plain words in the same sentence — don't leave a term unexplained and don't assume the patient already knows what it means from earlier in the chat. Prefer short everyday comparisons over technical description: "creatinine is what your kidneys filter out of your blood, like a coffee filter catching grounds" beats a definition. If the patient asks you to explain something more simply, drop the term entirely on that pass and describe it only in terms of what they'd notice or feel.

3. FORMATTING: Plain short paragraphs are usually enough — 2-3 sentences, done. Only reach for bullets or a header if the answer genuinely has 3+ distinct items (e.g. listing several foods, several causes) or covers more than one topic; don't manufacture structure for a single fact. Use **bold** sparingly, just for the one or two key values or terms that matter most in that answer — not every marker name.

4. TONE: Warm, patient, unhurried — like someone who's explained this exact thing to a worried person many times and never makes them feel behind for asking. Direct but not alarmist. Reference the specific finding, not the whole report.

5. GROUNDING: Only reference findings, ranges, and diet guidance that actually appear in the report above. If asked something the report doesn't cover, say so in one line rather than guessing.

6. SAFETY: Never prescribe specific drugs or dosages. Briefly note what the finding means and when to see a doctor in person versus when it's likely benign.

7. FOLLOW-UP QUESTIONS: End EVERY response with exactly 2 short follow-up questions from the patient's own perspective. Vary the angle each time rather than defaulting to "what does X mean" repeatedly — draw from different lenses across the conversation: what a finding means, whether it's serious, what to eat or avoid, what happens next, or a finding you haven't discussed yet. Never repeat a question you've already asked in this conversation. Use this exact format on a new line:

|SUGGESTIONS|
[question 1]
[question 2]
"""


def build_chat_system(report: SmartReport) -> str:
    return CHAT_SYSTEM_TEMPLATE.format(report_context=_report_context_block(report))


def _call_groq_json(system: str, user: str, max_tokens: int = 600) -> dict:
    response = _get_client().chat.completions.create(
        model=_settings.chat_model,
        temperature=0.3,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return json.loads(response.choices[0].message.content)


def generate_high_risk_starter_questions(report: SmartReport) -> list[str]:
    """
    AI-generated, but constrained: 4 short questions a patient would
    genuinely want to ask, each from a different angle (meaning,
    severity, diet/lifestyle, next steps) rather than 4 variations of
    "what's wrong with panel X" — grounded in the report's own critical
    alert, most out-of-range panels, diet plan, and isolated
    abnormalities, never invented.
    """
    system = (
        "You are generating starter question chips for a patient chat interface, in plain "
        "everyday language — the patient has no medical background. Given a health report "
        "context, write exactly 4 SHORT questions (under 12 words each) from the PATIENT's "
        "perspective. Each of the 4 must come from a DIFFERENT angle: "
        "(1) what a specific abnormal finding means, in plain words; "
        "(2) whether something is serious or urgent; "
        "(3) diet or lifestyle — only if the report has a diet_plan or dietary_recommendation; "
        "(4) what happens next — a recommended test, follow-up, or isolated abnormality. "
        "Prioritize the report's most severe/high-risk findings first. If fewer than 4 angles "
        "have real material to draw from, write fewer questions rather than padding with a "
        "repeat of an angle already used. "
        'Return ONLY a JSON object: {"questions": ["...", "...", "...", "..."]}'
    )
    user = _report_context_block(report)
    try:
        payload = _call_groq_json(system, user, max_tokens=300)
        questions = payload.get("questions", [])
        return [q.strip() for q in questions if isinstance(q, str) and q.strip()][:4]
    except Exception:
        # Fail closed to a safe, deterministic fallback built from the report
        # itself rather than a generic/empty state.
        fallback = []
        if report.wellness.critical_alert:
            fallback.append("What does my critical alert mean?")
        for panel in report.panels[:2]:
            fallback.append(f"What's going on with my {panel.name.title()} results?")
        return fallback[:4]


def stream_chat(session: Session, user_message: str) -> Iterator[str]:
    system = build_chat_system(session.report)
    history = session.messages[-8:] if len(session.messages) > 8 else session.messages
    messages = [{"role": "system", "content": system}] + history + [{"role": "user", "content": user_message}]

    try:
        stream = _get_client().chat.completions.create(
            model=_settings.chat_model,
            messages=messages,
            stream=True,
            max_tokens=350,
            temperature=0.4,
        )
        full_response = ""
        got_content = False
        for chunk in stream:
            try:
                content = chunk.choices[0].delta.content
            except (AttributeError, IndexError):
                continue
            if content:
                got_content = True
                full_response += content
                yield content

        if got_content:
            session.messages.append({"role": "user", "content": user_message})
            session.messages.append({"role": "assistant", "content": full_response})
        else:
            yield "I couldn't process that just now — could you try rephrasing?"
    except groq.RateLimitError:
        yield "I'm getting a lot of requests right now. Please try again in a moment."
    except Exception as e:
        yield f"Something went wrong: {e}. Please try again."
