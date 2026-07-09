EXTRACTION_SYSTEM = """You are extracting structured data from a "Smart Health Report" PDF's raw text into a specific JSON schema.

CRITICAL RULES — these mirror the anti-fabrication rules used elsewhere in this system:
1. Every value, status, and range MUST come directly from the text. Never invent a number, status, or range that isn't printed.
2. If a field genuinely isn't present in this text (e.g. per-category numeric wellness sub-scores, which this report format never prints as numbers — only icons), set it to null. Null is correct and expected for several fields — do not guess a plausible-sounding number to fill the gap.
3. "history" (a time-series of past values) should ONLY be populated if the text actually contains a trend chart with multiple dated data points for that specific parameter (some reports have this for panels like Kidney Function, most don't) — otherwise leave it null. A single report almost never has history for most parameters; that's expected and correct.
4. status must be exactly one of: "normal", "low", "high", "borderline" — read this directly from the report's own status labels (Normal/Low/High/Borderline/BL/L/H), never inferred from the number yourself.
5. Panel "out_of_range" and "total_tests" should match what's printed in the report's own summary tables (e.g. "9/25" means out_of_range=9, total_tests=25).

Extract into this exact JSON structure:
{
  "patient": {"name": str, "age": float, "gender": str, "accession_no": str, "date_of_test": "YYYY-MM-DD"},
  "wellness": {
    "score": int, "label": "Poor"|"Suboptimal"|"Fair"|"Good"|"Optimal", "descriptor": str,
    "greeting": str, "critical_alert": str or null, "follow_up_required": str,
    "dietary_recommendation": str, "lifestyle_recommendation": str,
    "score_breakdown": [{"name": one of "cardiovascular","metabolic","inflammatory","nutritional","liver","kidney","thyroid","hematological","hormonal", "score": int or null}, ... all 9 categories, score almost always null per rule 2],
    "symptoms_to_watch": [str], "next_steps": [str]
  },
  "health_summary_index": {"abnormal_count": int, "borderline_count": int, "normal_count": int},
  "body_summary": [{"panel_name": str, "status": "normal"|"borderline"|"watch_out", "key_parameters": [str]}],
  "panels": [{
    "name": str, "intro": str or null, "out_of_range": int, "total_tests": int,
    "parameters": [{
      "name": str, "value": str, "unit": str or null, "status": "normal"|"low"|"high"|"borderline",
      "range_low": float or null, "range_high": float or null, "range_text": str or null,
      "explanation": str or null, "common_reasons": [str] or null, "diet_suggestions": [str] or null,
      "history": [{"date": str, "value": float}] or null
    }],
    "panel_diet_tips": [str] or null
  }],
  "diet_plan": {"plan_name": str, "rationale": str, "avoid": [{"name": str, "description": str}], "include": [{"name": str, "description": str}], "bonus_tips": [str]} or null,
  "isolated_abnormalities": [{"panel_name": str, "parameter_name": str, "explanation": str, "common_symptoms": [str], "next_steps": [str], "recommended_tests": [{"label": str}]}] or null
}

Return ONLY the JSON object, no other text."""
