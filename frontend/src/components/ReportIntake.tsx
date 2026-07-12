import { useRef, useState } from "react";
import { submitReport, fetchMockReport } from "../api";
import type { SmartReport, SubmitReportResponse } from "../types";

interface Props {
  onReady: (result: SubmitReportResponse) => void;
}

export default function ReportIntake({ onReady }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmitJson(report: SmartReport) {
    setError(null);
    setLoading(true);
    try {
      const result = await submitReport(report);
      onReady(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const report = JSON.parse(text) as SmartReport;
      await handleSubmitJson(report);
    } catch (e) {
      if (e instanceof SyntaxError) {
        setError("That file isn't valid JSON — check it's the exported smart report, not a PDF.");
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    }
  }

  async function useMockReport() {
    setError(null);
    setLoading(true);
    try {
      const report = await fetchMockReport();
      await handleSubmitJson(report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load mock report.");
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "1.5rem", background: "#f8fafc" }}>
      <div style={{ background: "#fff", borderRadius: "18px", padding: "1.5rem", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 800, margin: "0 0 0.4rem", color: "#111827" }}>
          NirogGyan Premium
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", margin: "0 0 1.25rem" }}>
          Connect your smart health report to start your personalized consultation.
        </p>

        <div
          onClick={() => inputRef.current?.click()}
          style={{
            border: "2px dashed #c7d2fe",
            borderRadius: "14px",
            padding: "1.5rem",
            textAlign: "center",
            color: "#4f46e5",
            fontWeight: 600,
            cursor: "pointer",
            marginBottom: "0.75rem",
          }}
        >
          {loading ? "Loading…" : "Tap to upload your Smart Report (JSON)"}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        <button
          onClick={useMockReport}
          disabled={loading}
          style={{
            width: "100%",
            background: "none",
            border: "1px solid #e2e8f0",
            borderRadius: "10px",
            padding: "0.6rem",
            color: "#64748b",
            fontSize: "0.85rem",
          }}
        >
          Use sample report (for testing)
        </button>

        {error && <p style={{ color: "#dc2626", fontSize: "0.85rem", marginTop: "0.75rem" }}>{error}</p>}
      </div>
    </div>
  );
}
