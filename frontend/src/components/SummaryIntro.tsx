import type { InfographicSummary } from "../types";

export default function SummaryIntro({ data }: { data: InfographicSummary }) {
  return (
    <div style={{ margin: "0.75rem", padding: "0.9rem 1rem", background: "#ffffff", borderRadius: "14px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)" }}>
      <p style={{ margin: 0, fontSize: "0.95rem", color: "#1e293b", lineHeight: 1.5 }}>
        {data.short_summary}
      </p>
      {data.critical_alert && (
        <div
          style={{
            marginTop: "0.6rem",
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: "8px",
            padding: "0.45rem 0.65rem",
            fontSize: "0.8rem",
            color: "#991b1b",
            fontWeight: 600,
          }}
        >
          ⚠️ {data.critical_alert}
        </div>
      )}
    </div>
  );
}
