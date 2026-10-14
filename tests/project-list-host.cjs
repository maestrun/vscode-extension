const vscode = require('vscode');
const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { mkdir, rm, writeFile } = require('node:fs/promises');
const { prepare, waitFor } = require('./runtime-fixture.cjs');

async function checkProjectList(browser, folder) {
  const first = join(folder.uri.fsPath, '00-projects/first');
  const second = join(folder.uri.fsPath, '00-projects/nested/second');
  const third = join(vscode.workspace.workspaceFolders[1].uri.fsPath, '00-other-root');
  await prepare(first); await prepare(second); await prepare(third);
  await mkdir(join(folder.uri.fsPath, '00-projects/plain/.git'), { recursive: true });
  for (const [path, title] of [[first, 'First project task'], [second, 'Nested project task'], [third, 'Other workspace task']]) {
    await writeFile(join(path, 'plan.md'), `## Tasks\n\n### Task task-1: ${title}\n\n- Depends on: none\n\nInspect ${title}.\n`);
  }
  await vscode.commands.executeCommand('maestrun.refresh');
  await vscode.commands.executeCommand('maestrun.projects.focus');
  const page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1440, height: 1200 });
  const rows = page.locator('[id="workbench.parts.auxiliarybar"] .monaco-list-row');
  const firstRow = rows.filter({ hasText: '00-projects/first' });
  const secondRow = rows.filter({ hasText: '00-projects/nested/second' });
  await firstRow.waitFor({ state: 'visible' });
  await secondRow.waitFor({ state: 'visible' });
  assert.equal(await rows.filter({ hasText: '00-projects/plain' }).count(), 0);
  const tabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs);
  const initial = tabs().length;
  let side;
  await firstRow.click();
  await waitFor(async () => {
    for (const frame of page.frames()) {
      try { if (await frame.locator('.sidebar-tasks').getAttribute('data-project', { timeout: 50 }) === first) { side = frame; return true; } } catch {}
    }
    return false;
  });
  await side.getByRole('button', { name: 'First project task', exact: true }).click();
  await side.locator('#detail-title').filter({ hasText: 'First project task' }).waitFor();
  await secondRow.click();
  await side.getByRole('button', { name: 'Nested project task', exact: true }).click();
  await side.locator('#detail-title').filter({ hasText: 'Nested project task' }).waitFor();
  assert.equal(await side.locator('.task-row').count(), 1, 'table only shows the selected project');
  assert.equal(tabs().length, initial, 'project and task selection do not create editor tabs');
  await firstRow.waitFor({ state: 'visible' });
  await secondRow.waitFor({ state: 'visible' });
  await page.screenshot({ path: resolve(__dirname, '../.vscode-test/project-list.png') });
  // The other root is also inside the parent root; discovery must deduplicate it.
  assert.equal(await rows.filter({ hasText: '00-other-root' }).count(), 1);
  await vscode.commands.executeCommand('maestrun.allFlowcharts');
  let flows;
  await waitFor(async () => {
    for (const frame of page.frames()) {
      try { if (await frame.locator('.all-flows').count()) { flows = frame; return true; } } catch {}
    }
    return false;
  });
  // Paths scope repeated task IDs to their own project.
  const nested = flows.locator('.flow-project').filter({ hasText: second });
  assert.ok((await flows.locator('.flow-project').count()) >= 4);
  assert.equal(await flows.locator('.flow-project').evaluateAll((entries, path) => entries.filter((entry) => entry.dataset.projectPath === path).length, third), 1);
  const beforeFlowClick = tabs().length;
  await nested.locator('.flow-node').first().click();
  await nested.locator('.step-inspector').waitFor();
  assert.match(await nested.locator('.step-inspector').innerText(), /Nested project task/);
  assert.equal(tabs().length, beforeFlowClick, 'flow nodes show details in the same tab');
  await nested.getByRole('button', { name: 'Close step details', exact: true }).click();
  await nested.locator('.step-inspector').waitFor({ state: 'detached' });
  await vscode.commands.executeCommand('maestrun.allFlowcharts');
  assert.equal(tabs().length, beforeFlowClick, 'the overview reuses its tab');
  await page.screenshot({ path: resolve(__dirname, '../.vscode-test/all-flowcharts.png') });
  const created = join(folder.uri.fsPath, '00-projects/created');
  await prepare(created);
  await rows.filter({ hasText: '00-projects/created' }).waitFor({ state: 'visible' });
  await flows.getByText(created, { exact: true }).waitFor();
  await rm(join(first, '.maestrun/config.json'));
  await firstRow.waitFor({ state: 'detached' });
  await flows.getByText(first, { exact: true }).waitFor({ state: 'detached' });
  await secondRow.waitFor({ state: 'visible' });
}
module.exports = { checkProjectList };
