const vscode = require('vscode');
const assert = require('node:assert/strict');
const { join, resolve, dirname } = require('node:path');
const { homedir } = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { writeFile, rm } = require('node:fs/promises');
const { runBridge } = require('../dist/bridge');
const { readReport } = require('../dist/storage');
const { waitFor } = require('./runtime-fixture.cjs');

async function checkTaskInput(browser, folder, frameWith) {
  const cwd = folder.uri.fsPath;
  const path = join(cwd, '.maestrun/run.json');
  const report = await runBridge({ cwd, action: 'preview', executable: process.env.MAESTRUN_TEST_EXECUTABLE,
    node: process.env.MAESTRUN_TEST_NODE, tasksPath: 'plan.md', worker: resolve(__dirname, '../dist/bridge-worker.js') });
  const task = report.tasks[0];
  const request = { id: randomUUID(), stage: task.steps[0].id, question: 'Which layout?\nChoose compact or spacious. <script>literal</script>', summary: 'Work is saved.\nA layout decision is required.' };
  task.status = 'on_hold'; task.step = request.stage; task.steps[0].status = 'on_hold'; task.inputRequests = [request];
  const answerFile = join(homedir(), '.maestrun/conversations', createHash('sha256').update(resolve(cwd)).digest('hex'), `${request.id}.answer.json`);
  try {
    await writeFile(path, JSON.stringify(report));
    await vscode.commands.executeCommand('maestrun.refresh');
    await vscode.commands.executeCommand('maestrun.openEditor');
    let dashboard = await frameWith(browser, '#task-filter');
    await dashboard.locator('.task-row[data-status="on_hold"]').waitFor();
    await dashboard.locator('[data-filter="on_hold"]').click();
    assert.equal(await dashboard.locator('.task-row:visible').count(), 1);
    await dashboard.getByRole('button', { name: task.title, exact: true }).click();
    await dashboard.locator('.input-request.on_hold').waitFor();
    assert.ok((await dashboard.locator('.input-request').innerText()).includes(request.question));
    assert.equal(await dashboard.locator('.input-request script').count(), 0);
    await dashboard.getByRole('button', { name: 'Flowchart', exact: true }).click();
    await dashboard.locator('.flow-node.on_hold').click();
    await dashboard.getByRole('button', { name: 'Answer question', exact: true }).click();
    let form = await frameWith(browser, '#prompt-form .input-context');
    assert.ok((await form.locator('.input-context').innerText()).includes(request.question));
    await form.getByRole('button', { name: 'Send answer', exact: true }).click();
    await form.locator('#validation').filter({ hasText: '1–32000' }).waitFor();
    await form.locator('#answer').fill('compact\nPreserve existing files.');
    await form.page().screenshot({ path: resolve(__dirname, '../.vscode-test/task-input.png') });
    await form.getByRole('button', { name: 'Send answer', exact: true }).click();
    await waitFor(async () => (await readReport(cwd))?.tasks[0].inputRequests[0].answer === 'compact\nPreserve existing files.');
    dashboard = await frameWith(browser, '#project-flow');
    await dashboard.getByRole('heading', { name: 'Your answer', exact: true }).waitFor();
    assert.equal(await dashboard.getByRole('button', { name: 'Answer question', exact: true }).count(), 0);
    await dashboard.getByRole('button', { name: 'Detailed tasks', exact: true }).click();
    await dashboard.locator('#no-matches').waitFor();
    await dashboard.locator('[data-filter="all"]').click();
    assert.equal(await dashboard.locator('.task-row:visible').count(), 2);
  } finally {
    await rm(path, { force: true });
    await rm(dirname(answerFile), { recursive: true, force: true });
    await vscode.commands.executeCommand('maestrun.refresh');
  }
}
module.exports = { checkTaskInput };
