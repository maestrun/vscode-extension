const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, symlink, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { discoverProjects, projectInWorkspace } = require('../dist/projects');

test('discovers multiple workspace roots, nested Git repositories, worktrees, and configured projects', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'maestrun-projects-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const one = join(root, 'one'); const two = join(root, 'two');
  for (const path of ['one/services/api/.git', 'one/plain', 'one/tools/worker', 'one/apps/ui/.maestrun', 'two', 'one/node_modules/ignored/.git'])
    await mkdir(join(root, path), { recursive: true });
  await writeFile(join(one, 'tools/worker/.git'), 'gitdir: elsewhere');
  await writeFile(join(one, 'apps/ui/.maestrun/config.json'), '{}');
  await symlink(one, join(one, 'cycle'));
  const { projects, truncated } = await discoverProjects([one, two]);
  assert.equal(truncated, false);
  assert.deepEqual(new Set(projects.map((project) => project.path)), new Set([one, two, join(one, 'services/api'), join(one, 'tools/worker'), join(one, 'apps/ui')]));
  assert.equal(projects.find((project) => project.path.endsWith('apps/ui')).configured, true);
  assert.equal(projects.find((project) => project.path.endsWith('services/api')).git, true);
  assert.equal(projects.find((project) => project.path.endsWith('tools/worker')).git, true);
  assert.equal((await discoverProjects([one, join(one, 'services/api')])).projects.filter((project) => project.path.endsWith('services/api')).length, 1);
  assert.equal(await projectInWorkspace(join(one, 'plain'), [one, two]), one);
  await symlink(two, join(one, 'outside'));
  assert.equal(await projectInWorkspace(join(one, 'outside'), [one]), undefined);
  assert.equal(await projectInWorkspace(root, [one]), undefined);
});
