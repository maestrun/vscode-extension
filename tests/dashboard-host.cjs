const vscode = require('vscode');
const assert = require('node:assert/strict');
const {join, resolve} = require('node:path');
const {writeFile, readFile, rm, mkdir} = require('node:fs/promises');
const {randomUUID} = require('node:crypto');
const {runBridge} = require('../dist/bridge');
const {waitFor} = require('./runtime-fixture.cjs');

async function checkDashboard(frame, folder) {
  const cwd=folder.uri.fsPath;
  const planPath=join(cwd,'plan.md'), configPath=join(cwd,'.maestrun/config.json'), reportPath=join(cwd,'.maestrun/run.json');
  const original=await readFile(planPath,'utf8'), originalConfig=await readFile(configPath,'utf8');
  const config=JSON.parse(originalConfig);
  config.stages=['planning','implementation','testing','review','custom:Documentation','custom:Release','custom:Observe','custom:Verify'].map(id=>({id,executor:'codex',model:'test-model',effort:'high'}));
  await writeFile(configPath,JSON.stringify(config));
  const titles=['Build the workflow','Stream execution logs','Verify keyboard navigation'];
  await writeFile(planPath,'## Tasks\n\n'+titles.map((title,index)=>`### Task task-${index+1}: ${title}\n\n- Depends on: ${index?'task-1':'none'}\n\nImplement ${title}.\n`).join('\n'));
  const preview=await runBridge({cwd,action:'preview',executable:process.env.MAESTRUN_TEST_EXECUTABLE,node:process.env.MAESTRUN_TEST_NODE,tasksPath:'plan.md',worker:resolve(__dirname,'../dist/bridge-worker.js')});
  const conversationId=randomUUID();
  const report={...preview,tasks:preview.tasks.map((task,index)=>({...task,status:['completed','running','failed'][index],step:'testing',executor:'codex',model:'test-model',effort:'high',completedSteps:index===0?7:1,
    tokenUsage:{inputTokens:1200,outputTokens:80},tokenUsageIncomplete:index===2,conversationId:index===1?conversationId:undefined,
    steps:task.steps.map((step,i)=>({...step,status:i===0?'completed':i===1&&index===1?'refactor':'pending',summary:i===0?'Implemented and verified':'',tokenUsage:{inputTokens:600,outputTokens:40}})),
    error:index===2?'Keyboard check failed':undefined}))};
  await mkdir(join(cwd,'.maestrun/conversations'),{recursive:true});
  const conversationFile=join(cwd,`.maestrun/conversations/${conversationId}.json`);
  const conversation={active:true,messages:[{id:'m1',role:'model',text:'Live output from the testing step'}]};
  await writeFile(conversationFile,JSON.stringify(conversation));
  await writeFile(reportPath,JSON.stringify(report));await vscode.commands.executeCommand('maestrun.refresh');
  await frame.getByRole('button',{name:titles[1],exact:true}).waitFor();
  const headers=await frame.locator('.detailed-task-table th').allTextContents();
  for(const name of ['Tokens in / out','Status','Stage','Model','Effort','Steps'])assert.ok(headers.includes(name));
  assert.match(await frame.locator('.detailed-task-table').innerText(),/1,200 \/ 80/);
  await frame.getByRole('button',{name:titles[1],exact:true}).click();
  await frame.locator('#detail-title').filter({hasText:titles[1]}).waitFor();
  assert.equal(await frame.locator('.step-table tbody tr').count(),7);
  await frame.locator('.filters [data-filter=attention]').click();assert.equal(await frame.locator('.task-row:visible').count(),1);
  await frame.locator('.filters [data-filter=all]').click();await frame.locator('#task-sort').selectOption('status');
  assert.equal(await frame.locator('.task-row').first().getAttribute('data-status'),'running');
  await frame.locator('#task-filter').fill('no match');await frame.getByRole('button',{name:'Clear filters',exact:true}).click();
  await frame.locator('#task-filter').fill('Stream');
  await frame.getByRole('button',{name:'Flowchart',exact:true}).click();
  await frame.locator('#project-flow').waitFor();
  assert.equal(await frame.locator('.detailed-task-table').count(),0,'flow mode has no task table');
  assert.equal(await frame.locator('#task-detail').count(),0,'flow initially shows only the chart');
  const positions = () => frame.locator('.flow-node').evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
  }));
  await waitFor(async () => { const boxes = await positions(); return boxes[0].y === boxes[1].y && boxes[1].x > boxes[0].x; });
  const wide = await positions();
  const columns = wide.filter((box) => box.y === wide[0].y).length;
  assert.ok(columns >= 2 && columns < wide.length);
  assert.equal(wide[columns].x, wide[columns - 1].x, 'next row starts below the previous row endpoint');
  assert.ok(wide[columns + 1].x < wide[columns].x, 'second row returns right to left');
  if (wide.length > columns * 2 + 1) assert.ok(wide[columns * 2 + 1].x > wide[columns * 2].x, 'third row goes left to right');
  await frame.page().screenshot({path:resolve(__dirname,'../.vscode-test/flow-zigzag.png')});
  await frame.locator('.flow-node[data-step-id=testing]').click();
  await frame.locator('#detail-title').filter({hasText:'Tests'}).waitFor();
  await frame.getByText('Live output from the testing step',{exact:true}).waitFor();
  assert.equal(await frame.locator('.flow-node').count(),7,'chart remains available above the step inspector');
  conversation.messages.push({id:'m2',role:'model',text:'<img src=x onerror=alert(1)> Keep logs as text.'});
  await writeFile(conversationFile,JSON.stringify(conversation));await vscode.commands.executeCommand('maestrun.refresh');
  await frame.getByText('<img src=x onerror=alert(1)> Keep logs as text.',{exact:true}).waitFor();
  assert.equal(await frame.locator('#task-detail img').count(),0);
  await frame.page().screenshot({path:resolve(__dirname,'../.vscode-test/editor-flow.png')});
  await frame.getByRole('button',{name:'Close step details',exact:true}).click();
  await frame.locator('#task-detail').waitFor({state:'detached'});
  await frame.locator('#flow-task-selector').selectOption('task-3');
  await waitFor(async()=>await frame.locator('.dashboard').getAttribute('data-selection')==='task-3');
  await frame.getByRole('button',{name:'Detailed tasks',exact:true}).click();
  await frame.locator('#task-filter').waitFor();assert.equal(await frame.locator('#task-filter').inputValue(),'Stream','filters survive mode changes');
  await frame.locator('#task-filter').fill('');
  await frame.page().screenshot({path:resolve(__dirname,'../.vscode-test/editor-tasks.png')});
  const themes=vscode.workspace.getConfiguration('workbench');const previous=themes.get('colorTheme');
  for(const [name,theme,cls] of [['dark','Default Dark Modern','vscode-dark'],['light','Default Light Modern','vscode-light'],['contrast','Default High Contrast','vscode-high-contrast']]){
    await themes.update('colorTheme',theme,vscode.ConfigurationTarget.Global);await frame.locator(`body.${cls}`).waitFor();
    assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name}: no page overflow`);
    await frame.page().screenshot({path:resolve(__dirname,`../.vscode-test/dashboard-${name}.png`)});
  }
  await frame.page().setViewportSize({width:740,height:900});
  assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'table scrolls inside narrow editor');
  await frame.getByRole('button',{name:'Flowchart',exact:true}).click();await frame.locator('#flow-task-selector').selectOption('task-2');await frame.locator('.flow-node').first().click();
  await frame.locator('#detail-title').waitFor();
  assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'narrow flow has no page overflow');
  await waitFor(async () => { const boxes = await positions(); return boxes.every((box) => Math.abs(box.x - boxes[0].x) < 1); });
  const narrow = await positions();
  assert.ok(narrow.slice(1).every((box, i) => box.y >= narrow[i].bottom), 'single-column layout preserves step order without overlap');
  assert.ok(await frame.locator('.repair-connector path').getAttribute('d'), 'repair connection is redrawn after resizing');
  await frame.page().screenshot({path:resolve(__dirname,'../.vscode-test/flow-narrow.png')});
  await frame.getByRole('button',{name:'Detailed tasks',exact:true}).click();
  await frame.page().setViewportSize({width:1440,height:1000});await themes.update('colorTheme',previous,vscode.ConfigurationTarget.Global);
  await rm(reportPath);await writeFile(planPath,'Invalid plan');await vscode.commands.executeCommand('maestrun.refresh');
  await frame.locator('.error-banner').waitFor();await frame.getByRole('heading',{name:'Tasks are unavailable',exact:true}).waitFor();
  await writeFile(configPath,originalConfig);await writeFile(planPath,original);await vscode.commands.executeCommand('maestrun.refresh');
  await waitFor(async()=>await frame.locator('.task-row').count()===2);
}
module.exports={checkDashboard};
