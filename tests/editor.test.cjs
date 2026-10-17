const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp, mkdir, writeFile, rm, symlink} = require('node:fs/promises');
const {join} = require('node:path');
const {tmpdir} = require('node:os');
const {randomUUID} = require('node:crypto');
const {editorContent} = require('../dist/editor-content');
const {executionLog, taskConversation, workerLog} = require('../dist/execution-log');
const {discoverCatalog, validModelSelection} = require('../dist/model-catalog');
const {taskContent} = require('../dist/task-content');
const task = {id:'one',title:'Example',status:'running',step:'testing',model:'test-model',effort:'high',completedSteps:1,totalSteps:2,
 tokenUsage:{inputTokens:1200,outputTokens:40}, tokenUsageIncomplete:true, steps:[
 {id:'implementation',title:'Implementation',status:'completed',summary:'Implementation result'},
 {id:'testing',title:'Tests',status:'running',summary:'Test result',tokenUsage:{inputTokens:200,outputTokens:4}}
 ]};
const report={version:1,startedAt:'',tasks:[task]};
test('step details format structured results and logs as escaped tables with logs collapsed',()=>{
 const result={status:'completed',summary:'Verified <script>alert(1)</script>',tokenUsage:{inputTokens:0},checks:[{name:'Unit tests',passed:false}],warnings:[]};
 const step={...task.steps[0],summary:JSON.stringify(result)};
 const html=taskContent({task,step,project:'/project',conversation:{active:false,messages:[
  {id:'1',role:'model',text:'```json\n'+JSON.stringify(result)+'\n```'},
  {id:'2',role:'model',text:'Plain output <img src=x>'}
 ]}});
 assert.match(html,/<th scope="col">Model<\/th>/);
 assert.match(html,/<th scope="row">Token Usage \/ input Tokens<\/th><td>0<\/td>/i);
 assert.match(html,/<th scope="row">Checks \/ 1 \/ passed<\/th><td>false<\/td>/);
 assert.match(html,/<th scope="row">Warnings<\/th><td>None<\/td>/);
 assert.match(html,/<details class="detail-section step-logs"[^>]*><summary>Step logs \(2\)<\/summary>/);
 assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
 assert.doesNotMatch(html,/<script>|<img|&quot;status&quot;|```json/);
 assert.match(html,/<pre>Plain output &lt;img src=x&gt;<\/pre>/);
 assert.match(html,/Verified &lt;script&gt;/);
});
test('editor tasks and flow are separate views with CLI fields and a step inspector only after selection',()=>{
 const table=editorContent(report,'/project',undefined,'Details','one','tasks');
 for(const label of ['Tokens in / out','Stage','Status','Steps','1,200 / 40 *','test-model','Tests'])assert.ok(table.includes(label));
 assert.ok(!table.includes('class="flowchart'));
 const flow=editorContent(report,'/project',undefined,'Step info','one','flow');
 assert.ok(flow.includes('class="flowchart'));
 assert.ok(!flow.includes('detailed-task-table'));
 assert.ok(!flow.includes('step-inspector'));
 assert.ok(editorContent(report,'/project',undefined,'Step info','one','flow','testing').includes('step-inspector'));
});
test('execution log includes actual step results and conversations even when run.log is empty',async(t)=>{
 const cwd=await mkdtemp(join(tmpdir(),'maestrun-log-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 await mkdir(join(cwd,'.maestrun/conversations'),{recursive:true});await writeFile(join(cwd,'.maestrun/run.log'),'');
 const id=randomUUID();await writeFile(join(cwd,`.maestrun/conversations/${id}.json`),JSON.stringify({active:true,messages:[{id:'m',role:'model',text:'Current model output'}]}));
 const current={...task,conversationId:id};
 const logs=await executionLog({...report,tasks:[current]},cwd);
 assert.match(logs,/Implementation result/);assert.match(logs,/Test result/);assert.match(logs,/Current model output/);
 assert.equal((logs.match(/Current model output/g)||[]).length,1,'active conversation is only attributed to the current step');
 assert.equal((await taskConversation(cwd,current,current.steps[0])).conversation,undefined);
 await writeFile(join(cwd,'.maestrun/run.log'),'Worker diagnostic');assert.match(await executionLog(report,cwd),/Worker diagnostic/);
 await rm(join(cwd,'.maestrun/run.log'));await symlink('/etc/hosts',join(cwd,'.maestrun/run.log'));await assert.rejects(workerLog(cwd));
});
test('catalog only discovers ready CLIs, handles unavailable ones, and validates per-model effort',async()=>{
 const calls=[];
 const runtime={call:async(path,name,args)=>{if(name==='detectExecutors')return[{id:'codex',state:'ready'},{id:'claude',state:'unauthenticated',nextAction:'Sign in'},{id:'copilot',state:'ready'}];calls.push(args[0]);if(args[0]==='copilot')throw Error('Offline');return[{id:'precise',name:'Precise',efforts:['low','high']},{id:'fast',name:'Fast',efforts:[]}];}};
 const catalog=await discoverCatalog(runtime,'/tmp',new AbortController().signal);
 assert.deepEqual(calls,['codex','copilot']);assert.equal(catalog[1].available,false);assert.match(catalog[2].message,/Offline/);
 assert.equal(validModelSelection({executor:'codex',model:'precise',effort:'high'},catalog),true);
 assert.equal(validModelSelection({executor:'codex',model:'precise',effort:'ultra'},catalog),false);
 assert.equal(validModelSelection({executor:'codex',model:'fast',effort:'low'},catalog),false);
 assert.equal(validModelSelection({executor:'codex',model:'fast'},catalog),true);
});
