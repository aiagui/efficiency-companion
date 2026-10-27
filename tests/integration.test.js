import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, bash, read, noisy } from './harness.js';
const call = {tool:'Bash',command:'npm test'};
const readCall = {tool:'Read',file_path:'/test/a.txt'};
const file = 'const stable = "useful code";\n'.repeat(200);
const stats = async h => JSON.parse((await h.command('efficiency-stats', 'json')).text);

test('rewrites schema, discards core ref, archives exact original and retains contexts', async () => {
 const h = await harness(); const original = bash(noisy());
 const out = await h.tool(call, original,{context:['another plugin note']});
 assert.equal(out.ref,undefined); assert.equal(out.text,undefined);
 assert.deepEqual(out.context,['another plugin note']); assert.equal(out.result.interrupted,false);
 const id = out.result.stdout.match(/original: \/efficiency-original ([a-f0-9-]+)/)[1];
 const recovered = await h.command('efficiency-original',id);
 assert.deepEqual(JSON.parse(recovered.context[0]),original);
 assert.equal((await stats(h)).outputsCompressed,1); assert.equal(h.calls(),1);
});
test('duplicate reads are checked after permission chain; changes, ranges and loops re-send', async () => {
 const h=await harness();
 const first=await h.tool(readCall,read(file)); assert.equal(first.ref,7);
 const second=await h.tool(readCall,read(file)); assert.ok(second.result.file.content.includes('Unchanged'));
 assert.equal(h.calls(),2); assert.equal((await stats(h)).duplicateReadsAvoided,1);
 assert.equal((await h.tool({...readCall,offset:2},read(file))).ref,7);
 assert.equal((await h.tool({...readCall,agentId:'other'},read(file))).ref,7);
 assert.equal((await h.tool(readCall,read(file.replace('stable','change')))).ref,7);
});
test('same size file change never becomes a duplicate', async () => {
 const h=await harness(); await h.tool(readCall,read(file));
 assert.equal((await h.tool(readCall,read(file.replaceAll('stable','change')))).ref,7);
});
test('cache clears on compaction, new session and bypass', async () => {
 const h=await harness(); await h.tool(readCall,read(file));
 await h.emit('session.compact',{trigger:'manual',messages:[]},async()=>({messages:[]}));
 assert.equal((await h.tool(readCall,read(file))).ref,7);
 h.setId('new'); assert.equal((await h.tool(readCall,read(file))).ref,7);
 await h.command('efficiency-bypass'); assert.equal((await h.tool(readCall,read(file))).ref,7);
 assert.equal((await stats(h)).bypassed,1);
});
test('in-flight read cannot seed pre-compaction content', async () => {
 const h=await harness(); let release;
 const pending=h.emit('tool.call',readCall,()=>new Promise(r=>release=r));
 await h.emit('session.compact',{trigger:'auto',messages:[]},async()=>({messages:[]}));
 release({result:read(file),ref:7}); await pending;
 assert.equal((await h.tool(readCall,read(file))).ref,7);
});
test('archive write failure, archive cap, denial and error return exact core object', async () => {
 for (const options of [{archiveBudgetBytes:1},{}]) {
  const h=await harness(options); if (!options.archiveBudgetBytes) h.failStore();
  assert.equal((await h.tool(call,bash(noisy()))).ref,7);
 }
 const h=await harness();
 assert.equal((await h.tool(call,bash(noisy()),{isError:true})).ref,7);
 assert.equal((await h.tool(call,bash(noisy()),{deny:'blocked'})).deny,'blocked');
});
test('images, backgrounds, raw output handles, interrupted results are untouched', async () => {
 const h=await harness();
 for (const field of [{isImage:true},{interrupted:true},{backgroundTaskId:'task'},{rawOutputPath:'/raw'},{timedOutAfterMs:5},{backgroundedByUser:true}]) {
  assert.equal((await h.tool(call,{...bash(noisy()),...field})).ref,7);
 }
 assert.equal((await h.tool(readCall,{type:'image',file:{base64:'data'}})).ref,7);
});
test('stderr unchanged and every non-content Bash field survives rewrite', async () => {
 const h=await harness(); const original={...bash(noisy()),stderr:'fatal detail',extraStatus:42};
 const out=await h.tool(call,original); assert.equal(out.result.stderr,original.stderr); assert.equal(out.result.extraStatus,42);
});
test('observe mode changes no outputs, counts only potential savings, tracks duplicates', async () => {
 const h=await harness({mode:'observe'});
 assert.equal((await h.tool(call,bash(noisy()))).ref,7);
 await h.tool(readCall,read(file)); assert.equal((await h.tool(readCall,read(file))).ref,7);
 const m=await stats(h); assert.equal(m.bytesRemoved,0); assert.equal(m.duplicateReadsAvoided,0); assert.ok(m.potentialBytesSaved>0);
 assert.equal([...h.backing.keys()].some(k=>k.startsWith('original:')),false);
});
test('telemetry is numeric and contains no command, path, secret or raw text', async () => {
 const h=await harness(); await h.tool(call,bash(noisy()));
 const stored=h.backing.get('metrics:test-session');
 assert.ok(!JSON.stringify(stored).includes('DATABASE_URL')); assert.ok(!JSON.stringify(stored).includes('npm test'));
 assert.ok(stored.beforeBytes>stored.afterBytes);
});
test('telemetry can be disabled, while recoverable local originals still exist', async () => {
 const h=await harness({telemetry:false}); await h.tool(call,bash(noisy()));
 assert.equal([...h.backing.keys()].some(k=>k.startsWith('metrics:')),false);
 assert.equal([...h.backing.keys()].some(k=>k.startsWith('original:')),true);
});
test('parallel duplicate processing is serialized without changing tool execution count', async () => {
 const h=await harness();
 const out=await Promise.all(Array.from({length:5},()=>h.tool(readCall,read(file))));
 assert.equal(h.calls(),5); assert.equal((await stats(h)).duplicateReadsAvoided,4);
 assert.equal(out[0].ref,7);
});
test('guard proposes review with cooldown; never compacts or calls a model', async () => {
 const h=await harness();h.setTurns(31);
 await h.emit('session.measure',{context:{percent:80}},async()=>({changed:['context']}));
 await h.emit('session.measure',{context:{percent:81}},async()=>({changed:['context']}));
 assert.equal(h.logs.length,0); assert.equal((await stats(h)).guardNotices,1);
});
test('purge is explicit, removes originals and resets duplicate cache', async () => {
 const h=await harness(); await h.tool(readCall,read(file));
 await h.command('efficiency-purge'); assert.ok(h.backing.size>0);
 await h.command('efficiency-purge','confirm'); assert.equal(h.backing.size,0);
 assert.equal((await h.tool(readCall,read(file))).ref,7);
});
test('redaction keeps an exact raw local original', async () => {
 const h=await harness({redactSecrets:true}); const original=bash('password=supersecret');
 const out=await h.tool(call,original);
 assert.ok(!out.result.stdout.includes('supersecret'));
 const archive=[...h.backing.values()].find(v=>v.result); assert.equal(archive.result.stdout,original.stdout);
});
test('recovery overhead reduces the claimed savings', async () => {
 const h=await harness(); const out=await h.tool(call,bash(noisy()));
 const before=(await stats(h)).bytesRemoved;
 const id=out.result.stdout.match(/original: \/efficiency-original ([a-f0-9-]+)/)[1];
 await h.command('efficiency-original',id);
 assert.ok((await stats(h)).bytesRemoved<before); assert.equal((await stats(h)).originalsRecovered,1);
});
test('redaction also covers stderr when output is eligible', async () => {
 const h=await harness({redactSecrets:true});
 const out=await h.tool(call,{...bash('ok'),stderr:'password=supersecret'});
 assert.ok(!out.result.stderr.includes('supersecret'));
});
test('default stats are readable while JSON remains available for tools', async () => {
 const h=await harness();
 const ready=await h.command('efficiency-stats');
 assert.ok(ready.text.includes('Ready when you are.'));
 assert.ok(!ready.text.includes('"schemaVersion"'));
 await h.tool(call,bash(noisy()));
 const summary=await h.command('efficiency-stats');
 assert.ok(summary.text.includes('Estimated tool-output reduction:'));
 assert.ok(summary.text.includes('Original retrieval overhead is included.'));
 assert.equal((await stats(h)).outputsCompressed,1);
});

