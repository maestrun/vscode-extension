const vscode = require('vscode');
const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { writeFile, readFile, mkdir } = require('node:fs/promises');
const { prepare, waitFor, json } = require('./runtime-fixture.cjs');

async function projectFrame(browser, path) {
  let found;
  await waitFor(async () => {
    for (const page of browser.contexts().flatMap((context) => context.pages())) for (const frame of page.frames()) {
      try {
        if (await frame.locator('.dashboard').getAttribute('data-project', { timeout: 100 }) === path) { found = frame; return true; }
      } catch { /* A webview may be loading or hidden. */ }
    }
    return false;
  });
  return found;
}

async function checkDashboards(browser, folder) {
  const root = folder.uri.fsPath;
  const a = join(root, 'apps/frontend');
  const b = join(root, 'services/backend');
  const fresh = join(root, 'arbitrary/deep/folder');
  await prepare(a); await prepare(b); await mkdir(fresh, { recursive: true });
  const rootBefore = await readFile(join(root, '.maestrun/config.json'), 'utf8');
  const aBefore = await readFile(join(a, '.maestrun/config.json'), 'utf8');
  await writeFile(join(b, 'plan.md'), '## Tasks\n\n### Task task-1: Backend only\n\n- Depends on: none\n\nVerify backend independently.\n');
  const tabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('maestrun.task'));
  const initialCount = tabs().length;
  await vscode.commands.executeCommand('maestrun.openProjectDashboard', vscode.Uri.file(a));
  let front = await projectFrame(browser, a);
  await front.locator('#task-filter').fill('First');
  await front.getByRole('button', { name: 'First task', exact: true }).click();
  await front.locator('#detail-title').waitFor();
  await vscode.commands.executeCommand('maestrun.openProjectDashboard', vscode.Uri.file(b));
  let back = await projectFrame(browser, b);
  assert.equal(tabs().length, initialCount + 2, 'two project dashboards stay open');
  assert.match(await back.locator('#content').innerText(), /Backend only/);
  await vscode.commands.executeCommand('maestrun.openProjectDashboard', vscode.Uri.file(a));
  front = await projectFrame(browser, a);
  assert.equal(tabs().length, initialCount + 2, 'opening the same project reuses its dashboard');
  assert.equal(await front.locator('#task-filter').inputValue(), 'First');
  assert.match(await front.locator('#detail-title').innerText(), /First task/);
  await front.locator('#project-menu summary').click();
  await front.getByRole('button', { name: 'Open configuration file', exact: true }).click();
  await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === join(a, '.maestrun/config.json'));
  await vscode.commands.executeCommand('maestrun.openProjectDashboard', vscode.Uri.file(b));
  back = await projectFrame(browser, b);
  const editing = vscode.commands.executeCommand('maestrun.configure');
  let form;
  await waitFor(async () => {
    for (const page of browser.contexts().flatMap((context) => context.pages())) for (const frame of page.frames()) {
      try { if (await frame.locator('#prompt-form').count()) { form = frame; return true; } } catch {}
    }
    return false;
  });
  await form.locator('.choice').filter({ hasText: 'Edit steps and execution in a table' }).click();
  await form.getByRole('button', { name: 'Continue', exact: true }).click();
  await form.locator('#workflow-table tbody tr').nth(1).locator('[data-field=model]').selectOption('backend-model');
  await form.getByRole('button', { name: 'Save workflow', exact: true }).click();
  await editing;
  assert.equal((await json(join(b, '.maestrun/config.json'))).stages[1].model, 'backend-model');
  assert.equal(await readFile(join(a, '.maestrun/config.json'), 'utf8'), aBefore);
  assert.equal(await readFile(join(root, '.maestrun/config.json'), 'utf8'), rootBefore);
  await writeFile(join(a, 'plan.md'), '## Tasks\n\n### Task task-1: Frontend updated\n\n- Depends on: none\n\nUpdated independently.\n');
  await vscode.commands.executeCommand('maestrun.refresh');
  await vscode.commands.executeCommand('maestrun.openProjectDashboard', vscode.Uri.file(a));
  front = await projectFrame(browser, a);
  if (await front.locator('[data-ui=back]').isVisible()) await front.locator('[data-ui=back]').click();
  await front.locator('#task-filter').fill('');
  await front.getByRole('button', { name: 'Frontend updated', exact: true }).waitFor();
  await vscode.commands.executeCommand('maestrun.openProjectDashboard', vscode.Uri.file(b));
  back = await projectFrame(browser, b);
  await back.getByRole('button', { name: 'Backend only', exact: true }).waitFor();
  await vscode.commands.executeCommand('maestrun.openProjectDashboard', vscode.Uri.file(fresh));
  const empty = await projectFrame(browser, fresh);
  await empty.getByRole('heading', { name: 'Start with a plan', exact: true }).waitFor();
  assert.equal(tabs().length, initialCount + 3, 'arbitrary subfolders need no Git or existing configuration');
  await empty.page().screenshot({ path: resolve(__dirname, '../.vscode-test/multiple-dashboards.png') });
}
module.exports = { checkDashboards };
