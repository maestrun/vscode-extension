import * as vscode from "vscode";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { bridgeWorker, BridgeOptions, runBridge } from "./bridge";
import { inside, isSampleProject } from "./projects";
import { tasksFile } from "./actions";
import { isRecord, parseReport, Report } from "./report";
import { readReport } from "./storage";
import { mergePlan } from "./plan-state";
import { parsePrompt, WorkflowView, WorkflowSurface } from "./workflow-view";

export class Backend implements vscode.Disposable {
  private readonly plans = new Map<string, Promise<Report>>();
  private readonly operations = new Map<string, AbortController>();
  private readonly views = new Set<WorkflowView>();

  constructor(private readonly extension: vscode.Uri, private readonly state: vscode.Memento,
    private readonly surface: (title: string) => Promise<WorkflowSurface | undefined>) {}

  tasksFile(folder: vscode.WorkspaceFolder): string {
    if (isSampleProject(folder.uri.fsPath)) return "plan.md";
    const configured = tasksFile(folder);
    const selected = this.state.get<{ source: string; path: string }>(`tasksFile:${folder.uri.toString()}`);
    return selected?.source === configured ? selected.path : configured;
  }

  private options(folder: vscode.WorkspaceFolder, action: string): BridgeOptions {
    if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace to use Maestrun.");
    if (process.platform === "win32") throw new Error("Open this project in VS Code through WSL.");
    const config = vscode.workspace.getConfiguration("maestrun", folder.uri);
    return { cwd: folder.uri.fsPath, action, tasksPath: this.tasksFile(folder), worker: bridgeWorker(this.extension.fsPath),
      executable: config.get<string>("executable", "maestrun"), node: config.get<string>("nodeExecutable", "node") };
  }

  busy(folder: vscode.WorkspaceFolder, recursive = false): boolean {
    return recursive ? [...this.operations.keys()].some((key) => inside(folder.uri.fsPath, vscode.Uri.parse(key).fsPath))
      : this.operations.has(folder.uri.toString());
  }

  invalidate(): void { this.plans.clear(); }

  async snapshot(folder: vscode.WorkspaceFolder): Promise<Report | undefined> {
    const saved = await readReport(folder.uri.fsPath);
    try { await stat(resolve(folder.uri.fsPath, this.tasksFile(folder))); }
    catch (error) { if (isRecord(error) && error.code === "ENOENT") return saved; throw error; }
    const key = `${folder.uri.toString()}\n${this.tasksFile(folder)}`;
    let plan = this.plans.get(key);
    if (!plan) {
      plan = runBridge(this.options(folder, "preview")).then(parseReport);
      this.plans.set(key, plan);
    }
    return mergePlan(await plan, saved);
  }

  async execute(folder: vscode.WorkspaceFolder, action: string,
    surface = this.surface, target?: { taskId: string; requestId: string }): Promise<unknown> {
    const key = folder.uri.toString();
    if (action === "cancel" && this.operations.has(key)) { this.operations.get(key)?.abort(); return; }
    if (this.operations.has(key)) throw new Error("A workflow operation is already open for this project.");
    const options = this.options(folder, action);
    const controller = new AbortController();
    this.operations.set(key, controller);
    let view: WorkflowView | undefined;
    try {
      const title = `${folder.name} · ${action === "sample" ? "Run example" : action === "answerInput" ? "Answer question" : action}`;
      view = new WorkflowView(this.extension, title, () => controller.abort(), await surface(title));
      this.views.add(view);
      const current = view;
      const result = await runBridge({ ...options, ...target, signal: controller.signal, onLog: (text) => current.append(text),
        onPrompt: (prompt) => current.ask(parsePrompt(prompt)) });
      if (action === "plan" && this.tasksFile(folder) !== "plan.md")
        await this.state.update(`tasksFile:${key}`, { source: tasksFile(folder), path: "plan.md" });
      if (action === "answerInput" || action === "sample") { view.finish("Operation completed."); view.dispose(); this.views.delete(view); return result; }
      view.finish(action === "run" ? "Execution is running in the background. Follow tasks in the dashboard." : "Operation completed.");
      if (action === "run") { view.dispose(); this.views.delete(view); }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") { view?.finish("Operation cancelled."); return; }
      view?.finish(String(error)); throw error;
    }
    finally { this.operations.delete(key); this.invalidate(); }
  }

  dispose(): void {
    for (const operation of this.operations.values()) operation.abort();
    for (const view of this.views) view.dispose();
    this.plans.clear();
  }
}
