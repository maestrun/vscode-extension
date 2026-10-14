export type Status = "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled" | "refactor" | "on_hold";
export type Message = { id: string; role: "user" | "model"; text: string; status?: string; error?: string };
export type Conversation = { active: boolean; messages: Message[] };
export type Step = {
  id: string; title: string; status: Status; summary?: string; model?: string; effort?: string;
  tokenUsage?: { inputTokens: number; outputTokens: number }; tokenUsageIncomplete?: boolean;
  conversationId?: string; conversation?: Conversation;
};
export type InputRequest = { id: string; stage: string; question: string; summary: string; answer?: string };
export type Task = Step & {
  inputRequests?: InputRequest[]; plannedStages?: string[];
  integration?: "pending" | "running"; worktree?: { integrated?: boolean };
  completedSteps: number; totalSteps: number; steps?: Step[]; step?: string;
  executor?: string; error?: string; definition?: string; instructions?: string; dependsOn?: string[]; target?: string;
};
export type Report = { version: 1; startedAt: string; finishedAt?: string; tasks: Task[] };

export const STATUS: Record<Status, { label: string; icon: string; color: string }> = {
  on_hold: { label: "On hold", icon: "debug-pause", color: "charts.orange" },
  pending: { label: "Pending", icon: "circle-outline", color: "descriptionForeground" },
  running: { label: "Running", icon: "sync~spin", color: "charts.blue" },
  completed: { label: "Completed", icon: "pass", color: "testing.iconPassed" },
  failed: { label: "Failed", icon: "error", color: "testing.iconFailed" },
  blocked: { label: "Blocked", icon: "lock", color: "charts.orange" },
  cancelled: { label: "Cancelled", icon: "circle-slash", color: "descriptionForeground" },
  refactor: { label: "Needs changes", icon: "tools", color: "charts.orange" }
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalStrings(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((key) => value[key] === undefined || typeof value[key] === "string");
}

function isMessage(value: unknown): value is Message {
  return isRecord(value) && typeof value.id === "string" && typeof value.text === "string"
    && (value.role === "user" || value.role === "model") && optionalStrings(value, ["status", "error"]);
}

export function parseConversation(value: unknown): Conversation {
  if (!isRecord(value) || typeof value.active !== "boolean" || !Array.isArray(value.messages)
    || !value.messages.every(isMessage)) throw new Error("Invalid Maestrun conversation.");
  return { active: value.active, messages: value.messages };
}

function isStep(value: unknown): value is Step {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id
    || typeof value.title !== "string" || typeof value.status !== "string"
    || !Object.hasOwn(STATUS, value.status)
    || !optionalStrings(value, ["summary", "model", "effort", "conversationId"])) return false;
  if (value.tokenUsage !== undefined && (!isRecord(value.tokenUsage)
    || ![value.tokenUsage.inputTokens, value.tokenUsage.outputTokens].every((count) =>
      typeof count === "number" && Number.isSafeInteger(count) && count >= 0))) return false;
  if (value.tokenUsageIncomplete !== undefined && typeof value.tokenUsageIncomplete !== "boolean") return false;
  if (value.conversation !== undefined) parseConversation(value.conversation);
  return true;
}

export function pendingInput(task: Task): InputRequest | undefined {
  return task.inputRequests?.find((request) => request.answer === undefined);
}

export function validInputText(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= 32000;
}

function validRequests(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((entry) => isRecord(entry)
    && typeof entry.id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(entry.id)
    && typeof entry.stage === "string" && Boolean(entry.stage)
    && validInputText(entry.question) && validInputText(entry.summary)
    && (entry.answer === undefined || validInputText(entry.answer)))
    && new Set(value.map((entry) => entry.id)).size === value.length
    && value.filter((entry) => entry.answer === undefined).length <= 1);
}

function isTask(value: unknown): value is Task {
  if (!isRecord(value) || !isStep(value)) return false;
  const record: Record<string, unknown> = value;
  if (record.integration !== undefined && record.integration !== "pending" && record.integration !== "running") return false;
  if (record.worktree !== undefined && (!isRecord(record.worktree)
    || (record.worktree.integrated !== undefined && typeof record.worktree.integrated !== "boolean"))) return false;
  if (!validRequests(record.inputRequests)) return false;
  if (record.status === "on_hold" && !pendingInput(value as Task)) return false;
  if (record.plannedStages !== undefined && (!Array.isArray(record.plannedStages)
    || !record.plannedStages.every((id) => typeof id === "string"))) return false;
  const validCounts = [record.completedSteps, record.totalSteps]
    .every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0);
  return validCounts && optionalStrings(value, ["step", "executor", "error", "definition", "instructions", "target"])
    && (record.dependsOn === undefined || (Array.isArray(record.dependsOn) && record.dependsOn.every((id) => typeof id === "string")))
    && (record.steps === undefined || (Array.isArray(record.steps) && record.steps.every(isStep)));
}

export function parseReport(value: unknown): Report {
  if (!isRecord(value) || value.version !== 1 || typeof value.startedAt !== "string"
    || !optionalStrings(value, ["finishedAt"]) || !Array.isArray(value.tasks)
    || !value.tasks.every(isTask)) throw new Error("Invalid or unsupported .maestrun/run.json report.");
  if (new Set(value.tasks.map((task) => task.id)).size !== value.tasks.length)
    throw new Error("The report contains duplicate task IDs.");
  return { version: 1, startedAt: value.startedAt, tasks: value.tasks,
    ...(typeof value.finishedAt === "string" ? { finishedAt: value.finishedAt } : {}) };
}
