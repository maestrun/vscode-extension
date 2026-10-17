const { test } = require('node:test');
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { existsSync } = require('node:fs');
const { fixture, executable, config } = require('./runtime-fixture.cjs');
const { parseReport } = require('../dist/report');
const { mergePlan } = require('../dist/plan-state');

for (const strategy of ['plan', 'agent']) test(`previews ${strategy} orchestration with the real CLI, parent links and per-task stages`, {
  skip: !existsSync(executable) && 'Build the CLI first.'
}, async (t) => {
  const { cwd, invoke } = await fixture(t);
  await writeFile(join(cwd, '.maestrun/config.json'), JSON.stringify({ ...config,
    execution: { ...config.execution, orchestrator: strategy },
    stages: [...config.stages, { id: 'implementation', executor: 'codex', model: 'test-model' }, { id: 'testing', executor: 'codex', model: 'test-model' }] }));
  await writeFile(join(cwd, 'plan.md'), '## Tasks\n\n### Task a: Build\n- Depends on: none\n- Steps: implementation\n\nBuild a small function.\n\n### Task b: Verify\n- Depends on: a\n- Steps: testing\n\nTest it.\n\n### Task c: Review\n- Depends on: b\n- Steps: testing\n\nReview it.\n');
  const preview = parseReport(await invoke('preview'));
  assert.equal(preview.orchestration.strategy, strategy);
  assert.deepEqual(preview.tasks.map((task) => task.id), ['__orchestrator__', 'a', 'b', 'c']);
  assert.equal(preview.tasks[1].parentId, '__orchestrator__');
  assert.equal(preview.tasks[2].parentId, 'a');
  assert.equal(preview.tasks[3].parentId, 'b');
  assert.deepEqual(preview.tasks[2].steps.map((step) => step.id), ['testing']);
  assert.match(preview.tasks[1].instructions, /Build a small function/);
  const saved = structuredClone(preview);
  saved.tasks[0].status = 'running';
  saved.tasks[1].status = 'completed';
  saved.tasks[1].completedSteps = 1;
  saved.tasks[1].steps[0].status = 'completed';
  for (const task of saved.tasks.slice(1)) task.parentId = '__orchestrator__';
  await writeFile(join(cwd, '.maestrun/run.json'), JSON.stringify(saved));
  const merged = mergePlan(parseReport(await invoke('preview')), saved);
  assert.equal(merged.tasks[0].status, 'running');
  assert.equal(merged.tasks[1].status, 'completed');
  assert.equal(merged.tasks[2].parentId, 'a');
  assert.equal(merged.tasks[3].parentId, 'b');
});
