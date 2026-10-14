const vscode = require('vscode');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFile, access, mkdir, rm } = require('node:fs/promises');
const { prepare, waitFor } = require('./runtime-fixture.cjs');

async function checkRemoval(browser, folder) {
  await vscode.commands.executeCommand('notifications.clearAll');
  const cwd = folder.uri.fsPath;
  const project = join(cwd, 'remove-config');
  const sample = join(cwd, '.maestrun/samples/run-delete');
  await prepare(project); await prepare(sample);
  await vscode.commands.executeCommand('maestrun.refresh');
  await vscode.commands.executeCommand('maestrun.projects.focus');
  const page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1440, height: 1200 });
  const rows = page.locator('[id="workbench.parts.auxiliarybar"] .monaco-list-row');
  const row = rows.filter({ hasText: 'remove-config' });
  const original = vscode.window.showWarningMessage;
  const prompts = [];
  let accept = false;
  // VS Code refuses modal prompts in extension tests. Capture the real command's
  // confirmation request; only replace the user's answer, retaining real Trash IO.
  vscode.window.showWarningMessage = async (message, options, label) => {
    prompts.push({ message, options, label });
    return accept ? label : undefined;
  };
  try {
    await row.waitFor({ state: 'visible' });
    await row.hover();
    const remove = row.locator('.action-label.codicon-trash');
    await remove.waitFor({ state: 'visible' });
    await row.locator('.action-label.codicon-refresh').click();
    await row.hover();
    await remove.click();
    await waitFor(() => prompts.length === 1);
    assert.equal(prompts[0].options.modal, true);
    assert.match(prompts[0].options.detail, /Only this workflow configuration/);
    assert.ok(prompts[0].options.detail.includes(join(project, '.maestrun/config.json')));
    await access(join(project, '.maestrun/config.json'));
    accept = true;
    await row.hover();
    await remove.click();
    await waitFor(async () => { try { await access(join(project, '.maestrun/config.json')); return false; } catch { return true; } });
    assert.match(await readFile(join(project, 'plan.md'), 'utf8'), /First task/);
    await row.waitFor({ state: 'detached' });
    const exampleRow = rows.filter({ hasText: 'Example · run-delete' });
    await exampleRow.waitFor({ state: 'visible' });
    await exampleRow.hover();
    await exampleRow.locator('.action-label.codicon-trash').click();
    await waitFor(() => prompts.length === 3);
    assert.match(prompts[2].options.detail, /entire example folder/);
    assert.ok(prompts[2].options.detail.includes(sample));
    await waitFor(async () => { try { await access(sample); return false; } catch { return true; } });
    await exampleRow.waitFor({ state: 'detached' });
    const selecting = vscode.commands.executeCommand('maestrun.selectProject');
    const input = page.locator('.quick-input-widget input').first();
    await input.waitFor({ state: 'visible' });
    const pickerProject = join(cwd, 'picker-config');
    await prepare(pickerProject);
    await page.locator('.quick-input-widget .codicon-refresh').click();
    await input.fill('picker-config');
    const pickerRow = page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'picker-config' });
    await pickerRow.waitFor({ state: 'visible' });
    await pickerRow.hover();
    accept = false;
    await pickerRow.locator('.codicon-trash').click();
    await waitFor(() => prompts.length === 4);
    await access(join(pickerProject, '.maestrun/config.json'));
    await input.waitFor({ state: 'visible' });
    await waitFor(async () => await input.isEnabled());
    accept = true;
    await pickerRow.hover();
    await pickerRow.locator('.codicon-trash').click();
    await waitFor(async () => { try { await access(join(pickerProject, '.maestrun/config.json')); return false; } catch { return true; } });
    await pickerRow.locator('.codicon-trash').waitFor({ state: 'detached' });
    await input.press('Escape');
    await selecting;
    await checkUnsupportedTrash(cwd);
    await access(join(cwd, '.maestrun/config.json'));
  } finally {
    vscode.window.showWarningMessage = original;
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}
async function checkUnsupportedTrash(cwd) {
  const fsDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'fs');
  const nativeFs = vscode.workspace.fs;
  const originalDelete = nativeFs.delete;
  const originalWarning = vscode.window.showWarningMessage;
  const originalError = vscode.window.showErrorMessage;
  const originalCreateOutput = vscode.window.createOutputChannel;
  const diagnosticLines = [];
  let logsOpened = false;
  vscode.window.createOutputChannel = (name) => {
    const channel = originalCreateOutput(name);
    return { ...channel, appendLine: (line) => { diagnosticLines.push(line); channel.appendLine(line); }, show: () => { logsOpened = true; } };
  };
  const errors = [];
  const attempts = [];
  const prompts = [];
  let acceptPermanent = false;
  let lock;
  let trashError = "Unable to delete file via trash because provider does not support it.";
  Object.defineProperty(vscode.workspace, 'fs', { configurable: true, value: { ...nativeFs, delete: async (uri, options) => {
    attempts.push(options);
    if (options.useTrash) throw new Error(trashError);
    return originalDelete(uri, options);
  } } });
  vscode.window.showErrorMessage = async (message, button) => { errors.push(message); assert.equal(button, "View logs"); return button; };
  vscode.window.showWarningMessage = async (message, options, label) => {
    prompts.push({ message, options, label });
    if (label === 'Delete permanently') {
      assert.equal(options.modal, true);
      assert.match(options.detail, /cannot be undone/);
      if (lock) await mkdir(lock);
      return acceptPermanent ? label : undefined;
    }
    return label;
  };
  try {
    for (const example of [false, true]) {
      const path = join(cwd, example ? '.maestrun/samples/run-remote-delete' : 'remote-config');
      await prepare(path);
      const config = join(path, '.maestrun/config.json');
      const remove = () => vscode.commands.executeCommand('maestrun.removeProject', { project: { path } });
      acceptPermanent = false;
      const before = attempts.length;
      await remove();
      await access(config);
      assert.equal(attempts.length, before + 1, 'cancelling permanent deletion does not retry without Trash');
      assert.ok(prompts.at(-1).options.detail.includes(example ? path : config));
      acceptPermanent = true;
      if (example) {
        lock = join(path, '.maestrun/run.lock');
        await remove();
        await access(config);
        assert.match(errors.pop(), /active execution or lock/);
        assert.equal(attempts.at(-1).useTrash, true, 'execution started during confirmation blocks permanent deletion');
        await rm(lock, { recursive: true }); lock = undefined;
      } else {
        trashError = 'Permission denied';
        const count = prompts.length;
        await remove();
        await access(config);
        assert.equal(prompts.length, count + 1, 'unrelated file errors do not offer permanent deletion');
        assert.match(errors.pop(), /Permission denied/);
        trashError = 'Unable to delete file via trash because provider does not support it.';
      }
      await remove();
      await assert.rejects(access(example ? path : config), { code: 'ENOENT' });
      assert.deepEqual(attempts.at(-1), { recursive: example, useTrash: false });
      if (!example) assert.match(await readFile(join(path, 'plan.md'), 'utf8'), /First task/);
    }
    assert.deepEqual(errors, []);
    await waitFor(() => logsOpened);
    assert.ok(diagnosticLines.some(line => /Permission denied/.test(line)));
    assert.ok(diagnosticLines.some(line => /provider does not support/.test(line)));
  } finally {
    Object.defineProperty(vscode.workspace, 'fs', fsDescriptor);
    vscode.window.showWarningMessage = originalWarning;
    vscode.window.showErrorMessage = originalError;
    vscode.window.createOutputChannel = originalCreateOutput;
  }
}

module.exports = { checkRemoval };
