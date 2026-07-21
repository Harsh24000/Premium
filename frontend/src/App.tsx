import { useState } from "react";
import ReportIntake from "./components/ReportIntake";
import ReportDashboard from "./components/ReportDashboard";
import ChatWidget from "./components/ChatWidget";
import { activatePlan } from "./api";
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
    // A fresh session always starts on the trial plan (see store.py) — if
    // this person had paid, that status just lived in the same in-memory
    // dict that got wiped. Best-effort restore it rather than silently
    // downgrading a paying user back to the trial quota. This is a
    // stopgap: the real fix is persisting plan state somewhere that
    // survives a restart (see the cost/architecture notes), keyed by
    // something durable — a session UUID that changes on every recovery
    // isn't that, so this only helps within one browser tab's lifetime.
    if (result && result.plan !== "trial") {
      try {
        const upgraded = await activatePlan(fresh.session_id, result.plan);
        const restored = { ...fresh, plan: upgraded.plan, messages_quota: upgraded.quota, messages_remaining: upgraded.quota };
        setResult(restored);
        return restored.session_id;
      } catch {
        // Restore failed — fall through to the trial-plan session rather
        // than blocking the user entirely.
      }
    }
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
      {/* Keyed on session_id: a fresh session after recovery has no memory
          of the prior conversation on the backend either, so remounting
          here (fresh quota, empty message list) matches reality instead
          of showing chat history the server no longer has context for. */}
      <ChatWidget
        key={result.session_id}
        sessionId={result.session_id}
        infographic={result.infographic}
        starterQuestions={result.starter_questions}
        report={result.report}
        plan={result.plan}
        messagesRemaining={result.messages_remaining}
        messagesQuota={result.messages_quota}
        onSessionExpired={handleSessionExpired}
      />
    </>
  );
}
