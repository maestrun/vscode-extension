const { test } = require('node:test');
const assert = require('node:assert/strict');
const { taskHierarchy } = require('../dist/task-hierarchy');
const { dashboardContent } = require('../dist/dashboard-content');
const task = (id, parentId) => ({ id, title: id, parentId, status: 'pending', completedSteps: 0, totalSteps: 0, steps: [] });
const tasks = [task('leaf', 'child'), task('root'), task('child', 'root'), task('sibling', 'root'), task('last')];

test('task rows follow parents with directory branches regardless of input order', () => {
  const rows = taskHierarchy(tasks);
  assert.deepEqual(rows.map(({ task, prefix, depth, children }) => [task.id, prefix, depth, children]), [
    ['root', '', 0, true], ['child', '├─ ', 1, true], ['leaf', '│  └─ ', 2, false],
    ['sibling', '└─ ', 1, false], ['last', '', 0, false],
  ]);
});

test('editor and sidebar expose hierarchy controls and escape task labels', () => {
  for (const sidebar of [false, true]) {
    const html = dashboardContent({ version: 1, startedAt: '', tasks: [...tasks, task('<unsafe>', 'root')] }, '/project', undefined, undefined, undefined, sidebar);
    assert.match(html, /role="treegrid"/);
    assert.match(html, /data-task-id="leaf" data-parent-id="child" aria-level="3"/);
    assert.match(html, /aria-label="Collapse root"/);
    assert.match(html, /│  └─ /);
    assert.ok(!html.includes('<unsafe>'));
    const flat = dashboardContent({ version: 1, startedAt: '', tasks: [task('single')] }, '/project', undefined, undefined, undefined, sidebar);
    assert.ok(!flat.includes('role="treegrid"'));
    assert.ok(!flat.includes('data-ui="toggle-task"'));
  }
});
