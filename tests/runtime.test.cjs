const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { executable, fixture, json, waitFor } = require('./runtime-fixture.cjs');
const { parseReport } = require('../dist/report');
const { mergePlan } = require('../dist/plan-state');
const { dashboardContent } = require('../dist/dashboard-content');

const options = { skip: !existsSync(executable) && 'Set MAESTRUN_TEST_EXECUTABLE to test the installed CLI.' };

test('shows planned tasks, dependencies, instructions and steps before any run exists', options, async (t) => {
  const { cwd, invoke } = await fixture(t);
  const report = parseReport(await invoke('preview'));
  assert.equal(report.tasks.length, 2);
  assert.equal(report.tasks[0].status, 'pending');
  assert.deepEqual(report.tasks[1].dependsOn, ['task-1']);
  assert.match(report.tasks[0].instructions, /verify it/);
  assert.equal(report.tasks[0].steps[0].title, 'Fixture');
  assert.equal(existsSync(join(cwd, '.maestrun/run.json')), false);
  const html = dashboardContent(report, cwd);
  assert.match(html, /First task/);
  assert.match(html, /Pending/);
  assert.match(html, /data-action="run"/);
});

test('configuration questions and cancellation travel through the extension bridge', options, async (t) => {
  const { cwd, invoke } = await fixture(t);
  const before = await readFile(join(cwd, '.maestrun/config.json'), 'utf8');
  let prompted = false;
  await invoke('configure', { onPrompt: async (prompt) => {
    prompted = true;
    assert.equal(prompt.kind, 'select');
    assert.ok(prompt.choices.some((choice) => choice.value === 'reuse'));
    return { value: 'reuse' };
  } });
  assert.ok(prompted);
  await assert.rejects(invoke('configure', { onPrompt: async () => ({ navigation: 'cancel' }) }), /Cancelled/);
  assert.deepEqual(JSON.parse(await readFile(join(cwd, '.maestrun/config.json'), 'utf8')), JSON.parse(before));
});

test('executes and resumes real Maestrun tasks without a terminal', options, async (t) => {
  const { cwd, invoke } = await fixture(t);
  let consent = false;
  const result = await invoke('run', { onPrompt: async (prompt) => {
    consent = true; assert.equal(prompt.kind, 'confirm'); return { value: true };
  } });
  assert.equal(result.status, 'running');
  await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status === 'completed');
  const report = await json(join(cwd, '.maestrun/run.json'));
  assert.ok(report.tasks.every((task) => task.status === 'completed'));
  assert.ok(consent);
  const merged = mergePlan(parseReport(await invoke('preview')), parseReport(report));
  assert.equal(merged.tasks[0].status, 'completed');
  assert.match(merged.tasks[0].instructions, /verify/);
  await invoke('run', { onPrompt: async () => ({ value: true }) });
  await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status === 'completed');
});

test('cancels a live background execution using the session protocol', options, async (t) => {
  const { cwd, invoke } = await fixture(t);
  await writeFile(join(cwd, 'hold'), '');
  await invoke('run', { onPrompt: async () => ({ value: true }) });
  await waitFor(async () => (await json(join(cwd, '.maestrun/run.json')))?.tasks[0].status === 'running');
  await invoke('cancel');
  await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status === 'cancelled');
  assert.equal((await json(join(cwd, '.maestrun/run.json'))).tasks[0].status, 'cancelled');
});

test('rejects changed task definitions and malformed plans without replacing progress', options, async (t) => {
  const { cwd, invoke } = await fixture(t);
  await invoke('run', { onPrompt: async () => ({ value: true }) });
  await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status === 'completed');
  const saved = await json(join(cwd, '.maestrun/run.json'));
  const plan = await readFile(join(cwd, 'plan.md'), 'utf8');
  await writeFile(join(cwd, 'plan.md'), plan.replace('First task', 'Changed task'));
  const merged = mergePlan(parseReport(await invoke('preview')), parseReport(saved));
  assert.equal(merged.tasks[0].status, 'pending');
  assert.match(merged.tasks[0].error, /differs/);
  await assert.rejects(invoke('run'), /changed since/);
  assert.deepEqual(await json(join(cwd, '.maestrun/run.json')), saved);
  await writeFile(join(cwd, 'plan.md'), 'not a plan');
  await assert.rejects(invoke('preview'), /Invalid task plan/);
});

test('missing Maestrun explains installation without confusing a missing Node executable', async (t) => {
  const { cwd } = await fixture(t);
  const { runtimeDirectory, executablePath } = require('../dist/runtime');
  await assert.rejects(runtimeDirectory(join(cwd, 'missing-maestrun'), cwd), error => {
    assert.match(error.message, /Maestrun CLI was not found/);
    assert.match(error.message, /https:\/\/maestrun\.com/);
    assert.match(error.message, /WSL or SSH/);
    assert.match(error.message, /maestrun\.executable/);
    const html = dashboardContent(undefined, cwd, error.message, undefined, undefined, true);
    assert.match(html, /href="https:\/\/maestrun\.com"/);
    return true;
  });
  await assert.rejects(executablePath(join(cwd, 'missing-node'), cwd), error => {
    assert.match(error.message, /Cannot find/);
    assert.doesNotMatch(error.message, /maestrun\.com/);
    return true;
  });
});
