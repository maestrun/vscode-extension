const { mkdtemp, writeFile, rm, mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { createServer } = require('node:net');
const { runTests } = require('@vscode/test-electron');
const { prepare, executable, fakeExecutors } = require('./runtime-fixture.cjs');

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  // Trash is unsupported on system-internal mounts such as /tmp on Linux.
  const testRoot = resolve(__dirname, '../.vscode-test');
  await mkdir(testRoot, { recursive: true });
  const project = await mkdtemp(join(testRoot, 'maestrun-vscode-host-'));
  try {
    await prepare(project);
    await writeFile(join(project, '.maestrun', 'run.log'), 'Test log');
    const second = join(project, "second-workspace-root");
    await mkdir(second);
    const workspace = join(project, "test.code-workspace");
    await writeFile(workspace, JSON.stringify({ folders: [{ path: project }, { path: second }] }));
    const port = await freePort();
    await runTests({
      version: process.env.VSCODE_TEST_VERSION ?? '1.106.0',
      extensionDevelopmentPath: resolve(__dirname, '..'),
      extensionTestsPath: resolve(__dirname, 'host-suite.cjs'),
      extensionTestsEnv: { PATH: `${await fakeExecutors(project)}:${process.env.PATH}`, MAESTRUN_TEST_EXECUTABLE: executable, MAESTRUN_TEST_NODE: process.execPath, MAESTRUN_TEST_CDP: String(port) },
      launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`],
    });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
