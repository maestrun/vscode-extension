const { test } = require('node:test');
const assert = require('node:assert/strict');
const { unlink } = require('node:fs/promises');
const { join } = require('node:path');
const { fixture, json } = require('./runtime-fixture.cjs');

test('Orchestrator setup offers and saves a default effort through the extension', async (t) => {
  const { cwd, invoke } = await fixture(t);
  await unlink(join(cwd, '.maestrun/config.json'));
  const answers = ['codex', 'test-model', 'orchestrator', 'high', 'parallel', true];
  let effortPrompt = false;
  await invoke('start', { onPrompt: async (prompt) => {
    if (prompt.title === 'Default orchestrator effort (agents can override)') {
      effortPrompt = true;
      assert.ok(prompt.choices.some(choice => choice.value === 'high'));
    }
    return { value: answers.shift() };
  } });
  assert.ok(effortPrompt);
  assert.equal(answers.length, 0);
  const config = await json(join(cwd, '.maestrun/config.json'));
  assert.equal(config.stages[0].effort, 'high');
  assert.equal(config.execution.orchestrator, 'agent');
});
