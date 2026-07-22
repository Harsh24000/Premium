import { useState, useRef, useEffect } from "react";
import {
  streamChat,
  SessionExpiredError,
  QuotaExceededError,
  MessageTooLongError,
  MultipleQuestionsError,
} from "../api";
import type { ChatMessage, InfographicSummary, SmartReport } from "../types";
import MarkdownLite from "./MarkdownLite";

interface Props {
  sessionId: string;
  infographic: InfographicSummary;
  starterQuestions: string[];
  report: SmartReport;
  plan: string;
  messagesRemaining: number;
  messagesQuota: number;
  onSessionExpired: () => Promise<string>;
}

const SUGGESTIONS_MARKER = "|SUGGESTIONS|";
const SIMPLIFY_PROMPT = "Can you explain that again in even simpler, everyday words?";
const MAX_CHARS = 75; // mirrors backend/app/plans.py MAX_MESSAGE_CHARS — keep in sync

/** Split the model's reply from its trailing follow-up questions.
 *  While a reply is still streaming the marker can arrive a character at
 *  a time, so a partial prefix is hidden too — otherwise "|SUGG" flashes
 *  in the bubble. */
function parseAssistantMessage(content: string): { text: string; suggestions: string[] } {
  const idx = content.indexOf(SUGGESTIONS_MARKER);
  if (idx === -1) {
    const partial = content.lastIndexOf("|");
    if (partial !== -1 && SUGGESTIONS_MARKER.startsWith(content.slice(partial))) {
      return { text: content.slice(0, partial).trim(), suggestions: [] };
    }
    return { text: content, suggestions: [] };
  }
  const text = content.slice(0, idx).trim();
  const suggestions = content
    .slice(idx + SUGGESTIONS_MARKER.length)
    .split("\n")
    .map((s) => s.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean);
  return { text, suggestions };
}

/** Quick-action chips above the input. "Explain more simply" already
 *  lives under every message, so this row is reserved for things that
 *  need the WHOLE report to answer — only shown when the report
 *  actually has material to back the chip. */
function buildQuickActions(report: SmartReport): string[] {
  const actions = ["What matters most in my results?"];
  if (report.diet_plan || report.wellness.dietary_recommendation) {
    actions.push("What should I eat or avoid?");
  }
  if (report.isolated_abnormalities && report.isolated_abnormalities.length > 0) {
    actions.push("Do I need any more tests?");
  }
  if (report.wellness.next_steps.length > 0) {
    actions.push("What should I do next?");
  }
  if (report.health_summary_index.abnormal_count > 0 || report.wellness.critical_alert) {
    actions.push("Is anything here serious?");
  }
  return actions;
}

function TypingDots() {
  return (
    <span className="typing" aria-label="Dr. Gyan is typing">
      <span /><span /><span />
    </span>
  );
}

