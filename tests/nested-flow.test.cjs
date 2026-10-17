const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReport } = require('../dist/report');
const { mergePlan } = require('../dist/plan-state');
const { nestedFlow } = require('../dist/nested-flow');
const { editorContent } = require('../dist/editor-content');
const { isWorkflowTable } = require('../dist/worker-ui');
const task = (id, parentId, steps = ['implementation']) => ({ id, title: id, parentId, status: 'pending', completedSteps: 0, totalSteps: steps.length,
  steps: steps.map((id) => ({ id, title: id, status: 'pending', model: 'test-model' })) });
const report = { version: 1, startedAt: '', orchestration: { strategy: 'agent', phase: 'execute', round: 1, source: [], tasks: [] },
  tasks: [task('main'), task('child', 'main', ['implementation', 'testing']), task('leaf', 'child', ['review'])] };

test('retains hierarchy and orchestrator metadata and rejects invalid parent graphs', () => {
  assert.deepEqual(parseReport(report), report);
  for (const tasks of [[task('a', 'absent')], [task('a', 'a')], [task('a', 'b'), task('b', 'a')], [task('a', 4)]])
    assert.throws(() => parseReport({ ...report, tasks }));
  for (const orchestration of [null, { ...report.orchestration, strategy: 'other' }, { ...report.orchestration, round: -1 }])
    assert.throws(() => parseReport({ ...report, orchestration }));
});

test('saved agent tasks and root survive merging with a stale source-plan preview', () => {
  const saved = { ...report, tasks: [...report.tasks, { ...task('generated', 'child', ['testing']), status: 'completed', completedSteps: 1 }],
    orchestration: { ...report.orchestration, tasks: [{ id: 'generated', instructions: 'Generated instructions' }] } };
  const merged = mergePlan(report, saved);
  assert.equal(merged.tasks.length, 4);
  assert.equal(merged.tasks[3].parentId, 'child');
  assert.equal(merged.tasks[3].status, 'completed');
  assert.equal(merged.tasks[3].instructions, 'Generated instructions');
  assert.deepEqual(merged.orchestration, saved.orchestration);
  assert.match(mergePlan({ ...report, orchestration: { ...report.orchestration, strategy: 'plan' } }, saved).tasks[0].error, /differs/);
});

test('nested rendering includes every task and its own steps with a simple/detailed toggle', () => {
  const html = nestedFlow(report, '/project', { task: 'child', step: 'testing' });
  assert.equal((html.match(/class="nested-task /g) ?? []).length, 3);
  assert.equal((html.match(/data-predecessors=/g) ?? []).length, 3);
  assert.equal((html.match(/class="flow-node /g) ?? []).length, 4);
  assert.match(html, /data-flow-mode="tasks"/);
  assert.match(html, /data-flow-mode="steps"/);
  assert.match(html, /data-flow-direction="horizontal"/);
  assert.match(html, /data-flow-direction="vertical"/);
  assert.match(html, /data-step-id="testing" aria-pressed="true"/);
  assert.ok(html.indexOf('data-task-id="main"') < html.indexOf('data-task-id="child"'));
  const editor = editorContent(report, '/project', undefined, 'Step result', 'child', 'flow', 'testing');
  assert.match(editor, /class="nested-flow"/);
  assert.match(editor, /Step result/);
  assert.equal((editor.match(/class="nested-task /g) ?? []).length, 3);
});

test('nested task titles and paths remain escaped and saved orchestration config is accepted', () => {
  const html = nestedFlow({ ...report, tasks: [task('<img src=x>')] }, '"><script>');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;img/);
  for (const orchestrator of ['plan', 'agent']) assert.equal(isWorkflowTable({ stages: [], execution: { mode: 'sequential', concurrency: 1, orchestrator } }), true);
  assert.equal(isWorkflowTable({ stages: [], execution: { mode: 'sequential', concurrency: 1, orchestrator: 'bad' } }), false);
});