test('companion nudges on repeated composer wording, snoozes, and preserves prompts', async () => {
 const h = await harness();
 const prompt = {text:'Please review the deployment configuration and explain the remaining production blockers.',origin:{kind:'composer'}};
 let forwarded=0;
 for(let i=0;i<2;i++) await h.emit('prompt.submit',prompt,async e=>{assert.equal(e,prompt);forwarded++;return {text:e.text};});
 const panel=()=>h.emit('ui.render',{component:'AbovePrompt'});
 assert.match(JSON.stringify(await panel()),/same message more than once/);
 const tree=await panel(); const flatten=t=>[t,...(t.children||[]).flatMap(c=>typeof c==='object'?flatten(c):[])]; await flatten(tree).find(c=>c.key==='later').onPress();
 assert.doesNotMatch(JSON.stringify(await panel()),/same message more than once/);
 h.setTurns(6); await h.emit('session.measure',{context:{percent:80}});
 await h.emit('prompt.submit',prompt,async()=>({}));
 assert.match(JSON.stringify(await panel()),/same message more than once/);
 assert.equal(forwarded,2);
});
test('companion compaction button requires affirmative choice and catches busy sessions', async () => {
 const h = await harness(); let compacts=0;
 h.api.session.compact=async()=>{compacts++;throw new Error('turn running');};
 await h.emit('session.measure',{context:{percent:80}});
 const tree=await h.emit('ui.render',{component:'AbovePrompt'});
 const flatten=t=>[t,...(t.children||[]).flatMap(c=>typeof c==='object'?flatten(c):[])];
 const press=flatten(tree).find(c=>c.key==='stay-here').onPress;
 await press(); assert.equal(compacts,0);
 h.api.ui.ask=async()=> 'Make room'; await press(); assert.equal(compacts,1);
 const after=await h.emit('ui.render',{component:'AbovePrompt'});
 assert.match(JSON.stringify(after),/Let Claude finish/);
});

test('a rejected command cannot prevent subsequent commands or panel startup', async () => {
 const h=await harness(); const registered=[]; let opened=0;
 h.api.command.register=async spec=>{if(spec.name==='efficiency-draft')throw new Error('name rejected');registered.push(spec.name);};
 h.api.ui.open=async()=>{opened++;};
 await h.emit('session.start',{isInteractive:true,surface:'desktop'});
 assert.ok(registered.includes('efficiency-open'));
 assert.ok(registered.includes('efficiency-purge'));
 assert.equal(opened,0);
 assert.match(h.logs.join('\n'),/Could not register \/efficiency-draft/);
});