export default function ChatWidget({
  sessionId,
  infographic,
  starterQuestions,
  report,
  plan,
  messagesRemaining,
  messagesQuota,
  onSessionExpired,
}: Props) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    infographic.intro_message ? [{ role: "assistant", content: infographic.intro_message }] : []
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(messagesRemaining);
  const [quota, setQuota] = useState(messagesQuota);
  const currentSessionId = useRef(sessionId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const quickActions = useRef(buildQuickActions(report)).current;
  const chars = input.length;
  const overLimit = chars > MAX_CHARS;
  const outOfQuota = remaining <= 0;

  useEffect(() => {
    currentSessionId.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    if (open) {
      setSeen(true);
      inputRef.current?.focus();
    }
  }, [open]);

  // Escape closes the panel — expected of any floating overlay, and on
  // mobile this is now a full screen so it doubles as the "back" gesture.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function sendMessage(text: string, isRetry = false) {
    const trimmed = text.trim();
    if (!trimmed || loading || outOfQuota) return;
    if (trimmed.length > MAX_CHARS) {
      // Belt-and-suspenders: the input box already disables sending over
      // the limit, but a quick-action chip or suggestion could in theory
      // exceed it too if the model ever ignores its own length rules.
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `That's a bit long for one question — try trimming it to ${MAX_CHARS} characters or fewer.`,
        },
      ]);
      return;
    }

    if (!isRetry) {
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: trimmed }, { role: "assistant", content: "" }]);
    } else {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: "" };
        return next;
      });
    }
    setLoading(true);

    try {
      const usage = await streamChat(currentSessionId.current, trimmed, (chunk) => {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: next[next.length - 1].content + chunk,
          };
          return next;
        });
      });
      // null means the header was missing/unreadable (see api.ts) —
      // keep showing the last known-good count rather than guessing.
      if (usage.remaining !== null) setRemaining(usage.remaining);
      if (usage.quota !== null) setQuota(usage.quota);
    } catch (err) {
      if (err instanceof SessionExpiredError && !isRetry) {
        setLoading(false);
        setRecovering(true);
        try {
          const freshId = await onSessionExpired();
          currentSessionId.current = freshId;
          setRecovering(false);
          await sendMessage(trimmed, true);
          return;
        } catch {
          setRecovering(false);
          setMessages((prev) => [
            ...prev.slice(0, -1),
            {
              role: "assistant",
              content: "Your session ended and reconnecting didn't work. Upload your report again to carry on.",
            },
          ]);
          setLoading(false);
          return;
        }
      }
      if (err instanceof QuotaExceededError) {
        setRemaining(0);
        setQuota(err.quota);
        setMessages((prev) => [
          ...prev.slice(0, -1),
          {
            role: "assistant",
            content: `You've used all ${err.quota} questions. Get 10 more for ₹50 to keep chatting.`,
          },
        ]);
        setLoading(false);
        return;
      }
      if (err instanceof MessageTooLongError) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          {
            role: "assistant",
            content: `That's a bit long — try it in ${err.maxChars} characters or fewer, one question at a time.`,
          },
        ]);
        setLoading(false);
        return;
      }
      if (err instanceof MultipleQuestionsError) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          {
            role: "assistant",
            content: "That looks like a couple of questions in one — could you send them one at a time?",
          },
        ]);
        setLoading(false);
        return;
      }
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: "That message didn't get through. Try sending it again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function copyMessage(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1600);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — not
      // worth surfacing as an error, the button simply won't confirm.
    }
  }

  const unread = !seen && infographic.intro_message ? 1 : 0;
  const noUserTurnsYet = !messages.some((m) => m.role === "user");
  const depletionPct = quota > 0 ? Math.max(0, Math.min(100, (remaining / quota) * 100)) : 0;
  const quotaTone = remaining <= 0 ? "empty" : remaining <= Math.max(1, Math.ceil(quota * 0.2)) ? "low" : "ok";

  if (!open) {
    return (
      <button className="chatfab" onClick={() => setOpen(true)} aria-label="Open chat with Dr. Gyan">
        <span className="chatfab__avatar" aria-hidden="true">🩺</span>
        Ask Dr. Gyan
        <span className="chatfab__dot" aria-hidden="true" />
        {unread > 0 && <span className="chatfab__badge">{unread}</span>}
      </button>
    );
  }

  return (
    <aside className="chatpanel" role="dialog" aria-label="Chat with Dr. Gyan" aria-modal="true">
      <header className="chathead">
        <div className="chathead__avatar" aria-hidden="true">🩺</div>
        <div>
          <div className="chathead__name">Dr. Gyan</div>
          <div className="chathead__status">
            <span className="chatfab__dot" aria-hidden="true" /> AI health companion
          </div>
        </div>
        <button className="chathead__close" onClick={() => setOpen(false)} aria-label="Close chat">
          ✕
        </button>
      </header>

      {/* Prominent quota banner — the count and its depletion are meant
          to be seen at a glance, not buried in a status line. No plan
          label here on purpose — "questions left" reads as a paid
          allowance, which is what this actually is. */}
      <div className={`quotabar quotabar--${quotaTone}`}>
        <div className="quotabar__row">
          <span className="quotabar__text">
            {remaining} question{remaining === 1 ? "" : "s"} left
          </span>
        </div>
        <div className="quotabar__track">
          <div className="quotabar__fill" style={{ width: `${depletionPct}%` }} />
        </div>
      </div>

      <div className="chatlog">
        {messages.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={i} className="bubble bubble--me">
                {m.content}
              </div>
            );
          }
          const { text, suggestions } = parseAssistantMessage(m.content);
          const isStreaming = loading && i === messages.length - 1;
          return (
            <div key={i} style={{ display: "contents" }}>
              <div className="bubble bubble--them">
                {text ? (
                  <MarkdownLite content={text} />
                ) : recovering ? (
                  "Reconnecting…"
                ) : isStreaming ? (
                  <TypingDots />
                ) : null}
              </div>

              {text && !isStreaming && (
                <div className="msgactions">
                  <button className="msgaction" onClick={() => copyMessage(text, i)}>
                    {copiedIdx === i ? "Copied ✓" : "Copy"}
                  </button>
                  {!outOfQuota && (
                    <button className="msgaction" onClick={() => sendMessage(SIMPLIFY_PROMPT)}>
                      Explain more simply
                    </button>
                  )}
                </div>
              )}

              {suggestions.length > 0 && !isStreaming && !outOfQuota && (
                <div className="suggests">
                  {suggestions.map((s, si) => (
                    <button key={si} className="suggest" onClick={() => sendMessage(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {noUserTurnsYet && starterQuestions.length > 0 && !outOfQuota && (
          <div className="suggests">
            {starterQuestions.map((q, i) => (
              <button key={i} className="suggest" onClick={() => sendMessage(q)}>
                {q}
              </button>
            ))}
          </div>
        )}

        {outOfQuota && (
          <div className="paywall">
            <div className="paywall__title">You're out of questions</div>
            <p>You've used all {quota} questions on this report. Get more to keep talking with Dr. Gyan.</p>
            {/* Real copy, but still not wired to a real charge — there's
                no payment gateway behind this yet (see main.py's plan-
                activation stub). This opens a contact channel rather than
                silently granting credits, which a fake "pay" button would
                either do nothing or do for free — replace mailto with a
                real checkout link once a gateway exists. */}
            <a className="paywall__cta" href="mailto:support@niroggyan.com?subject=Get%2010%20more%20questions">
              Get 10 more questions for ₹50
            </a>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {!outOfQuota && (
        <div className="quickrow">
          {quickActions.map((q, i) => (
            <button key={i} className="quickchip" onClick={() => sendMessage(q)} disabled={loading}>
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="chatbar">
        <div className="chatbar__field">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !overLimit && sendMessage(input)}
            placeholder={outOfQuota ? "Get more questions to keep chatting" : "Ask about your report…"}
            disabled={loading || outOfQuota}
            aria-label="Message Dr. Gyan"
            maxLength={MAX_CHARS + 20}
          />
          {input.length > 0 && (
            <span className={`charcount ${overLimit ? "charcount--over" : ""}`}>
              {chars}/{MAX_CHARS}
            </span>
          )}
        </div>
        <button
          onClick={() => sendMessage(input)}
          disabled={loading || outOfQuota || !input.trim() || overLimit}
          aria-label="Send message"
        >
          ➤
        </button>
      </div>
      <div className="chatfoot">AI assistant · not a medical diagnosis</div>
    </aside>
  );
}
