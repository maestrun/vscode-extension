import { Report, Task } from "./report";

export function mergePlan(plan: Report, saved?: Report): Report {
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
