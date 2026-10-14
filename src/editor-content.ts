import { basename } from "node:path";
import { escapeHtml as e, errorHtml } from "./html";
import { Report, STATUS } from "./report";
import { flowContent, stageLabel, tokenLabel } from "./task-flow";

export type EditorView = "tasks" | "flow" | "logs";
export function editorContent(report: Report | undefined, project: string, error: string | undefined,
  detail: string | undefined, selected: string | undefined, view: EditorView, step?: string, logs?: string): string {
  const tasks = report?.tasks ?? [];
  const task = tasks.find((task) => task.id === selected);
  const filters = [["all", "All"], ["on_hold", "On hold"], ["running", "Running"], ["attention", "Needs attention"], ["pending", "Pending"], ["completed", "Completed"]];
  return `<div class="dashboard editor-dashboard" data-project="${e(project)}" data-selection="${e(selected ?? "")}" data-editor-view="${view}" data-step="${e(step ?? "")}">
    <header class="workspace-header"><div class="project-heading"><h1>${e(basename(project) || "Maestrun")}</h1><p class="project-path">${e(project)}</p></div>
      <nav class="toolbar" aria-label="Workflow actions"><button class="primary" data-action="run">Run / resume</button><button data-action="plan">Generate plan</button><button class="quiet" data-action="refresh">Refresh</button>
      <details class="project-menu" id="project-menu"><summary>More</summary><div class="menu-items"><button data-action="allFlowcharts">All flowcharts</button><button data-action="configure">Configure workflow</button><button data-action="start">Set up workflow</button><button data-action="sample">Run example…</button>
        <button data-action="openPlan">Edit plan</button><button data-action="openConfig">Open configuration file</button><button data-action="openLog">Execution log</button>
        <button data-action="cancel">Cancel execution</button><button data-action="selectProject">Switch project</button><button data-action="choosePosition">Choose window position…</button><button data-action="openSidebar">Open in sidebar</button></div></details></nav></header>
    <nav class="editor-views" aria-label="Editor views"><button data-action="showDetailedTasks" aria-pressed="${view === "tasks"}">Detailed tasks</button><button data-action="showFlowchart" aria-pressed="${view === "flow"}">Flowchart</button>
    <button data-action="allFlowcharts">All flowcharts</button><span class="muted">${tasks.filter((task) => task.status === "completed").length}/${tasks.length} completed</span></nav>
    ${error ? `<div class="error-banner" role="alert"><p>${errorHtml(error)}</p>${view !== "logs" ? '<button class="text-button" data-action="openLog">View execution log</button>' : ""}</div>` : ""}
    ${view === "logs" ? `<section class="execution-log"><h2>Execution log</h2><p class="muted">Task results, step conversations and worker diagnostics. Updates automatically.</p><pre id="execution-log" tabindex="0">${e(logs ?? "Loading logs…")}</pre></section>` : view === "flow" ? `
      <section class="flow-workspace"><label class="flow-selector">Task<select id="flow-task-selector" aria-label="Flowchart task">${tasks.map((entry) => `<option value="${e(entry.id)}" ${entry.id === selected ? "selected" : ""}>${e(entry.id)} — ${e(entry.title)}</option>`).join("")}</select></label>
      <div class="flow-layout ${step ? "with-step" : ""}"><section id="project-flow" aria-label="Flowchart">${task ? flowContent(task, step) : '<div class="empty-state"><h2>No tasks yet</h2><button data-action="plan">Generate plan</button></div>'}</section>
      ${step && detail ? `<section class="inspector step-inspector" id="task-detail" aria-label="Step details and logs"><button class="text-button" data-action="showFlowchart">Close step details</button>${detail}</section>` : ""}</div></section>` : `
      <section class="editor-tasks"><div class="list-toolbar"><div class="section-heading"><h2>Tasks</h2><label class="sort-label">Sort<select id="task-sort"><option value="plan">Plan order</option><option value="status">Status</option><option value="title">Title</option></select></label></div>
      <input id="task-filter" type="search" placeholder="Search by task, model, or executor…" aria-label="Filter tasks"><div class="filters" role="group" aria-label="Filter by status">${filters.map(([value, label]) => `<button data-filter="${value}" aria-pressed="${value === "all"}">${label}</button>`).join("")}</div><p id="filter-result" class="sr-only" role="status"></p></div>
      <div id="task-list-scroll" class="detailed-table-scroll"><table class="detailed-task-table"><caption class="sr-only">Execution tasks, stages, models, steps and token usage</caption><thead><tr>${["ID", "Task", "Tokens in / out", "Status", "Stage", "Model", "Effort", "Steps"].map((label) => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody id="task-list">
      ${tasks.map((entry, index) => { const pending = entry.status === "pending" ? entry.steps?.[0] : undefined; return `<tr class="task-row" data-order="${index}" data-title="${e(entry.title)}" data-status="${entry.status}" data-executor="${e(entry.executor ?? "")}">
        <td class="task-id">${e(entry.id)}</td><td><button class="task-select" data-action="showTask" data-task-id="${e(entry.id)}" aria-label="${e(entry.title)}" aria-pressed="${entry.id === selected}">${e(entry.title)}</button></td>
        <td class="token-cell" title="${e(tokenLabel(entry))}">${entry.tokenUsage ? `${entry.tokenUsage.inputTokens.toLocaleString("en")} / ${entry.tokenUsage.outputTokens.toLocaleString("en")}${entry.tokenUsageIncomplete ? " *" : ""}` : "n/a"}</td>
        <td><span class="badge ${entry.status}">${STATUS[entry.status].label}</span></td><td>${entry.status === "completed" ? "—" : e(stageLabel(entry.step))}</td><td>${e(entry.model ?? pending?.model ?? "—")}</td><td>${e(entry.effort ?? pending?.effort ?? "default")}</td><td>${entry.completedSteps}/${entry.totalSteps}</td></tr>`; }).join("")}</tbody></table></div>
      <div id="no-matches" class="empty-state" hidden><h3>No matching tasks</h3><button data-ui="clear-filters">Clear filters</button></div>
      ${!tasks.length ? `<div class="empty-state"><h3>${error ? "Tasks are unavailable" : "Start with a plan"}</h3><button data-action="start">Set up workflow</button><button data-action="sample">Run example…</button><button data-action="plan">Generate plan</button></div>` : ""}
      <p class="table-note muted">Tokens: input / output. * Partial usage; n/a means the executor did not report usage.</p>
      <section class="inspector" id="task-detail" aria-label="Task details">${detail ?? '<div class="empty-state"><h3>Select a task</h3><p>Review instructions, step results, token usage and logs below.</p></div>'}</section></section>`}
  </div>`;
}
