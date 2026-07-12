import { useState, useRef, useEffect } from "react";
import { streamChat, SessionExpiredError } from "../api";
import type { ChatMessage, InfographicSummary } from "../types";
import SummaryIntro from "./SummaryIntro";
import MarkdownLite from "./MarkdownLite";

interface Props {
  sessionId: string;
  infographic: InfographicSummary;
  starterQuestions: string[];
  onSessionExpired: () => Promise<string>; // resolves to a fresh session_id
}

const SUGGESTIONS_MARKER = "|SUGGESTIONS|";

function parseAssistantMessage(content: string): { text: string; suggestions: string[] } {
  const idx = content.indexOf(SUGGESTIONS_MARKER);
  if (idx === -1) return { text: content, suggestions: [] };
  const text = content.slice(0, idx).trim();
  const suggestions = content
    .slice(idx + SUGGESTIONS_MARKER.length)
    .split("\n")
    .map((s) => s.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean);
  return { text, suggestions };
}

export default function ChatScreen({ sessionId, infographic, starterQuestions, onSessionExpired }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    infographic.intro_message ? [{ role: "assistant", content: infographic.intro_message }] : []
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  // Internal, mutable session id — starts from the prop, but gets swapped
  // in place on recovery WITHOUT remounting this component, so existing
  // chat history is never lost when the backend session expires.
  const currentSessionId = useRef(sessionId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    currentSessionId.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string, isRetry = false) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    if (!isRetry) {
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: trimmed }, { role: "assistant", content: "" }]);
    } else {
      // Retry after recovery: clear the placeholder bubble's content so
      // streaming starts fresh, without adding a duplicate user message.
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
          next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + chunk };
          return next;
        });
      });
    } catch (err) {
      if (err instanceof SessionExpiredError && !isRetry) {
        // Recover silently: get a fresh session from the same original
        // report data, then retry this exact message once. The user
        // never sees the expiry at all if recovery succeeds.
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
            { role: "assistant", content: "Your session expired and I couldn't reconnect automatically. Please go back and re-upload your report." },
          ]);
          setLoading(false);
          return;
        }
      }
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: err instanceof Error ? err.message : "Something went wrong." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f8fafc" }}>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <SummaryIntro data={infographic} />

        {!messages.some((m) => m.role === "user") && starterQuestions.length > 0 && (
          <div style={{ margin: "0 0.75rem 0.75rem" }}>
            <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: "0.5rem 0" }}>
              Based on your report, you might want to ask:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {starterQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  style={{
                    textAlign: "left",
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "10px",
                    padding: "0.65rem 0.9rem",
                    fontSize: "0.9rem",
                    color: "#334155",
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: "0 0.75rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {messages.map((m, i) => {
            if (m.role === "user") {
              return (
                <div
                  key={i}
                  style={{
                    alignSelf: "flex-end",
                    background: "#4f46e5",
                    color: "#fff",
                    padding: "0.6rem 0.9rem",
                    borderRadius: "14px",
                    maxWidth: "85%",
                    fontSize: "0.92rem",
                  }}
                >
                  {m.content}
                </div>
              );
            }
            const { text, suggestions } = parseAssistantMessage(m.content);
            const isStreaming = loading && i === messages.length - 1;
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: "90%" }}>
                <div style={{ background: "#ffffff", borderRadius: "14px", padding: "0.7rem 0.9rem", fontSize: "0.92rem", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
                  {text ? <MarkdownLite content={text} /> : (recovering ? "Reconnecting…" : isStreaming ? "…" : null)}
                </div>
                {suggestions.length > 0 && !isStreaming && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    {suggestions.map((s, si) => (
                      <button
                        key={si}
                        onClick={() => sendMessage(s)}
                        style={{
                          textAlign: "left",
                          background: "#eff6ff",
                          border: "1px dashed #93c5fd",
                          borderRadius: "10px",
                          padding: "0.5rem 0.8rem",
                          fontSize: "0.82rem",
                          color: "#1d4ed8",
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", padding: "0.6rem", borderTop: "1px solid #e2e8f0", background: "#fff" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
          placeholder="Ask Dr. Gyan about your report..."
          disabled={loading}
          style={{ flex: 1, padding: "0.6rem 0.8rem", borderRadius: "10px", border: "1px solid #cbd5e1", fontSize: "0.9rem" }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
          style={{ background: "#4f46e5", color: "#fff", border: "none", borderRadius: "10px", padding: "0 1.1rem", fontWeight: 700, opacity: loading || !input.trim() ? 0.6 : 1 }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
