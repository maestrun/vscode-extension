const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { readReport, Conversations } = require('../dist/storage');

async function fixture(t, legacy = false) {
  const root = await mkdtemp(join(tmpdir(), 'maestrun-extension-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'project');
  const home = join(root, 'home');
  const id = randomUUID();
  const hash = createHash('sha256').update(resolve(cwd)).digest('hex');
  const base = legacy ? join(cwd, '.maestrun', 'conversations') : join(home, 'conversations', hash);
  const channel = join(base, id);
  await mkdir(join(cwd, '.maestrun'), { recursive: true });
  await mkdir(channel, { recursive: true });
  await writeFile(`${channel}.json`, JSON.stringify({ active: true, messages: [] }));
  return { cwd, home, channel, id, conversations: new Conversations(home) };
}

test('reads real report files and distinguishes no execution from invalid JSON', async (t) => {
  const { cwd } = await fixture(t);
  assert.equal(await readReport(cwd), undefined);
  const report = { version: 1, startedAt: '2026-10-13', tasks: [] };
  await writeFile(join(cwd, '.maestrun', 'run.json'), JSON.stringify(report));
  assert.deepEqual(await readReport(cwd), report);
  await writeFile(join(cwd, '.maestrun', 'run.json'), '{');
  await assert.rejects(readReport(cwd));
  assert.equal(await readReport(join(cwd, 'missing')), undefined);
});

for (const legacy of [false, true]) test(`queues messages using the CLI protocol (legacy=${legacy})`, async (t) => {
  const { cwd, channel, id, conversations } = await fixture(t, legacy);
  assert.deepEqual(await conversations.read(cwd, id), { active: true, messages: [] });
  const text = 'Testar espaços, "aspas", $(comando) e\nlinhas.';
  const ids = await Promise.all(Array.from({ length: 3 }, () => conversations.send({ cwd, conversationId: id, text })));
  const files = await readdir(channel);
  assert.equal(files.length, 3);
  for (const file of files) {
    assert.match(file, /^\d+-[a-f0-9-]+\.json$/);
    const message = JSON.parse(await readFile(join(channel, file), 'utf8'));
    assert.ok(ids.includes(message.id));
    assert.equal(message.text, text);
  }
});

test('does not enqueue for inactive sessions or invalid instructions', async (t) => {
  const { cwd, channel, id, conversations } = await fixture(t);
  for (const text of ['', '   ', 'a'.repeat(32001)])
    await assert.rejects(conversations.send({ cwd, conversationId: id, text }));
  await writeFile(`${channel}.json`, JSON.stringify({ active: false, messages: [] }));
  await assert.rejects(conversations.send({ cwd, conversationId: id, text: 'Hello' }), /session/);
  assert.deepEqual(await readdir(channel), []);
  await assert.rejects(conversations.read(cwd, '../escape'));
  assert.equal(await conversations.read(cwd, randomUUID()), undefined);
});

test('rejects symlinked reports and message queues', async (t) => {
  const { cwd, channel, id, conversations, home } = await fixture(t);
  await symlink(`${channel}.json`, join(cwd, '.maestrun', 'run.json'));
  await assert.rejects(readReport(cwd), /symbolic/);
  await rm(channel, { recursive: true });
  await symlink(home, channel);
  await assert.rejects(conversations.send({ cwd, conversationId: id, text: 'Hello' }), /symbolic/);
});
