import * as vscode from "vscode";
import { isRecord, Task } from "./report";
import { Conversations, readReport } from "./storage";
import { TaskNode } from "./task-tree";
import { WorkflowView, WorkflowSurface } from "./workflow-view";

export async function sendMessage(input: { folder: vscode.WorkspaceFolder; extension: vscode.Uri; node?: TaskNode; surface?: (title: string) => Promise<WorkflowSurface | undefined> }): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace to send instructions.");
  const cwd = input.folder.uri.fsPath;
  const report = await readReport(cwd);
  const available = report?.tasks.filter((task) => task.status === "running" && task.conversationId) ?? [];
  if (!available.length) throw new Error("No running task sessions are available.");
  const selected = input.node ? available.find((task) => task.id === input.node?.task.id)
    : (await vscode.window.showQuickPick(available.map((task) => ({ label: task.title, description: task.id, task }))))?.task;
  if (!selected?.conversationId) { if (input.node) throw new Error("This task is no longer running."); return; }
  const text = await instructions(input.extension, selected, await input.surface?.(`Instructions · ${selected.title}`));
  if (text === undefined) return;
  const current = (await readReport(cwd))?.tasks.find((task) => task.id === selected.id);
  if (current?.status !== "running" || current.conversationId !== selected.conversationId)
    throw new Error("The task moved to another step. Open the current conversation and send again.");
  await new Conversations().send({ cwd, conversationId: selected.conversationId, text });
  void vscode.window.showInformationMessage("Instructions queued. Follow delivery in the task conversation.");
}

async function instructions(extension: vscode.Uri, task: Task, surface?: WorkflowSurface): Promise<string | undefined> {
  const view = new WorkflowView(extension, `Instructions · ${task.title}`, () => view.dispose(), surface);
  let initial = "";
  try {
    while (true) {
      const response = await view.ask({ id: 1, kind: "paste", title: `Instructions for ${task.title}`, initial });
      if (!isRecord(response) || typeof response.value !== "string") return;
      initial = response.value;
      if (initial.trim() && initial.length <= 32000) return initial;
      view.append("Instructions must contain between 1 and 32000 characters.\n");
    }
  } finally { view.dispose(); }
}
