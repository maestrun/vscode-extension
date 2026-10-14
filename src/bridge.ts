import { fork, ChildProcess } from "node:child_process";
import { join } from "node:path";
import { isRecord } from "./report";
import { executablePath, runtimeDirectory } from "./runtime";

export type BridgeOptions = {
  cwd: string; executable: string; node: string; action: string; tasksPath: string; worker: string;
  taskId?: string; requestId?: string;
  signal?: AbortSignal; onLog?: (text: string) => void; onPrompt?: (prompt: unknown) => Promise<unknown>;
};

export async function runBridge(options: BridgeOptions): Promise<unknown> {
  if (options.signal?.aborted) throw new Error("Cancelled");
  const directory = await runtimeDirectory(options.executable, options.cwd);
  const node = await executablePath(options.node, options.cwd);
  const child = fork(options.worker, [directory, options.action, options.tasksPath, options.taskId ?? "", options.requestId ?? ""], {
    cwd: options.cwd, execPath: node, execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
  });
  return follow(child, options);
}

function follow(child: ChildProcess, options: BridgeOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let received = false;
    let failure = "";
    let result: unknown;
    const abort = (): void => { if (child.connected) child.send({ type: "cancel" }); };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout?.on("data", (data: Buffer) => options.onLog?.(data.toString()));
    child.stderr?.on("data", (data: Buffer) => { failure = (failure + data.toString()).slice(-8000); options.onLog?.(data.toString()); });
    child.on("message", (message: unknown) => {
      if (!isRecord(message)) return;
      if (message.type === "log" && typeof message.text === "string") options.onLog?.(message.text);
      if (message.type === "result") { received = true; result = message.result; }
      if (message.type === "failure") failure = `${String(message.message)}${message.nextAction ? `\n${String(message.nextAction)}` : ""}`;
      if (message.type === "prompt") void answer(child, message.prompt, options).catch((error: unknown) => {
        failure = String(error); abort();
      });
    });
    child.once("error", reject);
    child.once("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (received && code === 0) resolve(result);
      else reject(new Error(failure || `Maestrun worker exited with code ${code}. Check the Node.js and Maestrun settings.`));
    });
  });
}

async function answer(child: ChildProcess, prompt: unknown, options: BridgeOptions): Promise<void> {
  if (!isRecord(prompt) || typeof prompt.id !== "number" || !options.onPrompt)
    throw new Error("Unexpected Maestrun prompt.");
  const response = await options.onPrompt(prompt);
  if (child.connected && isRecord(response)) child.send({ ...response, type: "answer", id: prompt.id });
}

export function bridgeWorker(extensionPath: string): string { return join(extensionPath, "dist", "bridge-worker.js"); }
