import type { InfographicSummary } from "../types";

export default function SummaryIntro({ data }: { data: InfographicSummary }) {
  return (
    <div
      style={{
        margin: "0.75rem",
        padding: "1rem 1.1rem",
        background: "#ffffff",
        borderRadius: "16px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.07)",
        border: "1px solid #f1f5f9",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.85rem" }}>
        <div>
          <div style={{ fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>
            {toTitleCase(data.patient_name)}
          </div>
          <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "0.15rem" }}>
            {data.patient_age ? `${Math.round(data.patient_age)} yrs` : ""}
            {data.patient_age && data.patient_gender ? " • " : ""}
            {formatGender(data.patient_gender)}
          </div>
        </div>
        <div style={{ fontSize: "1.6rem" }}>🩺</div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <StatBlock label="Normal" value={data.normal_count} color="#16a34a" bg="#f0fdf4" />
        <StatBlock label="Abnormal" value={data.abnormal_count} color="#dc2626" bg="#fef2f2" />
        <StatBlock label="Borderline" value={data.borderline_count} color="#d97706" bg="#fffbeb" />
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
    </div>
  );
}

function StatBlock({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center", background: bg, borderRadius: "10px", padding: "0.55rem 0.25rem" }}>
      <div style={{ fontSize: "1.3rem", fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: "0.68rem", color: "#64748b", fontWeight: 600, marginTop: "0.1rem" }}>{label}</div>
    </div>
  );
}

function toTitleCase(name: string): string {
  // Source names sometimes have no space after a title, e.g.
  // "MISS.LORRAINE KEMO MHALADI" — insert one before splitting, or the
  // whole "MISS.LORRAINE" token gets title-cased as one word.
  const spaced = name.replace(/\b(MISS|MRS|MR|MS|DR)\.(?=\S)/gi, "$1. ");
  return spaced
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function formatGender(g: string): string {
  const normalized = g.trim().toUpperCase();
  if (normalized === "F" || normalized === "FEMALE") return "Female";
  if (normalized === "M" || normalized === "MALE") return "Male";
  return g;
}
