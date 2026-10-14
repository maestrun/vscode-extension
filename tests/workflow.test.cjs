const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { executable, fixture, json } = require('./runtime-fixture.cjs');
const options = { skip: !existsSync(executable) && 'Set MAESTRUN_TEST_EXECUTABLE to test the installed CLI.' };

test('keeping a workflow is the default and preserves the exact file, including formatting', options, async (t) => {
  const { cwd, invoke } = await fixture(t);
  const path = join(cwd, '.maestrun/config.json');
  const before = await readFile(path, 'utf8');
  for (const action of ['configure', 'start']) {
    await invoke(action, { onPrompt: async (prompt) => {
      assert.equal(prompt.initial, 'reuse');
      return { value: prompt.initial };
    } });
    assert.equal(await readFile(path, 'utf8'), before);
  }
  await invoke('configure', { onPrompt: async (prompt) => ({ value: prompt.kind === 'select' ? 'adjust' : prompt.table }) });
  assert.equal(await readFile(path, 'utf8'), before, 'saving the unchanged table does not rewrite the file');
});

test('table edits retain other settings and invalid edits can be corrected without losing the draft', options, async (t) => {
  const { cwd, invoke } = await fixture(t);
  const path = join(cwd, '.maestrun/config.json');
  const before = await json(path);
  before.extraSetting = { keep: true };
  before.targets = { frontend: before.stages[0], backend: before.stages[0] };
  await writeFile(path, JSON.stringify(before));
  let tables = 0;
  await invoke('configure', { onPrompt: async (prompt) => {
    if (prompt.kind === 'select') return { value: 'adjust' };
    assert.equal(prompt.kind, 'table');
    tables++;
    if (tables === 1) {
      assert.equal(prompt.error, undefined);
      prompt.table.stages.push({ ...prompt.table.stages[1] });
    } else {
      assert.equal(prompt.table.stages.length, 3);
      assert.match(prompt.error, /unique step names/);
      assert.deepEqual(await json(path), before, 'invalid edits never write');
      prompt.table.stages[2].id = 'custom:Documentation';
    }
    return { value: prompt.table };
  } });
  assert.equal(tables, 2);
  const after = await json(path);
  assert.deepEqual(after, { ...before, stages: [...before.stages, { ...before.stages[1], id: 'custom:Documentation' }] });
});

test('back, cancellation and concurrent file changes preserve the saved workflow', options, async (t) => {
  const { cwd, invoke } = await fixture(t);
  const path = join(cwd, '.maestrun/config.json');
  const before = await readFile(path, 'utf8');
  let choices = 0;
  await invoke('configure', { onPrompt: async (prompt) => prompt.kind === 'select'
    ? { value: ++choices === 1 ? 'adjust' : 'reuse' } : { navigation: 'back' } });
  assert.equal(choices, 2);
  await assert.rejects(invoke('configure', { onPrompt: async (prompt) => prompt.kind === 'select'
    ? { value: 'adjust' } : { navigation: 'cancel' } }), /Cancelled/);
  assert.equal(await readFile(path, 'utf8'), before);
  const external = JSON.stringify({ ...JSON.parse(before), timeoutMs: 20000 });
  await assert.rejects(invoke('configure', { onPrompt: async (prompt) => {
    if (prompt.kind === 'select') return { value: 'adjust' };
    await writeFile(path, external);
    prompt.table.stages[1].model = 'updated-model';
    return { value: prompt.table };
  } }), /changed/i);
  assert.equal(await readFile(path, 'utf8'), external);
});

test('model discovery survives IPC, refresh preserves the draft and incompatible efforts cannot be saved', options, async (t) => {
  const { cwd, invoke } = await fixture(t);
  const path = join(cwd, '.maestrun/config.json');
  const before = await readFile(path, 'utf8');
  let tables = 0;
  await invoke('configure', { onPrompt: async (prompt) => {
    if (prompt.kind === 'select') return { value: 'adjust' };
    const codex = prompt.catalog.find((entry) => entry.executor === 'codex');
    assert.equal(codex.available, true);
    assert.deepEqual(codex.models.find((model) => model.id === 'backend-model').efforts, ['low', 'high']);
    tables++;
    if (tables === 1) {
      Object.assign(prompt.table.stages[1], { model: 'backend-model', effort: 'medium' });
      return { value: { refreshCatalog: true, table: prompt.table } };
    }
    assert.equal(prompt.table.stages[1].model, 'backend-model');
    assert.equal(prompt.table.stages[1].effort, 'medium');
    assert.equal(await readFile(path, 'utf8'), before);
    if (tables === 3) {
      assert.match(prompt.error, /available model and supported effort/);
      prompt.table.stages[1].effort = 'high';
    }
    return { value: prompt.table };
  } });
  assert.equal(tables, 3);
  const after = await json(path);
  assert.equal(after.stages[1].model, 'backend-model');
  assert.equal(after.stages[1].effort, 'high');
});
