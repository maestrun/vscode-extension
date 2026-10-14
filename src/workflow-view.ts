import * as vscode from "vscode";
import { isRecord } from "./report";
import { escapeHtml } from "./html";
import { webviewShell } from "./webview";
import type { Prompt } from "./worker-ui";
import { isCatalog } from "./model-catalog";
import { isWorkflowTable } from "./worker-ui";

export function parsePrompt(value: unknown): Prompt {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || typeof value.id !== "number"
    || typeof value.title !== "string" || typeof value.kind !== "string"
    || !["select", "checkbox", "input", "paste", "confirm", "table"].includes(value.kind)) throw new Error("Invalid workflow prompt.");
  if (value.context !== undefined && typeof value.context !== "string") throw new Error("Invalid prompt context.");
  if (value.kind === "table" && !isWorkflowTable(value.table)) throw new Error("Invalid workflow table.");
  if (value.catalog !== undefined && !isCatalog(value.catalog)) throw new Error("Invalid model catalog.");
  if (value.error !== undefined && typeof value.error !== "string") throw new Error("Invalid workflow feedback.");
  if (value.choices !== undefined && (!Array.isArray(value.choices) || !value.choices.every((choice) =>
    isRecord(choice) && typeof choice.name === "string" && typeof choice.value === "string"
    && (choice.disabled === undefined || typeof choice.disabled === "string")))) throw new Error("Invalid workflow choices.");
  if (value.initial !== undefined && typeof value.initial !== "string" && typeof value.initial !== "boolean"
    && !(Array.isArray(value.initial) && value.initial.every((item) => typeof item === "string"))) throw new Error("Invalid prompt default.");
  return value as Prompt;
}

function promptHtml(prompt: Prompt): string {
  const choices = (prompt.choices ?? []).map((choice, index) => {
    const checked = Array.isArray(prompt.initial) ? prompt.initial.includes(choice.value) : prompt.initial === choice.value;
    return `<label class="choice"><input name="choice" type="${prompt.kind === "checkbox" ? "checkbox" : "radio"}"
      value="${index}" ${checked ? "checked" : ""} ${choice.disabled ? "disabled" : ""}>
      <span>${escapeHtml(choice.name)}${choice.disabled ? ` — ${escapeHtml(choice.disabled)}` : ""}</span></label>`;
  }).join("");
  const text = typeof prompt.initial === "string" ? escapeHtml(prompt.initial) : "";
  const inputs: Record<string, string> = {
    select: `<input id="filter" name="filter" autocomplete="off" type="search" aria-label="Filter choices" placeholder="Filter options…">${choices}`,
    checkbox: choices,
    input: `<input id="answer" name="answer" autocomplete="off" aria-label="${escapeHtml(prompt.title)}" value="${text}">`,
    paste: `<textarea id="answer" name="answer" autocomplete="off" rows="14" aria-label="${escapeHtml(prompt.title)}" placeholder="${prompt.context ? "Your answer…" : "Requirements, acceptance criteria, and verification…"}">${text}</textarea>`,
    confirm: `<p>Choose an answer to continue.</p>`
  };
  inputs.table = `<button type="button" id="refresh-models">Refresh models</button><p class="muted">Models come from installed, available CLIs. Effort options follow the selected model. Saved unavailable values are preserved until you replace them.</p><p>Existing settings are kept unless you change them. Add a row for each new step; planning is required.</p>
    <div class="workflow-table-scroll" role="region" aria-label="Workflow steps" tabindex="0"><table id="workflow-table">
      <caption>Steps run from top to bottom</caption><thead><tr><th scope="col"><span class="sr-only">Reorder</span></th><th scope="col">Step</th><th scope="col">Executor</th><th scope="col">Model</th><th scope="col">Effort</th><th scope="col">Instruction file (optional)</th><th scope="col">Actions</th></tr></thead><tbody></tbody></table></div>
    <p id="reorder-status" class="muted" role="status">Drag the row handle to reorder steps, or use the Move buttons. Planning stays first.</p><button type="button" id="add-step">Add step</button><p class="muted">Use a built-in name (implementation, testing, qa, review) or your own name. Custom instruction files must already exist at .maestrun/steps/name.md.</p>
    <details id="execution-settings"><summary>Execution settings</summary><div class="execution-fields">
      <label>Mode<select id="execution-mode"><option value="sequential">Sequential</option><option value="parallel">Parallel</option></select></label>
      <label>Concurrency<input id="execution-concurrency" type="number" min="1" max="16" step="1" required></label>
      <label>Maximum repairs<input id="execution-repairs" type="number" min="0" max="100" step="1" placeholder="Default"></label>
      </div></details>`;
  const submit = prompt.kind === "confirm" ? '<button type="submit" value="yes">Yes</button><button type="submit" value="no">No</button>'
    : `<button type="submit">${prompt.kind === "table" ? "Save workflow" : prompt.context ? "Send answer" : "Continue"}</button>`;
  return `<form id="prompt-form"><h2>${escapeHtml(prompt.title)}</h2>${prompt.context ? `<pre class="input-context">${escapeHtml(prompt.context)}</pre>` : ""}${inputs[prompt.kind]}
    <p id="validation" role="alert">${escapeHtml(prompt.error ?? "")}</p><nav>${submit}<button type="button" data-navigation="back">Back</button>
    <button type="button" data-navigation="cancel">Cancel</button></nav></form>`;
}

