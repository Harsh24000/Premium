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
    const body = await res.json().catch(() => ({}));
    // FastAPI wraps HTTPException(status, {...dict...}) as {"detail": {...dict...}}.
    // Several endpoints (rate limit, quota, message-length) send a dict, not a
    // string, as that detail — grabbing detail.detail directly gets the nested
    // object, which JS then stringifies as the unhelpful "[object Object]".
    // Drill one level further for the actual message string.
    const inner = body.detail;
    const message = typeof inner === "string" ? inner : inner?.detail;
    throw new Error(message || `Submit failed (${res.status})`);
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
    const body = await res.json().catch(() => ({}));
    const inner = body.detail;
    const message = typeof inner === "string" ? inner : inner?.detail;
    throw new Error(message || `Submit failed (${res.status})`);
  }
  return res.json();
}

export async function fetchMockReport(): Promise<SmartReport> {
  const res = await fetch(`${BASE}/mock-report`);
  if (!res.ok) throw new Error("Could not load mock report");
  return res.json();
}

/** Calls the backend's plan-activation STUB (see main.py) — there is no
 * payment verification behind this at all. It exists today only so the
 * frontend can restore a session's plan after an in-memory session is
 * lost and recreated (see App.tsx's handleSessionExpired). Once a real
 * payment gateway exists, this call must only ever happen server-side,
 * from a verified payment webhook — never triggered by a button in the
 * UI, or anyone could grant themselves the paid quota for free. */
export async function activatePlan(sessionId: string, plan: string): Promise<{ plan: string; quota: number }> {
  const res = await fetch(`${BASE}/session/${sessionId}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) throw new Error(`Could not activate plan (${res.status})`);
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

/** Thrown on 402 — either the session is fully out of credits
 * ("quota_exceeded") — the session has used its full question quota. */
export class QuotaExceededError extends Error {
  plan: string;
  quota: number;
  constructor(message: string, plan: string, quota: number) {
    super(message);
    this.name = "QuotaExceededError";
    this.plan = plan;
    this.quota = quota;
  }
}

/** Thrown on 422 — the message exceeded the per-message length limit.
 * Character count is the primary constraint (see plans.py); word count
 * rides along as a secondary check. */
export class MessageTooLongError extends Error {
  maxChars: number;
  charCount: number;
  constructor(message: string, maxChars: number, charCount: number) {
    super(message);
    this.name = "MessageTooLongError";
    this.maxChars = maxChars;
    this.charCount = charCount;
  }
}

/** Thrown on 422 — the message read as more than one question stacked
 * together (question marks, numbered lists, multiple question-shaped
 * clauses). Separate from MessageTooLongError because the fix is
 * different: this message might already be short, it's the shape of
 * it that's the problem. */
export class MultipleQuestionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultipleQuestionsError";
  }
}

export interface ChatUsage {
  remaining: number;
  quota: number;
}

export async function streamChat(
  sessionId: string,
  message: string,
  onChunk: (text: string) => void,
): Promise<ChatUsage> {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (res.status === 404) {
    const detail = await res.json().catch(() => ({}));
    throw new SessionExpiredError(detail.detail?.detail || detail.detail || "Session expired.");
  }
  if (res.status === 402) {
    const detail = await res.json().catch(() => ({}));
    const d = detail.detail || {};
    throw new QuotaExceededError(
      d.detail || "Question limit reached.",
      d.plan ?? "trial",
      d.quota ?? 0,
    );
  }
  if (res.status === 422) {
    const detail = await res.json().catch(() => ({}));
    const d = detail.detail || {};
    if (d.error === "multiple_questions") {
      throw new MultipleQuestionsError(d.detail || "That looks like more than one question.");
    }
    throw new MessageTooLongError(
      d.detail || "That message is too long.",
      d.max_chars ?? 75,
      d.char_count ?? 0,
    );
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    const inner = body.detail;
    const message = typeof inner === "string" ? inner : inner?.detail;
    throw new Error(message || `Chat failed (${res.status})`);
  }

  const remainingHeader = res.headers.get("X-Messages-Remaining");
  const quotaHeader = res.headers.get("X-Messages-Quota");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }

  return {
    remaining: remainingHeader !== null ? parseInt(remainingHeader, 10) : 0,
    quota: quotaHeader !== null ? parseInt(quotaHeader, 10) : 0,
  };
}
