import { escapeHtml as e } from "./html";
import type { Task } from "./report";

type Row = { task: Task; prefix: string; depth: number; children: boolean };

export function taskHierarchy(tasks: Task[]): Row[] {
  const rows: Row[] = [];
  const groups = new Map<string | undefined, Task[]>();
  for (const task of tasks) groups.set(task.parentId, [...groups.get(task.parentId) ?? [], task]);
  const visit = (parent: string | undefined, ancestors: boolean[]): void => {
    const siblings = groups.get(parent) ?? [];
    siblings.forEach((task, index) => {
      const last = index === siblings.length - 1;
      const prefix = ancestors.slice(1).map((end) => end ? "   " : "│  ").join("") + (ancestors.length ? (last ? "└─ " : "├─ ") : "");
      rows.push({ task, prefix, depth: ancestors.length, children: groups.has(task.id) });
      visit(task.id, [...ancestors, last]);
    });
  };
  visit(undefined, []);
  return rows;
}

export function hierarchyAttributes(row: Row, nested: boolean): string {
  return nested ? `data-task-id="${e(row.task.id)}" data-parent-id="${e(row.task.parentId ?? "")}" aria-level="${row.depth + 1}"${row.children ? ' aria-expanded="true"' : ""}` : "";
}

export function hierarchyPrefix(row: Row, nested: boolean): string {
  if (!nested) return "";
  return `<span class="task-tree-prefix" aria-hidden="true">${e(row.prefix)}</span>${row.children
    ? `<button class="task-tree-toggle" data-ui="toggle-task" data-task-id="${e(row.task.id)}" aria-expanded="true" aria-label="Collapse ${e(row.task.title)}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2 4 4-4 4"/></svg></button>`
    : '<span class="task-tree-spacer" aria-hidden="true"></span>'}`;
}
