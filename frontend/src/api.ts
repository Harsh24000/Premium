import type { SmartReport, SubmitReportResponse } from "./types";

const BASE = "/api";

export async function submitReport(report: SmartReport): Promise<SubmitReportResponse> {
  const res = await fetch(`${BASE}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Submit failed (${res.status})`);
  }
  return res.json();
}

export async function fetchMockReport(): Promise<SmartReport> {
  const res = await fetch(`${BASE}/mock-report`);
  if (!res.ok) throw new Error("Could not load mock report");
  return res.json();
}

export async function streamChat(
  sessionId: string,
  message: string,
  onChunk: (text: string) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Chat failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}
