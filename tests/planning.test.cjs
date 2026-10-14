const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { mkdir, writeFile, chmod, readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { fixture, executable, plan } = require('./runtime-fixture.cjs');

test('generates a real plan from multiline extension prompts with a fake executor', {
  skip: !existsSync(executable) && 'Set MAESTRUN_TEST_EXECUTABLE to test the installed CLI.'
}, async (t) => {
  const { cwd, invoke } = await fixture(t);
  const bin = join(cwd, 'bin');
  await mkdir(bin);
  const fake = join(bin, 'codex');
  await writeFile(fake, `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('fixture'); process.exit(0); }
if (args.includes('--help')) { console.log('--sandbox --json --ephemeral --ignore-user-config --ignore-rules'); process.exit(0); }
if (args.includes('status')) { console.log('Logged in'); process.exit(0); }
process.stdin.resume(); process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: ${JSON.stringify(plan)} } }));
  console.log(JSON.stringify({ type: 'turn.completed' }));
});`);
  await chmod(fake, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = bin;
  t.after(() => { process.env.PATH = originalPath; });
  const kinds = [];
  let logs = '';
  await invoke('plan', { onLog: (text) => { logs += text; }, onPrompt: async (prompt) => {
    kinds.push(prompt.kind);
    if (prompt.kind === 'confirm') return { value: true };
    if (prompt.kind === 'paste') return { value: 'Implement a feature.\nAcceptance: unit tests pass.' };
    if (prompt.choices?.some((choice) => choice.value === 'paste')) return { value: 'paste' };
    if (prompt.choices?.some((choice) => choice.value === 'simple')) return { value: 'simple' };
    throw new Error(`Unexpected prompt: ${JSON.stringify(prompt)}`);
  } });
  assert.ok(kinds.includes('paste'));
  assert.ok(kinds.includes('confirm'));
  assert.match(logs, /Generating a plan/);
  assert.match(await readFile(join(cwd, 'plan.md'), 'utf8'), /### Task task-1: First task/);
});
