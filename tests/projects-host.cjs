const vscode = require('vscode');
const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { mkdir, writeFile, readFile } = require('node:fs/promises');
const { prepare, json, waitFor } = require('./runtime-fixture.cjs');

async function selectProject(page, path) {
  const selecting = vscode.commands.executeCommand('maestrun.selectProject');
  const input = page.locator('.quick-input-widget .monaco-inputbox input').first();
  await input.waitFor({ state: 'visible' });
  await input.fill(path);
  await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: path }).first().waitFor();
  await input.press('Enter');
  await selecting;
}

async function sidebarFrame(browser, selector = '#task-filter', workflow = false) {
  let found;
  await waitFor(async () => {
    for (const page of browser.contexts().flatMap((context) => context.pages())) for (const frame of page.frames()) {
      try {
        if (await frame.locator(selector).count() && (await frame.locator(selector).first().isVisible())
          && (workflow ? await frame.locator('.workflow').count() : await frame.locator('.sidebar-tasks').count())) { found = frame; return true; }
      } catch { /* A workflow replaces its sidebar document. */ }
    }
    return false;
  });
  return found;
}

async function checkProjects(browser, folder) {
  const page = browser.contexts()[0].pages()[0];
  const root = folder.uri.fsPath;
  const nested = join(root, 'packages/api');
  const fresh = join(root, 'packages/new-project');
  await prepare(nested);
  await mkdir(join(nested, '.git'));
  await mkdir(join(fresh, '.git'), { recursive: true });
  const parentReport = await readFile(join(root, '.maestrun/run.json'), 'utf8');
  await vscode.commands.executeCommand('maestrun.openSidebar');
  await selectProject(page, nested);
  let side = await sidebarFrame(browser);
  await waitFor(async () => await side.locator('.dashboard').getAttribute('data-project') === nested);
  await side.getByRole('button', { name: 'First task', exact: true }).click();
  await side.locator('#detail-title').waitFor({ state: 'visible' });
  await page.screenshot({ path: resolve(__dirname, '../.vscode-test/sidebar.png') });

  const configured = vscode.commands.executeCommand('maestrun.configure');
  let form = await sidebarFrame(browser, '#prompt-form', true);
  assert.equal(await form.locator('body').getAttribute('data-sidebar-workflow'), 'false');
  await form.locator('.choice').filter({ hasText: 'Keep the saved workflow and exit' }).click();
  await form.getByRole('button', { name: 'Continue', exact: true }).click();
  await configured;
  await form.getByText('Operation completed.', { exact: true }).waitFor();
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  side = await sidebarFrame(browser, '#detail-title');

  const running = vscode.commands.executeCommand('maestrun.run');
  form = await sidebarFrame(browser, '#prompt-form', true);
  const runTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const tabCount = vscode.window.tabGroups.all.flatMap((group) => group.tabs).length;
  await form.getByRole('heading', { name: 'Run tasks', exact: true }).waitFor();
  await form.getByRole('button', { name: 'Continue', exact: true }).click();
  await form.getByRole('button', { name: 'Yes', exact: true }).click();
  await running;
  await vscode.commands.executeCommand('maestrun.openSidebar');
  side = await sidebarFrame(browser);
  await side.getByRole('button', { name: 'Open in editor', exact: true }).click();
  await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab === runTab);
  assert.equal(vscode.window.tabGroups.all.flatMap((group) => group.tabs).length, tabCount,
    'Run from the sidebar and Open in editor share the project tab');
  await waitFor(async () => (await json(join(nested, '.maestrun/session.json')))?.status === 'completed');
  assert.equal(await readFile(join(root, '.maestrun/run.json'), 'utf8'), parentReport, 'subproject execution must not mutate root progress');
  assert.ok((await json(join(nested, '.maestrun/run.json'))).tasks.every((task) => task.status === 'completed'));
  await vscode.commands.executeCommand('maestrun.openConfig');
  assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, join(nested, '.maestrun/config.json'));

  await vscode.commands.executeCommand('maestrun.openSidebar');
  await selectProject(page, fresh);
  side = await sidebarFrame(browser);
  await side.getByRole('heading', { name: 'Start with a plan', exact: true }).waitFor();
  const settingUp = vscode.commands.executeCommand('maestrun.start');
  form = await sidebarFrame(browser, '#prompt-form', true);
  await page.screenshot({ path: resolve(__dirname, '../.vscode-test/sidebar-setup.png') });
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await settingUp;
  const second = vscode.workspace.workspaceFolders[1];
  assert.ok(second, 'real multi-root workspace');
  await selectProject(page, second.uri.fsPath);
  side = await sidebarFrame(browser);
  await waitFor(async () => await side.locator('.dashboard').getAttribute('data-project') === second.uri.fsPath);
  await selectProject(page, root);
  await vscode.commands.executeCommand('maestrun.openEditor');
  await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview);
}
module.exports = { checkProjects };
