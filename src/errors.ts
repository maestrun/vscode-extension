import * as vscode from "vscode";

let output: vscode.OutputChannel | undefined;

export function logError(error: unknown, context: string): vscode.OutputChannel {
  output ??= vscode.window.createOutputChannel("Maestrun");
  output.appendLine(`[${new Date().toISOString()}] ${context}`);
  output.appendLine(error instanceof Error ? error.stack ?? error.message : String(error));
  return output;
}

export async function showError(error: unknown, context: string): Promise<void> {
  const log = logError(error, context);
  const message = error instanceof Error ? error.message : String(error);
  const missing = message.startsWith("Maestrun CLI was not found.");
  const choice = await vscode.window.showErrorMessage(`Maestrun: ${message}`, ...(missing ? ["Installation instructions", "View logs"] : ["View logs"]));
  if (choice === "View logs") log.show(true);
  if (missing && choice === "Installation instructions") await vscode.env.openExternal(vscode.Uri.parse("https://maestrun.com"));
}

export function disposeErrorLog(): void { output?.dispose(); output = undefined; }
