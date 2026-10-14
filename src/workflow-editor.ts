import { discoverCatalog, validModelSelection } from "./model-catalog";
import { Runtime } from "./runtime";
import { isRecord } from "./report";
import { createWorkerUi, isWorkflowTable, WorkflowTable } from "./worker-ui";

export async function editWorkflow(runtime: Runtime, input: {
  cwd: string; signal: AbortSignal; ui: ReturnType<typeof createWorkerUi>
}, quick: boolean): Promise<unknown> {
  const saved = await runtime.call("config/index", "loadConfig", [input.cwd]);
  if (!isRecord(saved)) throw new Error("Invalid workflow response.");
  if (!saved.config) return runtime.call("modules/workflow/initialize-workflow", "initialize", [{ ...input, quick }]);
  if (!isWorkflowTable(saved.config)) throw new Error("Unsupported workflow configuration.");
  const original = saved.config;
  const initial: WorkflowTable = { stages: original.stages, ...(original.execution ? { execution: original.execution } : {}) };
  let draft = initial;
  let error: string | undefined;
  while (true) {
    const action = await input.ui.select("Saved workflow found", [
      { name: "Keep the saved workflow and exit", value: "reuse" },
      { name: "Edit steps and execution in a table", value: "adjust" },
      { name: "More settings (guided setup)", value: "wizard" }
    ], "reuse");
    if (action === "reuse") { input.ui.log("Workflow kept unchanged."); return; }
    if (action === "wizard") return runtime.call("modules/workflow/initialize-workflow", "initialize", [input]);
    let catalog = await input.ui.progress("Checking installed CLIs and available models…", () => discoverCatalog(runtime, input.cwd, input.signal));
    while (true) {
      let response: unknown;
      try { response = await input.ui.workflowTable(draft, error, catalog); }
      catch (cause) {
        const back = await runtime.navigation("BackError");
        if (cause instanceof Error && cause.constructor === back.constructor) break;
        throw cause;
      }
      if (isRecord(response) && response.refreshCatalog === true && isWorkflowTable(response.table)) {
        draft = response.table;
        catalog = await input.ui.progress("Refreshing available models…", () => discoverCatalog(runtime, input.cwd, input.signal));
        continue;
      }
      if (!isWorkflowTable(response)) { error = "Check the step fields and execution settings."; continue; }
      draft = response;
      if (JSON.stringify(draft) === JSON.stringify(initial)) { input.ui.log("Workflow kept unchanged."); return; }
      try { await runtime.call("config/index", "parseConfig", [{ ...original, ...draft }]); }
      catch {
        error = "Check each row: use unique step names, a valid executor/model and compatible effort. Planning must stay first; built-in steps stay in their original order. Instruction paths use .maestrun/steps/name.md and only apply to custom steps. Execution values must be valid whole numbers.";
        continue;
      }
      const invalid = draft.stages.find((stage) => !initial.stages.some((saved) => saved.executor === stage.executor && saved.model === stage.model && saved.effort === stage.effort)
        && !validModelSelection(stage, catalog));
      if (invalid) { error = `Choose an available model and supported effort for ${invalid.id}. Refresh models after installing or signing in to a CLI.`; continue; }
      if (input.signal.aborted) throw await runtime.navigation("CancelError");
      if (!isRecord(saved.snapshot)) throw new Error("Missing configuration snapshot.");
      const document: unknown = saved.snapshot.exists ? JSON.parse(String(saved.snapshot.content)) : {};
      if (!isRecord(document)) throw new Error("Invalid configuration document.");
      const updated = { ...document,
        ...(JSON.stringify(draft.stages) !== JSON.stringify(initial.stages) ? { version: 1, stages: draft.stages } : {}),
        ...(JSON.stringify(draft.execution) !== JSON.stringify(initial.execution) ? { execution: draft.execution } : {}) };
      await runtime.call("config/index", "saveConfigDocument", [input.cwd, updated, saved.snapshot]);
      input.ui.log("Workflow saved."); return;
    }
  }
}
