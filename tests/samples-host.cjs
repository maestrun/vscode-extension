const vscode = require('vscode');
const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { readFile, writeFile, rm } = require('node:fs/promises');
const { sampleExecutor } = require('./sample-fixture.cjs');
const { prepare, json, waitFor } = require('./runtime-fixture.cjs');

async function checkSamples(browser, folder, frameWith) {
  const cwd = folder.uri.fsPath;
  const config = vscode.workspace.getConfiguration('maestrun', folder.uri);
  const previous = config.inspect('tasksFile')?.workspaceFolderValue;
  const parent = await readFile(join(cwd, '.maestrun/config.json'), 'utf8');
  await sampleExecutor(cwd);
  await vscode.commands.executeCommand('maestrun.selectSidebarProject', folder.uri);
  await vscode.commands.executeCommand('maestrun.openEditor');
  const dashboard = await frameWith(browser, `.editor-dashboard[data-project="${cwd}"] #task-filter`);
  await config.update('tasksFile', 'custom-parent-plan.md', vscode.ConfigurationTarget.WorkspaceFolder);
  let sample;
  try {
    await dashboard.locator('#project-menu summary').click();
    await dashboard.locator('#project-menu [data-action="sample"]').click();
    const form = await frameWith(browser, '#prompt-form');
    await form.getByRole('heading', { name: 'Choose an example', exact: true }).waitFor();
    assert.match(await form.locator('#prompt-form').innerText(), /Advanced.*5 tasks/);
    for (let i = 0; i < 8; i++) {
      const heading = await form.locator('#prompt-form h2').innerText();
      if (await form.getByRole('button', { name: 'Yes', exact: true }).count()) {
        assert.match(heading, /consumes its usage/);
        await form.getByRole('button', { name: 'Yes', exact: true }).click();
        break;
      }
      await form.getByRole('button', { name: 'Continue', exact: true }).click();
      await waitFor(async () => (await form.locator('#prompt-form h2').allTextContents()).some(text => text !== heading));
    }
    let example;
    await waitFor(async () => {
      for (const page of browser.contexts().flatMap(context => context.pages())) for (const frame of page.frames()) {
        try {
          const path = await frame.locator('.editor-dashboard').getAttribute('data-project', { timeout: 50 });
          if (path?.startsWith(join(cwd, '.maestrun/samples/'))) { sample = path; example = frame; return true; }
        } catch {}
      }
      return false;
    });
    assert.equal(await example.locator('.task-row').count(), 2, 'sample uses plan.md despite the parent custom plan setting');
    await waitFor(async () => (await json(join(sample, '.maestrun/session.json')))?.status === 'completed');
    await waitFor(async () => await example.locator('.task-row[data-status="completed"]').count() === 2);
    assert.equal(await readFile(join(cwd, '.maestrun/config.json'), 'utf8'), parent);
    await example.page().screenshot({ path: resolve(__dirname, '../.vscode-test/example-run.png') });
  } finally {
    await config.update('tasksFile', previous, vscode.ConfigurationTarget.WorkspaceFolder);
    if (sample && (await json(join(sample, '.maestrun/session.json')))?.status === 'running') {
      await vscode.commands.executeCommand('maestrun.selectSidebarProject', vscode.Uri.file(sample));
      await vscode.commands.executeCommand('maestrun.cancel');
      await waitFor(async () => (await json(join(sample, '.maestrun/session.json')))?.status !== 'running');
    }
  }
  // A CLI-created sample appears automatically without a manual refresh or a launch command.
  const external = join(cwd, '.maestrun/samples/run-terminal');
  await prepare(external);
  await writeFile(join(external, '.maestrun/run.json'), JSON.stringify({ version: 1, startedAt: '', tasks: [
    { id: 'external-task', title: 'Terminal example task', status: 'running', completedSteps: 0, totalSteps: 1 }
  ] }));
  await rm(join(external, 'plan.md')); // Report-only execution is also monitorable.
  await vscode.commands.executeCommand('maestrun.projects.focus');
  const page = browser.contexts()[0].pages()[0];
  const row = page.locator('[id="workbench.parts.auxiliarybar"] .monaco-list-row').filter({ hasText: 'Example · run-terminal' });
  await row.waitFor({ state: 'visible', timeout: 20000 });
  assert.match(await row.innerText(), /1 running/);
  await row.click();
  let side;
  await waitFor(async () => {
    for (const frame of page.frames()) {
      try { if (await frame.locator('.sidebar-tasks').getAttribute('data-project', { timeout: 50 }) === external) { side = frame; return true; } } catch {}
    }
    return false;
  });
  await side.getByRole('button', { name: 'Terminal example task', exact: true }).waitFor();
  await vscode.commands.executeCommand('maestrun.allFlowcharts');
  const flows = await frameWith(browser, '.all-flows');
  await flows.getByText(external, { exact: true }).waitFor();
  await rm(join(external, '.maestrun/config.json'));
  await row.waitFor({ state: 'detached', timeout: 20000 });
  await flows.getByText(external, { exact: true }).waitFor({ state: 'detached', timeout: 20000 });
  await vscode.commands.executeCommand('maestrun.selectSidebarProject', folder.uri);
}
module.exports = { checkSamples };
