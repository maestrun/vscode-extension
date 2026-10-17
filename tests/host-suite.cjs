const vscode = require('vscode');
const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { writeFile, readFile, mkdir, readdir } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright-core');
const { json, waitFor } = require('./runtime-fixture.cjs');
const { checkNavigation } = require('./navigation-host.cjs');
const { checkRemoval } = require('./removal-host.cjs');
const { checkProjects } = require('./projects-host.cjs');
const { checkSamples } = require('./samples-host.cjs');
const { checkTaskInput } = require('./task-input-host.cjs');
const { checkNestedFlow } = require('./nested-flow-host.cjs');
const { checkDashboard } = require('./dashboard-host.cjs');
const { checkDashboards } = require('./dashboards-host.cjs');
const { checkSidebarTasks } = require('./sidebar-tasks-host.cjs');
const { checkProjectList } = require('./project-list-host.cjs');

async function frameWith(browser, selector) {
  let result;
  await waitFor(async () => {
    for (const page of browser.contexts().flatMap((context) => context.pages())) {
      for (const frame of page.frames()) {
        try { if (await frame.locator(selector).count() && !await frame.locator('.sidebar-tasks').count()) { result = frame; return true; } }
        catch { /* A replaced webview frame can detach during navigation. */ }
      }
    }
    return false;
  });
  return result;
}

