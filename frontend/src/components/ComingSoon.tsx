interface Props {
  title: string;
  icon: string;
  description: string;
}

export default function ComingSoon({ title, icon, description }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: "2rem", textAlign: "center", background: "#f8fafc" }}>
      <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem", opacity: 0.6 }}>{icon}</div>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#111827", margin: "0 0 0.4rem" }}>{title}</h2>
      <p style={{ color: "#64748b", fontSize: "0.9rem", maxWidth: "280px" }}>{description}</p>
      <span style={{ marginTop: "1rem", background: "#f1f5f9", color: "#64748b", fontSize: "0.75rem", fontWeight: 600, padding: "0.3rem 0.8rem", borderRadius: "999px" }}>
        🔒 Coming Soon
      </span>
    </div>
  );
}
