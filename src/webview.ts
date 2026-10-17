import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { escapeHtml } from "./html";

export function webviewShell(webview: vscode.Webview, extension: vscode.Uri, script: string, sidebarWorkflow = false): string {
  const nonce = randomBytes(16).toString("hex");
  const asset = (name: string): string => escapeHtml(webview.asWebviewUri(vscode.Uri.joinPath(extension, "media", name)).toString());
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${asset("task.css")}"><link rel="stylesheet" href="${asset("nested-flow.css")}"><title>Maestrun</title></head>
    <body data-sidebar-workflow="${sidebarWorkflow}"><main id="content">Loading Maestrun…</main>
    ${script === "task.js" || script === "all-flows.js" ? `<script nonce="${nonce}" src="${asset("task-hierarchy.js")}"></script><script nonce="${nonce}" src="${asset("nested-flow.js")}"></script><script nonce="${nonce}" src="${asset("flow-layout.js")}"></script>` : ""}
    <script nonce="${nonce}" src="${asset(script)}"></script></body></html>`;
}
