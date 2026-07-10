"""
SmartReport schema — derived from 4 real report examples (Aman, Bimla,
Surinder, Sneha) provided directly, not designed from scratch.

IMPORTANT: this app does NOT parse the source PDFs into this shape. That's
a separate, much bigger OCR/structure-extraction problem (trend charts,
radar/wellness scores, organ-mapped panels) than a standard lab-report
pipeline can reliably do. This backend accepts a SmartReport JSON that's
already been produced elsewhere and focuses on the paid chat experience
built on top of it.
"""

from typing import Literal
from pydantic import BaseModel


class PatientInfo(BaseModel):
    name: str
    age: float
    gender: str
    accession_no: str
    date_of_test: str


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
    score: int  # 0-100
    # Poor <50, Suboptimal 51-60, Fair 61-69, Good 70-90, Optimal >90
    label: Literal["Poor", "Suboptimal", "Fair", "Good", "Optimal"]
    descriptor: str  # e.g. "Minor issues that require attention"
    greeting: str  # e.g. "Dear Mr. AMAN, Well done! Most of your health markers..."
    critical_alert: str | None = None  # e.g. "BUN (7.94) is Low — please seek medical advice"
    follow_up_required: str  # e.g. "No follow-up actions required at this time."
    dietary_recommendation: str
    lifestyle_recommendation: str
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
    history: list[HistoricalPoint] | None = None  # seen for Surinder's KFT params


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
    health_summary_index: HealthSummaryIndex
    body_summary: list[BodySummaryHighlight] = []
    panels: list[Panel] = []
    diet_plan: DietPlan | None = None
    isolated_abnormalities: list[IsolatedAbnormality] | None = None
