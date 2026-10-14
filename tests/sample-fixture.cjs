const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { fakeExecutors } = require('./runtime-fixture.cjs');

async function sampleExecutor(cwd) {
  const bin = await fakeExecutors(cwd);
  const file = join(bin, 'codex');
  const script = await readFile(file, 'utf8');
  await writeFile(file, script.replace(" const data=", `
 const emit=value=>console.log(JSON.stringify(value));
 if(request.method==='thread/start'){emit({id:request.id,result:{thread:{id:'sample-thread'}}});return;}
 if(request.method==='turn/start'){
   const prompt=request.params.input[0].text;
   const result=prompt.startsWith('Run only the Implementation stage for task sample-confirmation:') && !prompt.includes('Earlier questions and user answers:')
     ? {status:'needs_input',question:'Type continue to approve.',summary:'Waiting for simulated approval.'}
     : prompt.startsWith('Run only the Implementation stage for task sample-missing-input:')
       ? {status:'failed',summary:'Intentional missing input'} : {status:'completed',summary:'Example verified'};
   emit({id:request.id,result:{turn:{id:'sample-turn'}}});
   setTimeout(()=>{
     emit({method:'item/completed',params:{item:{type:'agentMessage',id:'result',text:JSON.stringify(result)}}});
     emit({method:'turn/completed',params:{turn:{status:'completed'}}});
   },100);
   return;
 }
 const data=`));
  return bin;
}

function sampleAnswer(mode, confirm = true) {
  return async prompt => {
    if (prompt.title === 'Choose an example') return { value: mode };
    if (prompt.kind === 'confirm') return { value: confirm };
    const choices = prompt.choices?.filter(choice => !choice.disabled) ?? [];
    for (const value of ['codex', 'test-model', 'low'])
      if (choices.some(choice => choice.value === value)) return { value };
    if (choices.some(choice => choice.value === prompt.initial)) return { value: prompt.initial };
    throw Error(`Unexpected example prompt: ${JSON.stringify(prompt)}`);
  };
}
module.exports = { sampleExecutor, sampleAnswer };
