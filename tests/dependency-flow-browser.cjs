const assert = require('node:assert/strict');
const { readFile, mkdir } = require('node:fs/promises');
const { resolve } = require('node:path');
const { chromium } = require('playwright-core');
const { nestedFlow } = require('../dist/nested-flow');

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const tasks = [
      { id: 'main', title: 'Main task' }, { id: 'base', title: 'Prepare base', dependsOn: [] },
      { id: 'api', title: 'Implement API', dependsOn: ['base'] },
      { id: 'ui', title: 'Implement interface', dependsOn: ['base'] },
      { id: 'verify', title: 'Verify integration', dependsOn: ['api', 'ui'] },
      { id: 'release', title: 'Release', dependsOn: ['base', 'verify'] },
    ].map((task, index) => ({ ...task, parentId: index ? 'main' : undefined, status: 'pending', completedSteps: 0,
      totalSteps: index + 1, steps: Array.from({ length: index + 1 }, (_, n) => ({
        id: `custom:${n}`, title: `Stage ${n + 1}`, status: 'pending', model: 'test-model',
      })) }));
    const report = { version: 1, startedAt: '', tasks };
    await page.setContent(`<html><body><main id="content">${nestedFlow(report, 'test')}</main></body></html>`);
    await page.addStyleTag({ content: 'body { --vscode-editor-background: #181818; --vscode-foreground: #eee; --vscode-descriptionForeground: #bbb; --border: #555; --surface: #202020; font: 14px sans-serif; margin: 20px; background: #181818; color: #eee; }' });
    for (const file of ['task.css', 'nested-flow.css']) await page.addStyleTag({ content: await readFile(resolve(__dirname, '../media', file), 'utf8') });
    for (const file of ['nested-flow.js', 'flow-layout.js']) await page.addScriptTag({ path: resolve(__dirname, '../media', file) });
    await page.evaluate(() => window.maestrunNestedFlow.restore());
    await mkdir(resolve(__dirname, '../.vscode-test'), { recursive: true });
    for (const width of [1440, 760]) for (const mode of ['tasks', 'steps']) for (const direction of ['horizontal', 'vertical']) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator(`[data-flow-mode=${mode}]`).click();
      await page.locator(`[data-flow-direction=${direction}]`).click();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await checkGeometry(page, direction);
      if (mode === 'tasks' || width === 760) await page.screenshot({ path: resolve(__dirname, `../.vscode-test/dependencies-${width}-${mode}-${direction}.png`) });
    }
    await page.locator('.nested-scroll').evaluate((node) => { node.scrollLeft = 100; });
    const state = await page.evaluate(() => window.maestrunNestedFlow.capture());
    await page.locator('#content').evaluate((node, html) => { node.innerHTML = html; }, nestedFlow(report, 'test'));
    await page.evaluate((state) => window.maestrunNestedFlow.restore(state), state);
    assert.equal(await page.locator('.nested-flow').getAttribute('data-mode'), 'steps');
    assert.equal(await page.locator('.nested-scroll').evaluate((node) => node.scrollLeft), state.test.left);
    assert.deepEqual(errors, []);
    console.log('Dependency flow browser checks passed: all 7 edges, 6 unique tasks, horizontal/vertical, simple/detailed, 1440/760px, updates and scroll.');
  } finally { await browser.close(); }
}

async function checkGeometry(page, direction) {
  const result = await page.evaluate(() => {
    const bounds = document.querySelector('.flow-graph').getBoundingClientRect();
    const cards = Object.fromEntries([...document.querySelectorAll('.nested-task')].map((node) => {
      const r = node.getBoundingClientRect();
      return [node.dataset.taskId, { x: r.x - bounds.x, y: r.y - bounds.y, right: r.right - bounds.x, bottom: r.bottom - bounds.y }];
    }));
    const edges = [...document.querySelectorAll('.dependency-edges > path')].map((path) => ({
      from: path.dataset.from, to: path.dataset.to,
      points: [...path.getAttribute('d').split('m')[0].matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]),
    }));
    return { cards, edges, pageFits: document.documentElement.scrollWidth <= innerWidth };
  });
  assert.equal(Object.keys(result.cards).length, 6);
  assert.equal(result.edges.length, 7);
  assert.ok(result.pageFits, 'only the diagram scrolls');
  for (const edge of result.edges) {
    const from = result.cards[edge.from], to = result.cards[edge.to];
    assert.ok(direction === 'vertical' ? from.bottom < to.y : from.right < to.x, `${edge.from} must precede ${edge.to}`);
    for (let i = 1; i < edge.points.length; i++) {
      const [x1, y1] = edge.points[i - 1], [x2, y2] = edge.points[i];
      for (const [id, card] of Object.entries(result.cards)) {
        const crosses = x1 === x2
          ? x1 > card.x + 0.5 && x1 < card.right - 0.5 && Math.max(y1, y2) > card.y + 0.5 && Math.min(y1, y2) < card.bottom - 0.5
          : y1 > card.y + 0.5 && y1 < card.bottom - 0.5 && Math.max(x1, x2) > card.x + 0.5 && Math.min(x1, x2) < card.right - 0.5;
        assert.ok(!crosses, `${edge.from} → ${edge.to} crosses ${id}`);
      }
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
