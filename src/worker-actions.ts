import { createHash } from "node:crypto";
import { isRecord, pendingInput, validInputText } from "./report";
import { readReport } from "./storage";
import { Runtime } from "./runtime";
import { createWorkerUi } from "./worker-ui";
import { editWorkflow } from "./workflow-editor";

type Input = { only?: readonly string[]; taskId?: string; requestId?: string; cwd: string; tasksPath: string; signal: AbortSignal; ui: ReturnType<typeof createWorkerUi> };

export async function performAction(runtime: Runtime, action: string, input: Input): Promise<unknown> {
  if (action === "answerInput") return answerInput(runtime, input);
  if (action === "preview") return preview(runtime, input);
  await runtime.call("shared/home", "ensureHomeDirectory");
  if (action === "start" || action === "configure") return editWorkflow(runtime, input, action === "start");
  if (action === "plan") return runtime.call("modules/planning/create-plan", "createPlan", [input]);
  if (action === "sample") return startSample(runtime, input);
  if (action === "run") {
    const session = await runtime.call("modules/execution/run-session.repository", "readSession", [input.cwd]);
    if (isRecord(session) && session.status === "running") return startRun(runtime, input);
    await runtime.call("modules/execution/choose-workspace-repositories", "chooseWorkspaceRepositories", [input]);
    const only = await runtime.call("modules/execution/choose-run-tasks", "chooseRunTasks", [input]);
    if (only !== undefined && (!Array.isArray(only) || !only.every((id) => typeof id === "string")))
      throw new Error("Invalid task selection. Update the Maestrun CLI and retry.");
    return startRun(runtime, { ...input, ...(only ? { only } : {}) });
  }
  if (action === "cancel") return cancelRun(runtime, input.cwd);
  throw new Error(`Unknown action: ${action}`);
}

async function preview(runtime: Runtime, input: Input): Promise<unknown> {
  const tasks = await runtime.call("modules/execution/tasks", "loadTasks", [input.cwd, input.tasksPath]);
  const saved = await runtime.call("config/index", "loadConfig", [input.cwd]);
  if (!Array.isArray(tasks) || !isRecord(saved)) throw new Error("Invalid Maestrun plan response.");
  if (isRecord(saved.config) && isRecord(saved.config.execution) && saved.config.execution.orchestrator)
    return previewOrchestration(runtime, { cwd: input.cwd, config: saved.config, tasks });
  const entries = await Promise.all(tasks.map(async (task: unknown) => {
    if (!isRecord(task)) throw new Error("Invalid task definition.");
    const state = saved.config ? await runtime.call("modules/execution/scheduler", "initialTaskState", [saved.config, task])
      : { id: task.id, title: task.title, status: "pending", completedSteps: 0, totalSteps: 0 };
    if (!isRecord(state) || !Array.isArray(task.dependsOn)) throw new Error("Invalid task state.");
    const definition = createHash("sha256").update(JSON.stringify({ ...task, dependsOn: [...task.dependsOn].sort() })).digest("hex");
    return { ...state, definition, instructions: task.instructions, dependsOn: task.dependsOn, target: task.target };
  }));
  return { version: 1, startedAt: "", tasks: entries };
}

async function previewOrchestration(runtime: Runtime, input: { cwd: string; config: unknown; tasks: unknown[] }): Promise<unknown> {
  const report = await runtime.call("modules/execution/orchestration-state", "orchestrationReport", [input.cwd, input.config, input.tasks]);
  if (!isRecord(report) || !Array.isArray(report.tasks) || !isRecord(report.orchestration)
    || !Array.isArray(report.orchestration.tasks)) throw new Error("Invalid orchestration preview.");
  const definitions = report.orchestration.tasks;
  return { ...report, tasks: report.tasks.map((task: unknown) => {
    if (!isRecord(task)) throw new Error("Invalid orchestrated task.");
    const definition = definitions.find((entry: unknown) => isRecord(entry) && entry.id === task.id);
    return isRecord(definition) ? { ...task, instructions: definition.instructions, dependsOn: task.dependsOn ?? definition.dependsOn, target: definition.target } : task;
  }) };
}

