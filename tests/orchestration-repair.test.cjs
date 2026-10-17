const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { writeFile, readFile, chmod } = require('node:fs/promises');
const { join, delimiter } = require('node:path');
const { fixture, executable, json, waitFor } = require('./runtime-fixture.cjs');

test('extension routes QA refactor to a specialist repair and updates the plan checklist', {
  skip: !existsSync(executable) && 'Build the CLI first.'
}, async t => {
  const { cwd, invoke } = await fixture(t);
  const tasks = [{ id: 'accept', title: 'Final acceptance', dependsOn: [], steps: ['qa'], instructions: 'Review only.' }];
  const repair = { id: 'repair', title: 'Repair frontend', dependsOn: [], repairFor: 'accept', steps: ['implementation', 'testing'], instructions: 'Repair and independently verify.' };
  await writeFile(join(cwd, '.maestrun/config.json'), JSON.stringify({ version: 1,
    stages: [{ id: 'planning', executor: 'codex', model: 'test-model' }],
    execution: { mode: 'sequential', concurrency: 1, orchestrator: 'agent', maxRepairs: 1 }, plugins: [] }));
  await writeFile(join(cwd, 'plan.md'), '### Task accept: Final acceptance\n- Depends on: none\n- Steps: qa\n\nReview only.\n');
  const cli = join(cwd, '.fixture-bin/codex');
  await writeFile(cli, String.raw`#!${process.execPath}
const {existsSync,writeFileSync,appendFileSync}=require('node:fs');
const emit=value=>console.log(JSON.stringify(value));
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line); if(request.id===undefined)return;
 if(request.method==='thread/start'){emit({id:request.id,result:{thread:{id:'fixture-thread'}}});return;}
 if(request.method!=='turn/start'){emit({id:request.id,result:{}});return;}
 const prompt=request.params.input[0].text;
 const task=prompt.match(/for task ([^:]+):/)[1];
 appendFileSync('calls.jsonl',JSON.stringify(task)+'\n');
 let result={status:'completed',summary:'Verified'};
 if(task==='__orchestrator__') result.summary=JSON.stringify(prompt.startsWith('Run only the Coordinate 3')?{done:true}:{done:false,tasks:prompt.startsWith('Run only the Coordinate 1')?${JSON.stringify(tasks)}:${JSON.stringify([...tasks, repair])}});
 else if(task==='repair')writeFileSync('repair.txt','Verified repair');
 else if(!existsSync('repair.txt'))result={status:'refactor',summary:'Frontend and independent visual verification need repair.'};
 emit({id:request.id,result:{turn:{id:'fixture-turn'}}});
 emit({method:'item/completed',params:{item:{type:'agentMessage',text:JSON.stringify(result)}}});
 emit({method:'turn/completed',params:{turn:{status:'completed'}}});
});`);
  await chmod(cli, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${join(cwd, '.fixture-bin')}${delimiter}${previous ?? ''}`;
  try {
    await invoke('run');
    await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status !== 'running');
    const session = await json(join(cwd, '.maestrun/session.json'));
    assert.equal(session.status, 'completed', session.error);
    const report = await json(join(cwd, '.maestrun/run.json'));
    assert.equal(report.orchestration.repairRounds, 1);
    assert.ok(report.tasks.every(task => task.status === 'completed'));
    assert.deepEqual((await readFile(join(cwd, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse), ['__orchestrator__', 'accept', '__orchestrator__', 'repair', 'repair', 'accept', '__orchestrator__']);
    const plan = await readFile(join(cwd, 'plan.md'), 'utf8');
    assert.match(plan, /- \[x\] accept: Final acceptance/);
    assert.match(plan, /- \[x\] repair: Repair frontend/);
    assert.equal((await invoke('preview')).orchestration.phase, 'complete');
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
});
