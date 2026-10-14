const vscode = require('vscode');
const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { writeFile, readFile, rm } = require('node:fs/promises');
const { prepare, waitFor } = require('./runtime-fixture.cjs');

async function checkSidebarTasks(browser, folder) {
  const root = join(folder.uri.fsPath, 'sidebar-table');
  await prepare(root);
  await writeFile(join(root, 'plan.md'), '## Tasks\n\n### Task first: Inspect the task table\n\n- Depends on: none\n\nKeep the list visible while selecting tasks.\n\n### Task second: Inspect the next task\n\n- Depends on: first\n\nShow a summary below without opening an editor.\n');
  // An existing editor for the same project must not capture sidebar clicks.
  await vscode.commands.executeCommand('maestrun.openProjectDashboard', vscode.Uri.file(root));
  await vscode.commands.executeCommand('maestrun.openSidebar');
  const page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1440, height: 1000 });
  let side;
  await waitFor(async () => {
    for (const frame of page.frames()) {
      try { if (await frame.locator('.sidebar-tasks').count()) { side = frame; return true; } } catch {}
    }
    return false;
  });
  const session = join(root, '.maestrun/session.json');
  await writeFile(session, JSON.stringify({ status: 'cancelled' }));
  await vscode.commands.executeCommand('maestrun.refresh');
  const notice = side.locator('#project-notice');
  await notice.waitFor();
  assert.equal(await notice.getAttribute('open'), null);
  assert.ok((await notice.boundingBox()).height <= 40, 'cancelled notice fits in a compact row');
  await notice.locator('summary').click();
  assert.match(await notice.innerText(), /Completed work is preserved/);
  await vscode.commands.executeCommand('maestrun.refresh');
  assert.notEqual(await notice.getAttribute('open'), null, 'refresh preserves expanded details');
  await notice.locator('summary').click();
  await side.page().screenshot({ path: resolve(__dirname, '../.vscode-test/compact-notice.png') });
  await writeFile(session, JSON.stringify({ status: 'failed', error: 'Fixture executor unavailable' }));
  await writeFile(join(root, '.maestrun/run.log'), 'Diagnostic: fixture process exited with code 1');
  await vscode.commands.executeCommand('maestrun.refresh');
  await notice.locator('summary').filter({ hasText: 'Fixture executor unavailable' }).waitFor();
  await notice.locator('summary').click();
  await notice.getByRole('button', { name: 'View execution log', exact: true }).click();
  await waitFor(async () => {
    for (const frame of page.frames()) {
      try {
        const log = frame.locator('.editor-dashboard[data-project="' + root + '"] #execution-log');
        if (await log.count()) return /Fixture executor unavailable/.test(await log.innerText()) && /fixture process exited with code 1/.test(await log.innerText());
      } catch {}
    }
    return false;
  });
  await rm(join(root, '.maestrun/run.log'));
  await rm(session);
  await vscode.commands.executeCommand('maestrun.refresh');
  const tabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs);
  const before = tabs().length;
  const taskEditors = () => tabs().filter((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('maestrun.task'));
  await side.getByRole('button', { name: 'Inspect the task table', exact: true }).click();
  await side.locator('#detail-title').filter({ hasText: 'Inspect the task table' }).waitFor();
  await side.getByRole('button', { name: 'Inspect the next task', exact: true }).focus();
  await side.getByRole('button', { name: 'Inspect the next task', exact: true }).press('Enter');
  await side.locator('#detail-title').filter({ hasText: 'Inspect the next task' }).waitFor();
  assert.equal(tabs().length, before, 'selection must not create editor tabs');
  assert.equal(await side.locator('.task-table:visible').count(), 1, 'table stays visible');
  assert.equal(await side.locator('#task-detail:visible').count(), 1, 'summary stays visible');
  assert.ok(await side.evaluate(() => document.querySelector('#task-detail').getBoundingClientRect().top >= document.querySelector('#task-browser').getBoundingClientRect().bottom), 'summary is below the table');
  assert.equal(await side.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
  await side.locator('#task-filter').fill('next');
  await vscode.commands.executeCommand('maestrun.refresh');
  assert.equal(await side.locator('#task-filter').inputValue(), 'next');
  assert.equal(await side.locator('.task-row:visible').count(), 1);
  await side.locator('#task-filter').fill('');
  await side.page().screenshot({ path: resolve(__dirname, '../.vscode-test/sidebar-tasks.png') });

  await side.getByRole('button', { name: 'View details', exact: true }).click();
  await waitFor(() => taskEditors().some((tab) => tab.isActive && tab.label.includes('Inspect the next task')));
  assert.equal(tabs().length, before, 'explicit details reuse the existing project editor');
  let editor;
  await waitFor(async () => {
    for (const frame of page.frames()) {
      try { if (await frame.locator('.dashboard:not(.sidebar-tasks) #detail-title').textContent({ timeout: 50 }) === 'Inspect the next task') { editor = frame; return true; } } catch {}
    }
    return false;
  });
  await side.getByRole('button', { name: 'Inspect the task table', exact: true }).click();
  await side.locator('#detail-title').filter({ hasText: 'Inspect the task table' }).waitFor();
  assert.equal(await editor.locator('#detail-title').innerText(), 'Inspect the next task', 'sidebar selection does not change the open editor');

  const configPath = join(root, '.maestrun/config.json');
  const original = await readFile(configPath, 'utf8');
  assert.equal(await side.locator('.toolbar > [data-action=run]').isVisible(), true);
  assert.equal(await side.locator('.toolbar > [data-action=openEditor]').isVisible(), true);
  await side.locator('#project-menu summary').click();
  await side.getByRole('button', { name: 'Configure workflow', exact: true }).click();
  let form;
  await waitFor(async () => {
    for (const frame of page.frames()) {
      try { if (await frame.locator('#prompt-form').count()) { form = frame; return true; } } catch {}
    }
    return false;
  });
  assert.equal(await side.locator('.task-table:visible').count(), 1, 'configuration leaves the task list intact');
  assert.equal(tabs().length, before + 1, 'configuration opens one editor tab');
  assert.equal(await form.locator('body').getAttribute('data-sidebar-workflow'), 'false');
  await form.getByRole('button', { name: 'Continue', exact: true }).click();
  await form.getByText('Operation completed.', { exact: true }).waitFor();
  assert.equal(await readFile(configPath, 'utf8'), original);
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}
module.exports = { checkSidebarTasks };
