import { logError, showError } from "./errors";
import { removalTarget } from "./project-removal";
import { AllFlows } from "./all-flows";
import { basename } from "node:path";
import { discoverProjects, inside, isSampleProject, projectInWorkspace, Project } from "./projects";
import { displaySteps } from "./task-flow";
import * as vscode from "vscode";
import { WORKFLOW_ACTIONS, openProjectFile } from "./actions";
import { Details } from "./details";
import { isRecord, pendingInput, Report } from "./report";
import { Backend } from "./backend";
import { sendMessage } from "./send-message";
import { sessionNotice } from "./storage";
import { TaskNode, ProjectTree } from "./task-tree";
import { stat } from "node:fs/promises";

type ProjectDashboard = { folder: vscode.WorkspaceFolder; details: Details; report?: Report };

export class Controller implements vscode.Disposable {
  private readonly tree = new ProjectTree();
  private readonly launcher = vscode.window.createTreeView("maestrun.launcher", { treeDataProvider: { getTreeItem: (item: vscode.TreeItem) => item, getChildren: () => [] } });
  private readonly view = vscode.window.createTreeView("maestrun.projects", { treeDataProvider: this.tree });
  private treeSnapshot = "";
  private projects: Project[] = [];
  private projectsChanged = true;
  private lastProjectScan = 0;
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  private readonly details: Details;
  private readonly backend: Backend;
  private folder?: vscode.WorkspaceFolder;
  private report?: Report;
  private refreshing = false;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly dashboards = new Map<string, ProjectDashboard>();
  private readonly allFlows: AllFlows;
  private activeDashboard?: ProjectDashboard;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.backend = new Backend(context.extensionUri, context.workspaceState, (title) => this.details.workflowSurface(title));
    this.details = new Details(context.extensionUri, (action, node) => this.execute(action, node, null), context.workspaceState,
      { onActive: () => { this.activeDashboard = undefined; } });
    this.disposables.push(vscode.window.registerWebviewViewProvider("maestrun.dashboardView", this.details, { webviewOptions: { retainContextWhenHidden: true } }));
    this.status.command = "maestrun.openSidebar";
    this.disposables.push(this.launcher, this.launcher.onDidChangeVisibility((event) => {
      if (event.visible) void this.execute("openSidebar", undefined, null).catch((error: unknown) => showError(error, "Open Maestrun"));
    }));
    this.status.tooltip = "Browse Maestrun tasks";
    this.disposables.push(vscode.commands.registerCommand("maestrun.selectSidebarProject", (uri: vscode.Uri) =>
      this.selectProject(false, uri).catch((error: unknown) => {
        void showError(error, `Select project: ${uri.fsPath}`);
      })));
    this.allFlows = new AllFlows(context.extensionUri, async (action, entry, node) => {
      if (!entry) return this.execute(action);
      const folder = { uri: vscode.Uri.file(entry.project.path), name: entry.project.name, index: 0 };
      await this.execute(action, node, { folder, report: entry.report, details: this.details });
    });
    this.registerCommands();
    this.watch();
  }

  async initializeLayout(): Promise<void> {
    if (this.context.workspaceState.get<boolean>("secondaryLayout.v1")) return;
    await vscode.commands.executeCommand("vscode.moveViews", {
      viewIds: ["maestrun.projects", "maestrun.dashboardView"], destinationId: "workbench.view.extension.maestrun-workspace"
    });
    await this.context.workspaceState.update("secondaryLayout.v1", true);
  }

  private async resetFolder(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const saved = this.context.workspaceState.get<string>("project");
    if (saved) {
      const uri = vscode.Uri.parse(saved);
      try {
        const root = await projectInWorkspace(uri.fsPath, folders.map((folder) => folder.uri.fsPath));
        if (root) { this.folder = { uri, name: basename(uri.fsPath), index: folders.findIndex((folder) => folder.uri.fsPath === root) }; return; }
      } catch { /* The previously selected project may have been removed. */ }
    }
    this.folder = folders[0];
  }

  private registerCommands(): void {
    const actions = [...WORKFLOW_ACTIONS, "dashboard", "refresh", "selectProject", "openPlan", "openConfig",
      "removeProject", "removeProjectConfig", "deleteExample", "allFlowcharts", "openLog", "showTask", "sendMessage", "answerInput", "openSidebar", "openEditor", "choosePosition", "openProjectDashboard"];
    for (const action of actions) this.disposables.push(vscode.commands.registerCommand(
      `maestrun.${action}`, (node: unknown) => this.execute(action, node,
        isRecord(node) && typeof node.projectPath === "string"
          ? this.dashboards.get(vscode.Uri.file(node.projectPath).toString()) ?? null : this.activeDashboard).catch((error: unknown) => {
        void showError(error, `Command: ${action}`);
      })));
  }

  private watch(): void {
    const timer = setInterval(() => { void this.refresh(); }, 2000);
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.{md,json}");
    const changed = (uri: vscode.Uri): void => {
      if (/[\\/]\.maestrun[\\/]config\.json$/.test(uri.fsPath)) this.projectsChanged = true;
      if (!/[\\/](run|session)\.json$/.test(uri.fsPath)) this.backend.invalidate();
      void this.refresh();
    };
    this.disposables.push(watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed), watcher.onDidDelete(changed),
      vscode.workspace.onDidChangeWorkspaceFolders(() => { this.projectsChanged = true; this.folder = undefined; this.report = undefined; void this.refresh(); }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("maestrun")) { this.backend.invalidate(); void this.refresh(); }
      }), { dispose: () => clearInterval(timer) });
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    if (!this.folder) await this.resetFolder();
    const folder = this.folder;
    try {
      const report = folder ? await this.backend.snapshot(folder) : undefined;
      const notice = folder ? await sessionNotice(folder.uri.fsPath) : undefined;
      if (folder !== this.folder) return;
      this.report = report;
      this.present(report);
      await this.details.update(report, folder?.uri.fsPath ?? "", notice);
    } catch (error) {
      if (folder !== this.folder) return;
      this.report = undefined;
      this.status.text = "$(warning) Maestrun";
      await this.details.update(undefined, folder?.uri.fsPath ?? "", String(error));
    } finally {
      await Promise.all([...this.dashboards.values()].map((dashboard) => this.refreshDashboard(dashboard)));
      await this.refreshProjects();
      this.refreshing = false;
    }
  }

  private async refreshProjects(): Promise<void> {
    try {
      // Watchers can miss files created immediately inside a new directory.
      if (this.projectsChanged || Date.now() - this.lastProjectScan >= 10000) {
        this.projectsChanged = false;
        const result = await discoverProjects((vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath));
        this.projects = result.projects.filter((project) => project.configured).sort((a, b) => a.name.localeCompare(b.name));
        this.lastProjectScan = Date.now();
        this.view.message = result.truncated ? "Scan limit reached. Open a smaller workspace root to list all projects." : undefined;
      }
      const projects = await Promise.all(this.projects.map(async (project) => {
        try {
          const folder = { uri: vscode.Uri.file(project.path), name: basename(project.path), index: 0 };
          return { project, report: await this.backend.snapshot(folder) };
        } catch (error) { return { project, error: String(error) }; }
      }));
      await this.allFlows.update(projects, this.view.message);
      const snapshot = JSON.stringify(projects);
      this.view.description = `${projects.length} projects`;
      if (snapshot !== this.treeSnapshot) { this.treeSnapshot = snapshot; this.tree.update(projects); }
    } catch (error) {
      this.projectsChanged = true;
      this.view.message = `Could not list projects: ${String(error)}`;
      await this.allFlows.update([], this.view.message);
    }
  }

  private async refreshDashboard(dashboard: ProjectDashboard): Promise<void> {
    const path = dashboard.folder.uri.fsPath;
    try {
      if (!await projectInWorkspace(path, (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath))) {
        dashboard.details.dispose(); return;
      }
      dashboard.report = await this.backend.snapshot(dashboard.folder);
      await dashboard.details.update(dashboard.report, path, await sessionNotice(path));
    } catch (error) {
      dashboard.report = undefined;
      await dashboard.details.update(undefined, path, String(error));
    }
  }

  private present(report: Report | undefined): void {
    const done = report?.tasks.filter((task) => task.status === "completed").length ?? 0;
    const total = report?.tasks.length ?? 0;
    this.status.text = `$(checklist) Maestrun ${done}/${total}`;
    this.status.show();
  }

  private async pickProject(roots: string[]): Promise<{ path: string } | undefined> {
    type Item = vscode.QuickPickItem & { path: string; project?: Project };
    const picker = vscode.window.createQuickPick<Item>();
    picker.title = "Maestrun: select project";
    picker.placeholder = "Run or configure the workspace root or an independent subproject";
    picker.matchOnDetail = true;
    picker.ignoreFocusOut = true;
    picker.buttons = [{ iconPath: new vscode.ThemeIcon("refresh"), tooltip: "Refresh projects" }];
    const load = async () => {
      const result = await discoverProjects(roots);
      picker.items = [...result.projects.map((project): Item => ({ label: project.name,
        description: isSampleProject(project.path) ? "Maestrun example" : project.configured ? "Maestrun configured" : project.git ? "Git repository · Set up Maestrun" : "Workspace root · Set up Maestrun",
        detail: project.path, path: project.path, project,
        buttons: project.configured ? [{ iconPath: new vscode.ThemeIcon("trash"), tooltip: isSampleProject(project.path) ? "Delete example" : "Remove workflow configuration" }] : []
      })), { label: "Choose another folder…", description: result.truncated ? "Scan limit reached. Browse any folder in this workspace." : "Set up Maestrun in another workspace subdirectory", path: "" }];
    };
    let working = false;
    const update = async (project?: Project) => {
      if (working) return;
      working = true; picker.busy = true; picker.enabled = false;
      try { if (project) await this.removeProject({ project }, isSampleProject(project.path)); await load(); }
      catch (error) { void showError(error, `Project selector: ${project?.path ?? roots.join(", ")}`); }
      finally { working = false; picker.busy = false; picker.enabled = true; picker.show(); }
    };
    const listeners: vscode.Disposable[] = [];
    try {
      await load();
      return await new Promise<Item | undefined>((resolve) => {
        listeners.push(picker.onDidAccept(() => { if (!working) resolve(picker.selectedItems[0]); }),
          picker.onDidHide(() => { if (!working) resolve(undefined); }),
          picker.onDidTriggerButton(() => { void update(); }),
          picker.onDidTriggerItemButton(({ item }) => { if (item.project) void update(item.project); }));
        picker.show();
      });
    } finally { for (const listener of listeners) listener.dispose(); picker.dispose(); }
  }

  private async selectProject(separate = false, uri?: vscode.Uri): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) throw new Error("Open a project folder in VS Code.");
    const roots = folders.map((folder) => folder.uri.fsPath);
    if (!uri) {
      const selected = await this.pickProject(roots);
      if (!selected) return;
      uri = selected.path ? vscode.Uri.file(selected.path) : (await vscode.window.showOpenDialog({ canSelectFolders: true,
        canSelectFiles: false, canSelectMany: false, defaultUri: folders[0]?.uri, openLabel: "Use this project" }))?.[0];
      if (!uri) return;
    }
    const root = await projectInWorkspace(uri.fsPath, roots);
    if (!root || !(await stat(uri.fsPath)).isDirectory()) throw new Error("Select a folder inside this workspace.");
    if (separate) {
      const key = uri.toString();
      let dashboard = this.dashboards.get(key);
      if (!dashboard) {
        const folder = { uri, name: basename(uri.fsPath), index: folders.findIndex((folder) => folder.uri.fsPath === root) };
        const details = new Details(this.context.extensionUri, (action, node) => this.execute(action, node, dashboard), this.context.workspaceState, {
          projectPath: uri.fsPath,
          onActive: () => { this.activeDashboard = dashboard; },
          onClosed: () => { this.dashboards.delete(key); if (this.activeDashboard === dashboard) this.activeDashboard = undefined; }
        });
        dashboard = { folder, details };
        this.dashboards.set(key, dashboard);
      }
      await this.refreshDashboard(dashboard);
      await dashboard.details.showDashboard(dashboard.report, uri.fsPath, "editor");
      return;
    }
    this.folder = { uri, name: basename(uri.fsPath), index: folders.findIndex((folder) => folder.uri.fsPath === root) };
    this.activeDashboard = undefined;
    const folder = this.folder;
    this.report = undefined;
    await this.context.workspaceState.update("project", uri.toString());
    await this.details.update(undefined, uri.fsPath);
    try {
      const report = await this.backend.snapshot(folder);
      if (folder !== this.folder) return;
      this.report = report;
      await this.details.showDashboard(report, uri.fsPath, "sidebar");
    } catch (error) {
      if (folder === this.folder) await this.details.update(undefined, uri.fsPath, String(error));
    }
  }

  private async execute(action: string, value?: unknown, source: ProjectDashboard | null | undefined = this.activeDashboard): Promise<void> {
    if (action === "dashboard") action = "openSidebar";
    if (isRecord(value) && typeof value.projectPath === "string" && isRecord(value.task)
      && !source && value.projectPath !== this.folder?.uri.fsPath) {
      const uri = vscode.Uri.file(value.projectPath);
      await this.selectProject(false, uri);
      return this.execute(action, value, null);
    }
    if (action === "removeProject" && isRecord(value) && isRecord(value.project) && typeof value.project.path === "string")
      return this.removeProject(value, isSampleProject(value.project.path));
    if (action === "removeProjectConfig" || action === "deleteExample") return this.removeProject(value, action === "deleteExample");
    if (action === "allFlowcharts") { this.projectsChanged = true; await this.refreshProjects(); return this.allFlows.show(); }
    const details = source?.details ?? this.details;
    if (action === "openProjectDashboard") return this.selectProject(true, value instanceof vscode.Uri ? value : undefined);
    if (action === "choosePosition") {
      if (!source && this.folder) {
        await this.selectProject(true, this.folder.uri);
        return this.activeDashboard?.details.choosePosition();
      }
      return details.choosePosition();
    }
    if (action === "selectProject") return this.selectProject(Boolean(source), value instanceof vscode.Uri ? value : undefined);
    if (action === "refresh") { this.projectsChanged = true; this.backend.invalidate(); return this.refresh(); }
    if (!this.folder) await this.resetFolder();
    const folder = source?.folder ?? this.folder;
    const report = source ? source.report : this.report;
    if (!folder && action === "openSidebar") return vscode.commands.executeCommand("maestrun.dashboardView.focus");
    if (!folder) throw new Error("Open a project folder in VS Code.");
    if (source && !await projectInWorkspace(folder.uri.fsPath, (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)))
      throw new Error("This project's folder is no longer in the workspace.");
    if (action === "openLog") {
      if (source) return source.details.showView("logs");
      await this.selectProject(true, folder.uri);
      return this.dashboards.get(folder.uri.toString())?.details.showView("logs");
    }
    if (!source && (action === "openEditor" || action === "dashboard")) {
      await this.selectProject(true, folder.uri);
      const dashboard = this.dashboards.get(folder.uri.toString());
      const node = this.resolveNode(value, folder, dashboard?.report);
      await dashboard?.details.showView("tasks");
      if (dashboard && node) await dashboard.details.show(node, dashboard.report);
      return;
    }
    if (action === "openSidebar") {
      this.activeDashboard = undefined;
      this.folder = folder; this.report = report;
      await this.context.workspaceState.update("project", folder.uri.toString());
      return this.details.showDashboard(report, folder.uri.fsPath, "sidebar");
    }
    if (["dashboard", "openEditor", "openSidebar"].includes(action))
      return details.showDashboard(report, folder.uri.fsPath, action === "openEditor" ? "editor" : undefined);
    if (WORKFLOW_ACTIONS.includes(action)) {
      let result: unknown;
      try { result = await this.backend.execute(folder, action, (title) => details.workflowSurface(title)); }
      finally { if (action === "sample") this.projectsChanged = true; await this.refresh(); }
      if (action === "sample" && isRecord(result) && typeof result.samplePath === "string")
        return this.selectProject(true, vscode.Uri.file(result.samplePath));
      if ((source ? this.dashboards.get(folder.uri.toString()) === source : folder === this.folder) && (action === "run" || action === "plan" || action === "cancel"))
        await details.showDashboard(source ? source.report : this.report, folder.uri.fsPath);
      return;
    }
    const files: Record<string, string> = { openPlan: this.backend.tasksFile(folder), openConfig: ".maestrun/config.json" };
    if (Object.hasOwn(files, action)) return openProjectFile(folder, files[action] ?? "");
    const node = this.resolveNode(value, folder, report);
    if (action === "showTask" && node) return details.show(node, report);
    if (action === "answerInput") {
      const available = report?.tasks.filter((task) => task.status === "on_hold" && pendingInput(task)) ?? [];
      const task = node?.task ?? (await vscode.window.showQuickPick(available.map((task) => ({ label: task.title, description: task.id, task })),
        { title: "Answer a pending question" }))?.task;
      if (!task) return;
      const request = pendingInput(task);
      if (!request || task.status !== "on_hold") throw new Error("This question is no longer pending.");
      try { await this.backend.execute(folder, action, (title) => details.workflowSurface(title), { taskId: task.id, requestId: request.id }); }
      finally { await this.refresh(); }
      return;
    }
    if (action === "sendMessage") { await sendMessage({ folder, extension: this.context.extensionUri, node, surface: (title) => details.workflowSurface(title) }); await this.refresh(); }
  }

  private async removeProject(value: unknown, example: boolean): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace to remove Maestrun files.");
    if (!isRecord(value) || !isRecord(value.project) || typeof value.project.path !== "string")
      throw new Error("Choose a project from the Projects list.");
    const path = value.project.path;
    const roots = () => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    const folder = { uri: vscode.Uri.file(path), name: basename(path), index: 0 };
    if (this.backend.busy(folder, example)) throw new Error("Close the project's workflow form before removing its files.");
    const target = await removalTarget(path, roots(), example);
    const label = example ? "Delete example" : "Remove configuration";
    const accepted = await vscode.window.showWarningMessage(`${label}: ${basename(path)}?`, {
      modal: true, detail: example
        ? `The entire example folder, including generated files and execution history, will be moved to Trash:\n${target}`
        : `Only this workflow configuration will be moved to Trash. The project will leave the Projects list; source files, plans and execution history will be kept.\n${target}`
    }, label);
    if (accepted !== label) return;
    if (this.backend.busy(folder, example)) throw new Error("Close the project's workflow form before removing its files.");
    await removalTarget(path, roots(), example);
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(target), { recursive: example, useTrash: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/trash/i.test(message) || !/not support/i.test(message)) throw error;
      logError(error, `Delete: ${target}`);
      const permanent = "Delete permanently";
      const confirmed = await vscode.window.showWarningMessage(`Trash is not supported. ${label} permanently?`, {
        modal: true, detail: `${example ? "The entire example folder, including generated files and execution history" : "Only the workflow configuration"} will be permanently deleted. This cannot be undone.\n${target}\n\n${message}`
      }, permanent);
      if (confirmed !== permanent) return;
      if (this.backend.busy(folder, example)) throw new Error("Close the project's workflow form before removing its files.");
      await removalTarget(path, roots(), example);
      await vscode.workspace.fs.delete(vscode.Uri.file(target), { recursive: example, useTrash: false });
    }
    for (const dashboard of this.dashboards.values())
      if (example ? inside(path, dashboard.folder.uri.fsPath) : dashboard.folder.uri.fsPath === path) dashboard.details.dispose();
    if (example && this.folder && inside(path, this.folder.uri.fsPath)) {
      this.folder = undefined; this.report = undefined;
      await this.context.workspaceState.update("project", undefined);
    }
    this.projectsChanged = true; this.backend.invalidate();
    await this.refresh();
  }

  private resolveNode(value: unknown, folder: vscode.WorkspaceFolder, report?: Report): TaskNode | undefined {
    if (!isRecord(value) || value.projectPath !== folder.uri.fsPath || !isRecord(value.task)) return;
    const id = value.task.id;
    const task = report?.tasks.find((task) => task.id === id);
    if (!task) return;
    const stepId = isRecord(value.step) ? value.step.id : undefined;
    return { task, projectPath: folder.uri.fsPath, step: displaySteps(task).find((step) => step.id === stepId) };
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    for (const dashboard of this.dashboards.values()) dashboard.details.dispose();
    this.allFlows.dispose();
    this.backend.dispose(); this.details.dispose(); this.tree.dispose(); this.view.dispose(); this.status.dispose();
  }
}
