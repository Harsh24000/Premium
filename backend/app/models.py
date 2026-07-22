"""
SmartReport schema — derived from 4 real report examples (patients A-D)
provided directly, not designed from scratch. Patient identifiers were
not retained in this codebase; only the field structure was.

IMPORTANT: this app does NOT parse the source PDFs into this shape. That's
a separate, much bigger OCR/structure-extraction problem (trend charts,
radar/wellness scores, organ-mapped panels) than a standard lab-report
pipeline can reliably do. This backend accepts a SmartReport JSON that's
already been produced elsewhere and focuses on the paid chat experience
built on top of it.
"""

from typing import Literal
from pydantic import BaseModel, Field


class PatientInfo(BaseModel):
    name: str  # kept required — without this, personalization/greeting can't work meaningfully
    age: float = 0
    gender: str = ""
    accession_no: str = ""
    date_of_test: str = ""


class ScoreBreakdownCategory(BaseModel):
    # Seen in all 4 reports: 9 fixed categories with icons. Individual
    # numeric sub-scores weren't extractable from the source PDFs (only
    # the overall wellness score was), so this is optional per category —
    # render as a labeled badge if score is None, a filled gauge if present.
    name: Literal[
        "cardiovascular", "metabolic", "inflammatory", "nutritional",
        "liver", "kidney", "thyroid", "hematological", "hormonal",
    ]
    score: int | None = None


class WellnessSummary(BaseModel):
    score: int = 0  # 0-100 — kept as the core visual, defaults to 0 rather than crashing
    # Poor <50, Suboptimal 51-60, Fair 61-69, Good 70-90, Optimal >90
    label: Literal["Poor", "Suboptimal", "Fair", "Good", "Optimal"] = "Fair"
    descriptor: str = ""  # e.g. "Minor issues that require attention"
    greeting: str = ""  # e.g. "Dear [Name], Well done! Most of your health markers..."
    critical_alert: str | None = None  # e.g. "BUN (7.94) is Low — please seek medical advice"
    follow_up_required: str = ""  # e.g. "No follow-up actions required at this time."
    dietary_recommendation: str = ""
    lifestyle_recommendation: str = ""
    score_breakdown: list[ScoreBreakdownCategory] = []
    symptoms_to_watch: list[str] = []
    next_steps: list[str] = []


class HistoricalPoint(BaseModel):
    date: str
    value: float


class Parameter(BaseModel):
    name: str
    value: str
    unit: str | None = None
    status: Literal["normal", "low", "high", "borderline"]
    range_low: float | None = None
    range_high: float | None = None
    range_text: str | None = None  # for non-numeric ranges e.g. "< 0.3"
    explanation: str | None = None
    common_reasons: list[str] | None = None
    diet_suggestions: list[str] | None = None
    history: list[HistoricalPoint] | None = None  # seen for one patient's KFT params


class Panel(BaseModel):
    name: str  # e.g. "KIDNEY FUNCTION TEST (KFT)"
    intro: str | None = None  # panel-level explainer paragraph
    out_of_range: int
    total_tests: int
    parameters: list[Parameter] = []
    panel_diet_tips: list[str] | None = None  # panel-specific tips, distinct from the overall diet plan


class BodySummaryHighlight(BaseModel):
    # The organ-diagram callout boxes — only the panels with abnormal
    # findings (plus any all-normal panels get a green confirmation box)
    panel_name: str
    status: Literal["normal", "borderline", "watch_out"]
    key_parameters: list[str] = []  # short "name: value [status]" strings for the callout box


class DietFoodItem(BaseModel):
    name: str
    description: str


class DietPlan(BaseModel):
    plan_name: str  # e.g. "Longevity & wellness diet"
    rationale: str  # e.g. "Reduce oxidative stress and glycation"
    avoid: list[DietFoodItem] = []
    include: list[DietFoodItem] = []
    bonus_tips: list[str] = []


class RecommendedTest(BaseModel):
    label: str  # e.g. "Infection screen", "Hematology consult"


class IsolatedAbnormality(BaseModel):
    panel_name: str
    parameter_name: str
    explanation: str
    common_symptoms: list[str] = []
    next_steps: list[str] = []
    recommended_tests: list[RecommendedTest] = []


class HealthSummaryIndex(BaseModel):
    abnormal_count: int = 0
    borderline_count: int = 0
    normal_count: int = 0


class SmartReport(BaseModel):
    patient: PatientInfo
    wellness: WellnessSummary
    health_summary_index: HealthSummaryIndex = Field(default_factory=HealthSummaryIndex)
    body_summary: list[BodySummaryHighlight] = []
    panels: list[Panel] = []
    diet_plan: DietPlan | None = None
    isolated_abnormalities: list[IsolatedAbnormality] | None = None
    # Distinct from diet_plan: general nutrition guidance shaped by age/
    # gender, using local Indian food items by name — always populated
    # (unlike diet_plan, which is only for genuine abnormal findings).
    # Optional because reports submitted via the direct-JSON path (no
    # LLM generation involved) won't have this unless the source JSON
    # already includes it.
    demographic_diet_insight: str | None = None


def safe_parse_smart_report(data: dict) -> SmartReport:
    """
    Defensive construction for LLM-extracted data.

    Model-level defaults (above) only cover a KEY being entirely absent.
    They don't help when a key is present but one item inside it is
    malformed — e.g. a single panel missing its own required sub-field
    still fails pydantic validation for the WHOLE `panels` list, not just
    that one panel, because that's how nested list validation works.

    This is the actual fix for "the LLM's output varies across reports":
    validate each list item individually and silently drop only the ones
    that don't parse, instead of one bad item invalidating the entire
    report. No fields are ever fabricated here — a dropped item is simply
    missing from the result, same as if the LLM had never mentioned it.
    """
    import copy
    data = copy.deepcopy(data)

    def _filter_valid(items: list, model_cls: type[BaseModel]) -> list[dict]:
        valid = []
        for item in items or []:
            try:
                valid.append(model_cls(**item).model_dump())
            except Exception:
                continue  # drop this one item, keep the rest
        return valid

    data["panels"] = _filter_valid(data.get("panels"), Panel)
    for panel in data["panels"]:
        panel["parameters"] = _filter_valid(panel.get("parameters"), Parameter)

    data["body_summary"] = _filter_valid(data.get("body_summary"), BodySummaryHighlight)

    if data.get("isolated_abnormalities") is not None:
        filtered = _filter_valid(data["isolated_abnormalities"], IsolatedAbnormality)
        data["isolated_abnormalities"] = filtered or None

    if data.get("diet_plan") is not None:
        try:
            DietPlan(**data["diet_plan"])
        except Exception:
            data["diet_plan"] = None

    if isinstance(data.get("wellness"), dict):
        data["wellness"]["score_breakdown"] = _filter_valid(
            data["wellness"].get("score_breakdown"), ScoreBreakdownCategory
        )

    return SmartReport(**data)
