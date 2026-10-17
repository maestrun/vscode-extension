import { showError } from "./errors";
import { displaySteps } from "./task-flow";
import * as vscode from "vscode";
import { isRecord, Report } from "./report";
import { executionLog, taskConversation } from "./execution-log";
import type { EditorView } from "./editor-content";
import { taskContent, taskSummary } from "./task-content";
import { TaskNode } from "./task-tree";
import { webviewShell } from "./webview";
import { dashboardContent } from "./dashboard-content";
import type { WorkflowSurface } from "./workflow-view";

type Mode = "editor" | "sidebar";
export class Details implements vscode.Disposable, vscode.WebviewViewProvider {
  private panel?: vscode.WebviewPanel;
  private restoreDashboard?: () => void;
  private view?: vscode.WebviewView;
  private selection?: TaskNode;
  private content = "";
  private generation = 0;
  private report?: Report;
  private projectPath = "";
  private mode: Mode;
  private flowDetailsClosed = false;
  private editorView: EditorView = "tasks";

  constructor(private readonly extensionUri: vscode.Uri,
    private readonly handleAction: (action: string, node?: TaskNode) => Promise<void>,
    private readonly workspaceState: vscode.Memento,
    private readonly options: { projectPath?: string; onActive?: () => void; onClosed?: () => void } = {}) {
    this.mode = options.projectPath ? "editor" : "sidebar";
    const saved = workspaceState.get<string>(this.key("editor.view"));
    if (saved === "flow" || saved === "logs") this.editorView = saved;
  }

  private key(name: string): string { return this.options.projectPath ? `${name}:${this.options.projectPath}` : name; }

  private get title(): string {
    return this.projectPath ? `Maestrun · ${vscode.workspace.asRelativePath(vscode.Uri.file(this.projectPath), true)}` : "Maestrun · Tasks";
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")] };
    const messages = this.connect(view.webview, "sidebar");
    view.webview.html = webviewShell(view.webview, this.extensionUri, "task.js");
    const visibility = view.onDidChangeVisibility(() => {
      if (view.visible) { this.mode = "sidebar"; this.options.onActive?.(); void this.workspaceState.update(this.key("dashboard.mode"), "sidebar"); }
    });
    view.onDidDispose(() => { visibility.dispose(); this.view = undefined; messages.dispose(); });
    void this.update(this.report, this.projectPath);
  }

  async show(node: TaskNode, report?: Report): Promise<void> {
    this.flowDetailsClosed = false;
    this.selection = node; this.projectPath = node.projectPath;
    await this.reveal();
    await this.update(report, node.projectPath);
    void this.currentWebview()?.postMessage({ revealTask: true });
  }

  async showDashboard(report: Report | undefined, projectPath: string, mode?: Mode): Promise<void> {
    if (mode) { this.mode = mode; await this.workspaceState.update(this.key("dashboard.mode"), mode); }
    await this.update(report, projectPath);
    await this.reveal();
    await this.update(report, projectPath);
  }

  async showView(view: EditorView): Promise<void> {
    this.flowDetailsClosed = false;
    this.editorView = view;
    if (this.selection) this.selection = { ...this.selection, step: undefined };
    await this.workspaceState.update(this.key("editor.view"), view);
    await this.update(this.report, this.projectPath);
    await this.reveal();
  }

  async choosePosition(): Promise<void> {
    const choice = await vscode.window.showQuickPick([
      { label: "Editor on the right", column: vscode.ViewColumn.Two },
      { label: "Editor on the left", column: vscode.ViewColumn.One },
      { label: "Beside the active editor", column: vscode.ViewColumn.Beside },
      { label: "Sidebar", column: undefined }
    ], { title: "Maestrun: choose window position", placeHolder: "The position is remembered for this workspace" });
    if (!choice) return;
    if (choice.column === undefined && this.options.projectPath) return this.handleAction("openSidebar");
    if (choice.column !== undefined) {
      await this.workspaceState.update(this.key("dashboard.editorColumn"), choice.column);
      this.panel?.reveal(choice.column);
    }
    await this.showDashboard(this.report, this.projectPath, choice.column === undefined ? "sidebar" : "editor");
  }

  private currentWebview(): vscode.Webview | undefined { return this.mode === "sidebar" ? this.view?.webview : this.panel?.webview; }

