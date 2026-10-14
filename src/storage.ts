import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Conversation, isRecord, pendingInput, validInputText, parseConversation, parseReport, Report } from "./report";

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function regularDirectory(path: string): Promise<void> {
  if (!(await lstat(path)).isDirectory()) throw new Error(`Invalid directory or symbolic link: ${path}`);
}

async function readJson(path: string): Promise<unknown> {
  try {
    if (!(await lstat(path)).isFile()) throw new Error(`Invalid file or symbolic link: ${path}`);
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

export async function readReport(cwd: string): Promise<Report | undefined> {
  try {
    await regularDirectory(join(cwd, ".maestrun"));
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
  const value = await readJson(join(cwd, ".maestrun", "run.json"));
  if (value === undefined) return;
  const report = parseReport(value);
  await reflectTaskAnswers(cwd, report);
  return report;
}

export async function sessionNotice(cwd: string): Promise<string | undefined> {
  const value = await readJson(join(cwd, ".maestrun", "session.json"));
  if (value === undefined) return;
  if (!isRecord(value) || typeof value.status !== "string") throw new Error("Invalid execution session.");
  if (value.status === "failed") return `Execution failed: ${typeof value.error === "string" ? value.error : "Inspect the execution log."}`;
  if (value.status === "cancelled") return "Execution cancelled. Completed work is preserved; use Run / resume to continue.";
  return;
}

export class Conversations {
  constructor(private readonly home: string = join(homedir(), ".maestrun")) {}

  private async location(cwd: string, id: string): Promise<string> {
    if (!/^[a-f0-9-]{36}$/u.test(id)) throw new Error("Invalid conversation identifier.");
    const hash = createHash("sha256").update(resolve(cwd)).digest("hex");
    const directory = join(this.home, "conversations", hash);
    try {
      for (const path of [this.home, dirname(directory), directory]) await regularDirectory(path);
      const target = join(directory, id);
      if (await readJson(`${target}.json`) !== undefined) return target;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    await regularDirectory(join(cwd, ".maestrun"));
    await regularDirectory(join(cwd, ".maestrun", "conversations"));
    return join(cwd, ".maestrun", "conversations", id);
  }

  async read(cwd: string, id: string): Promise<Conversation | undefined> {
    try {
      const value = await readJson(`${await this.location(cwd, id)}.json`);
      return value === undefined ? undefined : parseConversation(value);
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  async send(input: { cwd: string; conversationId: string; text: string }): Promise<string> {
    if (!input.text.trim() || input.text.length > 32000)
      throw new Error("Instructions must contain between 1 and 32000 characters.");
    const target = await this.location(input.cwd, input.conversationId);
    const value = await readJson(`${target}.json`);
    if (value === undefined || !parseConversation(value).active)
      throw new Error("This task session has ended or is not ready to receive instructions.");
    await regularDirectory(target);
    const id = randomUUID();
    const temporary = join(target, `.${id}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ id, text: input.text }), { flag: "wx", mode: 0o600 });
      await rename(temporary, join(target, `${Date.now()}-${id}.json`));
    } finally {
      await rm(temporary, { force: true });
    }
    return id;
  }
}

export async function reflectTaskAnswers(cwd: string, report: Report, home = join(homedir(), ".maestrun")): Promise<void> {
  for (const task of report.tasks) {
    const request = pendingInput(task);
    if (task.status !== "on_hold" || !request) continue;
    const directory = join(home, "conversations", createHash("sha256").update(resolve(cwd)).digest("hex"));
    let value: unknown;
    try {
      for (const path of [home, dirname(directory), directory]) await regularDirectory(path);
      value = await readJson(join(directory, `${request.id}.answer.json`));
    } catch (error) { if (missing(error)) continue; throw error; }
    if (value === undefined) continue;
    if (!isRecord(value) || !validInputText(value.answer)) throw new Error("Invalid saved task answer.");
    request.answer = value.answer;
    task.status = "pending";
    const step = task.steps?.find((entry) => entry.id === request.stage);
    if (step) step.status = "pending";
  }
}
