const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile, rm, symlink } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { removalTarget } = require('../dist/project-removal');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'maestrun-remove-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const sample = join(project, '.maestrun/samples/run-example');
  for (const path of [project, sample]) {
    await mkdir(join(path, '.maestrun'), { recursive: true });
    await writeFile(join(path, '.maestrun/config.json'), '{}');
    await writeFile(join(path, 'plan.md'), 'Keep this plan');
  }
  return { root, project, sample };
}

test('configuration removal targets only config.json, while example deletion targets its own folder', async t => {
  const { root, project, sample } = await fixture(t);
  assert.equal(await removalTarget(project, [root], false), join(project, '.maestrun/config.json'));
  assert.equal(await removalTarget(sample, [root], true), sample);
  assert.equal(await readFile(join(project, 'plan.md'), 'utf8'), 'Keep this plan');
  await assert.rejects(removalTarget(project, [root], true), /Only folders/);
  await assert.rejects(removalTarget(sample, [join(root, 'unrelated')], true), /workspace/);
});

test('active sessions, foreground locks and nested running examples prevent deletion', async t => {
  const { root, project, sample } = await fixture(t);
  for (const name of ['run.lock', 'session.lock']) {
    const lock = join(sample, '.maestrun', name);
    await mkdir(lock);
    await assert.rejects(removalTarget(sample, [root], true), /active execution or lock/);
    await rm(lock, { recursive: true });
  }
  const session = join(sample, '.maestrun/session.json');
  await writeFile(session, JSON.stringify({ status: 'running' }));
  await assert.rejects(removalTarget(sample, [root], true), /Cancel/);
  await writeFile(session, JSON.stringify({ status: 'completed' }));
  assert.equal(await removalTarget(sample, [root], true), sample);
  const nested = join(sample, '.maestrun/samples/run-nested/.maestrun');
  await mkdir(join(nested, 'run.lock'), { recursive: true });
  await writeFile(join(nested, 'config.json'), '{}');
  await assert.rejects(removalTarget(sample, [root], true), /active execution or lock/);
  await mkdir(join(project, '.maestrun/run.lock'));
  await assert.rejects(removalTarget(project, [root], false), /active execution or lock/);
});

test('rejects symlinked samples, containers, configuration and malformed session state', async t => {
  const { root, project, sample } = await fixture(t);
  const alias = join(project, '.maestrun/samples/run-alias');
  await symlink(sample, alias);
  await assert.rejects(removalTarget(alias, [root], true), /regular project/);
  const fake = join(root, 'fake/.maestrun');
  await mkdir(fake, { recursive: true });
  await symlink(join(project, '.maestrun/samples'), join(fake, 'samples'));
  await assert.rejects(removalTarget(join(fake, 'samples/run-example'), [root], true), /Only folders/);
  const config = join(project, '.maestrun/config.json');
  await rm(config);
  await symlink(join(sample, '.maestrun/config.json'), config);
  await assert.rejects(removalTarget(project, [root], false), /regular file/);
  await writeFile(join(sample, '.maestrun/session.json'), '{}');
  await assert.rejects(removalTarget(sample, [root], true), /Invalid execution/);
});
