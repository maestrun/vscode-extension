const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReport, parseConversation, STATUS } = require('../dist/report');
const { taskContent } = require('../dist/task-content');

const task = { id: 'task-1', title: 'Build', status: 'running', completedSteps: 0, totalSteps: 2 };
const report = { version: 1, startedAt: '2026-10-13T00:00:00Z', tasks: [task] };

test('loads current CLI reports, optional step results and forward-compatible fields', () => {
  const value = { ...report, tasks: [{ ...task, executor: 'codex', tokenUsage: { inputTokens: 10, outputTokens: 1 },
    steps: [{ id: 'implementation', title: 'Implement', status: 'completed', summary: 'Done' }] }] };
  assert.deepEqual(parseReport(value).tasks[0], value.tasks[0]);
  for (const status of Object.keys(STATUS))
    assert.equal(parseReport({ ...report, tasks: [{ ...task, status, ...(status === "on_hold" ? { inputRequests: [{ id: "00000000-0000-0000-0000-000000000001", stage: "testing", question: "Continue?", summary: "Waiting" }] } : {}) }] }).tasks[0].status, status);
});

test('rejects malformed reports instead of showing misleading task state', () => {
  for (const value of [null, [], { ...report, version: 2 }, { ...report, tasks: [task, task] },
    { ...report, tasks: [{ ...task, status: 'toString' }] },
    { ...report, tasks: [{ ...task, completedSteps: -1 }] },
    { ...report, tasks: [{ ...task, totalSteps: '2' }] },
    { ...report, tasks: [{ ...task, steps: [{}] }] },
    { ...report, tasks: [{ ...task, conversation: { active: true, messages: [{}] } }] }])
    assert.throws(() => parseReport(value));
});

test('validates conversation messages at the file boundary', () => {
  const value = { active: true, messages: [{ id: 'a', role: 'model', text: 'Hello' }] };
  assert.deepEqual(parseConversation(value), value);
  for (const invalid of [null, { active: true, messages: 'bad' },
    { active: true, messages: [{ id: 'a', role: 'system', text: 'Hello' }] }])
    assert.throws(() => parseConversation(invalid));
});

test('renders executor content as text and only enables messages for the active step', () => {
  const attack = '<img src=x onerror="alert(1)">';
  const running = { ...task, title: attack, step: 'tests', steps: [
    { id: 'implementation', title: 'Implement', status: 'completed', summary: attack }
  ] };
  const conversation = { active: true, messages: [{ id: 'a', role: 'model', text: attack }] };
  const html = taskContent({ task: running, conversation, project: attack });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.match(html, /data-action="sendMessage" >Send/);
  const historical = taskContent({ task: running, step: running.steps[0], conversation, project: '/test' });
  assert.match(historical, /data-action="sendMessage" disabled/);
  const finished = taskContent({ task: { ...task, status: 'completed' }, conversation, project: '/test' });
  assert.match(finished, /data-action="sendMessage" disabled/);
});
