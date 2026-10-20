const { mkdtemp, mkdir, writeFile, rm, readFile, chmod } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { runBridge } = require('../dist/bridge');

const executable = process.env.MAESTRUN_TEST_EXECUTABLE ?? resolve(__dirname, '../../maestrun-cli/dist/main.js');
const plan = '## Tasks\n\n### Task task-1: First task\n\n- Depends on: none\n\nImplement the first change and verify it.\n\n### Task task-2: Second task\n\n- Depends on: task-1\n\nVerify the dependent change.\n';
const config = { version: 1, stages: [
  { id: 'planning', executor: 'codex', model: 'test-model' },
  { id: 'custom:Fixture', executor: 'codex', model: 'test-model' }
], execution: { mode: 'sequential', concurrency: 1, maxRepairs: 0 }, timeoutMs: 10000, plugins: ['./fixture.mjs'] };

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'maestrun-native-'));
  await prepare(cwd);
  const bin = await fakeExecutors(cwd);
  const invoke = async (action, options = {}) => {
    const previous = process.env.PATH;
    if (action === 'configure' || action === 'start') process.env.PATH = `${bin}:${previous}`;
    try { return await runBridge({ cwd, action, executable, node: process.execPath,
      onPrompt: async () => ({ value: 'all' }), tasksPath: 'plan.md', worker: resolve(__dirname, '../dist/bridge-worker.js'), ...options }); }
    finally { process.env.PATH = previous; }
  };
  t.after(async () => {
    const session = await json(join(cwd, '.maestrun/session.json'));
    if (session?.status === 'running') { await invoke('cancel'); await waitFor(async () => (await json(join(cwd, '.maestrun/session.json')))?.status !== 'running'); }
    await rm(cwd, { recursive: true, force: true });
  });
  return { cwd, invoke };
}

async function prepare(cwd) {
  await mkdir(join(cwd, '.maestrun'), { recursive: true });
  await writeFile(join(cwd, '.maestrun/config.json'), JSON.stringify(config));
  await writeFile(join(cwd, 'plan.md'), plan);
  await writeFile(join(cwd, 'fixture.mjs'), `import { existsSync } from 'node:fs';
export default { apiVersion: 1, name: 'test-fixture', stages: { 'custom:Fixture': async ({signal}) => {
  if (existsSync('hold')) await new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), {once:true});
  });
  return 'Verified by fixture';
} } };`);
}

async function json(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
}

async function waitFor(check) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for Maestrun state');
}

async function fakeExecutors(cwd) {
  const bin = join(cwd, '.fixture-bin'); await mkdir(bin, {recursive:true});
  const file = join(bin, 'codex');
  await writeFile(file, `#!${process.execPath}
const args=process.argv.slice(2);
if(args.includes('--version')) { console.log('fixture'); process.exit(0); }
if(args.includes('--help')) { console.log('--sandbox --json --ephemeral --ignore-user-config --ignore-rules'); process.exit(0); }
if(args.includes('status')) { console.log('Logged in'); process.exit(0); }
const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line); if(request.id===undefined)return;
 const data=['test-model','backend-model','updated-model','fast-model'].map((model,i)=>({model,displayName:model,isDefault:i===0,supportedReasoningEfforts:(i===3?[]:i===1?['low','high']:['low','medium','high']).map(reasoningEffort=>({reasoningEffort})),...(i===3?{}:{defaultReasoningEffort:i===1?'low':'medium'})}));
 console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,result:request.method==='model/list'?{data,nextCursor:null}:{}}));
});`);
  await chmod(file,0o755);
  for(const cli of ['claude','copilot','grok']) { const path=join(bin,cli);await writeFile(path,`#!${process.execPath}\nprocess.exit(1);\n`);await chmod(path,0o755); }
  return bin;
}

module.exports = { fakeExecutors, executable, config, plan, fixture, prepare, json, waitFor };
