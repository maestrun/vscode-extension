import * as vscode from "vscode";
import { escapeHtml as e, errorHtml } from "./html";
import { isRecord, Report } from "./report";
import { Project } from "./projects";
import { displaySteps, flowContent } from "./task-flow";
import { taskContent } from "./task-content";
import { taskConversation } from "./execution-log";
import { TaskNode } from "./task-tree";
import { webviewShell } from "./webview";

type Entry = { project: Project; report?: Report; error?: string };

export class AllFlows implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private entries: Entry[] = [];
  private selected?: { path: string; task: string; step?: string };
  private html = "";
  private generation = 0;

  constructor(private readonly extension: vscode.Uri,
    private readonly action: (action: string, entry?: Entry, node?: TaskNode) => Promise<void>) {}

  async show(): Promise<void> {
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel("maestrun.allFlows", "Maestrun · All flowcharts", vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.extension, "media")] });
      this.panel = panel;
      panel.iconPath = vscode.Uri.joinPath(this.extension, "media", "maestrun.png");
      const messages = panel.webview.onDidReceiveMessage((value: unknown) => {
        void this.receive(value).catch((error: unknown) => vscode.window.showErrorMessage(String(error)));
      });
      panel.onDidDispose(() => { messages.dispose(); this.panel = undefined; this.html = ""; this.generation++; });
      panel.webview.html = webviewShell(panel.webview, this.extension, "all-flows.js");
    }
    this.panel.reveal();
    await this.update(this.entries);
  }

  private async receive(value: unknown): Promise<void> {
    if (!isRecord(value) || typeof value.action !== "string") return;
    if (value.action === "ready") { void this.panel?.webview.postMessage({ html: this.html }); return; }
    if (value.action === "refresh") return this.action("refresh");
    if (value.action === "closeStep") { this.selected = undefined; return this.update(this.entries); }
    const entry = this.entries.find((entry) => entry.project.path === value.projectPath);
    if (!entry) return;
    const task = entry.report?.tasks.find((task) => task.id === value.taskId);
    const step = task ? displaySteps(task).find((step) => step.id === value.stepId) : undefined;
    if (value.action === "showStep" || value.action === "showTask") {
      if (!task || (value.action === "showStep" && !step)) return;
      this.selected = { path: entry.project.path, task: task.id, step: step?.id };
      return this.update(this.entries);
    }
    if (["openPlan", "sendMessage", "answerInput", "configure"].includes(value.action))
      await this.action(value.action, entry, task ? { task, step, projectPath: entry.project.path } : undefined);
  }

  async update(entries: Entry[], error?: string): Promise<void> {
    this.entries = entries;
    if (!this.panel) return;
    const generation = ++this.generation;
    let detail = "";
    const selected = this.selected;
    const entry = entries.find((entry) => entry.project.path === selected?.path);
    const task = entry?.report?.tasks.find((task) => task.id === selected?.task);
    const step = task ? displaySteps(task).find((step) => step.id === selected?.step) : undefined;
    if (entry && task && (!selected?.step || step)) {
      detail = taskContent({ task, step, project: entry.project.path, ...await taskConversation(entry.project.path, task, step) });
    } else this.selected = undefined;
    if (generation !== this.generation || !this.panel) return;
    const html = `<div class="all-flows editor-dashboard"><header class="workspace-header"><div><h1>All flowcharts</h1><p class="muted">${entries.length} workflows</p></div><button data-action="refresh">Refresh</button></header>
      ${error ? `<p class="error-banner" role="alert">${errorHtml(error)}</p>` : ""}
      ${!entries.length ? '<div class="empty-state"><h2>No workflows found</h2><p>Projects containing .maestrun/config.json in this workspace appear here.</p></div>' : ""}
      ${entries.map(({ project, report, error }) => `<section class="flow-project" data-project-path="${e(project.path)}"><header class="flow-project-header"><h2 title="${e(project.name)}">${e(project.name)}</h2><p class="project-path" title="${e(project.path)}">${e(project.path)}</p></header>
        ${error ? `<p class="error-banner" role="alert">${errorHtml(error)}</p>` : ""}
        ${!report?.tasks.length && !error ? '<p class="muted">No tasks yet. Generate a plan to preview this workflow.</p>' : ""}
        <div class="all-flow-grid">${(report?.tasks ?? []).map((task) => {
          const active = Boolean(detail && this.selected?.path === project.path && this.selected.task === task.id);
          return `<article class="flow-card ${active ? "selected-flow" : ""}" data-task-id="${e(task.id)}"><h3>${e(task.id)} · ${e(task.title)}</h3><div class="flow-layout ${active ? "with-step" : ""}"><div>${flowContent(task, active ? this.selected?.step : undefined)}</div>
            ${active ? `<section class="inspector step-inspector" aria-label="Step details and logs"><button class="text-button" data-action="closeStep">Close step details</button>${detail}</section>` : ""}</div></article>`;
        }).join("")}</div></section>`).join("")}</div>`;
    if (html === this.html) return;
    this.html = html;
    void this.panel.webview.postMessage({ html });
  }

  dispose(): void { this.panel?.dispose(); }
}
