const vscode = require('vscode');
const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { writeFile } = require('node:fs/promises');
const { prepare, config, waitFor, executable } = require('./runtime-fixture.cjs');
const { checkDirection, assertVertical } = require('./nested-direction-host.cjs');
const { checkUsability } = require('./nested-usability-host.cjs');
const { runBridge } = require('../dist/bridge');

async function findFrame(browser, selector) {
  let found;
  await waitFor(async () => {
    for (const page of browser.contexts().flatMap((context) => context.pages())) for (const frame of page.frames()) {
      try { if (await frame.locator(selector).count()) { found = frame; return true; } } catch {}
    }
    return false;
  });
  return found;
}

async function checkNestedFlow(browser, folder) {
  await vscode.commands.executeCommand('workbench.action.editorLayoutSingle');
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const cwd = join(folder.uri.fsPath, 'nested-orchestrator');
  await prepare(cwd);
  await writeFile(join(cwd, '.maestrun/config.json'), JSON.stringify({ ...config,
    execution: { ...config.execution, orchestrator: 'agent' }, stages: [config.stages[0],
      ...['implementation', 'testing', 'review'].map((id) => ({ id, executor: 'codex', model: 'test-model' }))] }));
  await writeFile(join(cwd, 'plan.md'), '## Tasks\n\n### Task build: Build\n- Depends on: none\n- Steps: implementation, testing\n\nBuild it.\n\n### Task check: Check\n- Parent: build\n- Depends on: build\n- Steps: testing\n\nCheck it.\n\n### Task review: Review\n- Depends on: build, check\n- Steps: review\n\nReview it.\n');
  await vscode.commands.executeCommand('maestrun.openProjectDashboard', vscode.Uri.file(cwd));
  let frame = await findFrame(browser, `.dashboard[data-project="${cwd}"]`);
  await frame.page().setViewportSize({ width: 1440, height: 1000 });
  await frame.getByRole('button', { name: 'Flowchart', exact: true }).click();
  await frame.locator('.nested-task').nth(3).waitFor();
  assert.equal(await frame.locator('.nested-steps:visible').count(), 0);
  await checkPositions(frame);
  assert.equal(await frame.locator('.dependency-edges path[data-from=build][data-to=review]').count(), 1);
  assert.equal(await frame.locator('.dependency-edges path[data-from=check][data-to=review]').count(), 1);
  await frame.getByRole('button', { name: 'Detailed', exact: true }).click();
  await waitFor(async () => await frame.locator('.nested-steps:visible').count() === 4);
  assert.equal(await frame.locator('.nested-steps .flow-node').count(), 5);
  const steps = await frame.locator('.nested-task[data-task-id=build] .flow-node').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().x));
  assert.ok(steps[0] < steps[1], 'steps run left to right inside each task');
  await frame.locator('.nested-task[data-task-id="build"] .flow-node[data-step-id="testing"]').click();
  await waitFor(async () => await frame.locator('.dashboard').getAttribute('data-selection') === 'build');
  await frame.locator('#detail-title').filter({ hasText: 'Tests' }).waitFor();
  await checkDirection(frame);
  await checkLiveUpdate(frame, cwd);
  await frame.locator('.nested-scroll').evaluate((node) => { node.scrollLeft = 0; node.scrollTop = 0; });
  await frame.page().screenshot({ path: resolve(__dirname, '../.vscode-test/nested-flow.png') });
  await checkUsability(frame);
  await checkAllFlows(browser, cwd);
}

async function checkPositions(frame) {
  const boxes = await frame.locator('.nested-task').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => {
    const box = node.getBoundingClientRect(); return [node.dataset.taskId, { x: box.x, right: box.right }];
  })));
  assert.ok(boxes.__orchestrator__.right < boxes.build.x, 'main task stays on the left');
  assert.ok(boxes.build.right < boxes.check.x, 'grandchildren stay farther right');
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'diagram scrolls inside its panel');
}

async function checkLiveUpdate(frame, cwd) {
  await frame.page().setViewportSize({ width: 760, height: 900 });
  await waitFor(async () => await frame.locator('.nested-scroll').evaluate((node) => node.scrollWidth > node.clientWidth + 100));
  const saved = await runBridge({ cwd, action: 'preview', executable, node: process.execPath, tasksPath: 'plan.md', worker: resolve(__dirname, '../dist/bridge-worker.js') });
  const generated = { ...saved.tasks.find((task) => task.id === 'check'), id: 'generated', title: 'Generated check', parentId: 'build' };
  delete generated.definition;
  saved.tasks.push(generated);
  saved.orchestration.tasks.push({ id: 'generated', title: generated.title, parentId: 'build', steps: ['testing'], instructions: 'Extra check.', dependsOn: ['build'] });
  await frame.locator('.nested-scroll').evaluate((node) => { node.scrollLeft = 100; });
  await writeFile(join(cwd, '.maestrun/run.json'), JSON.stringify(saved));
  await vscode.commands.executeCommand('maestrun.refresh');
  await waitFor(async () => await frame.locator('.nested-task').count() === 5);
  assert.equal(await frame.locator('.nested-flow').getAttribute('data-mode'), 'steps', 'detail mode survives report updates');
  assert.equal(await frame.locator('.nested-scroll').evaluate((node) => node.scrollLeft), 100, 'scroll survives report updates');
  await frame.page().setViewportSize({ width: 760, height: 900 });
  await checkPositions(frame);
  await frame.page().screenshot({ path: resolve(__dirname, '../.vscode-test/nested-flow-narrow.png') });
  await frame.page().setViewportSize({ width: 1440, height: 1000 });
}

async function checkAllFlows(browser, cwd) {
  await vscode.commands.executeCommand('maestrun.allFlowcharts');
  const frame = await findFrame(browser, '.all-flows');
  const tree = frame.locator(`.nested-flow[data-flow-key="${cwd}"]`);
  await tree.locator('.nested-task').nth(4).waitFor();
  await tree.getByRole('button', { name: 'Detailed', exact: true }).click();
  await tree.getByRole('button', { name: 'Vertical', exact: true }).click();
  await assertVertical(tree);
  await tree.locator('.nested-task[data-task-id="generated"] .flow-node').click();
  await frame.locator('.step-inspector #detail-title').filter({ hasText: 'Tests' }).waitFor();
  assert.equal(await tree.locator('.nested-steps:visible').count(), 5);
  assert.equal(await tree.getByRole('button', { name: 'Vertical', exact: true }).getAttribute('aria-pressed'), 'true');
  await frame.getByRole('button', { name: 'Close step details', exact: true }).click();
  await frame.locator('.step-inspector').waitFor({ state: 'detached' });
  await tree.getByRole('button', { name: 'Horizontal', exact: true }).click();
  await tree.getByRole('button', { name: 'Simple', exact: true }).click();
  assert.equal(await tree.locator('.nested-steps:visible').count(), 0);
}
module.exports = { checkNestedFlow };
