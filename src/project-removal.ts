import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { discoverProjects, isSampleProject, projectInWorkspace } from "./projects";
import { isRecord } from "./report";

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if (isRecord(error) && error.code === "ENOENT") return false; throw error; }
}

async function idle(path: string): Promise<void> {
  for (const file of ["run.lock", "session.lock"]) if (await exists(join(path, ".maestrun", file)))
    throw new Error("This project has an active execution or lock. Cancel execution and wait for it to stop before deleting files.");
  const session = join(path, ".maestrun", "session.json");
  if (!await exists(session)) return;
  if (!(await lstat(session)).isFile()) throw new Error("Invalid execution session file.");
  const value: unknown = JSON.parse(await readFile(session, "utf8"));
  if (!isRecord(value) || typeof value.status !== "string") throw new Error("Invalid execution session file.");
  if (value.status === "running") throw new Error("Cancel this project's execution before deleting files.");
}

export async function removalTarget(path: string, roots: string[], example: boolean): Promise<string> {
  if (!await projectInWorkspace(path, roots) || !(await lstat(path)).isDirectory())
    throw new Error("Select a regular project folder inside this workspace.");
  const state = join(path, ".maestrun");
  if (!(await lstat(state)).isDirectory()) throw new Error("The Maestrun state folder must not be a symbolic link.");
  const config = join(state, "config.json");
  if (!(await lstat(config)).isFile()) throw new Error("The workflow configuration must be a regular file.");
  await idle(path);
  if (!example) return config;
  if (!isSampleProject(path) || !isSampleProject(await realpath(path))
    || !(await lstat(dirname(path))).isDirectory() || !(await lstat(dirname(dirname(path)))).isDirectory())
    throw new Error("Only folders created under .maestrun/samples can be deleted as examples.");
  const nested = await discoverProjects([path]);
  if (nested.truncated) throw new Error("The example is too large to check for active nested executions.");
  for (const project of nested.projects) await idle(project.path);
  return path;
}
