import type { Step, Task } from "./report";
import type { Report } from "./report";
import { isSampleProject, type Project } from "./projects";
import { basename, relative } from "node:path";
import * as vscode from "vscode";

export type TaskNode = { task: Task; step?: Step; projectPath: string };
type ProjectNode = { project: Project; report?: Report; error?: string };

export class ProjectTree implements vscode.TreeDataProvider<ProjectNode>, vscode.Disposable {
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.change.event;
  private projects: ProjectNode[] = [];

  update(projects: ProjectNode[]): void {
    this.projects = projects;
    this.change.fire();
  }

  getChildren(): ProjectNode[] { return this.projects; }

  getTreeItem(node: ProjectNode): vscode.TreeItem {
    const tasks = node.report?.tasks ?? [];
    const label = relative(node.project.root, node.project.path) || basename(node.project.root);
    const row = new vscode.TreeItem(isSampleProject(node.project.path) ? `Example · ${basename(node.project.path)}` : label, vscode.TreeItemCollapsibleState.None);
    row.contextValue = isSampleProject(node.project.path) ? "maestrunExample" : "maestrunProject";
    row.id = node.project.path;
    row.resourceUri = vscode.Uri.file(node.project.path);
    row.description = node.error ? "Needs attention" : tasks.length
      ? `${tasks.filter((task) => task.status === "completed").length}/${tasks.length} tasks` : "No plan yet";
    const held = tasks.filter((task) => task.status === "on_hold").length;
    const running = tasks.filter((task) => task.status === "running").length;
    if (held) row.description += ` · ${held} on hold`;
    if (running) row.description += ` · ${running} running`;
    row.tooltip = `${node.project.path}${node.error ? `\n${node.error}` : ""}`;
    row.iconPath = new vscode.ThemeIcon(node.error ? "warning" : isSampleProject(node.project.path) ? "beaker" : "folder");
    row.command = { command: "maestrun.selectSidebarProject", title: "Show project tasks", arguments: [row.resourceUri] };
    return row;
  }

  dispose(): void { this.change.dispose(); }
}
