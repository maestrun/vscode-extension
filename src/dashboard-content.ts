import { taskHierarchy, hierarchyAttributes, hierarchyPrefix } from "./task-hierarchy";
import { hasTaskHierarchy } from "./nested-flow";
import { editorContent, EditorView } from "./editor-content";
import { basename } from "node:path";
import { Report, STATUS } from "./report";
import { escapeHtml as e, errorHtml } from "./html";

export function dashboardContent(report: Report | undefined, project: string, error?: string, detail?: string, selected?: string, sidebar = false, view: EditorView = "tasks", step?: string, logs?: string): string {
  const tasks = report?.tasks ?? [];
  const nested = hasTaskHierarchy(report);
  const done = tasks.filter((task) => task.status === "completed").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const attention = tasks.filter((task) => ["on_hold", "failed", "blocked", "cancelled", "refactor"].includes(task.status)).length;
  const filters = [["all", "All", tasks.length], ["on_hold", "On hold", tasks.filter((task) => task.status === "on_hold").length], ["running", "Running", running], ["attention", "Needs attention", attention],
    ["pending", "Pending", tasks.filter((task) => task.status === "pending").length], ["completed", "Completed", done]];
  if (sidebar) return `<div class="dashboard sidebar-tasks" data-project="${e(project)}" data-selection="${e(selected ?? "")}">
    <header class="workspace-header"><div class="project-heading"><button class="text-button" data-action="selectProject" title="Switch project: ${e(project)}">${e(basename(project) || "Select project")} ▾</button>
      <span class="count">${done}/${tasks.length} completed</span></div>
      <nav class="toolbar" aria-label="Project actions"><button class="primary" data-action="run">Run / resume</button><button class="quiet" data-action="openEditor">Open in editor</button>
      <details class="project-menu" id="project-menu"><summary aria-label="More project actions">More</summary><div class="menu-items">
        <button data-action="allFlowcharts">All flowcharts</button><button data-action="configure">Configure workflow</button><button data-action="selectProject">Switch project</button>
        <button data-action="start">Set up workflow</button><button data-action="sample">Run example…</button><button data-action="plan">Generate plan</button>
        <button data-action="cancel">Cancel execution</button>
        <button data-action="openPlan">Edit plan</button><button data-action="openConfig">Open configuration file</button>
        <button data-action="openLog">View execution log</button><button data-action="refresh">Refresh</button></div></details></nav></header>
    ${error ? `<details class="error-banner" id="project-notice"><summary title="${e(error)}">${error.startsWith("Execution cancelled.") ? "Execution cancelled" : e(error)}</summary><p>${errorHtml(error)}</p><button class="text-button" data-action="openLog">View execution log</button></details>` : ""}
    <div class="workspace-grid"><section id="task-browser" class="task-browser" aria-label="Tasks">
      <div class="list-toolbar"><div class="section-heading"><h2>Tasks <span class="count">${tasks.length}</span></h2>
      <label class="sort-label">Sort <select id="task-sort"><option value="plan">Plan order</option><option value="status">Status</option><option value="title">Title</option></select></label></div>
      <input id="task-filter" type="search" placeholder="Filter tasks…" aria-label="Filter tasks" autocomplete="off">
      <div class="filters" role="group" aria-label="Filter by status">${filters.map(([key, label, count]) => `<button data-filter="${key}" aria-pressed="${key === "all"}">${label} <span>${count}</span></button>`).join("")}</div>
      <p id="filter-result" class="sr-only" role="status" aria-live="polite"></p></div>
      <div class="task-list-scroll" id="task-list-scroll"><table class="task-table" ${nested ? 'role="treegrid" aria-label="Task hierarchy"' : ""}><caption class="sr-only">Select a task to show its summary below</caption>
      <thead><tr><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Steps</th></tr></thead><tbody id="task-list" data-hierarchy="${nested}">
      ${taskHierarchy(tasks).map((row, index) => { const task = row.task; return `<tr class="task-row" ${hierarchyAttributes(row, nested)} data-status="${task.status}" data-order="${index}" data-title="${e(task.title)}" data-executor="${e(task.executor ?? "")}">
        <td><div class="task-tree-cell">${hierarchyPrefix(row, nested)}<button class="task-select" data-action="showTask" data-task-id="${e(task.id)}" title="${e(task.title)}" aria-label="${e(task.title)}" aria-pressed="${task.id === selected}"><span class="task-title">${e(task.title)}</span><span class="task-id">${e(task.id)}</span></button></div></td>
        <td><span class="badge ${task.status}">${STATUS[task.status].label}</span></td><td class="step-count">${task.completedSteps}/${task.totalSteps}</td></tr>`; }).join("")}
      </tbody></table><div id="no-matches" class="empty-state" hidden><p>No matching tasks</p><button data-ui="clear-filters">Clear filters</button></div>
      ${!tasks.length ? `<div class="empty-state"><h3>${error ? "Tasks are unavailable" : "Start with a plan"}</h3><p>Set up a workflow and generate a plan to list its tasks.</p><button data-action="start">Set up workflow</button><button data-action="sample">Run example…</button><button data-action="plan">Generate plan</button></div>` : ""}</div></section>
      <section class="inspector ${detail ? "has-selection" : ""}" id="task-detail" aria-label="Task summary" tabindex="-1">
      ${detail ?? '<div class="empty-state"><h3>Select a task</h3><p>Its summary appears here. Open the details when you need the full workflow or conversation.</p></div>'}</section></div></div>`;
  return editorContent(report, project, error, detail, selected, view, step, logs);
}
