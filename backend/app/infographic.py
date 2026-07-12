"""
Two things get built here, both deterministically from the SmartReport's
already-generated fields — no new LLM call:

1. Card data: patient name/age/gender + normal/abnormal/borderline counts.
2. `intro_message`: a 4-5 sentence self-introduction in Dr. Gyan's voice,
   assembled from wellness.descriptor/follow_up_required/dietary_
   recommendation (already generated once by raw_to_smart.py's LLM pass,
   or present in a directly-submitted SmartReport) — reused as sentences
   in a real greeting instead of restating them as a flat summary line.
   This is shown as the FIRST chat bubble, not static header text.
"""

from .models import SmartReport


def build_infographic_summary(report: SmartReport) -> dict:
    top_issues = []
    for panel in report.panels:
        for param in panel.parameters:
            if param.status in ("low", "high"):
                top_issues.append({
                    "panel": panel.name,
                    "parameter": param.name,
                    "value": param.value,
                    "unit": param.unit,
                    "status": param.status,
                })
    panel_abnormal_counts = {p.name: p.out_of_range for p in report.panels}
    top_issues.sort(key=lambda x: panel_abnormal_counts.get(x["panel"], 0), reverse=True)
    flagged_panels = list(dict.fromkeys(issue["panel"] for issue in top_issues))  # dedupe, keep order

    intro_message = _build_intro_message(report, flagged_panels)

    return {
        "patient_name": report.patient.name,
        "patient_age": report.patient.age,
        "patient_gender": report.patient.gender,
        "abnormal_count": report.health_summary_index.abnormal_count,
        "borderline_count": report.health_summary_index.borderline_count,
        "normal_count": report.health_summary_index.normal_count,
        "critical_alert": report.wellness.critical_alert,
        "top_issues": top_issues[:5],
        "intro_message": intro_message,
    }


def _build_intro_message(report: SmartReport, flagged_panels: list[str]) -> str:
    descriptor = (report.wellness.descriptor or "").strip()
    follow_up = (report.wellness.follow_up_required or "").strip()
    diet_rec = (report.wellness.dietary_recommendation or "").strip()

    sentences = ["Hi, I'm Dr. Gyan 👋 I've reviewed your lab report."]

    if descriptor:
        sentences.append(descriptor)
    else:
        sentences.append("Your results are largely within the normal range.")

    if flagged_panels:
        areas = ", ".join(p.title() for p in flagged_panels[:3])
        sentences.append(f"A few areas worth discussing together: {areas}.")

    # Skip generic "no follow-up needed" filler — only include if it's
    # actually saying something actionable.
    if follow_up and "no follow-up" not in follow_up.lower() and "not required" not in follow_up.lower():
        sentences.append(follow_up)
    elif diet_rec:
        sentences.append(diet_rec)

    sentences.append("Feel free to ask me anything about your results — I'm here to help.")

    return " ".join(sentences)
