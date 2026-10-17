import { isRecord, type Report, type Task } from "./report";

export type GraphTask = { task: Task; parents: string[]; level: number };

export function taskGraph(report: Report): GraphTask[] {
  const definitions = report.orchestration?.tasks.filter(isRecord) ?? [];
  const ids = new Set(report.tasks.map((task) => task.id));
  const root = report.tasks.find((task) => !task.parentId)?.id;
  const nodes = report.tasks.map((task): GraphTask => {
    const definition = definitions.find((entry) => entry.id === task.id);
    const dependencies = Array.isArray(definition?.dependsOn)
      ? [...definition.dependsOn, ...definitions.filter((entry) => entry.repairFor === task.id).map((entry) => entry.id)]
      : task.dependsOn;
    const parents = dependencies?.length ? dependencies : dependencies && root && root !== task.id
      ? [root] : task.parentId ? [task.parentId] : [];
    return { task, parents: [...new Set(parents)].filter((id): id is string =>
      typeof id === "string" && ids.has(id) && id !== task.id), level: 0 };
  });
  const ordered: GraphTask[] = [], levels = new Map<string, number>();
  while (ordered.length < nodes.length) {
    const ready = nodes.filter((node) => !levels.has(node.task.id) && node.parents.every((id) => levels.has(id)));
    if (!ready.length) throw new Error("Cyclic task flow dependencies.");
    for (const node of ready) {
      node.level = 1 + Math.max(-1, ...node.parents.map((id) => levels.get(id) ?? 0));
      levels.set(node.task.id, node.level);
      ordered.push(node);
    }
  }
  return ordered;
}
