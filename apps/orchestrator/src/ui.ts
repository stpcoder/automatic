import type { Approval, Artifact, CaseEvent, CaseRecord } from "../../../packages/contracts/src/index.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prettyJson(value: unknown): string {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function renderLayout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1e7;
        --panel: #fffdfa;
        --ink: #16202a;
        --muted: #5d6873;
        --line: #d7cbb6;
        --accent: #115e59;
        --warn: #92400e;
        --danger: #991b1b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: radial-gradient(circle at top left, #fbf6ed, var(--bg) 48%, #ece2d0);
        color: var(--ink);
      }
      main {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }
      header {
        display: flex;
        gap: 16px;
        justify-content: space-between;
        align-items: end;
        margin-bottom: 24px;
        flex-wrap: wrap;
      }
      h1 {
        margin: 0;
        font-size: clamp(1.8rem, 3vw, 2.8rem);
        line-height: 1;
        letter-spacing: -0.03em;
      }
      .sub {
        color: var(--muted);
        margin-top: 8px;
      }
      nav {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      nav a, .link {
        color: var(--accent);
        text-decoration: none;
        font-weight: 600;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 18px;
      }
      .card {
        background: color-mix(in srgb, var(--panel) 94%, white);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 18px 40px rgba(22, 32, 42, 0.06);
      }
      .card h2, .card h3 {
        margin: 0 0 10px;
        line-height: 1.1;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
      }
      .pill {
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 700;
        border: 1px solid var(--line);
        background: #f3eadb;
      }
      .pill.pending { background: #fff3d6; color: var(--warn); }
      .pill.approved { background: #ddf6ec; color: var(--accent); }
      .pill.rejected { background: #fee2e2; color: var(--danger); }
      .row {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
      }
      .stack { display: grid; gap: 10px; }
      pre {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        background: #f4efe6;
        border-radius: 12px;
        padding: 12px;
        font-size: 12px;
        border: 1px solid #e4d8c2;
      }
      ul {
        margin: 0;
        padding-left: 18px;
      }
      button, input {
        font: inherit;
      }
      .decision-bar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 14px;
      }
      .decision-bar input {
        min-width: 220px;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 10px 14px;
        background: white;
      }
      .decision-bar button {
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        color: white;
        cursor: pointer;
        font-weight: 700;
      }
      .approve { background: var(--accent); }
      .reject { background: var(--danger); }
      .revise { background: #7c3aed; }
      .empty {
        padding: 28px;
        border-radius: 18px;
        border: 1px dashed var(--line);
        color: var(--muted);
        background: rgba(255,255,255,0.5);
      }
      .section-title {
        margin: 28px 0 12px;
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main>${body}</main>
    <script>
      async function decideApproval(approvalId, decision) {
        const actorInput = document.getElementById('actor-' + approvalId);
        const actor = actorInput && actorInput.value ? actorInput.value : 'operator@example.com';
        const response = await fetch('/approvals/' + approvalId + '/decision', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision, actor })
        });
        if (!response.ok) {
          const text = await response.text();
          alert('Approval update failed: ' + text);
          return;
        }
        location.reload();
      }
    </script>
  </body>
</html>`;
}

export function renderApprovalsPage(approvals: Approval[]): string {
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const body = `
    <header>
      <div>
        <h1>Approval Center</h1>
        <div class="sub">Human-in-the-loop gate before mail send, web submit, and outbound chat.</div>
      </div>
      <nav>
        <a href="/ui/approvals">Pending Approvals</a>
      </nav>
    </header>
    ${
      pendingApprovals.length === 0
        ? `<div class="empty">No pending approvals. The workflow engine is currently waiting on external events or all commit actions have been reviewed.</div>`
        : `<div class="grid">${pendingApprovals.map(renderApprovalCard).join("")}</div>`
    }
  `;
  return renderLayout("Approval Center", body);
}

function renderApprovalCard(approval: Approval): string {
  const checklist = approval.checklist.length > 0
    ? `<ul>${approval.checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<div class="sub">No checklist items attached.</div>`;

  return `
    <section class="card">
      <div class="meta">
        <span class="pill pending">pending</span>
        <span class="pill">${escapeHtml(approval.action_type)}</span>
        <span class="pill">${escapeHtml(approval.step_id)}</span>
      </div>
      <h2>${escapeHtml(approval.case_id)}</h2>
      <div class="sub">Requested ${escapeHtml(approval.requested_at)}</div>
      <div class="section-title">Preview</div>
      <div class="stack">
        <div>${escapeHtml(approval.preview.summary)}</div>
        <pre>${prettyJson(approval.preview.payload)}</pre>
      </div>
      <div class="section-title">Checklist</div>
      ${checklist}
      <div class="section-title">Case</div>
      <a class="link" href="/ui/cases/${encodeURIComponent(approval.case_id)}">Open case detail</a>
      <div class="decision-bar">
        <input id="actor-${escapeHtml(approval.approval_id)}" value="operator@example.com" aria-label="actor" />
        <button class="approve" onclick="decideApproval('${escapeHtml(approval.approval_id)}','approve')">Approve</button>
        <button class="reject" onclick="decideApproval('${escapeHtml(approval.approval_id)}','reject')">Reject</button>
        <button class="revise" onclick="decideApproval('${escapeHtml(approval.approval_id)}','request_revision')">Request Revision</button>
      </div>
    </section>
  `;
}

export function renderCaseDetailPage(params: {
  caseRecord: CaseRecord;
  approvals: Approval[];
  artifacts: Artifact[];
  events: CaseEvent[];
}): string {
  const { caseRecord, approvals, artifacts, events } = params;
  const body = `
    <header>
      <div>
        <h1>${escapeHtml(caseRecord.case_id)}</h1>
        <div class="sub">Workflow ${escapeHtml(caseRecord.workflow_id)} · current step ${escapeHtml(caseRecord.current_step_id)}</div>
      </div>
      <nav>
        <a href="/ui/approvals">Approval Center</a>
        <a href="/cases/${encodeURIComponent(caseRecord.case_id)}">JSON API</a>
      </nav>
    </header>
    <div class="grid">
      <section class="card">
        <div class="meta">
          <span class="pill">${escapeHtml(caseRecord.state)}</span>
          <span class="pill">completed ${escapeHtml(caseRecord.completed_steps.length)}</span>
        </div>
        <h2>Facts</h2>
        <pre>${prettyJson(caseRecord.facts)}</pre>
      </section>
      <section class="card">
        <h2>Approvals</h2>
        <pre>${prettyJson(approvals)}</pre>
      </section>
    </div>
    <div class="section-title">Artifacts</div>
    <section class="card">
      <pre>${prettyJson(artifacts)}</pre>
    </section>
    <div class="section-title">Events</div>
    <section class="card">
      <pre>${prettyJson(events)}</pre>
    </section>
  `;
  return renderLayout(`Case ${caseRecord.case_id}`, body);
}