async function run() {
  const extension = vscode.extensions.getExtension('maestrun.maestrun-vscode');
  assert.ok(extension);
  const folder = vscode.workspace.workspaceFolders[0];
  // VS Code resolves a login-shell PATH at startup; keep discovery inside the fixture.
  process.env.PATH = `${join(folder.uri.fsPath, ".fixture-bin")}:${process.env.PATH}`;
  const config = vscode.workspace.getConfiguration('maestrun', folder.uri);
  await config.update('executable', process.env.MAESTRUN_TEST_EXECUTABLE, vscode.ConfigurationTarget.Global);
  await config.update('nodeExecutable', process.env.MAESTRUN_TEST_NODE, vscode.ConfigurationTarget.Global);
  await extension.activate();
  await vscode.commands.executeCommand('maestrun.refresh');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.MAESTRUN_TEST_CDP}`);
  try { await checkNavigation(browser); await checkRemoval(browser, folder); await vscode.commands.executeCommand('maestrun.openEditor'); await checkInterface(browser, folder); await checkNestedFlow(browser, folder); await checkMissingCli(browser, folder); }
  catch (error) {
    for (const page of browser.contexts().flatMap((context) => context.pages())) {
      console.log('Page:', page.url(), 'Frames:', page.frames().map((frame) => frame.url()));
      await page.screenshot({ path: resolve(__dirname, '../.vscode-test/failure.png') });
    }
    throw error;
  }
  finally { await browser.close(); }
  console.log('Host checks passed: English dashboard, planned tasks, details, configuration forms, execution and cancellation without terminals.');
}

async function checkInterface(browser, folder) {
  const terminalCount = vscode.window.terminals.length;
  let dashboard = await frameWith(browser, '#task-filter');
  await dashboard.page().setViewportSize({ width: 1440, height: 1000 });
  await dashboard.getByRole('button', { name: 'First task', exact: true }).waitFor();
  assert.match(await dashboard.locator('#content').innerText(), /Pending/);
  await dashboard.getByRole('button', { name: 'First task', exact: true }).click();
  await dashboard.locator('#task-detail').waitFor();
  assert.match(await dashboard.locator('#task-detail').innerText(), /Implement the first change and verify it/);
  await dashboard.locator('#task-filter').fill('Second task');
  assert.equal(await dashboard.locator('.task-row:visible').count(), 1);
  await dashboard.locator('#task-filter').fill('');
  await checkDashboard(dashboard, folder);
  await checkTaskInput(browser, folder, frameWith);
  await checkConfigure(browser, folder);
  await checkRun(browser, folder);
  for (const [command, suffix] of [['openPlan', 'plan.md'], ['openConfig', 'config.json']]) {
    await vscode.commands.executeCommand(`maestrun.${command}`);
    assert.ok(vscode.window.activeTextEditor.document.uri.fsPath.endsWith(suffix));
  }
  await vscode.commands.executeCommand("notifications.clearAll");
  await checkProjects(browser, folder);
  await checkPosition(browser);
  await checkDashboards(browser, folder);
  await vscode.commands.executeCommand("notifications.clearAll");
  await checkSidebarTasks(browser, folder);
  await checkProjectList(browser, folder);
  await checkSamples(browser, folder, frameWith);
  assert.equal(vscode.window.terminals.length, terminalCount, 'no terminal was opened');
}

async function checkConfigure(browser, folder) {
  const path = join(folder.uri.fsPath, '.maestrun/config.json');
  const before = await readFile(path, 'utf8');
  const configured = vscode.commands.executeCommand('maestrun.configure');
  const form = await frameWith(browser, '#prompt-form');
  assert.match(await form.locator('.choice:has(input:checked)').innerText(), /Keep the saved workflow/);
  await form.getByRole('button', { name: 'Continue', exact: true }).click();
  await configured;
  await form.getByText('Operation completed.', { exact: true }).waitFor();
  assert.equal(await readFile(path, 'utf8'), before);

  const editing = vscode.commands.executeCommand('maestrun.configure');
  const editor = await frameWith(browser, '#prompt-form');
  await editor.locator('.choice').filter({ hasText: 'Edit steps and execution in a table' }).click();
  await editor.getByRole('button', { name: 'Continue', exact: true }).click();
  await editor.locator('#workflow-table').waitFor();
  const rows = editor.locator('#workflow-table tbody tr');
  assert.equal(await rows.count(), 2);
  const model = rows.nth(1).locator('select[data-field=model]');
  const effort = rows.nth(1).locator('select[data-field=effort]');
  assert.ok((await model.locator('option').allTextContents()).includes('backend-model'), await rows.nth(1).innerText());
  await model.selectOption('backend-model');
  assert.deepEqual(await effort.locator('option').evaluateAll((options)=>options.map((option)=>option.value)), ['', 'low', 'high']);
  await effort.selectOption('high');
  await model.selectOption('fast-model');
  assert.equal(await effort.inputValue(), '', 'model change resets unsupported effort');
  assert.equal(await effort.locator('option').count(), 1, 'models without effort only offer the CLI default');
  await model.selectOption('test-model');
  await editor.getByRole('button', {name:'Refresh models',exact:true}).click();
  await editor.locator('#workflow-table').waitFor();
  assert.equal(await rows.first().locator('[data-field=id]').getAttribute('readonly'), '');
  await editor.getByRole('button', { name: 'Add step', exact: true }).click();
  await rows.nth(2).locator('[data-field=id]').fill('Fixture');
  await editor.getByRole('button', { name: 'Save workflow', exact: true }).click();
  await editor.locator('#validation').filter({ hasText: /unique step names/ }).waitFor();
  assert.equal(await rows.count(), 3, 'invalid save preserves the draft');
  assert.equal(await readFile(path, 'utf8'), before);
  await rows.nth(2).locator('[data-field=id]').fill('Documentation');
  await rows.nth(2).getByRole('button', { name: 'Move up', exact: true }).click();
  assert.equal(await rows.nth(1).locator('[data-field=id]').inputValue(), 'Documentation');
  await rows.nth(1).getByRole('button', { name: 'Move down', exact: true }).click();
  await editor.getByRole('button', { name: 'Add step', exact: true }).click();
  await rows.nth(3).getByRole('button', { name: 'Remove', exact: true }).click();
  assert.equal(await rows.count(), 3);
  const order = () => rows.locator('[data-field=id]').evaluateAll((inputs) => inputs.map((input) => input.value));
  assert.equal(await rows.first().locator('.drag-handle').isDisabled(), true);
  await rows.nth(2).locator('.drag-handle').dragTo(rows.nth(1), { targetPosition: { x: 10, y: 2 } });
  assert.deepEqual(await order(), ['planning', 'Documentation', 'Fixture']);
  await rows.nth(1).locator('.drag-handle').press('ArrowDown');
  assert.deepEqual(await order(), ['planning', 'Fixture', 'Documentation']);
  await rows.nth(2).locator('.drag-handle').dragTo(rows.first(), { targetPosition: { x: 10, y: 2 } });
  assert.deepEqual(await order(), ['planning', 'Fixture', 'Documentation'], 'planning cannot be displaced');
  await rows.nth(2).locator('.drag-handle').dragTo(rows.nth(1), { targetPosition: { x: 10, y: 2 } });
  assert.deepEqual(await order(), ['planning', 'Documentation', 'Fixture']);
  assert.equal(await readFile(path, 'utf8'), before, 'dragging edits only the draft');
  await editor.locator('#execution-settings summary').click();
  await editor.locator('#execution-mode').selectOption('parallel');
  await editor.locator('#execution-concurrency').fill('2');
  await editor.page().screenshot({ path: resolve(__dirname, '../.vscode-test/workflow-table.png') });
  await editor.getByRole('button', { name: 'Save workflow', exact: true }).click();
  await editing;
  const after = await json(path);
  assert.equal(after.stages[1].id, 'custom:Documentation');
  assert.equal(after.execution.mode, 'parallel');
  assert.equal(after.execution.concurrency, 2);
  assert.deepEqual(after.plugins, JSON.parse(before).plugins);
  await writeFile(path, before);
}

async function checkPosition(browser) {
  const page = browser.contexts()[0].pages()[0];
  const choose = async (label) => {
    const choosing = vscode.commands.executeCommand('maestrun.choosePosition');
    const input = page.locator('.quick-input-widget .monaco-inputbox input').first();
    await input.waitFor({ state: 'visible' });
    await input.fill(label);
    await input.press('Enter');
    await choosing;
  };
  const document = await vscode.workspace.openTextDocument({ content: 'Keep this editor visible beside Maestrun.' });
  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  await choose('Editor on the right');
  assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.ViewColumn.Two);
  assert.ok(vscode.window.visibleTextEditors.some((editor) => editor.document === document));
  await choose('Editor on the left');
  assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.ViewColumn.One);
  await choose('Editor on the right');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await vscode.commands.executeCommand('maestrun.openEditor');
  assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.ViewColumn.Two, 'reopening remembers the position');
  const configuring = vscode.commands.executeCommand('maestrun.configure');
  const form = await frameWith(browser, '#prompt-form');
  assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.ViewColumn.Two, 'forms follow the dashboard position');
  await form.getByRole('button', { name: 'Continue', exact: true }).click();
  await configuring;
}

async function checkRun(browser, folder) {
  await vscode.commands.executeCommand('maestrun.openEditor');
  await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input.viewType?.endsWith('maestrun.task'));
  const tabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs);
  const dashboardTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const tabCount = tabs().length;
  const running = vscode.commands.executeCommand('maestrun.run');
  const form = await frameWith(browser, '#prompt-form');
  await form.getByRole('heading', { name: /Allow these project plugins/ }).waitFor();
  assert.equal(tabs().length, tabCount, 'Run reuses the project dashboard');
  await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab === dashboardTab);
  await vscode.commands.executeCommand('maestrun.openSidebar');
  await vscode.commands.executeCommand('maestrun.openEditor');
  assert.equal(tabs().length, tabCount, 'Open in editor preserves the pending Run prompt in the same tab');
  await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab === dashboardTab);
  await form.getByRole('button', { name: 'Yes', exact: true }).click();
  await running;
  await vscode.commands.executeCommand('maestrun.openSidebar');
  await vscode.commands.executeCommand('maestrun.openEditor');
  assert.equal(tabs().length, tabCount, 'Open in editor reuses the tab after Run');
  await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab === dashboardTab);
  const sessionPath = join(folder.uri.fsPath, '.maestrun/session.json');
  await waitFor(async () => (await json(sessionPath))?.status === 'completed');
  await vscode.commands.executeCommand('maestrun.refresh');
  const dashboard = await frameWith(browser, '#task-filter');
  await dashboard.locator('.task-row').first().waitFor();
  assert.ok((await json(join(folder.uri.fsPath, '.maestrun/run.json'))).tasks.every((task) => task.status === 'completed'));
  await vscode.commands.executeCommand('maestrun.openLog');
  const log = await frameWith(browser, '#execution-log');
  await log.getByText(/Verified by fixture/).first().waitFor();
  assert.ok((await log.locator('#execution-log').innerText()).includes('Fixture'));
  await log.getByRole('button', { name: 'Detailed tasks', exact: true }).click();
  await checkInstructions(browser, folder);
  await writeFile(join(folder.uri.fsPath, 'plan.md'), '## Tasks\n\n### Task new-task: Cancel this task\n\n- Depends on: none\n\nWait for cancellation.\n');
  await writeFile(join(folder.uri.fsPath, 'hold'), '');
  const secondRun = vscode.commands.executeCommand('maestrun.run');
  const secondForm = await frameWith(browser, '#prompt-form');
  assert.equal(tabs().length, tabCount, 'a repeated Run does not create another tab');
  await secondForm.getByRole('button', { name: 'Yes', exact: true }).click();
  await secondRun;
  await waitFor(async () => (await json(join(folder.uri.fsPath, '.maestrun/run.json')))?.tasks[0].status === 'running');
  await vscode.commands.executeCommand('maestrun.cancel');
  await waitFor(async () => (await json(sessionPath))?.status === 'cancelled');
}

async function checkInstructions(browser, folder) {
  const reportPath = join(folder.uri.fsPath, '.maestrun/run.json');
  const saved = await json(reportPath);
  const conversationId = randomUUID();
  const channel = join(folder.uri.fsPath, '.maestrun/conversations', conversationId);
  await mkdir(channel, { recursive: true });
  await writeFile(`${channel}.json`, JSON.stringify({ active: true, messages: [{ id: 'm1', role: 'model', text: 'Waiting for instructions' }] }));
  const task = { ...saved.tasks[0], status: 'running', conversationId };
  await writeFile(reportPath, JSON.stringify({ ...saved, tasks: [task, ...saved.tasks.slice(1)] }));
  await vscode.commands.executeCommand('maestrun.refresh');
  await vscode.commands.executeCommand('maestrun.showTask', { task, projectPath: folder.uri.fsPath });
  const dashboard = await frameWith(browser, '#task-detail');
  await dashboard.getByRole('button', { name: 'Send instructions', exact: true }).click();
  const form = await frameWith(browser, '#prompt-form textarea');
  await form.locator('textarea').fill('Add a regression test.\nKeep existing behavior.');
  await form.getByRole('button', { name: 'Continue', exact: true }).click();
  await waitFor(async () => (await readdir(channel)).length === 1);
  const [file] = await readdir(channel);
  assert.equal((await json(join(channel, file))).text, 'Add a regression test.\nKeep existing behavior.');
  await writeFile(reportPath, JSON.stringify(saved));
}

async function checkMissingCli(browser, folder) {
  const config = vscode.workspace.getConfiguration('maestrun', folder.uri);
  const previous = config.inspect('executable')?.globalValue;
  const originalError = vscode.window.showErrorMessage;
  const originalOpen = vscode.env.openExternal;
  let opened;
  vscode.window.showErrorMessage = async (message, ...buttons) => {
    assert.match(message, /Maestrun CLI was not found/);
    assert.match(message, /https:\/\/maestrun\.com/);
    assert.ok(buttons.includes('Installation instructions'));
    assert.ok(buttons.includes('View logs'));
    return 'Installation instructions';
  };
  vscode.env.openExternal = async uri => { opened = uri.toString(); return true; };
  try {
    await config.update('executable', join(folder.uri.fsPath, 'missing-maestrun'), vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('maestrun.openProjectDashboard', folder.uri);
    await vscode.commands.executeCommand('maestrun.refresh');
    const frame = await frameWith(browser, `.editor-dashboard[data-project="${folder.uri.fsPath}"] .error-banner a[href="https://maestrun.com"]`);
    await frame.locator('.error-banner a').waitFor({ state: 'visible' });
    await vscode.commands.executeCommand('maestrun.run');
    await waitFor(() => opened !== undefined);
    assert.equal(new URL(opened).href, 'https://maestrun.com/');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  } finally {
    vscode.window.showErrorMessage = originalError;
    vscode.env.openExternal = originalOpen;
    await config.update('executable', previous, vscode.ConfigurationTarget.Global);
  }
}

module.exports = { run };
