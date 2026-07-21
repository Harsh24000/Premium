import { useRef, useState } from "react";
import { submitRawReport, submitReport, fetchMockReport } from "../api";
import type { SmartReport, SubmitReportResponse } from "../types";

interface Props {
  onReady: (result: SubmitReportResponse, resubmit: () => Promise<SubmitReportResponse>) => void;
}

export default function ReportIntake({ onReady }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setLoading(true);
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      // Bound to this exact payload — if the session later expires
      // (e.g. Render free-tier spin-down wiping in-memory state),
      // calling this again regenerates it from the same source data.
      const resubmit = () => submitRawReport(raw);
      const result = await resubmit();
      onReady(result, resubmit);
    } catch (e) {
      if (e instanceof SyntaxError) {
        setError("That file isn't valid JSON. Export it again from your lab portal and retry.");
      } else {
        setError(e instanceof Error ? e.message : "The upload didn't go through. Try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function useMockReport() {
    setError(null);
    setLoading(true);
    try {
      const report = await fetchMockReport();
      const resubmit = () => submitReport(report as unknown as SmartReport);
      const result = await resubmit();
      onReady(result, resubmit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The sample report didn't load.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="intake">
      <div className="intake__card">
        <div className="intake__brand">NirogGyan</div>
        <p className="intake__sub">
          Upload your lab report and Dr. Gyan will turn it into a summary you can actually read.
        </p>

        <button className="dropzone" onClick={() => inputRef.current?.click()} disabled={loading}>
          {loading ? (
            "Reading your report…"
          ) : (
            <>
              Choose your report file
              <span className="dropzone__hint">JSON export from your lab</span>
            </>
          )}
        </button>
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

        <button className="intake__alt" onClick={useMockReport} disabled={loading}>
          Use a sample report instead
        </button>

        {error && <div className="intake__error">{error}</div>}
      </div>
    </div>
  );
}
