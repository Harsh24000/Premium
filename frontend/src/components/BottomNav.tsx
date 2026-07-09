interface Props {
  active: "chat" | "diet" | "consult" | "upload";
  onSelect: (tab: "chat" | "diet" | "consult" | "upload") => void;
}

const TABS: { key: "chat" | "diet" | "consult" | "upload"; label: string; icon: string; locked: boolean }[] = [
  { key: "chat", label: "Chat", icon: "💬", locked: false },
  { key: "diet", label: "Diet Plan", icon: "🥗", locked: true },
  { key: "consult", label: "Consult", icon: "🩺", locked: true },
  { key: "upload", label: "Test Upload", icon: "📄", locked: true },
];

export default function BottomNav({ active, onSelect }: Props) {
  return (
    <nav
      style={{
        position: "sticky",
        bottom: 0,
        left: 0,
        right: 0,
        display: "flex",
        background: "#ffffff",
        borderTop: "1px solid #e2e8f0",
        boxShadow: "0 -2px 10px rgba(0,0,0,0.05)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onSelect(tab.key)}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.15rem",
            padding: "0.6rem 0.25rem",
            background: "none",
            border: "none",
            color: active === tab.key ? "#4f46e5" : "#94a3b8",
            fontWeight: active === tab.key ? 700 : 500,
            fontSize: "0.7rem",
            position: "relative",
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: "1.2rem", opacity: tab.locked ? 0.5 : 1 }}>{tab.icon}</span>
          <span>{tab.label}</span>
          {tab.locked && (
            <span style={{ position: "absolute", top: "2px", right: "18%", fontSize: "0.65rem" }}>🔒</span>
          )}
        </button>
      ))}
    </nav>
  );
}
