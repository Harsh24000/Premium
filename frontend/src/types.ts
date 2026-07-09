export interface PatientInfo {
  name: string;
  age: number;
  gender: string;
  accession_no: string;
  date_of_test: string;
}

export interface ScoreBreakdownCategory {
  name: string;
  score: number | null;
}

export interface WellnessSummary {
  score: number;
  label: "Poor" | "Suboptimal" | "Fair" | "Good" | "Optimal";
  descriptor: string;
  greeting: string;
  critical_alert: string | null;
  follow_up_required: string;
  dietary_recommendation: string;
  lifestyle_recommendation: string;
  score_breakdown: ScoreBreakdownCategory[];
  symptoms_to_watch: string[];
  next_steps: string[];
}

export interface Parameter {
  name: string;
  value: string;
  unit: string | null;
  status: "normal" | "low" | "high" | "borderline";
  range_low: number | null;
  range_high: number | null;
  range_text: string | null;
  explanation: string | null;
  common_reasons: string[] | null;
  diet_suggestions: string[] | null;
}

export interface Panel {
  name: string;
  intro: string | null;
  out_of_range: number;
  total_tests: number;
  parameters: Parameter[];
  panel_diet_tips: string[] | null;
}

export interface BodySummaryHighlight {
  panel_name: string;
  status: "normal" | "borderline" | "watch_out";
  key_parameters: string[];
}

export interface DietFoodItem {
  name: string;
  description: string;
}

export interface DietPlan {
  plan_name: string;
  rationale: string;
  avoid: DietFoodItem[];
  include: DietFoodItem[];
  bonus_tips: string[];
}

export interface RecommendedTest {
  label: string;
}

export interface IsolatedAbnormality {
  panel_name: string;
  parameter_name: string;
  explanation: string;
  common_symptoms: string[];
  next_steps: string[];
  recommended_tests: RecommendedTest[];
}

export interface HealthSummaryIndex {
  abnormal_count: number;
  borderline_count: number;
  normal_count: number;
}

export interface SmartReport {
  patient: PatientInfo;
  wellness: WellnessSummary;
  health_summary_index: HealthSummaryIndex;
  body_summary: BodySummaryHighlight[];
  panels: Panel[];
  diet_plan: DietPlan | null;
  isolated_abnormalities: IsolatedAbnormality[] | null;
}

export interface TopIssue {
  panel: string;
  parameter: string;
  value: string;
  unit: string | null;
  status: string;
}

export interface InfographicSummary {
  patient_name: string;
  wellness_score: number;
  wellness_label: string;
  abnormal_count: number;
  borderline_count: number;
  normal_count: number;
  critical_alert: string | null;
  top_issues: TopIssue[];
}

export interface SubmitReportResponse {
  session_id: string;
  infographic: InfographicSummary;
  starter_questions: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
