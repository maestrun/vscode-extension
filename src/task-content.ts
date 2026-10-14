import { displaySteps, stageLabel, tokenLabel } from "./task-flow";
import { Conversation, pendingInput, STATUS, Step, Task } from "./report";

import { escapeHtml as e } from "./html";

export function taskSummary(task: Task, step?: Step): string {
  const item = step ?? task;
  const instructions = task.instructions ?? "No instructions recorded. Open the details to review this task.";
  return `<header class="detail-header"><div class="task-topline"><span class="task-id">${e(task.id)}</span>
    <span class="badge ${item.status}">${STATUS[item.status].label}</span></div>
    <h2 id="detail-title" tabindex="-1">${e(task.title)}</h2>
    <p class="muted">${task.completedSteps}/${task.totalSteps} steps · ${e(task.executor ?? "Unassigned")}</p>
    </header><div class="detail-body" id="detail-body">
    ${task.step ? `<p class="muted">Current step: ${e(task.step)}</p>` : ""}
    ${inputRequests(task, step)}
    <p class="task-excerpt">${e(instructions.length > 400 ? `${instructions.slice(0, 400)}…` : instructions)}</p>
    ${task.error ? `<p class="error">${e(task.error)}</p><button class="text-button" data-action="openLog">View execution log</button>` : ""}
    <nav class="detail-actions" aria-label="Selected task actions"><button class="primary" data-action="openEditor">View details</button></nav></div>`;
}

function textSection(title: string, text?: string, className = ""): string {
  return text ? `<section class="detail-section ${className}"><h3>${e(title)}</h3><pre>${e(text)}</pre></section>` : "";
}

function messages(conversation?: Conversation): string {
  if (!conversation?.messages.length) return '<div class="empty-state"><h3>No conversation yet</h3><p>Messages appear when an agent starts working on this step. Select a step to inspect its conversation.</p></div>';
  return conversation.messages.map((message) => `<article class="message ${message.role}">
    <h3>${message.role === "user" ? "You" : "Agent"}${message.status ? `<span class="muted">${e(message.status)}</span>` : ""}</h3>
    <pre>${e(message.text)}</pre>${textSection("Error", message.error, "error")}</article>`).join("");
}

export function taskContent(input: {
  task: Task; step?: Step; conversation?: Conversation; conversationError?: string; project: string;
}): string {
  const { task, step, conversation } = input;
  const item = step ?? task;
  const active = !input.conversationError && task.status === "running" && conversation?.active && (!step || step.id === task.step);
  return `<header class="detail-header"><div class="task-topline"><span class="task-id">${e(task.id)}${step ? ` / ${e(step.id)}` : ""}</span><span class="badge ${item.status}">${STATUS[item.status].label}</span></div>
    <h2 id="detail-title" tabindex="-1">${e(step?.title ?? task.title)}</h2>${step ? `<p class="muted">${e(task.title)}</p>` : ""}
    <dl class="execution-properties"><div><dt>Stage</dt><dd>${e(stageLabel(step?.id ?? task.step))}</dd></div><div><dt>Steps</dt><dd>${task.completedSteps}/${task.totalSteps}</dd></div>
    <div><dt>Executor</dt><dd>${e(task.executor ?? "—")}</dd></div><div><dt>Model</dt><dd>${e(item.model ?? (task.status === "pending" ? task.steps?.[0]?.model : undefined) ?? "—")}</dd></div>
    <div><dt>Effort</dt><dd>${e(item.effort ?? "default")}</dd></div><div><dt>Tokens</dt><dd>${e(tokenLabel(item))}</dd></div></dl>
    <nav class="detail-actions" aria-label="Task actions"><button class="primary" data-action="sendMessage" ${active ? "" : "disabled"}>Send instructions</button><button class="quiet" data-action="openPlan">Edit plan</button></nav></header>
    <div class="detail-body" id="detail-body">
    ${inputRequests(task, step)}
    ${!step ? `<dl class="task-properties"><div><dt>Dependencies</dt><dd>${task.dependsOn?.length ? task.dependsOn.map((id) => `<button class="text-button" data-action="showTask" data-task-id="${e(id)}">${e(id)}</button>`).join(" ") : "None"}</dd></div></dl>
    ${textSection("Instructions and acceptance criteria", task.instructions)}
    <section class="detail-section"><h3>Steps</h3><div class="detailed-table-scroll"><table class="step-table"><thead><tr><th>Step</th><th>Status</th><th>Model</th><th>Effort</th><th>Tokens</th><th>Result</th></tr></thead><tbody>
    ${displaySteps(task).map((entry) => `<tr><td><button class="text-button" data-action="showStep" data-task-id="${e(task.id)}" data-step-id="${e(entry.id)}">${e(entry.title)}</button></td><td><span class="badge ${entry.status}">${STATUS[entry.status].label}</span></td><td>${e(entry.model ?? "—")}</td><td>${e(entry.effort ?? "default")}</td><td>${e(tokenLabel(entry))}</td><td>${e(entry.summary ?? (entry.status === "pending" ? "Not started" : "No final result recorded"))}</td></tr>`).join("")}
    </tbody></table></div></section>` : `<button class="text-button" data-action="showTask" data-task-id="${e(task.id)}">Back to task</button>`}
    ${textSection("Error", step && step.id !== task.step ? undefined : task.error, "error")}${textSection("Result", item.summary)}
    <section class="detail-section step-logs" aria-label="Step logs"><h3>${step ? "Step logs" : "Current session log"}</h3>
    ${textSection("Could not load conversation", input.conversationError, "error")}${messages(conversation)}</section></div>`;
}

function inputRequests(task: Task, step?: Step): string {
  return (task.inputRequests ?? []).filter((request) => !step || request.stage === step.id).map((request) => {
    const pending = task.status === "on_hold" && pendingInput(task)?.id === request.id;
    return `<section class="detail-section input-request ${pending ? "on_hold" : ""}" aria-label="${pending ? "Awaiting your answer" : "Question and answer"}">
      <h3>${pending ? "Awaiting your answer" : "Question and answer"} · ${e(stageLabel(request.stage))}</h3>
      <pre>${e(request.summary)}</pre><h4>Question</h4><pre>${e(request.question)}</pre>
      ${request.answer !== undefined ? `<h4>Your answer</h4><pre>${e(request.answer)}</pre>` : ""}
      ${pending ? '<button class="primary" data-action="answerInput">Answer question</button>' : ""}</section>`;
  }).join("");
}
