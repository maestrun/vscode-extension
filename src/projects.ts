import { readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export type Project = { path: string; root: string; name: string; git: boolean; configured: boolean };
export function isSampleProject(path: string): boolean {
  return basename(dirname(path)) === "samples" && basename(dirname(dirname(path))) === ".maestrun";
}

const ignored = new Set(["node_modules", "vendor", "dist", "build", "out", "coverage", "target"]);
export function inside(root: string, path: string): boolean {
  const local = relative(root, path);
  return local === "" || (!isAbsolute(local) && local !== ".." && !local.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

export async function discoverProjects(roots: string[]): Promise<{ projects: Project[]; truncated: boolean }> {
  const projects: Project[] = [];
  const seen = new Set<string>();
  const queue = roots.map((root) => ({ path: resolve(root), root: resolve(root) }));
  let visited = 0;
  while (queue.length && visited < 20000) {
    const next = queue.shift();
    if (!next || seen.has(next.path)) continue;
    seen.add(next.path); visited++;
    let entries;
    try { entries = await readdir(next.path, { withFileTypes: true }); }
    catch (error) { if (next.path === next.root) throw error; continue; }
    const git = entries.some((entry) => entry.name === ".git" && (entry.isDirectory() || entry.isFile()));
    const maestrun = entries.some((entry) => entry.name === ".maestrun" && entry.isDirectory());
    let configured = false;
    if (maestrun) {
      try {
        const state = await readdir(join(next.path, ".maestrun"), { withFileTypes: true });
        configured = state.some((entry) => entry.name === "config.json" && entry.isFile());
        // CLI examples live under this hidden directory; other state folders stay excluded.
        if (state.some((entry) => entry.name === "samples" && entry.isDirectory())) {
          const samples = join(next.path, ".maestrun", "samples");
          for (const entry of await readdir(samples, { withFileTypes: true })) if (entry.isDirectory())
            queue.push({ path: join(samples, entry.name), root: next.root });
        }
      } catch { /* Keep readable projects visible even if sample discovery fails. */ }
    }
    if (next.path === next.root || git || maestrun) projects.push({ ...next, git, configured,
      name: next.path === next.root ? basename(next.root) : `${basename(next.root)} / ${relative(next.root, next.path)}` });
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith(".") && !ignored.has(entry.name))
      queue.push({ path: join(next.path, entry.name), root: next.root });
  }
  return { projects, truncated: queue.length > 0 };
}

export async function projectInWorkspace(path: string, roots: string[]): Promise<string | undefined> {
  const actual = await realpath(path);
  for (const root of roots) if (inside(root, path) && inside(await realpath(root), actual)) return root;
  return undefined;
}
