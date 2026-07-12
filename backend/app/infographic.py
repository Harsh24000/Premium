"""
The infographic summary shown when chat opens is built directly from the
SmartReport's own structured fields. `short_summary` reuses the
wellness.descriptor text that was already generated once (either by
raw_to_smart.py's LLM narrative pass, or present in a directly-submitted
SmartReport) rather than making a second LLM call just to restate it —
combined with which specific panels are flagged, built deterministically
here. No wellness score/count gauge — just a short line of what's
actually going on.
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
    # Most-affected panels first (more abnormal params = more relevant to lead with)
    panel_abnormal_counts = {p.name: p.out_of_range for p in report.panels}
    top_issues.sort(key=lambda x: panel_abnormal_counts.get(x["panel"], 0), reverse=True)

    flagged_panels = list(dict.fromkeys(issue["panel"] for issue in top_issues))  # dedupe, keep order

    descriptor = (report.wellness.descriptor or "").strip()
    if flagged_panels:
        areas = ", ".join(p.title() for p in flagged_panels[:3])
        short_summary = f"{descriptor} Worth keeping an eye on: {areas}.".strip()
    elif descriptor:
        short_summary = descriptor
    else:
        short_summary = "Your results are largely within the normal range."

    return {
        "patient_name": report.patient.name,
        "short_summary": short_summary,
        "critical_alert": report.wellness.critical_alert,
        "top_issues": top_issues[:5],
    }
