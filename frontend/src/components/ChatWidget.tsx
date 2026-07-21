import { useState, useRef, useEffect } from "react";
import { streamChat, SessionExpiredError } from "../api";
import type { ChatMessage, InfographicSummary, SmartReport } from "../types";
import MarkdownLite from "./MarkdownLite";

interface Props {
  sessionId: string;
  infographic: InfographicSummary;
  starterQuestions: string[];
  report: SmartReport;
  onSessionExpired: () => Promise<string>;
}

const SUGGESTIONS_MARKER = "|SUGGESTIONS|";
const SIMPLIFY_PROMPT = "Can you explain that again in even simpler, everyday words?";

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

/** Quick-action chips above the input. "Explain more simply" is always
 *  available; the rest only appear when the report actually has
 *  material to back them — no chip should ever lead to an empty answer. */
function buildQuickActions(report: SmartReport): string[] {
  // "Explain more simply" already lives under every message, so this
  // row is reserved for things that need the WHOLE report to answer —
  // the actual reason to pay for this instead of searching a symptom.
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

export default function ChatWidget({ sessionId, infographic, starterQuestions, report, onSessionExpired }: Props) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    infographic.intro_message ? [{ role: "assistant", content: infographic.intro_message }] : []
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const currentSessionId = useRef(sessionId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const quickActions = useRef(buildQuickActions(report)).current;

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
    if (!trimmed || loading) return;

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
      await streamChat(currentSessionId.current, trimmed, (chunk) => {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: next[next.length - 1].content + chunk,
          };
          return next;
        });
      });
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
                  <button className="msgaction" onClick={() => sendMessage(SIMPLIFY_PROMPT)}>
                    Explain more simply
                  </button>
                </div>
              )}

              {suggestions.length > 0 && !isStreaming && (
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

        {noUserTurnsYet && starterQuestions.length > 0 && (
          <div className="suggests">
            {starterQuestions.map((q, i) => (
              <button key={i} className="suggest" onClick={() => sendMessage(q)}>
                {q}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="quickrow">
        {quickActions.map((q, i) => (
          <button key={i} className="quickchip" onClick={() => sendMessage(q)} disabled={loading}>
            {q}
          </button>
        ))}
      </div>

      <div className="chatbar">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
          placeholder="Ask about your report…"
          disabled={loading}
          aria-label="Message Dr. Gyan"
        />
        <button onClick={() => sendMessage(input)} disabled={loading || !input.trim()} aria-label="Send message">
          ➤
        </button>
      </div>
      <div className="chatfoot">AI assistant · not a medical diagnosis</div>
    </aside>
  );
}
