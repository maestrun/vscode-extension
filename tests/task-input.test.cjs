const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { existsSync } = require('node:fs');
const { writeFile, rm, mkdir, symlink } = require('node:fs/promises');
const { dirname, join, resolve } = require('node:path');
const { homedir } = require('node:os');
const { parseReport } = require('../dist/report');
const { mergePlan } = require('../dist/plan-state');
const { readReport, reflectTaskAnswers } = require('../dist/storage');
const { taskContent, taskSummary } = require('../dist/task-content');
const { flowContent } = require('../dist/task-flow');
const { dashboardContent } = require('../dist/dashboard-content');
const { executionLog } = require('../dist/execution-log');
const { fixture, executable, config, json, waitFor } = require('./runtime-fixture.cjs');
const request = { id: randomUUID(), stage: 'custom:Fixture', question: '<script>continue?</script>', summary: 'Waiting for approval\nKeep completed work.' };
const held = { id: 'task-1', title: 'First task', status: 'on_hold', step: request.stage, completedSteps: 0, totalSteps: 1,
  steps: [{ id: request.stage, title: 'Fixture', status: 'on_hold' }], inputRequests: [request] };
const report = { version: 1, startedAt: '', tasks: [held] };
const options = { skip: !existsSync(executable) && 'Set MAESTRUN_TEST_EXECUTABLE to test the installed CLI.' };
const answerPath = (cwd, id) => join(homedir(), '.maestrun/conversations', createHash('sha256').update(resolve(cwd)).digest('hex'), `${id}.answer.json`);

test('validates held reports and renders questions safely in task, sidebar, flow and filters', () => {
  assert.deepEqual(parseReport(report), report);
  for (const inputRequests of [null, [], [request, request], [{ ...request, id: '../escape' }], [{ ...request, question: ' ' }],
    [{ ...request, answer: 'x'.repeat(32001) }], [{ ...request, answer: 'answered' }]])
    assert.throws(() => parseReport({ ...report, tasks: [{ ...held, inputRequests }] }));
  for (const html of [taskContent({ task: held, project: '/project' }), taskSummary(held)]) {
    assert.match(html, /Awaiting your answer/);
    assert.match(html, /data-action="answerInput"/);
    assert.match(html, /&lt;script&gt;/);
    assert.ok(!html.includes('<script>'));
  }
  assert.match(flowContent(held), /flow-node on_hold/);
  for (const sidebar of [true, false]) assert.match(dashboardContent(report, '/project', undefined, undefined, undefined, sidebar), /data-filter="on_hold"/);
  const historical = taskContent({ task: held, step: { id: 'implementation', title: 'Implementation', status: 'completed' }, project: '/project' });
  assert.ok(!historical.includes('data-action="answerInput"'));
});

test('preserves completed replan history using plannedStages while flagging incompatible changes', () => {
  const plan = { ...report, tasks: [{ ...held, status: 'pending', totalSteps: 2, definition: 'same', inputRequests: undefined,
    steps: [{ id: 'implementation', title: 'Implement', status: 'pending' }, { id: 'testing', title: 'Tests', status: 'pending' }] }] };
  const completed = { ...held, status: 'completed', completedSteps: 1, definition: 'same', plannedStages: ['implementation', 'testing'],
    steps: [{ ...held.steps[0], status: 'completed', summary: 'Preserved result' }], inputRequests: [{ ...request, answer: 'continue' }] };
  const merged = mergePlan(plan, { ...report, tasks: [completed] }).tasks[0];
  assert.equal(merged.status, 'completed');
  assert.equal(merged.totalSteps, 1);
  assert.equal(merged.steps[0].summary, 'Preserved result');
  assert.equal(merged.error, undefined);
  completed.plannedStages = ['implementation'];
  assert.match(mergePlan(plan, { ...report, tasks: [completed] }).tasks[0].error, /differs/);
});