  private async reveal(): Promise<void> {
    if (this.mode === "sidebar") {
      await vscode.commands.executeCommand("maestrun.dashboardView.focus");
      this.view?.show(false); return;
    }
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel("maestrun.task", "Maestrun · Tasks", this.workspaceState.get(this.key("dashboard.editorColumn"), vscode.ViewColumn.Two),
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")] });
      this.panel = panel;
      panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "maestrun.png");
      const messages = this.connect(panel.webview, "editor");
      panel.webview.html = webviewShell(panel.webview, this.extensionUri, "task.js");
      const position = panel.onDidChangeViewState(() => {
        if (panel.active) this.options.onActive?.();
        if (panel.viewColumn) void this.workspaceState.update(this.key("dashboard.editorColumn"), panel.viewColumn);
      });
      if (panel.viewColumn) await this.workspaceState.update(this.key("dashboard.editorColumn"), panel.viewColumn);
      panel.onDidDispose(() => { position.dispose(); messages.dispose(); this.panel = undefined; this.options.onClosed?.(); });
    }
    this.panel.reveal();
    this.options.onActive?.();
  }

  async workflowSurface(title: string, reuse = false): Promise<WorkflowSurface | undefined> {
    if (reuse && this.options.projectPath) {
      this.restoreDashboard?.();
      await this.reveal();
      const panel = this.panel!;
      panel.title = `Maestrun: ${title}`;
      const closed = new vscode.EventEmitter<void>();
      const restore = (disposed = false): void => {
        if (this.restoreDashboard !== restore) return;
        this.restoreDashboard = undefined;
        listener.dispose();
        closed.fire(); closed.dispose();
        if (!disposed) {
          panel.title = this.title;
          panel.webview.html = webviewShell(panel.webview, this.extensionUri, "task.js");
        }
      };
      const listener = panel.onDidDispose(() => restore(true));
      this.restoreDashboard = restore;
      return { webview: panel.webview, onDidDispose: closed.event,
        reveal: () => panel.reveal(), dispose: () => restore() };
    }
    const panel = vscode.window.createWebviewPanel("maestrun.workflow", `Maestrun: ${title}`,
      this.panel?.viewColumn ?? this.workspaceState.get(this.key("dashboard.editorColumn"), vscode.ViewColumn.Two),
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")] });
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "maestrun.png");
    return panel;
  }

  private connect(webview: vscode.Webview, mode: Mode): vscode.Disposable {
    return webview.onDidReceiveMessage((value: unknown) => {
      if (this.restoreDashboard && mode === "editor") return;
      if (!isRecord(value) || typeof value.action !== "string") return;
      if (value.action === "ready") { void webview.postMessage({ html: this.content,
        revealTask: Boolean(this.selection), focusTask: false }); return; }
      this.mode = mode;
      this.options.onActive?.();
      void this.workspaceState.update(this.key("dashboard.mode"), mode);
      if (this.options.projectPath && ["showFlowchart", "showDetailedTasks"].includes(value.action)) {
        void this.showView(value.action === "showFlowchart" ? "flow" : "tasks").catch((error: unknown) => showError(error, `${value.action}: ${this.projectPath}`));
        return;
      }
      if (value.action === "closeStep") {
        this.flowDetailsClosed = true;
        if (this.selection) this.selection = { ...this.selection, step: undefined };
        void this.update(this.report, this.projectPath).catch((error: unknown) => showError(error, `closeStep: ${this.projectPath}`));
        return;
      }
      const actions = ["allFlowcharts", "sendMessage", "answerInput", "openPlan", "openLog", "start", "configure", "sample", "plan", "run", "cancel", "refresh", "showTask", "showStep", "openConfig", "selectProject", "openSidebar", "openEditor", "choosePosition", "openProjectDashboard"];
      let node = this.selection;
      if (value.action === "showTask" || value.action === "showStep") {
        const task = this.report?.tasks.find((task) => task.id === (value.taskId ?? node?.task.id));
        if (!task) return;
        node = { task, projectPath: this.projectPath, step: displaySteps(task).find((step) => step.id === value.stepId) };
      }
      if (actions.includes(value.action)) void this.handleAction(value.action === "showStep" ? "showTask" : value.action, node)
        .catch((error: unknown) => { void showError(error, `${value.action}: ${this.projectPath}`); });
    });
  }

  async update(report: Report | undefined, projectPath: string, error?: string): Promise<void> {
    if (this.projectPath !== projectPath) { this.selection = undefined; this.flowDetailsClosed = false; }
    this.report = report; this.projectPath = projectPath;
    const generation = ++this.generation;
    if (this.options.projectPath && this.editorView === "logs") {
      const logs = await executionLog(report, projectPath);
      if (generation === this.generation) this.publish(dashboardContent(report, projectPath, error, undefined, undefined, false, "logs", undefined, logs));
      return;
    }
    if (this.options.projectPath && this.editorView === "flow" && !report?.tasks.some((task) => task.id === this.selection?.task.id)) {
      const task = report?.tasks.find((task) => task.status === "running") ?? report?.tasks[0];
      this.selection = task ? { task, projectPath } : undefined;
    }
    const node = this.selection;
    const task = report?.tasks.find((task) => task.id === node?.task.id);
    if (!task || !node) { this.selection = undefined;
      if (this.panel && !this.restoreDashboard) this.panel.title = this.title;
      this.publish(dashboardContent(report, projectPath, error, undefined, undefined, !this.options.projectPath, this.editorView)); return; }
    const step = node.step ? displaySteps(task).find((step) => step.id === node.step?.id) : undefined;
    if (!this.options.projectPath) {
      this.publish(dashboardContent(report, projectPath, error, taskSummary(task, step), task.id, true));
      return;
    }
    const conversation = await taskConversation(projectPath, task, step);
    if (generation !== this.generation) return;
    if (this.panel && !this.restoreDashboard) this.panel.title = `${this.title} · ${task.title}`;
    this.publish(dashboardContent(report, projectPath, error,
      this.editorView === "flow" && this.flowDetailsClosed ? undefined : taskContent({ task, step, ...conversation, project: projectPath }), task.id, false, this.editorView, step?.id));
  }

  private publish(html: string): void {
    if (html === this.content) return;
    this.content = html;
    if (!this.restoreDashboard) void this.panel?.webview.postMessage({ html });
    void this.view?.webview.postMessage({ html });
  }

  dispose(): void { this.panel?.dispose(); }
}
