import * as vscode from "vscode";
import { isAbsolute, relative, resolve } from "node:path";

export const WORKFLOW_ACTIONS = ["start", "configure", "plan", "run", "cancel", "sample"];

export function tasksFile(folder: vscode.WorkspaceFolder): string {
  return vscode.workspace.getConfiguration("maestrun", folder.uri).get<string>("tasksFile", "plan.md");
}

export async function openProjectFile(folder: vscode.WorkspaceFolder, path: string): Promise<void> {
  const target = resolve(folder.uri.fsPath, path);
  const local = relative(folder.uri.fsPath, target);
  if (isAbsolute(local) || local === ".." || local.startsWith("../") || local.startsWith("..\\"))
    throw new Error("The file must be inside the project folder.");
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
  await vscode.window.showTextDocument(document);
}
