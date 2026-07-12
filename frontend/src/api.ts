import type { SmartReport, SubmitReportResponse } from "./types";

// In dev, Vite's proxy (vite.config.ts) forwards /api to localhost:8000, so
// leaving this empty works locally. In production on Render, set
// VITE_API_BASE to your deployed backend's URL (e.g.
// https://niroggyan-premium-api.onrender.com) as a build-time env var.
const BASE = `${import.meta.env.VITE_API_BASE ?? ""}/api`;

/** Submits the RAW diagnofirm-format lab export (not a pre-structured
 * SmartReport). Backend generates the wellness score, panels, and
 * narrative content from these raw observations. */
export async function submitRawReport(raw: object): Promise<SubmitReportResponse> {
  const res = await fetch(`${BASE}/report/raw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(raw),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Submit failed (${res.status})`);
  }
  return res.json();
}

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

/** Thrown specifically on 404 — the backend's in-memory session was lost
 * (Render free-tier spin-down, or a redeploy). Distinguished from other
 * failures so the caller can recover by resubmitting instead of just
 * showing an error. */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
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
  if (res.status === 404) {
    const detail = await res.json().catch(() => ({}));
    throw new SessionExpiredError(detail.detail || "Session expired.");
  }
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
