"""
The infographic summary shown when chat opens is built directly from the
SmartReport's own structured fields — no LLM call needed, since the report
already carries a wellness score, counts, and top issues. Keeping this
deterministic means the opening screen can never contain an invented
number, consistent with the free app's guardrail philosophy.
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

    return {
        "patient_name": report.patient.name,
        "wellness_score": report.wellness.score,
        "wellness_label": report.wellness.label,
        "abnormal_count": report.health_summary_index.abnormal_count,
        "borderline_count": report.health_summary_index.borderline_count,
        "normal_count": report.health_summary_index.normal_count,
        "critical_alert": report.wellness.critical_alert,
        "top_issues": top_issues[:5],
    }
