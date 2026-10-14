const vscode = require('vscode');
const assert = require('node:assert/strict');
const { resolve, join } = require('node:path');
const { waitFor } = require('./runtime-fixture.cjs');

async function tasksVisible(browser) {
  await waitFor(async () => {
    for (const page of browser.contexts()[0].pages()) for (const frame of page.frames()) {
      try { if (await frame.locator('.sidebar-tasks').isVisible()) return true; } catch {}
    }
    return false;
  });
}

async function checkNavigation(browser) {
  const page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1440, height: 1000 });
  const secondary = page.locator('[id="workbench.parts.auxiliarybar"]');
  const panel = page.locator('[id="workbench.parts.panel"]');
  await secondary.waitFor({ state: 'visible' });
  assert.match(await secondary.innerText(), /PROJECTS/i, 'Projects defaults to the secondary sidebar');
  const document = await vscode.workspace.openTextDocument(join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'plan.md'));
  await vscode.window.showTextDocument(document);
  const launch = page.locator('.editor-actions [aria-label*="Open Maestrun"]').first();
  const icon = page.locator('.activitybar [aria-label^="Maestrun"]').first();
  await launch.waitFor({ state: 'visible' });
  await icon.waitFor({ state: 'visible' });
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  await secondary.waitFor({ state: 'hidden' });
  await launch.click();
  await secondary.waitFor({ state: 'visible' });
  await vscode.commands.executeCommand('maestrun.dashboardView.toggleVisibility');
  await launch.click();
  await tasksVisible(browser);
  await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['maestrun.dashboardView'], destinationId: 'workbench.panel.output' });
  await panel.waitFor({ state: 'visible' });
  await icon.waitFor({ state: 'visible' });
  await vscode.commands.executeCommand('workbench.action.closePanel');
  await panel.waitFor({ state: 'hidden' });
  await launch.click();
  await panel.waitFor({ state: 'visible' });
  await tasksVisible(browser);
  await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['maestrun.dashboardView'], destinationId: 'workbench.view.extension.maestrun-workspace' });
  await vscode.commands.executeCommand('workbench.action.closePanel');
  await launch.click();
  await tasksVisible(browser);
  await page.screenshot({ path: resolve(__dirname, '../.vscode-test/navigation.png') });
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}
module.exports = { checkNavigation };
