const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { readFile, rm, mkdir, writeFile, symlink } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { runBridge } = require('../dist/bridge');
const { discoverProjects, isSampleProject } = require('../dist/projects');
const { parseReport } = require('../dist/report');
const { fixture, executable, json, waitFor } = require('./runtime-fixture.cjs');
const { sampleExecutor, sampleAnswer } = require('./sample-fixture.cjs');
const options = { skip: !existsSync(executable) && 'Set MAESTRUN_TEST_EXECUTABLE to test the installed CLI.' };

for (const mode of ['simple', 'advanced']) test(`creates and monitors a ${mode} example without changing its parent`, options, async t => {
  let sample;
  let call;
  t.after(async () => {
    if (sample && (await json(join(sample, '.maestrun/session.json')))?.status === 'running') {
      await call('cancel');
      await waitFor(async () => (await json(join(sample, '.maestrun/session.json')))?.status !== 'running');
    }
  });
  const { cwd, invoke } = await fixture(t);
  const original = await readFile(join(cwd, '.maestrun/config.json'), 'utf8');
  const parentPlan = await readFile(join(cwd, 'plan.md'), 'utf8');
  const previousPath = process.env.PATH;
  process.env.PATH = `${await sampleExecutor(cwd)}:${previousPath}`;
  t.after(() => { process.env.PATH = previousPath; });
  const result = await invoke('sample', { tasksPath: 'custom-parent-plan.md', onPrompt: sampleAnswer(mode) });
  sample = result.samplePath;
  call = (action, extra = {}) => runBridge({ cwd: sample, action, executable, node: process.execPath,
    tasksPath: 'plan.md', worker: resolve(__dirname, '../dist/bridge-worker.js'), ...extra });
  assert.equal(isSampleProject(sample), true);
  assert.ok(sample.startsWith(join(cwd, '.maestrun/samples/')));
  assert.equal(result.session.status, 'running');
  const config = await json(join(sample, '.maestrun/config.json'));
  assert.equal(config.execution.mode, mode === 'simple' ? 'sequential' : 'parallel');
  assert.equal(config.execution.maxRepairs, mode === 'simple' ? 0 : 1);
  assert.ok(config.stages.every(stage => stage.model === 'test-model' && stage.effort === 'low'));
  assert.equal(config.plugins, undefined);
  const discovery = await discoverProjects([cwd, sample]);
  assert.equal(discovery.projects.filter(project => project.path === sample).length, 1);
  assert.equal(parseReport(await call('preview')).tasks.length, mode === 'simple' ? 2 : 5);
  if (mode === 'advanced') {
    let held;
    await waitFor(async () => { held = (await json(join(sample, '.maestrun/run.json')))?.tasks.find(task => task.status === 'on_hold'); return held; });
    await call('answerInput', { taskId: held.id, requestId: held.inputRequests[0].id, onPrompt: async () => ({ value: 'continue' }) });
  }
  await waitFor(async () => ['completed', 'failed'].includes((await json(join(sample, '.maestrun/session.json')))?.status));
  const report = parseReport(await json(join(sample, '.maestrun/run.json')));
  assert.equal(report.tasks.filter(task => task.status === 'completed').length, mode === 'simple' ? 2 : 4);
  if (mode === 'advanced') assert.equal(report.tasks.find(task => task.id === 'sample-missing-input').status, 'failed');
  assert.equal(await readFile(join(cwd, '.maestrun/config.json'), 'utf8'), original);
  assert.equal(await readFile(join(cwd, 'plan.md'), 'utf8'), parentPlan);
  assert.equal(existsSync(join(cwd, '.maestrun/run.json')), false);
});

test('cancelling example selection or declining execution creates no example', options, async t => {
  const { cwd, invoke } = await fixture(t);
  await assert.rejects(invoke('sample', { onPrompt: async () => ({ navigation: 'cancel' }) }), /Cancelled/);
  const previousPath = process.env.PATH;
  process.env.PATH = `${await sampleExecutor(cwd)}:${previousPath}`;
  t.after(() => { process.env.PATH = previousPath; });
  await assert.rejects(invoke('sample', { onPrompt: sampleAnswer('simple', false) }), /Cancelled/);
  assert.equal(existsSync(join(cwd, '.maestrun/samples')), false);
});

test('discovers CLI examples under unconfigured and nested projects while excluding other hidden state and symlinks', options, async t => {
  const { cwd } = await fixture(t);
  const sample = join(cwd, 'nested/.maestrun/samples/run-existing');
  await mkdir(join(sample, '.maestrun'), { recursive: true });
  await writeFile(join(sample, '.maestrun/config.json'), '{}');
  await mkdir(join(cwd, '.maestrun/worktrees/ignored/.maestrun'), { recursive: true });
  await writeFile(join(cwd, '.maestrun/worktrees/ignored/.maestrun/config.json'), '{}');
  await mkdir(join(cwd, '.maestrun/samples'), { recursive: true });
  await symlink(sample, join(cwd, '.maestrun/samples/linked'));
  let discovered = await discoverProjects([cwd]);
  assert.ok(discovered.projects.some(project => project.path === sample && project.configured));
  assert.ok(!discovered.projects.some(project => /ignored|linked/.test(project.path)));
  await mkdir(join(cwd, 'linked-container/.maestrun'), { recursive: true });
  await symlink(join(cwd, 'nested/.maestrun/samples'), join(cwd, 'linked-container/.maestrun/samples'));
  discovered = await discoverProjects([cwd]);
  assert.equal(discovered.projects.filter(project => project.path.endsWith('run-existing')).length, 1);
  await rm(join(sample, '.maestrun/config.json'));
  assert.equal((await discoverProjects([cwd])).projects.find(project => project.path === sample).configured, false);
});
