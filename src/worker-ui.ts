import { isRecord } from "./report";
import type { ExecutorCatalog } from "./model-catalog";
import { Runtime } from "./runtime";

export type Choice = { name: string; value: string; disabled?: string };
export type WorkflowTable = { stages: { id: string; executor: string; model: string; effort?: string; file?: string }[];
  execution?: { mode: string; concurrency: number; maxRepairs?: number; background?: boolean; orchestrator?: "plan" | "agent" } };
export type Prompt = { id: number; kind: string; title: string; context?: string; choices?: Choice[];
  initial?: string | boolean | readonly string[]; table?: WorkflowTable; catalog?: ExecutorCatalog[]; error?: string };

export function isWorkflowTable(value: unknown): value is WorkflowTable {
  return isRecord(value) && Array.isArray(value.stages) && value.stages.every((stage) =>
    isRecord(stage) && ["id", "executor", "model"].every((key) => typeof stage[key] === "string")
    && ["effort", "file"].every((key) => stage[key] === undefined || typeof stage[key] === "string"))
    && (value.execution === undefined || (isRecord(value.execution) && typeof value.execution.mode === "string"
      && Number.isSafeInteger(value.execution.concurrency)
      && (value.execution.maxRepairs === undefined || Number.isSafeInteger(value.execution.maxRepairs))
      && (value.execution.orchestrator === undefined || ["plan", "agent"].includes(String(value.execution.orchestrator)))
      && (value.execution.background === undefined || typeof value.execution.background === "boolean")));
}

export function createWorkerUi(runtime: Runtime, signal: AbortSignal) {
  let sequence = 0;
  const ask = async (prompt: Omit<Prompt, "id">): Promise<unknown> => {
    const response = await request({ ...prompt, id: ++sequence }, signal);
    if (isRecord(response) && response.navigation)
      throw await runtime.navigation(response.navigation === "back" ? "BackError" : "CancelError");
    return isRecord(response) ? response.value : undefined;
  };
  const select = (title: string, choices: Choice[], initial?: string) => ask({ kind: "select", title, choices, initial });
  const checkbox = (title: string, choices: Choice[], initial?: readonly string[]) => ask({ kind: "checkbox", title, choices, initial });
  return {
    select, search: select, checkbox,
    workflowTable: (table: WorkflowTable, error?: string, catalog?: ExecutorCatalog[]) => ask({ kind: "table", title: "Edit workflow", table, error, catalog }),
    input: (title: string, initial?: string) => ask({ kind: "input", title, initial }),
    taskAnswer: (title: string, context: string, initial: string, error?: string) => ask({ kind: "paste", title, context, initial, error }),
    paste: (initial?: string) => ask({ kind: "paste", title: "Describe the work", initial }),
    confirm: (title: string, initial?: boolean) => ask({ kind: "confirm", title, initial }),
    stages: (selected: string[], order?: string[]) => selectStages({ selected, order, select, checkbox }),
    orderStep: async (ids: string[], step: string) => {
      const others = ids.filter((id) => id !== step);
      const after = await select(`Place ${step} after`, others.map((id) => ({ name: id, value: id })));
      const position = others.indexOf(String(after)) + 1;
      return [...others.slice(0, position), step, ...others.slice(position)];
    },
    log: (text: string) => process.send?.({ type: "log", text: `${extensionText(text)}\n` }),
    write: (text: string) => process.send?.({ type: "log", text }),
    progress: async <T>(text: string, task: () => Promise<T>): Promise<T> => {
      process.send?.({ type: "log", text: `${text}\n` }); return task();
    }
  };
}

function extensionText(text: string): string {
  return text.replace("Run maestrun plan to create the plan.", "Use Generate plan to create your tasks.")
    .replace("Use Esc or ← Back to return; Ctrl+C or Cancel to exit.", "Use Back to return or Cancel to exit.");
}

async function selectStages(input: {
  selected: string[]; order?: string[];
  select: (title: string, choices: Choice[]) => Promise<unknown>;
  checkbox: (title: string, choices: Choice[], selected: string[]) => Promise<unknown>;
}): Promise<string[]> {
  const ids = input.order ?? ["planning", "implementation", "testing", "qa"];
  const value = await input.checkbox("Workflow stages", ids.map((id) => ({ name: id, value: id,
    ...(id === "planning" ? { disabled: "Planning is required" } : {}) })), input.selected);
  const selected = ["planning", ...(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id !== "planning") : [])];
  const actions = [{ name: "Continue", value: "continue" }, { name: "Add a custom step", value: "add-custom-step" }];
  if (selected.some((id) => id.startsWith("custom:"))) actions.push({ name: "Create step instruction files", value: "create-step-files" });
  const action = await input.select("Workflow stages", actions);
  return action === "continue" ? selected : [...selected, String(action)];
}

function request(prompt: Prompt, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => { process.off("message", receive); signal.removeEventListener("abort", abort); };
    const abort = (): void => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    const receive = (value: unknown): void => {
      if (!isRecord(value) || value.type !== "answer" || value.id !== prompt.id) return;
      cleanup(); resolve(value);
    };
    if (signal.aborted) { abort(); return; }
    process.on("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    process.send?.({ type: "prompt", prompt });
  });
}
