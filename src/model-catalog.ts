import { isRecord } from "./report";
import { Runtime } from "./runtime";

export type AvailableModel = { id: string; name: string; isDefault?: boolean; efforts?: string[]; defaultEffort?: string };
export type ExecutorCatalog = { executor: string; available: boolean; message: string; models: AvailableModel[] };

export function isCatalog(value: unknown): value is ExecutorCatalog[] {
  return Array.isArray(value) && value.every((entry) => isRecord(entry) && typeof entry.executor === "string"
    && typeof entry.available === "boolean" && typeof entry.message === "string" && Array.isArray(entry.models)
    && entry.models.every((model) => isRecord(model) && typeof model.id === "string" && typeof model.name === "string"
      && (model.isDefault === undefined || typeof model.isDefault === "boolean")
      && (model.defaultEffort === undefined || typeof model.defaultEffort === "string")
      && (model.efforts === undefined || (Array.isArray(model.efforts) && model.efforts.every((effort) => typeof effort === "string")))));
}

export async function discoverCatalog(runtime: Runtime, cwd: string, signal: AbortSignal): Promise<ExecutorCatalog[]> {
  const statuses = await runtime.call("modules/executors/detect-executors", "detectExecutors", [cwd, signal]);
  if (!Array.isArray(statuses)) throw new Error("Invalid executor availability response.");
  const result = await Promise.all(statuses.map(async (status): Promise<ExecutorCatalog> => {
    if (!isRecord(status) || typeof status.id !== "string" || typeof status.state !== "string") throw new Error("Invalid executor status.");
    const entry: ExecutorCatalog = { executor: status.id, available: false, models: [],
      message: [status.detail, status.nextAction].filter((text) => typeof text === "string" && text).join(". ") };
    if (status.state !== "ready") return entry;
    try {
      const models = await runtime.call("modules/executors/discover-models", "discoverModels", [status.id, cwd, signal]);
      const candidate = { ...entry, available: true, message: "", models };
      if (!isCatalog([candidate])) throw new Error("Invalid model catalog.");
      return { ...candidate, models: candidate.models as AvailableModel[], message: (models as unknown[]).length ? "" : "No models returned by this CLI." };
    } catch (error) {
      if (signal.aborted) throw error;
      return { ...entry, message: `Could not load models: ${String(error)}` };
    }
  }));
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  return result;
}

export function validModelSelection(stage: { executor: string; model: string; effort?: string }, catalog: ExecutorCatalog[]): boolean {
  const entry = catalog.find((entry) => entry.executor === stage.executor && entry.available);
  const model = entry?.models.find((model) => model.id === stage.model);
  return Boolean(model && (!stage.effort || model.efforts?.includes(stage.effort)));
}
