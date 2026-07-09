import type { InfographicSummary } from "../types";

const SCORE_COLORS: Record<string, string> = {
  Poor: "#dc2626",
  Suboptimal: "#f97316",
  Fair: "#eab308",
  Good: "#16a34a",
  Optimal: "#0891b2",
};

export default function InfographicHeader({ data }: { data: InfographicSummary }) {
  const color = SCORE_COLORS[data.wellness_label] ?? "#64748b";

  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: "16px",
        padding: "1rem",
        margin: "0.75rem",
        boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            border: `4px solid ${color}`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "1.3rem", fontWeight: 800, color, lineHeight: 1 }}>{data.wellness_score}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#111827" }}>
            {data.patient_name}
          </div>
          <div style={{ fontSize: "0.85rem", color, fontWeight: 600 }}>{data.wellness_label} Wellness Score</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.85rem" }}>
        <div style={{ flex: 1, textAlign: "center", background: "#fef2f2", borderRadius: "10px", padding: "0.5rem" }}>
          <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#dc2626" }}>{data.abnormal_count}</div>
          <div style={{ fontSize: "0.7rem", color: "#64748b" }}>Abnormal</div>
        </div>
        <div style={{ flex: 1, textAlign: "center", background: "#fffbeb", borderRadius: "10px", padding: "0.5rem" }}>
          <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#d97706" }}>{data.borderline_count}</div>
          <div style={{ fontSize: "0.7rem", color: "#64748b" }}>Borderline</div>
        </div>
        <div style={{ flex: 1, textAlign: "center", background: "#f0fdf4", borderRadius: "10px", padding: "0.5rem" }}>
          <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#16a34a" }}>{data.normal_count}</div>
          <div style={{ fontSize: "0.7rem", color: "#64748b" }}>Normal</div>
        </div>
      </div>

      {data.critical_alert && (
        <div
          style={{
            marginTop: "0.75rem",
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: "8px",
            padding: "0.5rem 0.7rem",
            fontSize: "0.8rem",
            color: "#991b1b",
            fontWeight: 600,
          }}
        >
          ⚠️ {data.critical_alert}
        </div>
      )}

      {data.top_issues.length > 0 && (
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.4rem", overflowX: "auto", paddingBottom: "0.2rem" }}>
          {data.top_issues.map((issue, i) => (
            <div
              key={i}
              style={{
                flexShrink: 0,
                background: issue.status === "high" ? "#fff7ed" : "#eff6ff",
                border: `1px solid ${issue.status === "high" ? "#fdba74" : "#93c5fd"}`,
                borderRadius: "8px",
                padding: "0.35rem 0.6rem",
                fontSize: "0.75rem",
                whiteSpace: "nowrap",
              }}
            >
              <strong>{issue.parameter}</strong> {issue.value}{issue.unit ?? ""} {issue.status === "high" ? "↑" : "↓"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