async function startRun(runtime: Runtime, input: Input): Promise<unknown> {
  const session = await runtime.call("modules/execution/run-session.repository", "readSession", [input.cwd]);
  if (isRecord(session) && session.status === "running") {
    if (await runtime.call("modules/execution/run-session.repository", "workerAlive", [session])) return session;
    throw new Error("The previous worker stopped unexpectedly. Inspect the execution log and preserved session files before retrying.");
  }
  await runtime.call("modules/execution/run-workflow", "runWorkflow", [{ ...input, dryRun: true }]);
  const saved = await runtime.call("config/index", "loadConfig", [input.cwd]);
  const plugins = isRecord(saved) && isRecord(saved.config) ? saved.config.plugins : undefined;
  let trustPlugins = false;
  if (Array.isArray(plugins) && plugins.length) {
    trustPlugins = await input.ui.confirm(`Allow these project plugins full process access for this run?\n${plugins.join("\n")}`, false) === true;
    if (!trustPlugins) throw await runtime.navigation("CancelError");
  }
  if (input.signal.aborted) throw await runtime.navigation("CancelError");
  return runtime.call("modules/execution/start-run-session", "startRunSession", [input.cwd, input.tasksPath, { trustPlugins, ...(input.only ? { only: input.only } : {}) }]);
}

async function cancelRun(runtime: Runtime, cwd: string): Promise<unknown> {
  const session = await runtime.call("modules/execution/run-session.repository", "readSession", [cwd]);
  if (!isRecord(session) || session.status !== "running") throw new Error("There is no active execution to cancel.");
  return runtime.call("modules/execution/run-session.repository", "saveSessionFile", [cwd, "cancel", session.id]);
}

async function answerInput(runtime: Runtime, input: Input): Promise<void> {
  const task = (await readReport(input.cwd))?.tasks.find((entry) => entry.id === input.taskId);
  const request = task && pendingInput(task);
  if (!task || task.status !== "on_hold" || !request || request.id !== input.requestId)
    throw new Error("This question is no longer pending. Refresh the task list.");
  let initial = "";
  let error: string | undefined;
  while (true) {
    const answer = await input.ui.taskAnswer(`Answer · ${task.title}`, `${request.summary}\n\n${request.question}`, initial, error);
    if (input.signal.aborted) throw await runtime.navigation("CancelError");
    if (validInputText(answer)) {
      await runtime.call("modules/execution/task-input.repository", "answerTaskInput", [input.cwd, task, answer]);
      return;
    }
    initial = typeof answer === "string" ? answer : "";
    error = "Enter an answer with 1–32000 characters.";
  }
}

async function startSample(runtime: Runtime, input: Input): Promise<unknown> {
  const mode = await input.ui.select("Choose an example", [
    { name: "Simple — 2 sequential tasks: implementation and tests", value: "simple" },
    { name: "Advanced — 5 tasks: on hold, failure, QA repair and Git integration", value: "advanced" },
    { name: "Orchestrator plan — 6 small tasks, varied steps", value: "orchestrator-plan" },
    { name: "Orchestrator agent — 6 small tasks, varied steps", value: "orchestrator-agent" }
  ], "simple");
  if (!["simple", "advanced", "orchestrator-plan", "orchestrator-agent"].includes(String(mode))) throw new Error("Invalid example mode.");
  const assignment = await runtime.call("modules/workflow/sample-settings", "selectSampleAssignment", [input]);
  const description = mode === "simple"
    ? "Run the simple example with 2 tasks (Implementation → Tests)?"
    : mode === "orchestrator-plan" || mode === "orchestrator-agent"
      ? `Run the ${mode} example with 6 small tasks, varied steps and nested subtasks? Select low effort to minimize usage.`
    : "Run the advanced example with 5 tasks? Answer the simulated approval with continue. One task intentionally fails; the expected final status is Failed after the other four complete.";
  if (!await input.ui.confirm(`${description}\nA separate example folder will be created. Execution uses your selected executor account and consumes its usage.`, false))
    throw await runtime.navigation("CancelError");
  if (input.signal.aborted) throw await runtime.navigation("CancelError");
  const samplePath = await runtime.call("modules/execution/run-sample", "prepareSample", [input.cwd, assignment, mode]);
  if (typeof samplePath !== "string") throw new Error("Invalid example project path.");
  input.ui.log(`Example project: ${samplePath}`);
  const session = await startRun(runtime, { ...input, cwd: samplePath, tasksPath: "plan.md" });
  return { samplePath, session };
}
