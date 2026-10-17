const vscode = require('vscode');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { waitFor } = require('./runtime-fixture.cjs');

async function assertVertical(scope) {
  const boxes = await scope.locator('.nested-task').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => {
    const box = node.getBoundingClientRect(); return [node.dataset.taskId, { x: box.x, y: box.y, right: box.right, bottom: box.bottom }];
  })));
  assert.ok(boxes.__orchestrator__.bottom < boxes.build.y, 'main task above its children');
  assert.ok(boxes.build.bottom < boxes.check.y, 'grandchildren below their parent');
  assert.ok(boxes.check.bottom < boxes.review.y, 'review follows its prerequisites');
  const steps = await scope.locator('.nested-task[data-task-id=build] .flow-node').evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, bottom: box.bottom };
  }));
  if (await scope.locator('.nested-steps:visible').count()) {
    assert.equal(steps[0].x, steps[1].x);
    assert.ok(steps[0].bottom < steps[1].y, 'steps flow downward without overlap');
    assert.equal(await scope.locator('.nested-task[data-task-id=build] .flow-stage').nth(1).getAttribute('data-direction'), 'down');
  }
}

async function checkDirection(frame) {
  await vscode.commands.executeCommand('workbench.action.joinAllGroups');
  const themes = vscode.workspace.getConfiguration('workbench');
  const original = themes.get('colorTheme');
  await themes.update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
  await frame.locator('body.vscode-dark').waitFor();
  await frame.getByRole('button', { name: 'Vertical', exact: true }).focus();
  await frame.getByRole('button', { name: 'Vertical', exact: true }).press('Enter');
  await waitFor(async () => await frame.locator('.nested-flow').getAttribute('data-direction') === 'vertical');
  await assertVertical(frame);
  await frame.locator('.nested-task[data-task-id=build] .flow-node[data-step-id=testing]').click();
  await frame.locator('#detail-title').filter({ hasText: 'Tests' }).waitFor();
  assert.equal(await frame.getByRole('button', { name: 'Vertical', exact: true }).getAttribute('aria-pressed'), 'true');
  await frame.getByRole('button', { name: 'Simple', exact: true }).click();
  await assertVertical(frame);
  const size = await frame.locator('.nested-task').first().boundingBox();
  assert.ok(size.width <= 220 && size.height < 120, 'simple task cards stay compact');
  await frame.getByRole('button', { name: 'Detailed', exact: true }).click();
  await captureDirections(frame, themes);
  await frame.getByRole('button', { name: 'Horizontal', exact: true }).click();
  await themes.update('colorTheme', original, vscode.ConfigurationTarget.Global);
}

async function captureDirections(frame, themes) {
  await frame.locator('.nested-scroll').evaluate((node) => node.scrollTo(0, 0));
  await frame.evaluate(() => { document.scrollingElement.scrollTop = 0; });
  await frame.page().screenshot({ path: resolve(__dirname, '../.vscode-test/flow-vertical-dark.png') });
  await frame.getByRole('button', { name: 'Horizontal', exact: true }).click();
  await frame.page().screenshot({ path: resolve(__dirname, '../.vscode-test/flow-horizontal-dark.png') });
  await frame.getByRole('button', { name: 'Vertical', exact: true }).click();
  await themes.update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Global);
  await frame.locator('body.vscode-light').waitFor();
  await frame.page().setViewportSize({ width: 760, height: 900 });
  await assertVertical(frame);
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await frame.page().screenshot({ path: resolve(__dirname, '../.vscode-test/flow-vertical-light-narrow.png') });
  await frame.page().setViewportSize({ width: 1440, height: 1000 });
}
module.exports = { checkDirection, assertVertical };
