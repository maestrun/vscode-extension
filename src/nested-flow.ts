import { escapeHtml as e } from "./html";
import { Report, STATUS } from "./report";
import { flowContent } from "./task-flow";
import { taskGraph, type GraphTask } from "./task-graph";

type Selection = { task?: string; step?: string };

export function hasTaskHierarchy(report?: Report): boolean {
  return Boolean(report?.orchestration || report?.tasks.some((task) => task.parentId));
}

export function nestedFlow(report: Report, key: string, selected: Selection = {}): string {
  const graph = taskGraph(report);
  return `<section class="nested-flow" data-flow-key="${e(key)}" data-mode="tasks" data-direction="horizontal" aria-label="Task dependency flow">
    <div class="nested-toolbar"><div role="group" aria-label="Flowchart detail"><button data-flow-mode="tasks" aria-pressed="true">Simple</button><button data-flow-mode="steps" aria-pressed="false">Detailed</button></div>
      <div role="group" aria-label="Flowchart direction"><button data-flow-direction="horizontal" aria-pressed="true" title="Left to right">Horizontal</button><button data-flow-direction="vertical" aria-pressed="false" title="Top to bottom">Vertical</button></div>
      <span class="muted">${report.tasks.length} tasks</span></div>
    <div class="nested-scroll" tabindex="0" role="region" aria-label="Scrollable task flowchart"><div class="flow-graph"><svg class="dependency-edges" aria-hidden="true"></svg><ul class="flow-tree">${graph.map((node) => branch(node, selected)).join("")}</ul></div></div></section>`;
}

function branch({ task, parents, level }: GraphTask, selected: Selection): string {
  return `<li class="flow-branch" data-level="${level}" data-predecessors="${e(JSON.stringify(parents))}">
    <article class="nested-task ${task.status}" data-task-id="${e(task.id)}">
      <button class="nested-task-title" data-action="showTask" data-task-id="${e(task.id)}" aria-pressed="${selected.task === task.id}"><strong>${e(task.title)}</strong><span class="task-id">${e(task.id)}</span></button>
      <div class="nested-task-status"><span class="badge ${task.status}">${STATUS[task.status].label}</span><span>${task.completedSteps}/${task.totalSteps} steps</span></div>
      ${parents.length ? `<p class="task-dependencies">After: ${parents.map(e).join(", ")}</p>` : ""}
      <div class="nested-steps">${flowContent(task, selected.task === task.id ? selected.step : undefined)}</div>
    </article></li>`;
}
