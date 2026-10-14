import { disposeErrorLog } from "./errors";
import * as vscode from "vscode";
import { Controller } from "./controller";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const controller = new Controller(context);
  context.subscriptions.push(controller, { dispose: disposeErrorLog });
  await controller.refresh();
  await controller.initializeLayout();
}
