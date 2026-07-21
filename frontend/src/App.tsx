import { useState } from "react";
import ReportIntake from "./components/ReportIntake";
import ReportDashboard from "./components/ReportDashboard";
import ChatWidget from "./components/ChatWidget";
import type { SubmitReportResponse } from "./types";

export default function App() {
  const [result, setResult] = useState<SubmitReportResponse | null>(null);
  // Bound to the original submitted payload — calling this regenerates a
  // fresh session from the SAME source data if the old one expires
  // (in-memory sessions don't survive a Render free-tier spin-down).
  const [resubmit, setResubmit] = useState<(() => Promise<SubmitReportResponse>) | null>(null);

  if (!result || !resubmit) {
    return (
      <ReportIntake
        onReady={(r, resubmitFn) => {
          setResult(r);
          setResubmit(() => resubmitFn);
        }}
      />
    );
  }

  async function handleSessionExpired(): Promise<string> {
    const fresh = await resubmit!();
    setResult(fresh);
    return fresh.session_id;
  }

  return (
    <>
      <ReportDashboard
        report={result.report}
        infographic={result.infographic}
        onStartOver={() => {
          setResult(null);
          setResubmit(null);
        }}
      />
      {/* Floating launcher, bottom-left. Keyed on session_id so a fresh
          session after recovery doesn't strand the old chat state. */}
      <ChatWidget
        sessionId={result.session_id}
        infographic={result.infographic}
        starterQuestions={result.starter_questions}
        report={result.report}
        onSessionExpired={handleSessionExpired}
      />
    </>
  );
}
