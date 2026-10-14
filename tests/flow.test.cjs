const { test } = require('node:test');
const assert = require('node:assert/strict');
const { displaySteps, flowContent } = require('../dist/task-flow');
const { parseReport } = require('../dist/report');

const task = { id: 'task-1', title: 'Build', status: 'running', completedSteps: 1, totalSteps: 2, step: 'testing', steps: [
  { id: 'implementation', title: 'Implementation', status: 'completed', model: 'test-model', effort: 'high', tokenUsage: { inputTokens: 1000, outputTokens: 100 } },
  { id: 'testing', title: 'Testing', status: 'refactor', tokenUsageIncomplete: true, tokenUsage: { inputTokens: 700, outputTokens: 50 } }
] };

test('flow connects configured steps, reports usage, and loops repair feedback back to implementation', () => {
  const html = flowContent(task, 'testing');
  assert.match(html, /repair-target/);
  assert.match(html, /repair-source/);
  assert.match(html, /flow-arrow needs-changes/);
  assert.equal((html.match(/class="flow-arrow[^"]*"/g) ?? []).length, 1);
  assert.match(html, /test-model · high effort/);
  assert.match(html, /In: 1,000 · Out: 100/);
  assert.match(html, /In: 700 · Out: 50 \(partial\)/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /data-step-id="testing" aria-pressed="true"/);
  assert.equal(task.steps[1].status, 'refactor');
  assert.ok(!flowContent({ ...task, status: 'refactor' }).includes('repair-source'));
  assert.equal(displaySteps({ ...task, status: 'refactor' })[1].status, 'failed');
  assert.ok(!flowContent({ ...task, steps: task.steps.slice(1) }).includes('repair-source'));
  assert.ok(!flowContent({ ...task, steps: [{ ...task.steps[0], title: '<img src=x>', model: '<script>' }] }).includes('<img'));
});

test('flow includes local Git integration and respects actual terminal outcomes', () => {
  assert.equal(displaySteps(task).length, 2);
  for (const status of ['running', 'completed', 'failed', 'cancelled']) {
    const current = { ...task, status, step: 'integration', worktree: { integrated: status === 'completed' } };
    const steps = displaySteps(current);
    assert.equal(steps.at(-1).id, 'integration');
    assert.equal(steps.at(-1).status, status);
    assert.equal(current.steps.length, 2);
    assert.match(flowContent(current), /Git · local/);
  }
  assert.equal(displaySteps({ ...task, integration: 'pending' }).at(-1).status, 'pending');
  assert.equal(displaySteps({ ...task, worktree: { integrated: true } }).at(-1).status, 'completed');
  assert.equal(displaySteps({ ...task, integration: 'running', steps: [{ id: 'integration', title: 'Integration', status: 'running' }] }).length, 1);
});

test('new flow metadata rejects malformed values at the report boundary', () => {
  const report = { version: 1, startedAt: '', tasks: [task] };
  assert.deepEqual(parseReport(report).tasks[0], task);
  for (const field of [{ tokenUsage: { inputTokens: -1, outputTokens: 2 } }, { tokenUsage: { inputTokens: 1 } },
    { tokenUsageIncomplete: 'yes' }, { effort: {} }, { integration: 'invalid' }, { worktree: { integrated: 'yes' } }])
    assert.throws(() => parseReport({ ...report, tasks: [{ ...task, ...field }] }));
});
