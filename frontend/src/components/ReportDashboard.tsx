import { useMemo, useState } from "react";
import type { InfographicSummary, Panel, Parameter, SmartReport } from "../types";

type View = "summary" | "insights" | "trends" | "risk";

interface Props {
  report: SmartReport;
  infographic: InfographicSummary;
  onStartOver: () => void;
}

const ABNORMAL = new Set(["low", "high", "borderline"]);

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function titleCase(text: string): string {
  const spaced = text.replace(/\b(MISS|MRS|MR|MS|DR)\.(?=\S)/gi, "$1. ");
  return spaced
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function panelLabel(name: string): string {
  // Panel names arrive fully upper-cased ("KIDNEY FUNCTION TEST (KFT)").
  // Title-case the words but leave short all-caps acronyms alone.
  return name
    .split(" ")
    .map((w) => {
      const bare = w.replace(/[()]/g, "");
      if (bare.length <= 4 && bare === bare.toUpperCase()) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function formatGender(g: string): string {
  const n = g.trim().toUpperCase();
  if (n === "F" || n === "FEMALE") return "Female";
  if (n === "M" || n === "MALE") return "Male";
  return g;
}

function rangeText(p: Parameter): string {
  if (p.range_low !== null && p.range_high !== null) return `${p.range_low} – ${p.range_high}`;
  if (p.range_text) return p.range_text;
  return "—";
}

/** How far outside its reference range a value sits, in units of range
 *  width. Used only for ordering findings — the worst first — never to
 *  re-classify a status the backend already decided. */
function deviation(p: Parameter): number {
  const value = parseFloat(p.value);
  if (Number.isNaN(value) || p.range_low === null || p.range_high === null) {
    return ABNORMAL.has(p.status) ? 0.5 : 0;
  }
  const width = p.range_high - p.range_low || 1;
  if (value < p.range_low) return (p.range_low - value) / width;
  if (value > p.range_high) return (value - p.range_high) / width;
  return 0;
}

interface Finding {
  panel: string;
  param: Parameter;
  severity: number;
}

function collectFindings(panels: Panel[]): Finding[] {
  const out: Finding[] = [];
  for (const panel of panels) {
    for (const param of panel.parameters) {
      if (ABNORMAL.has(param.status)) {
        out.push({ panel: panel.name, param, severity: deviation(param) });
      }
    }
  }
  // Out-of-range beats borderline; within a tier, biggest deviation first.
  return out.sort((a, b) => {
    const tier = (f: Finding) => (f.param.status === "borderline" ? 1 : 0);
    return tier(a) - tier(b) || b.severity - a.severity;
  });
}

/* ------------------------------------------------------------------ */
/* small pieces                                                        */
/* ------------------------------------------------------------------ */

function StatusChip({ status }: { status: string }) {
  return <span className={`chip chip--${status}`}>{status}</span>;
}

function RangeBar({ p }: { p: Parameter }) {
  const value = parseFloat(p.value);
  if (Number.isNaN(value) || p.range_low === null || p.range_high === null) return null;

  const width = p.range_high - p.range_low || 1;
  const min = Math.min(p.range_low - width * 0.5, value);
  const max = Math.max(p.range_high + width * 0.5, value);
  const span = max - min || 1;
  const pct = (n: number) => `${((n - min) / span) * 100}%`;
  const colour = p.status === "normal" ? "var(--ok)" : p.status === "borderline" ? "var(--warn)" : "var(--bad)";

  return (
    <>
      <div className="rangebar">
        <div
          className="rangebar__band"
          style={{ left: pct(p.range_low), width: `${((p.range_high - p.range_low) / span) * 100}%` }}
        />
        <div className="rangebar__dot" style={{ left: pct(value), background: colour }} />
      </div>
      <div className="rangebar__scale">
        <span>{p.range_low}</span>
        <span>{p.range_high}</span>
      </div>
    </>
  );
}

function Gauge({ score, label }: { score: number; label: string }) {
  const r = 46;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, score)) / 100;
  const tone = score >= 70 ? "var(--ok)" : score >= 50 ? "var(--warn)" : "var(--bad)";

  return (
    <div className="gauge">
      <svg viewBox="0 0 108 108" width="108" height="108" aria-hidden="true">
        <circle cx="54" cy="54" r={r} fill="none" stroke="var(--line)" strokeWidth="9" />
        <circle
          cx="54"
          cy="54"
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${circumference * filled} ${circumference}`}
          transform="rotate(-90 54 54)"
        />
      </svg>
      <div className="gauge__num">
        <div className="gauge__value">{score}</div>
        <div className="gauge__label">{label}</div>
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: { date: string; value: number }[] }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 560;
  const h = 64;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * (w - 16) + 8;
    const y = h - 10 - ((p.value - min) / span) * (h - 22);
    return { x, y, ...p };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Trend over time">
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      {coords.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r="3.5" fill="#fff" stroke="var(--accent)" strokeWidth="2" />
          <text x={c.x} y={h - 1} textAnchor="middle" fontSize="9" fill="var(--muted)">
            {c.date}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* views                                                               */
/* ------------------------------------------------------------------ */

function SummaryView({ report, findings }: { report: SmartReport; findings: Finding[] }) {
  const { wellness, health_summary_index: counts } = report;
  const headline = findings.slice(0, 4);

  return (
    <>
      <div className="notice">
        <span aria-hidden="true">ℹ️</span>
        <div>
          <div className="notice__title">How this summary was made</div>
          <p>
            Every value, unit and reference range below is taken directly from your lab report. Dr. Gyan writes
            the explanations around those numbers but never changes them.
          </p>
        </div>
      </div>

      <section className="card">
        <div className="card__head">
          <h2>Executive Summary</h2>
        </div>

        <div className="card__pad">
          <div className="scorerow">
            <Gauge score={wellness.score} label={wellness.label} />
            <div className="stat stat--ok">
              <div className="stat__n" style={{ color: "var(--ok)" }}>{counts.normal_count}</div>
              <div className="stat__l">Normal</div>
            </div>
            <div className="stat stat--bad">
              <div className="stat__n" style={{ color: "var(--bad)" }}>{counts.abnormal_count}</div>
              <div className="stat__l">Out of range</div>
            </div>
            <div className="stat stat--warn">
              <div className="stat__n" style={{ color: "var(--warn)" }}>{counts.borderline_count}</div>
              <div className="stat__l">Borderline</div>
            </div>
          </div>

          {wellness.critical_alert && (
            <div className="alertbar">
              <span aria-hidden="true">⚠️</span>
              <span>{wellness.critical_alert}</span>
            </div>
          )}
        </div>

        {headline.length > 0 && (
          <div className="card__pad" style={{ paddingTop: 0 }}>
            <h3 className="sectionlabel">
              <span aria-hidden="true">🔍</span> Key findings
            </h3>
            <div className="findings">
              {headline.map((f, i) => (
                <article className="finding" key={i}>
                  <div className="finding__eyebrow">{panelLabel(f.panel)}</div>
                  <div className="finding__title">{f.param.name}</div>
                  <div
                    className="finding__value"
                    style={{ color: f.param.status === "borderline" ? "var(--warn)" : "var(--bad)" }}
                  >
                    {f.param.value} {f.param.unit ?? ""} <StatusChip status={f.param.status} />
                  </div>
                  <RangeBar p={f.param} />
                  {f.param.explanation && <p className="finding__body">{f.param.explanation}</p>}
                </article>
              ))}
            </div>
          </div>
        )}

        <div className="card__pad" style={{ paddingTop: 0 }}>
          <h3 className="sectionlabel">
            <span aria-hidden="true">🗣</span> What this means in simple terms
          </h3>
          <div className="plain">
            {wellness.greeting && <p>{wellness.greeting}</p>}
            {wellness.descriptor && <p>{wellness.descriptor}</p>}

            {counts.normal_count > 0 && (
              <div className="readout">
                <span className="readout__mark" style={{ color: "var(--ok)" }} aria-hidden="true">✓</span>
                <p className="readout__text">
                  <strong>{counts.normal_count} results are in range.</strong> These need no action beyond your
                  usual routine.
                </p>
              </div>
            )}
            {counts.abnormal_count > 0 && (
              <div className="readout">
                <span className="readout__mark" style={{ color: "var(--bad)" }} aria-hidden="true">⚠</span>
                <p className="readout__text">
                  <strong>
                    {counts.abnormal_count} result{counts.abnormal_count === 1 ? "" : "s"} sit outside the
                    reference range.
                  </strong>{" "}
                  Worth going through with a doctor — open the chat to ask about any of them.
                </p>
              </div>
            )}
            {wellness.lifestyle_recommendation && (
              <div className="readout">
                <span className="readout__mark" style={{ color: "var(--accent)" }} aria-hidden="true">◆</span>
                <p className="readout__text">{wellness.lifestyle_recommendation}</p>
              </div>
            )}
          </div>
        </div>

        {wellness.next_steps.length > 0 && (
          <div className="card__pad" style={{ paddingTop: 0 }}>
            <h3 className="sectionlabel">
              <span aria-hidden="true">🧭</span> Suggested next steps
            </h3>
            <div className="steps">
              {wellness.next_steps.map((s, i) => (
                <div className="step" key={i}>
                  <div className="step__n">{String(i + 1).padStart(2, "0")}</div>
                  <div className="step__title">{s}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {report.diet_plan && (
        <section className="card">
          <div className="card__head">
            <h2>{report.diet_plan.plan_name}</h2>
            <p style={{ margin: "0.3rem 0 0", fontSize: "0.9rem", color: "var(--muted)" }}>
              {report.diet_plan.rationale}
            </p>
          </div>
          <div className="card__pad">
            <div className="dietcols">
              <div>
                <div className="dietcol__head" style={{ color: "var(--ok)" }}>Include</div>
                <ul className="dietlist">
                  {report.diet_plan.include.map((f, i) => (
                    <li key={i}>
                      <strong>{f.name}</strong> — {f.description}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="dietcol__head" style={{ color: "var(--bad)" }}>Limit</div>
                <ul className="dietlist">
                  {report.diet_plan.avoid.map((f, i) => (
                    <li key={i}>
                      <strong>{f.name}</strong> — {f.description}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function InsightsView({ report }: { report: SmartReport }) {
  const [openPanels, setOpenPanels] = useState<Set<string>>(
    () => new Set(report.panels.filter((p) => p.out_of_range > 0).map((p) => p.name))
  );

  function toggle(name: string) {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  if (report.panels.length === 0) {
    return (
      <div className="card empty">
        <div className="empty__title">No panels in this report</div>
        <p>The uploaded file didn't contain any test results we could read.</p>
      </div>
    );
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>Lab Insights</h2>
        <p style={{ margin: "0.3rem 0 0", fontSize: "0.9rem", color: "var(--muted)" }}>
          Every parameter in your report, grouped by panel.
        </p>
      </div>

      {report.panels.map((panel) => {
        const isOpen = openPanels.has(panel.name);
        return (
          <div className="panel" key={panel.name}>
            <button className="panel__toggle" onClick={() => toggle(panel.name)} aria-expanded={isOpen}>
              <span className="panel__name">{panelLabel(panel.name)}</span>
              <span className={`pill ${panel.out_of_range > 0 ? "pill--bad" : "pill--ok"}`}>
                {panel.out_of_range} of {panel.total_tests} flagged
              </span>
              <span className="panel__chev" aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
            </button>

            {isOpen && (
              <>
                {panel.intro && (
                  <p style={{ margin: 0, padding: "0 1.5rem 0.9rem", fontSize: "0.87rem", color: "var(--muted)" }}>
                    {panel.intro}
                  </p>
                )}
                <table className="ptable">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Result</th>
                      <th>Reference</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {panel.parameters.map((p, i) => (
                      <tr key={i}>
                        <td>
                          <div className="ptable__name">{p.name}</div>
                          {p.explanation && <p className="ptable__note">{p.explanation}</p>}
                        </td>
                        <td className="ptable__value">
                          {p.value} {p.unit ?? ""}
                        </td>
                        <td className="ptable__range">{rangeText(p)}</td>
                        <td>
                          <StatusChip status={p.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {panel.panel_diet_tips && panel.panel_diet_tips.length > 0 && (
                  <div style={{ padding: "0.9rem 1.5rem 1.2rem" }}>
                    <div className="dietcol__head" style={{ color: "var(--accent-dark)" }}>Tips for this panel</div>
                    <ul className="dietlist">
                      {panel.panel_diet_tips.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

function TrendsView({ report }: { report: SmartReport }) {
  const tracked = useMemo(
    () =>
      report.panels.flatMap((panel) =>
        panel.parameters
          .filter((p) => p.history && p.history.length >= 2)
          .map((p) => ({ panel: panel.name, param: p }))
      ),
    [report]
  );

  if (tracked.length === 0) {
    return (
      <div className="card empty">
        <div className="empty__title">No history to chart yet</div>
        <p>Trends appear once you've uploaded the same test more than once.</p>
      </div>
    );
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>Historical Trends</h2>
      </div>
      <div className="card__pad">
        {tracked.map(({ panel, param }, i) => (
          <div className="trend" key={i}>
            <div className="trend__head">
              <span className="trend__name">{param.name}</span>
              <span className="trend__unit">
                {param.unit ?? ""} · {panelLabel(panel)}
              </span>
              <span style={{ marginLeft: "auto" }}>
                <StatusChip status={param.status} />
              </span>
            </div>
            <Sparkline points={param.history!} />
          </div>
        ))}
      </div>
    </section>
  );
}

function RiskView({ report, findings }: { report: SmartReport; findings: Finding[] }) {
  const isolated = report.isolated_abnormalities ?? [];

  if (isolated.length === 0 && findings.length === 0) {
    return (
      <div className="card empty">
        <div className="empty__title">Nothing flagged</div>
        <p>Every parameter in this report came back within its reference range.</p>
      </div>
    );
  }

  return (
    <>
      {isolated.map((ia, i) => (
        <section className="card" key={i}>
          <div className="card__head">
            <h2 style={{ fontSize: "1.2rem" }}>{ia.parameter_name}</h2>
            <div className="pillrow" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
              <span className="pill pill--neutral">{panelLabel(ia.panel_name)}</span>
            </div>
          </div>
          <div className="card__pad">
            <p style={{ marginTop: 0 }}>{ia.explanation}</p>

            {ia.common_symptoms.length > 0 && (
              <>
                <div className="dietcol__head" style={{ color: "var(--warn)" }}>Symptoms to watch for</div>
                <ul className="dietlist">
                  {ia.common_symptoms.map((s, si) => (
                    <li key={si}>{s}</li>
                  ))}
                </ul>
              </>
            )}

            {ia.recommended_tests.length > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <div className="dietcol__head" style={{ color: "var(--accent-dark)" }}>Tests your doctor may order</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {ia.recommended_tests.map((t, ti) => (
                    <span className="pill pill--neutral" key={ti}>{t.label}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      ))}

      <section className="card">
        <div className="card__head">
          <h2 style={{ fontSize: "1.2rem" }}>Everything flagged, worst first</h2>
        </div>
        <table className="ptable">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Panel</th>
              <th>Result</th>
              <th>Reference</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f, i) => (
              <tr key={i}>
                <td className="ptable__name">{f.param.name}</td>
                <td style={{ color: "var(--muted)" }}>{panelLabel(f.panel)}</td>
                <td className="ptable__value">
                  {f.param.value} {f.param.unit ?? ""}
                </td>
                <td className="ptable__range">{rangeText(f.param)}</td>
                <td>
                  <StatusChip status={f.param.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* shell                                                               */
/* ------------------------------------------------------------------ */

export default function ReportDashboard({ report, infographic, onStartOver }: Props) {
  const [view, setView] = useState<View>("summary");
  const findings = useMemo(() => collectFindings(report.panels), [report]);
  const trendCount = useMemo(
    () =>
      report.panels.reduce(
        (n, p) => n + p.parameters.filter((x) => x.history && x.history.length >= 2).length,
        0
      ),
    [report]
  );

  const nav: { id: View; icon: string; label: string; count?: number; disabled?: boolean }[] = [
    { id: "summary", icon: "▤", label: "Summary" },
    { id: "insights", icon: "▦", label: "Lab Insights", count: report.panels.length },
    { id: "trends", icon: "◠", label: "Historical Trends", count: trendCount, disabled: trendCount === 0 },
    { id: "risk", icon: "◑", label: "Risk Profile", count: findings.length },
  ];

  return (
    <>
      <header className="topbar">
        <div className="topbar__brand">NirogGyan</div>
        <nav className="topbar__nav">
          <button className="topbar__link" aria-current="page">Smart Report</button>
          <button className="topbar__link">Sample Reports</button>
          <button className="topbar__link">My Health</button>
        </nav>
        <div className="topbar__spacer" />
        <button className="topbar__cta">For Labs &amp; Hospitals</button>
      </header>

      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar__id">
            <div className="sidebar__avatar" aria-hidden="true">🩺</div>
            <div>
              <div className="sidebar__name">Dr. Gyan</div>
              <div className="sidebar__role">AI health companion</div>
            </div>
          </div>

          <nav className="navlist">
            {nav.map((item) => (
              <button
                key={item.id}
                className={`navitem ${view === item.id ? "navitem--active" : ""}`}
                onClick={() => setView(item.id)}
                disabled={item.disabled}
                aria-current={view === item.id ? "page" : undefined}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
                {item.count !== undefined && item.count > 0 && (
                  <span className="navitem__count">{item.count}</span>
                )}
              </button>
            ))}
          </nav>

          <button className="sidebar__action" onClick={onStartOver}>
            + Start new analysis
          </button>
        </aside>

        <main className="main">
          <div className="pillrow">
            <span className="pill pill--ok">✓ Report unlocked</span>
            {report.patient.date_of_test && <span>Tested {report.patient.date_of_test}</span>}
            {report.patient.accession_no && <span>· {report.patient.accession_no}</span>}
          </div>

          <div className="reporthead">
            <div>
              <h1>{titleCase(infographic.patient_name)}</h1>
              <div className="reporthead__sub">
                Smart Health Report
                {report.patient.age ? ` · ${Math.round(report.patient.age)} yrs` : ""}
                {report.patient.gender ? ` · ${formatGender(report.patient.gender)}` : ""}
              </div>
            </div>
            <div className="reporthead__actions">
              <button className="iconbtn" onClick={() => window.print()} aria-label="Print or save as PDF">⤓</button>
            </div>
          </div>

          {view === "summary" && <SummaryView report={report} findings={findings} />}
          {view === "insights" && <InsightsView report={report} />}
          {view === "trends" && <TrendsView report={report} />}
          {view === "risk" && <RiskView report={report} findings={findings} />}

          <div className="disclaimer">
            <span aria-hidden="true">⚕</span>
            <span>
              This summary is generated by Dr. Gyan, an AI assistant, from the data in your lab report. It is not a
              clinical diagnosis and does not replace a consultation. Please review it with a qualified medical
              professional before acting on anything here.
            </span>
          </div>
        </main>
      </div>

      <footer className="footer">
        <div>
          <div className="footer__brand">NirogGyan</div>
          <div>Smart Report, Smarter You</div>
        </div>
        <div className="footer__links">
          <span>Terms of Service</span>
          <span>Privacy Policy</span>
          <span>Consent Manager</span>
          <span>Contact Support</span>
        </div>
      </footer>
    </>
  );
}
