import json
from collections.abc import Iterator

import groq

from .config import get_settings
from .extraction_prompt import EXTRACTION_SYSTEM
from .models import SmartReport
from .store import Session

_settings = get_settings()
_client: groq.Groq | None = None


def _get_client() -> groq.Groq:
    """
    Lazy singleton. Creating groq.Groq(api_key=...) at MODULE IMPORT TIME
    (the previous version) means a missing/bad GROQ_API_KEY crashes the
    entire app on startup with 'Exited with status 1' — every request
    fails, including ones that don't even need the LLM. Deferring
    creation to first actual use means the app boots fine either way,
    and only the specific request that needs Groq fails cleanly.
    """
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
    """
    response = _get_client().chat.completions.create(
        model=_settings.chat_model,
        temperature=0.1,
        max_tokens=8000,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": EXTRACTION_SYSTEM},
            {"role": "user", "content": report_text},
        ],
    )
    return json.loads(response.choices[0].message.content)


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


CHAT_SYSTEM_TEMPLATE = """You are Dr. Gyan, a senior, highly experienced attending physician reviewing this patient's full smart health report with them directly.

=== FULL SMART REPORT ===
{report_context}
=== END REPORT ===

HOW TO BEHAVE:

1. TONE: Speak with the calm authority and precision of an experienced doctor in a real consultation — warm but not casual, direct but not alarmist. Never use "bot" phrasing like "I'm just an AI." You have this patient's full report in front of you; reference it specifically.

2. FORMATTING — THIS IS MANDATORY: Every response MUST use Markdown formatting, never a single plain paragraph. Use:
   - **Bold** for key values, marker names, and critical terms
   - Bullet points for lists (symptoms, causes, recommendations)
   - Short headers (##) when covering more than one topic in a reply
   - Keep paragraphs short (2-3 sentences max) — this is a mobile chat interface, not a report page
   A plain, unformatted wall of text is a failure condition here.

3. GROUNDING: Only reference findings, ranges, and diet guidance that actually appear in the report above. If asked something the report doesn't cover, say so plainly rather than guessing.

4. SAFETY: Never prescribe specific drugs or dosages. Focus on what the finding means, what commonly causes it, and when to see a doctor in person versus when it's likely benign — the report's own "isolated abnormality" guidance is your model for this judgment.

5. FOLLOW-UP QUESTIONS: End EVERY response with exactly 2 relevant follow-up questions the patient might naturally want to ask next, written from the patient's own perspective. Use this exact format on a new line:

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
    AI-generated, but constrained: 3-4 short questions a patient would
    genuinely want to ask, prioritizing the report's own critical_alert
    and most out-of-range panels — grounded in real findings, not invented.
    """
    system = (
        "You are generating starter question chips for a patient chat interface. "
        "Given a health report context, write 3 to 4 SHORT questions (under 12 words each) "
        "from the PATIENT's perspective, prioritizing their most severe/high-risk findings first. "
        'Return ONLY a JSON object: {"questions": ["...", "...", "..."]}'
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
            max_tokens=700,
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
