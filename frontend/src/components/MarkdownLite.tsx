import React from "react";

/** Renders **bold** text within a line as React fragments. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>;
  });
}

/**
 * Minimal markdown renderer for chat answers: ## headers, bullet lists
 * (- or *), and paragraphs, with **bold** inline. Deliberately not a full
 * markdown library — the system prompt controls the output shape, so this
 * only needs to handle what Dr. Gyan is instructed to produce.
 */
export default function MarkdownLite({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  function flushList(key: string) {
    if (listBuffer.length > 0) {
      blocks.push(
        <ul key={key} style={{ margin: "0.4rem 0", paddingLeft: "1.2rem" }}>
          {listBuffer.map((item, i) => (
            <li key={i} style={{ marginBottom: "0.25rem" }}>
              {renderInline(item, `li-${key}-${i}`)}
            </li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  }

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      flushList(`flush-${idx}`);
      blocks.push(
        <h4 key={idx} style={{ margin: "0.6rem 0 0.3rem", fontSize: "1rem", fontWeight: 700 }}>
          {renderInline(trimmed.slice(3), `h-${idx}`)}
        </h4>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listBuffer.push(trimmed.slice(2));
    } else if (trimmed === "") {
      flushList(`flush-${idx}`);
    } else {
      flushList(`flush-${idx}`);
      blocks.push(
        <p key={idx} style={{ margin: "0.3rem 0", lineHeight: 1.5 }}>
          {renderInline(trimmed, `p-${idx}`)}
        </p>
      );
    }
  });
  flushList("flush-end");

  return <>{blocks}</>;
}
