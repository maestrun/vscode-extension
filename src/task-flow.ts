import { STATUS, Step, Task } from "./report";
import { escapeHtml as e } from "./html";

export function stageLabel(id?: string): string {
  if (!id) return "—";
  return ({ planning: "Planning", implementation: "Implementation", testing: "Tests", qa: "QA", review: "Review", integration: "Integration" } as Record<string, string>)[id] ?? id.replace(/^custom:/, "");
}

export function tokenLabel(item: Pick<Step, "tokenUsage" | "tokenUsageIncomplete">): string {
  const usage = item.tokenUsage;
  return usage ? `In: ${usage.inputTokens.toLocaleString("en")} · Out: ${usage.outputTokens.toLocaleString("en")}${item.tokenUsageIncomplete ? " (partial)" : ""}` : "In: n/a · Out: n/a";
}

// Match the CLI's task-display-steps rules without changing saved execution state.
export function displaySteps(task: Task): Step[] {
  const steps = (task.steps ?? []).map((step) => task.status === "refactor" && step.status === "refactor"
    ? { ...step, status: "failed" as const } : step);
  if ((!task.worktree && !task.integration && task.step !== "integration") || steps.some((step) => step.id === "integration")) return steps;
  let status: Step["status"] = "pending";
  if (task.worktree?.integrated) status = "completed";
  else if (task.step === "integration") {
    if (["failed", "cancelled", "completed"].includes(task.status)) status = task.status;
    else status = task.integration ?? (task.status === "running" ? "running" : "pending");
  }
  return [...steps, { id: "integration", title: "Integration", status, tokenUsage: { inputTokens: 0, outputTokens: 0 } }];
}

export function flowContent(task: Task, selected?: string): string {
  const steps = displaySteps(task);
  if (!steps.length) return '<div class="empty-state"><h3>No step history yet</h3><p>Configure a workflow to preview the execution flow. Recorded steps appear here as the task runs.</p><button data-action="configure">Configure workflow</button></div>';
  const implementation = steps.findIndex((step) => step.id === "implementation");
  const repair = steps.findIndex((step) => step.status === "refactor");
  const returning = implementation >= 0 && repair > implementation;
  const format = new Intl.NumberFormat("en");
  return `<p class="flow-help">Follow the execution path. Select a step to inspect its result and conversation.</p>
    ${returning ? `<p class="repair-notice">${e(steps[repair]?.title ?? "A step")} requested changes. Return to ${e(steps[implementation]?.title ?? "Implementation")}.</p>` : ""}
    <div class="flow-diagram"><ol class="flowchart ${returning ? "has-repair" : ""}" aria-label="Task execution flow">${steps.map((step, index) => {
      const lane = !returning ? "" : index === implementation ? "repair-target" : index === repair ? "repair-source"
        : index > implementation && index < repair ? "repair-path" : "";
      const usage = step.tokenUsage;
      const tokens = usage ? `In: ${format.format(usage.inputTokens)} · Out: ${format.format(usage.outputTokens)}${step.tokenUsageIncomplete ? " (partial)" : ""}` : "Token usage unavailable";
      return `<li class="flow-stage ${lane}">${index ? `<svg class="flow-arrow ${step.status === "refactor" ? "needs-changes" : ""}" viewBox="0 0 20 36" aria-hidden="true"><path d="M10 0v32m-4-5 4 5 4-5"/></svg>` : ""}
        <button class="flow-node ${step.status}" data-action="showStep" data-step-id="${e(step.id)}" aria-pressed="${step.id === selected}" ${step.id === task.step ? 'aria-current="step"' : ""}>
          <span class="step-heading"><strong><span class="step-number">${index + 1}.</span> ${e(step.title)}</strong><span class="badge ${step.status}">${STATUS[step.status].label}</span></span>
          <span class="flow-model">${step.id === "integration" ? "Git · local" : `${e(step.model ?? "Model not assigned")} · ${e(step.effort ?? "default")} effort`}</span>
          <span class="flow-tokens">${tokens}</span>${step.id === task.step ? '<span class="current-step">Current step</span>' : ""}
        </button></li>`;
    }).join("")}</ol>${returning ? '<svg class="repair-connector" aria-hidden="true"><path/></svg>' : ""}</div>`;
}
