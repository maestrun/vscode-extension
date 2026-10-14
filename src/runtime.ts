import { access, readFile, realpath } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isRecord } from "./report";

export async function executablePath(name: string, cwd: string, missingMessage?: string): Promise<string> {
  const candidates = isAbsolute(name) || name.includes("/") ? [resolve(cwd, name)]
    : [join(cwd, "node_modules", ".bin", name), ...(process.env.PATH ?? "").split(delimiter).map((p) => join(p, name))];
  for (const candidate of candidates) {
    try { await access(candidate); return await realpath(candidate); }
    catch (error) { if (!isRecord(error) || !["ENOENT", "ENOTDIR"].includes(String(error.code))) throw error; }
  }
  throw new Error(missingMessage ?? `Cannot find ${name}. Install it or set its executable path in Maestrun settings.`);
}

export class Runtime {
  constructor(private readonly directory: string) {}

  async module(path: string): Promise<Record<string, unknown>> {
    const value: unknown = await import(pathToFileURL(join(this.directory, `${path}.js`)).href);
    if (!isRecord(value)) throw new Error(`Unsupported Maestrun module: ${path}`);
    return value;
  }

  async call(path: string, name: string, args: unknown[] = []): Promise<unknown> {
    const fn = (await this.module(path))[name];
    if (typeof fn !== "function") throw new Error(`This Maestrun installation does not support ${name}.`);
    return await fn(...args) as unknown;
  }

  async navigation(name: "BackError" | "CancelError"): Promise<Error> {
    const constructor = (await this.module("shared/errors"))[name];
    if (typeof constructor !== "function") return new Error(name);
    const error: unknown = Reflect.construct(constructor, []);
    return error instanceof Error ? error : new Error(name);
  }
}

export async function runtimeDirectory(executable: string, cwd: string): Promise<string> {
  const directory = dirname(await executablePath(executable, cwd,
    "Maestrun CLI was not found. Follow the installation instructions at https://maestrun.com. Install it in the same environment as this workspace (inside WSL or SSH when using a remote workspace). If already installed, set maestrun.executable to its full path. Then refresh Maestrun."));
  const manifest: unknown = JSON.parse(await readFile(join(directory, "..", "package.json"), "utf8"));
  if (!isRecord(manifest) || manifest.name !== "@maestrun/maestrun")
    throw new Error("Set maestrun.executable to the installed Maestrun executable or its dist/main.js file.");
  await access(join(directory, "modules", "execution", "tasks.js"));
  return directory;
}
