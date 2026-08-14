import { Alert, ArrowRight, Check, Clipboard, HardHat } from "./icons";

const projects = [
  { code: "PRJ-007", name: "Contoh - Terlambat", planned: 60, actual: 45, variance: "−15.0%", tone: "danger" },
  { code: "PRJ-003", name: "Harbour Road Bridge Repair", planned: 76, actual: 78, variance: "+2.0%", tone: "success" },
  { code: "PRJ-002", name: "Northgate Retail Park", planned: 48, actual: 41, variance: "−7.0%", tone: "danger" },
] as const;

export function DashboardVisual() {
  return (
    <div className="product-window dashboard-window" aria-label="V2 portfolio dashboard example">
      <WindowBar title="Portfolio control" />
      <div className="app-layout">
        <aside className="mock-sidebar" aria-hidden>
          <span className="mini-brand">V2</span>
          <div className="sidebar-line active"><i /><span /></div>
          <div className="sidebar-line"><i /><span /></div>
          <div className="sidebar-line"><i /><span /></div>
          <div className="sidebar-line short"><i /><span /></div>
        </aside>
        <div className="dashboard-body">
          <div className="mock-toolbar">
            <div><span className="micro-label">PORTFOLIO</span><strong>Good morning, Ana.</strong></div>
            <span className="data-chip"><i /> Data through 10 Aug 2026</span>
          </div>
          <div className="summary-grid">
            <MetricCard label="Portfolio value" value="Rp 428,6 M" note="6 active projects" />
            <MetricCard label="Work completed" value="Rp 214,7 M" note="50.1% measured" />
            <MetricCard label="Needs attention" value="3" note="Projects to review" alert />
          </div>
          <div className="attention-panel">
            <div className="panel-heading">
              <div><span className="micro-label">EXCEPTIONS</span><strong>Needs attention</strong></div>
              <span className="plain-link">View all <ArrowRight /></span>
            </div>
            <div className="filter-row">
              <span className="filter active">All problems <b>3</b></span>
              <span className="filter">Behind schedule <b>2</b></span>
              <span className="filter">Open actions <b>2</b></span>
            </div>
            <div className="project-table">
              <div className="table-head"><span>Project</span><span>Plan / actual</span><span>Variance</span></div>
              {projects.map((project) => (
                <div className="project-row" key={project.code} data-tone={project.tone}>
                  <div><small>{project.code}</small><strong>{project.name}</strong></div>
                  <div className="progress-cell">
                    <span><i style={{ width: `${project.actual}%` }} /></span>
                    <small>{project.planned}% / {project.actual}%</small>
                  </div>
                  <strong className="variance">{project.variance}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkflowVisual() {
  const periods = ["W1", "W2", "W3", "W4", "W5", "W6"];
  const rows = [
    ["1.1", "Pekerjaan persiapan", 100, [30, 30, 25, 15, 0, 0]],
    ["1.2", "Pondasi dan struktur", 100, [0, 15, 25, 25, 20, 15]],
    ["1.3", "Arsitektur", 100, [0, 0, 5, 20, 35, 40]],
  ] as const;

  return (
    <div className="product-window workflow-window" aria-label="V2 baseline schedule example">
      <WindowBar title="Baseline / Schedule" />
      <div className="workflow-content">
        <div className="workflow-topbar">
          <div><span className="micro-label">PRJ-007</span><strong>Baseline pekerjaan</strong></div>
          <span className="status-pill"><Check /> Ready for review</span>
        </div>
        <div className="baseline-steps" aria-hidden>
          <span className="done"><Check /> BoQ</span><i />
          <span className="active">2 Schedule</span><i />
          <span>3 Review</span>
        </div>
        <div className="schedule-grid">
          <div className="schedule-head"><span>Work line</span>{periods.map((period) => <span key={period}>{period}</span>)}<span>Total</span></div>
          {rows.map(([code, name, total, values]) => (
            <div className="schedule-row" key={code}>
              <span><small>{code}</small><b>{name}</b></span>
              {values.map((value, index) => <span key={`${code}-${periods[index]}`} data-value={value > 0 || undefined}>{value || "—"}</span>)}
              <strong>{total}%</strong>
            </div>
          ))}
        </div>
        <div className="workflow-footer">
          <span><i /> 3 work lines complete</span>
          <button type="button" tabIndex={-1}>Continue to review <ArrowRight /></button>
        </div>
      </div>
    </div>
  );
}

export function ProgressVisual() {
  return (
    <div className="product-window progress-window" aria-label="V2 planned and actual progress example">
      <WindowBar title="Progress / PRJ-007" />
      <div className="progress-content">
        <div className="progress-summary">
          <div><span>Actual progress</span><strong>45.0%</strong></div>
          <div><span>Planned to date</span><strong>60.0%</strong></div>
          <div className="danger"><span>Deviation</span><strong>−15.0%</strong><small>Behind schedule</small></div>
        </div>
        <div className="curve-card">
          <div className="curve-heading"><div><span className="micro-label">S-CURVE</span><strong>Planned vs actual</strong></div><span>Data date · 10 Aug</span></div>
          <svg viewBox="0 0 720 270" role="img" aria-label="Planned progress reaches 60 percent while actual progress reaches 45 percent">
            <defs>
              <linearGradient id="curveArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2c64e8" stopOpacity=".16" /><stop offset="1" stopColor="#2c64e8" stopOpacity="0" /></linearGradient>
            </defs>
            <g className="chart-grid"><path d="M52 28H694M52 84H694M52 140H694M52 196H694M52 252H694" /><path d="M52 28V252M180 28V252M308 28V252M436 28V252M564 28V252M694 28V252" /></g>
            <path className="area" d="M52 244C118 236 154 216 180 204C246 174 276 136 308 118C360 89 406 67 436 59L436 252H52Z" />
            <path className="planned" d="M52 244C118 226 149 195 180 176C238 141 273 100 308 77C350 50 398 36 436 28" />
            <path className="actual" d="M52 244C116 238 151 220 180 204C240 171 276 135 308 118C360 89 406 67 436 59" />
            <path className="data-line" d="M436 20V252" />
            <circle className="planned-dot" cx="436" cy="28" r="5" /><circle className="actual-dot" cx="436" cy="59" r="5" />
            <g className="chart-labels"><text x="52" y="266">W1</text><text x="180" y="266">W4</text><text x="308" y="266">W8</text><text x="436" y="266">W12</text><text x="564" y="266">W16</text><text x="676" y="266">W20</text></g>
          </svg>
          <div className="legend"><span><i className="planned-key" /> Planned</span><span><i className="actual-key" /> Actual</span><span className="data-date">Data date</span></div>
        </div>
      </div>
    </div>
  );
}

export function FieldVisual({ type }: { type: "daily" | "actions" | "notes" }) {
  if (type === "daily") {
    return <div className="mini-product"><div className="mini-product-head"><Clipboard /><span>Daily report</span><b>Draft</b></div><div className="weather-row"><span>Clear</span><span>28°C</span><span>0h rain</span></div><div className="note-lines"><i /><i /><i className="short" /></div><div className="crew-row"><span>Steel fixer <b>12</b></span><span>Carpenter <b>8</b></span></div></div>;
  }
  if (type === "actions") {
    return <div className="mini-product"><div className="mini-product-head"><Alert /><span>Project actions</span><b>7 open</b></div><div className="action-item danger"><i /><span><b>Concrete test result</b><small>Quality · Critical</small></span><em>Today</em></div><div className="action-item"><i /><span><b>Confirm facade sample</b><small>RFI · Medium</small></span><em>14 Aug</em></div></div>;
  }
  return <div className="mini-product"><div className="mini-product-head"><HardHat /><span>Site notes</span><b>Today</b></div><div className="photo-grid"><span className="photo-one" /><span className="photo-two" /><span className="photo-three" /></div><p>East elevation inspection complete. Waterproofing detail requires follow-up.</p></div>;
}

function WindowBar({ title }: { title: string }) {
  return <div className="window-bar"><span className="window-controls" aria-hidden><i /><i /><i /></span><strong>{title}</strong><span className="window-sync"><i /> Synced</span></div>;
}

function MetricCard({ label, value, note, alert = false }: { label: string; value: string; note: string; alert?: boolean }) {
  return <div className="metric-card" data-alert={alert || undefined}><span>{label}</span><strong>{value}</strong><small>{alert && <Alert />}{note}</small></div>;
}
