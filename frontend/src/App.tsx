import { useState } from "react";
import ReportIntake from "./components/ReportIntake";
import ChatScreen from "./components/ChatScreen";
import BottomNav from "./components/BottomNav";
import ComingSoon from "./components/ComingSoon";
import type { SubmitReportResponse } from "./types";

type Tab = "chat" | "diet" | "consult" | "upload";

export default function App() {
  const [result, setResult] = useState<SubmitReportResponse | null>(null);
  const [tab, setTab] = useState<Tab>("chat");

  if (!result) {
    return <ReportIntake onReady={setResult} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", maxWidth: "480px", margin: "0 auto", background: "#fff" }}>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {tab === "chat" && (
          <ChatScreen
            sessionId={result.session_id}
            infographic={result.infographic}
            starterQuestions={result.starter_questions}
          />
        )}
        {tab === "diet" && (
          <ComingSoon icon="🥗" title="Diet Plan" description="Your personalized diet plan, built from your full report, is coming soon." />
        )}
        {tab === "consult" && (
          <ComingSoon icon="🩺" title="Doctor Consult" description="Book a consultation with a real doctor based on your report — coming soon." />
        )}
        {tab === "upload" && (
          <ComingSoon icon="📄" title="Test Upload" description="Upload follow-up tests to keep your health record up to date — coming soon." />
        )}
      </div>
      <BottomNav active={tab} onSelect={setTab} />
    </div>
  );
}