test('answers through the CLI bridge, preserves pending questions on cancel, rejects stale and duplicate answers', options, async (t) => {
  const { cwd, invoke } = await fixture(t);
  const file = join(cwd, '.maestrun/run.json');
  await writeFile(file, JSON.stringify(report));
  const target = { taskId: held.id, requestId: request.id };
  const path = answerPath(cwd, request.id);
  t.after(() => rm(dirname(path), { recursive: true, force: true }));
  await assert.rejects(invoke('answerInput', { ...target, onPrompt: async () => ({ navigation: 'cancel' }) }), /Cancelled/);
  assert.equal((await readReport(cwd)).tasks[0].status, 'on_hold');
  assert.equal(existsSync(path), false);
  await assert.rejects(invoke('answerInput', { ...target, requestId: randomUUID() }), /no longer pending/);
  let prompts = 0;
  const answer = 'continue\nUse the existing files.';
  await invoke('answerInput', { ...target, onPrompt: async (prompt) => {
    assert.equal(prompt.kind, 'paste');
    assert.ok(prompt.context.includes(request.question));
    if (++prompts === 1) return { value: ' ' };
    assert.match(prompt.error, /1–32000/);
    return { value: answer };
  } });
  assert.equal(prompts, 2);
  assert.deepEqual(await json(path), { answer });
  const reflected = await readReport(cwd);
  assert.equal(reflected.tasks[0].status, 'pending');
  assert.equal(reflected.tasks[0].steps[0].status, 'pending');
  assert.equal(reflected.tasks[0].inputRequests[0].answer, answer);
  assert.equal((await json(file)).tasks[0].status, 'on_hold', 'only the CLI worker writes checkpoints');
  assert.match(await executionLog(reflected, cwd), /Your answer: continue/);
  assert.ok(!taskContent({ task: reflected.tasks[0], project: cwd }).includes('data-action="answerInput"'));
  await assert.rejects(invoke('answerInput', { ...target, onPrompt: async () => ({ value: 'duplicate' }) }), /no longer pending/);
  assert.deepEqual(await json(path), { answer });
});

test('rechecks a question after the answer form opens', options, async (t) => {
  const { cwd, invoke } = await fixture(t);
  const file = join(cwd, '.maestrun/run.json');
  const fresh = { ...request, id: randomUUID() };
  await writeFile(file, JSON.stringify({ ...report, tasks: [{ ...held, inputRequests: [fresh] }] }));
  await assert.rejects(invoke('answerInput', { taskId: held.id, requestId: fresh.id, onPrompt: async () => {
    await writeFile(file, JSON.stringify({ ...report, tasks: [{ ...held, inputRequests: [{ ...fresh, id: randomUUID() }] }] }));
    return { value: 'stale answer' };
  } }), /no longer pending/);
  assert.equal(existsSync(answerPath(cwd, fresh.id)), false);
});

test('rejects malformed and symlinked saved answers', options, async (t) => {
  const { cwd } = await fixture(t);
  const home = join(cwd, 'home');
  const directory = join(home, 'conversations', createHash('sha256').update(resolve(cwd)).digest('hex'));
  const file = join(directory, `${request.id}.answer.json`);
  await mkdir(directory, { recursive: true });
  await writeFile(file, JSON.stringify({ answer: '' }));
  await assert.rejects(reflectTaskAnswers(cwd, structuredClone(report), home), /Invalid saved/);
  await rm(file);
  await symlink(join(cwd, 'plan.md'), file);
  await assert.rejects(reflectTaskAnswers(cwd, structuredClone(report), home), /symbolic/);
});

test('a live worker resumes a held stage after an extension answer', options, async (t) => {
  const { cwd, invoke } = await fixture(t);
  await writeFile(join(cwd, '.maestrun/config.json'), JSON.stringify({ ...config, plugins: [], stages: [
    config.stages[0], { id: 'implementation', executor: 'codex', model: 'test-model' }
  ] }));
  const previousPath = process.env.PATH;
  process.env.PATH = `${join(cwd, '.fixture-bin')}:${previousPath}`;
  t.after(() => { process.env.PATH = previousPath; });
  await writeFile(join(cwd, '.fixture-bin/codex'), `#!${process.execPath}
const emit = value => console.log(JSON.stringify(value));
require('node:readline').createInterface({input: process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'thread/start') return emit({ id: message.id, result: { thread: { id: 'fixture-thread' } } });
  if (message.method !== 'turn/start') return emit({ id: message.id, result: {} });
  const answered = message.params.input[0].text.includes('Earlier questions and user answers:');
  emit({ id: message.id, result: { turn: { id: 'fixture-turn' } } });
  emit({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'final', text: JSON.stringify(answered
    ? { status: 'completed', summary: 'Resumed with saved answer' }
    : { status: 'needs_input', question: 'Continue?', summary: 'Waiting for approval' }) } } });
  emit({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
});`);
  await invoke('run', { onPrompt: async (prompt) => ({ value: prompt.title === "Run tasks" ? "all" : true }) });
  for (const id of ['task-1', 'task-2']) {
    await waitFor(async () => (await readReport(cwd))?.tasks.find(task => task.id === id)?.status === 'on_hold');
    const task = (await readReport(cwd)).tasks.find(task => task.id === id);
    await invoke('answerInput', { taskId: id, requestId: task.inputRequests[0].id, onPrompt: async () => ({ value: 'continue' }) });
  }
  await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status === 'completed');
  const saved = await readReport(cwd);
  assert.ok(saved.tasks.every(task => task.status === 'completed' && task.inputRequests[0].answer === 'continue'));
  assert.ok(saved.tasks.every(task => task.summary.includes('Resumed')));
});
