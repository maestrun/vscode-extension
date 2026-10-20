const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { fixture, json, waitFor } = require('./runtime-fixture.cjs');

test('run defaults to All, supports a subset, and disables completed tasks on the next run', async (t) => {
  const { cwd, invoke } = await fixture(t);
  const run = (only, completed = false) => invoke('run', { onPrompt: async (prompt) => {
    if (prompt.title === 'Run tasks') {
      assert.equal(prompt.initial, 'all');
      return { value: only ? 'choose' : 'all' };
    }
    if (prompt.kind === 'checkbox') {
      assert.equal(prompt.choices.find(choice => choice.value === 'task-1').disabled, completed ? 'completed' : undefined);
      assert.deepEqual(prompt.initial, completed ? ['task-2'] : ['task-1', 'task-2']);
      return { value: only };
    }
    assert.equal(prompt.kind, 'confirm');
    return { value: true };
  } });
  await run(['task-1']);
  await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status === 'completed');
  let report = await json(join(cwd, '.maestrun/run.json'));
  assert.deepEqual(report.tasks.map(task => task.status), ['completed', 'pending']);
  assert.deepEqual(report.selectedTaskIds, ['task-1']);
  await run(['task-2'], true);
  await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status === 'completed');
  report = await json(join(cwd, '.maestrun/run.json'));
  assert.ok(report.tasks.every(task => task.status === 'completed'));
  await run();
  await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status === 'completed');
  assert.equal((await json(join(cwd, '.maestrun/run.json'))).selectedTaskIds, undefined);
});

test('cancelling task selection starts no worker', async (t) => {
  const { cwd, invoke } = await fixture(t);
  await assert.rejects(invoke('run', { onPrompt: async () => ({ navigation: 'cancel' }) }), { name: 'AbortError' });
  assert.equal(await json(join(cwd, '.maestrun/session.json')), undefined);
});
