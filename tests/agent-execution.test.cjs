const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { existsSync } = require('node:fs');
const { mkdir, readFile, writeFile, chmod } = require('node:fs/promises');
const { join, delimiter } = require('node:path');
const { fixture, executable, json, waitFor } = require('./runtime-fixture.cjs');

async function prepareAgents(cwd) {
  await mkdir(join(cwd, 'agents'));
  await writeFile(join(cwd, 'agents/backend.md'), '---\nmodel: gpt-6.1-sol\nreasoning_effort: xhigh\n---\nImplement backend only.');
  await writeFile(join(cwd, 'agents/tests.md'), '---\nmodel: gpt-6-luna\nreasoning_effort: max\n---\nVerify backend only.');
  await writeFile(join(cwd, '.maestrun/config.json'), JSON.stringify({ version: 1,
    stages: [{ id: 'planning', executor: 'codex', model: 'planning-model' }],
    execution: { mode: 'sequential', concurrency: 1, orchestrator: 'plan', maxRepairs: 0 }, plugins: [] }));
  await writeFile(join(cwd, 'plan.md'), `### Task backend: Backend
- Depends on: none
- Steps: implementation, custom:Backend tests
- Agents: {"implementation":"agents/backend.md","custom:Backend tests":"agents/tests.md"}

Implement and test the API.

### Task docs: Documentation
- Depends on: backend
- Steps: custom:Document

Document the API without changing executable behavior.
`);
  const path = join(cwd, '.fixture-bin/codex');
  await writeFile(path, String.raw`#!${process.execPath}
const {appendFileSync}=require('node:fs');
const emit=value=>console.log(JSON.stringify(value));
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);
 if(request.id===undefined)return;
 if(request.method==='thread/start') { emit({id:request.id,result:{thread:{id:'test-thread'}}});return; }
 if(request.method!=='turn/start') {emit({id:request.id,result:{}});return;}
 appendFileSync(${JSON.stringify(join(cwd, 'rpc.jsonl'))},JSON.stringify(request.params)+'\n');
 emit({id:request.id,result:{turn:{id:'test-turn'}}});
 emit({method:'item/completed',params:{item:{type:'agentMessage',text:JSON.stringify({status:'completed',summary:'Fixture passed'})}}});
 emit({method:'turn/completed',params:{turn:{status:'completed'}}});
});`);
  await chmod(path, 0o755);
}

for (const entry of ['cli', 'extension']) test(`${entry} passes agent model and reasoning_effort through the executor protocol`, {
  skip: !existsSync(executable) && 'Build the CLI first.'
}, async (t) => {
  const { cwd, invoke } = await fixture(t);
  await prepareAgents(cwd);
  const previousPath = process.env.PATH;
  process.env.PATH = `${join(cwd, '.fixture-bin')}${delimiter}${previousPath ?? ''}`;
  try {
    const preview = await invoke('preview');
    assert.deepEqual(preview.tasks[1].steps.map(s => [s.model, s.effort]), [['gpt-6.1-sol', 'xhigh'], ['gpt-6-luna', 'max']]);
    if (entry === 'cli') await promisify(execFile)(process.execPath, [executable, 'run'], { cwd, timeout: 15000 });
    else {
      assert.equal((await invoke('run')).status, 'running');
      await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status !== 'running');
      assert.equal((await json(join(cwd, '.maestrun/session.json'))).status, 'completed');
    }
    const calls = (await readFile(join(cwd, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(c => [c.model, c.effort]), [['gpt-6.1-sol', 'xhigh'], ['gpt-6-luna', 'max'], ['planning-model', null]]);
    for (const call of calls) {
      const text = call.input[0].text;
      const profile = JSON.parse(text.split('\n').find(l => l.startsWith('Maestrun execution request: ')).slice('Maestrun execution request: '.length));
      assert.equal(profile.model, call.model);
      assert.equal(profile.effort, call.effort ?? 'executor default');
      assert.match(text, /process arguments and session files may not expose these settings/);
    }
    const report = await json(join(cwd, '.maestrun/run.json'));
    assert.ok(report.tasks.every(task => task.status === 'completed'));
    assert.deepEqual(report.tasks[1].steps.map(s => s.id), ['implementation', 'custom:Backend tests']);
    assert.deepEqual(report.tasks[2].steps.map(s => s.id), ['custom:Document']);
    const config = await json(join(cwd, '.maestrun/config.json'));
    assert.deepEqual(config.orchestration.tasks.map(task => task.id), ['backend', 'docs']);
    assert.deepEqual(config.orchestration.tasks[0].stages.map(s => [s.model, s.effort]), [['gpt-6.1-sol', 'xhigh'], ['gpt-6-luna', 'max']]);
    assert.deepEqual(config.orchestration.tasks[1].stages.map(s => [s.model, s.effort]), [['planning-model', null]]);
    const plan = await readFile(join(cwd, 'plan.md'), 'utf8');
    assert.match(plan, /- \[x\] backend: Backend/);
    assert.match(plan, /- \[x\] docs: Documentation/);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});