export type WorkflowSurface = Pick<vscode.WebviewPanel, "webview" | "onDidDispose" | "dispose"> & { reveal(): void; sidebar?: boolean };

export class WorkflowView implements vscode.Disposable {
  private readonly panel: WorkflowSurface;
  private logs = "";
  private prompt?: Prompt;
  private pending?: (value: unknown) => void;
  private closed = false;
  private outcome?: string;

  constructor(extension: vscode.Uri, title: string, private readonly cancel: () => void, surface?: WorkflowSurface) {
    this.panel = surface ?? vscode.window.createWebviewPanel("maestrun.workflow", `Maestrun: ${title}`, vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extension, "media")] });
    if (!surface) (this.panel as vscode.WebviewPanel).iconPath = vscode.Uri.joinPath(extension, "media", "maestrun.png");
    this.panel.webview.html = webviewShell(this.panel.webview, extension, "workflow.js", Boolean(surface?.sidebar));
    const messages = this.panel.webview.onDidReceiveMessage((value: unknown) => this.receive(value));
    this.panel.onDidDispose(() => {
      messages.dispose(); this.closed = true; this.pending?.({ navigation: "cancel" }); this.pending = undefined; this.cancel();
    });
  }

  private receive(value: unknown): void {
    if (!isRecord(value)) return;
    if (value.type === "close") { this.dispose(); return; }
    if (value.type === "ready") { this.publish(); return; }
    if (value.type === "cancel") { this.cancel(); return; }
    if (value.type !== "answer" || !this.prompt || value.id !== this.prompt.id || !this.pending) return;
    const navigation = value.navigation;
    const prompt = this.prompt;
    if (navigation !== "back" && navigation !== "cancel" && !validAnswer(prompt, value.value)) return;
    this.pending(navigation ? { navigation } : { value: value.value });
    this.pending = undefined; this.prompt = undefined; this.publish();
  }

  ask(prompt: Prompt): Promise<unknown> {
    if (this.closed) return Promise.resolve({ navigation: "cancel" });
    this.prompt = prompt;
    this.panel.reveal();
    return new Promise((resolve) => { this.pending = resolve; this.publish(); });
  }

  append(text: string): void { this.logs = (this.logs + text).slice(-60000); this.publish(false); }

  finish(outcome: string): void {
    this.pending?.({ navigation: "cancel" }); this.pending = undefined; this.prompt = undefined;
    this.outcome = outcome; this.publish();
  }

  private publish(includePrompt = true): void {
    if (this.closed) return;
    void this.panel.webview.postMessage({ logs: this.logs, outcome: this.outcome,
      ...(includePrompt ? { prompt: this.prompt, html: this.prompt ? promptHtml(this.prompt) : "" } : {}) });
  }

  dispose(): void { if (!this.closed) this.panel.dispose(); }
}

function validAnswer(prompt: Prompt, value: unknown): boolean {
  if (prompt.kind === "table") return isWorkflowTable(value) || (isRecord(value) && value.refreshCatalog === true && isWorkflowTable(value.table));
  if (prompt.kind === "confirm") return typeof value === "boolean";
  if (prompt.kind === "input" || prompt.kind === "paste") return typeof value === "string";
  const available = prompt.choices?.filter((choice) => !choice.disabled).map((choice) => choice.value) ?? [];
  if (prompt.kind === "select") return typeof value === "string" && available.includes(value);
  return Array.isArray(value) && value.every((item) => typeof item === "string" && available.includes(item));
}
