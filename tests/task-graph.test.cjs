const { test } = require('node:test');
const assert = require('node:assert/strict');
const { taskGraph } = require('../dist/task-graph');
const { nestedFlow } = require('../dist/nested-flow');

const task = (id, dependsOn, parentId = 'main') => ({ id, title: id, dependsOn, parentId,
  status: 'pending', completedSteps: 0, totalSteps: 1, steps: [{ id: 'testing', title: 'Tests', status: 'pending' }] });
const report = { version: 1, startedAt: '', tasks: [
  { ...task('main'), parentId: undefined }, task('a', []), task('b', []),
  task('join', ['a', 'b'], 'a'), task('finish', ['a', 'join'], 'join'),
] };

test('all prerequisites converge on a single node in execution order, independent of grouping', () => {
  const nodes = taskGraph({ ...report, tasks: [...report.tasks].reverse() });
  assert.deepEqual(Object.fromEntries(nodes.map((node) => [node.task.id, node.level])),
    { main: 0, b: 1, a: 1, join: 2, finish: 3 });
  assert.deepEqual(nodes.find((node) => node.task.id === 'join').parents, ['a', 'b']);
  const html = nestedFlow(report, 'project');
  assert.equal((html.match(/class="nested-task /g) ?? []).length, 5);
  assert.match(html, /After: a, b/);
  assert.match(html, /class="dependency-edges"/);
});

test('old flat checkpoints recover dependencies and repair prerequisites from definitions', () => {
  const saved = { ...report, tasks: report.tasks.map(({ dependsOn, ...state }) => state),
    orchestration: { tasks: report.tasks.slice(1).map((task) => ({ ...task,
      ...(task.id === 'b' ? { repairFor: 'a' } : {}) })) } };
  const nodes = taskGraph(saved);
  assert.deepEqual(nodes.find((node) => node.task.id === 'a').parents, ['b']);
  assert.deepEqual(nodes.find((node) => node.task.id === 'join').parents, ['a', 'b']);
  assert.ok(nodes.find((node) => node.task.id === 'a').level > nodes.find((node) => node.task.id === 'b').level);
});

test('empty, missing and cyclic graph inputs terminate without inventing tasks', () => {
  assert.deepEqual(taskGraph({ ...report, tasks: [] }), []);
  assert.equal(taskGraph({ ...report, tasks: [task('alone', ['missing'])] }).length, 1);
  assert.throws(() => taskGraph({ ...report, tasks: [task('a', ['b']), task('b', ['a'])] }), /Cyclic/);
});

