import { Runtime } from "./runtime";
import { isRecord } from "./report";
import { createWorkerUi } from "./worker-ui";
import { performAction } from "./worker-actions";

async function main(): Promise<void> {
  const [directory, action, tasksPath, taskId, requestId] = process.argv.slice(2);
  if (!directory || !action || !tasksPath || !process.send) throw new Error("Invalid bridge invocation.");
  const runtime = new Runtime(directory);
  const controller = new AbortController();
  process.on("message", (value: unknown) => { if (isRecord(value) && value.type === "cancel") controller.abort(); });
  process.on("disconnect", () => controller.abort());
  process.on("SIGTERM", () => controller.abort());
  const ui = createWorkerUi(runtime, controller.signal);
  try {
    const result = await performAction(runtime, action, { cwd: process.cwd(), tasksPath, taskId, requestId, signal: controller.signal, ui });
    process.send({ type: "result", result });
  } catch (error) {
    const cancelled = await runtime.call("shared/errors", "isCancellation", [error]);
    process.send({ type: "failure", cancelled: cancelled === true, message: error instanceof Error ? error.message : String(error),
      nextAction: isRecord(error) && typeof error.nextAction === "string" ? error.nextAction : undefined });
  } finally { process.disconnect?.(); }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
