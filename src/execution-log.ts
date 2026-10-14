import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { Conversation, Report, STATUS, Step, Task } from "./report";
import { Conversations, sessionNotice } from "./storage";
import { displaySteps, stageLabel, tokenLabel } from "./task-flow";

export async function taskConversation(project: string, task: Task, step?: Step): Promise<{ conversation?: Conversation; conversationError?: string }> {
  const current = !step || step.id === task.step;
  const id = step?.conversationId ?? (current ? task.conversationId : undefined);
  let conversation = step?.conversation ?? (current ? task.conversation : undefined);
  try { if (id) conversation = await new Conversations().read(project, id) ?? conversation; }
  catch (error) { return { conversation, conversationError: String(error) }; }
  return { conversation };
}

export async function workerLog(project: string): Promise<string> {
  try {
    if (!(await lstat(join(project, ".maestrun"))).isDirectory()) throw new Error("Invalid project state directory.");
    const file = await open(join(project, ".maestrun/run.log"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new Error("Invalid worker log.");
      const start = Math.max(0, info.size - 128 * 1024);
      const buffer = Buffer.alloc(Math.min(info.size, 128 * 1024));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      return `${start ? "[Showing the last 128 KiB]\n" : ""}${buffer.subarray(0, bytesRead).toString("utf8")}`;
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

export async function executionLog(report: Report | undefined, project: string): Promise<string> {
  const lines = [`Execution log — ${project}`, `Started: ${report?.startedAt || "Not started"}`, ...(report?.finishedAt ? [`Finished: ${report.finishedAt}`] : [])];
  try { const notice = await sessionNotice(project); if (notice) lines.push(notice); }
  catch (error) { lines.push(`Session: ${String(error)}`); }
  for (const task of report?.tasks ?? []) {
    lines.push("", `${task.id} — ${task.title}`, `${STATUS[task.status].label} · Stage: ${stageLabel(task.step)} · Steps: ${task.completedSteps}/${task.totalSteps}`, tokenLabel(task));
    for (const request of task.inputRequests ?? []) {
      lines.push(`Input requested · ${stageLabel(request.stage)}`, request.summary, `Question: ${request.question}`,
        request.answer === undefined ? "Awaiting your answer" : `Your answer: ${request.answer}`);
    }
    if (task.error) lines.push(`Error: ${task.error}`);
    const steps = displaySteps(task);
    for (const step of steps.length ? steps : [undefined]) {
      const item = step ?? task;
      if (step) lines.push("", `${step.title} · ${STATUS[step.status].label} · ${tokenLabel(step)}`);
      lines.push(item.summary || (item.status === "pending" ? "This step has not started." : "No final result recorded."));
      const { conversation, conversationError } = await taskConversation(project, task, step);
      if (conversationError) lines.push(`Could not load conversation: ${conversationError}`);
      for (const message of conversation?.messages ?? []) {
        lines.push("", `${message.role === "user" ? "You" : "Agent"}${message.status ? ` · ${message.status}` : ""}`, message.text);
        if (message.error) lines.push(`Error: ${message.error}`);
      }
    }
  }
  if (!report?.tasks.length) lines.push("", "No task execution recorded yet.");
  try { const text = await workerLog(project); if (text.trim()) lines.push("", "Worker diagnostics", text); }
  catch (error) { lines.push("", `Could not read worker diagnostics: ${String(error)}`); }
  return lines.join("\n");
}
