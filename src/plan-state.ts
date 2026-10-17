import { Report, Task, isRecord } from "./report";

export function mergePlan(plan: Report, saved?: Report): Report {
  if (saved?.orchestration) return mergeOrchestration(plan, saved);
  return { ...plan, startedAt: saved?.startedAt ?? "", finishedAt: saved?.finishedAt,
    tasks: plan.tasks.map((task) => mergeTask(task, saved?.tasks.find((previous) => previous.id === task.id))) };
}

function mergeTask(task: Task, previous?: Task): Task {
  if (!previous) return task;
  const sameDefinition = previous.definition ? task.definition === previous.definition : task.title === previous.title;
  const sameStages = previous.plannedStages
    ? JSON.stringify(task.steps?.map((step) => step.id)) === JSON.stringify(previous.plannedStages)
    : task.totalSteps === previous.totalSteps
      && JSON.stringify(task.steps?.map((step) => step.id)) === JSON.stringify(previous.steps?.map((step) => step.id));
  if (!sameDefinition || !sameStages) return { ...task, error: "The plan or workflow differs from saved progress. Restore the original definition or use a new task ID before resuming." };
  return { ...task, ...previous, instructions: task.instructions, dependsOn: task.dependsOn, target: task.target };
}

function mergeOrchestration(plan: Report, saved: Report): Report {
  const changed = plan.orchestration?.strategy !== saved.orchestration?.strategy
    || JSON.stringify(plan.orchestration?.source) !== JSON.stringify(saved.orchestration?.source);
  const tasks = saved.tasks.map((task) => {
    const definition = saved.orchestration?.tasks.find((entry) => isRecord(entry) && entry.id === task.id);
    const preview = plan.tasks.find((entry) => entry.id === task.id);
    return { ...preview, ...task,
      ...(!changed && preview ? { parentId: preview.parentId } : {}),
      ...(isRecord(definition) && typeof definition.instructions === "string" ? { instructions: definition.instructions } : {}),
      ...(changed && !task.parentId ? { error: "The source plan or orchestration strategy differs from saved progress. Restore it before resuming." } : {}) };
  });
  return { ...saved, tasks };
}
