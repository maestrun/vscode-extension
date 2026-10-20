const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { fixture, json, waitFor } = require('./runtime-fixture.cjs');

test('Run chooses and remembers participating repositories before validating or starting tasks', async (t) => {
  const { cwd, invoke } = await fixture(t);
  const configPath = join(cwd, '.maestrun/config.json');
  const config = await json(configPath);
  config.execution.mode = 'parallel'; config.execution.concurrency = 2;
  await writeFile(configPath, JSON.stringify(config));
  const selected = ['backend', 'nested/frontend'];
  for (const path of selected) {
    const repository = join(cwd, path);
    await mkdir(repository, { recursive: true });
    await writeFile(join(repository, 'baseline.txt'), 'baseline');
    for (const args of [['init', '--quiet'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--quiet', '-m', 'Baseline']])
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: repository, stdio: 'pipe' });
  }
  await mkdir(join(cwd, 'unrelated/.git'), { recursive: true });
  await writeFile(join(cwd, 'unrelated/.git/HEAD'), 'invalid repository');
  let choices = 0;
  await invoke('run', { onPrompt: async (prompt) => {
    if (prompt.title.startsWith('Repositories for this workspace')) {
      choices++;
      assert.deepEqual(prompt.initial, []);
      assert.ok(prompt.choices.some(choice => choice.value === 'unrelated'));
      return { value: selected };
    }
    return { value: prompt.title === 'Run tasks' ? 'all' : true };
  } });
  await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status === 'completed');
  assert.equal(choices, 1);
  assert.deepEqual((await json(configPath)).execution.repositories, selected);
  const report = await json(join(cwd, '.maestrun/run.json'));
  assert.deepEqual(report.tasks[0].worktree.repositories.map(entry => entry.path), selected);
  await invoke('run', { onPrompt: async (prompt) => {
    assert.ok(prompt.title === 'Run tasks' || prompt.kind === 'confirm');
    return { value: prompt.title === 'Run tasks' ? 'all' : true };
  } });
  await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status === 'completed');
});
