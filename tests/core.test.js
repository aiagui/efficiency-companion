import test from 'node:test';
import assert from 'node:assert/strict';
import { slim, DEFAULTS, hash, redact, bytes, configuration, guard, handoff } from '../src/core.js';
import { noisy } from './harness.js';

test('retains every diagnostic and unknown line while removing recognized passing logs', () => {
 const input = noisy() + '\nImportant requirement: keep stable schema';
 const out = slim(input, DEFAULTS).text;
 for (const line of ['ERROR: missing DATABASE_URL','  at connect (src/db.js:42:8)','1 failed, 400 passed','Important requirement: keep stable schema']) assert.ok(out.includes(line));
 assert.ok(bytes(out) < bytes(input) * .15);
});
test('JSON values/types remain exact, including nested arrays and errors', () => {
 const obj = { records: Array.from({length:100}, (_,i)=>({id:i, flags:[false,null,'x'], message:'error details'})) };
 assert.deepEqual(JSON.parse(slim(JSON.stringify(obj,null,4), DEFAULTS).text), obj);
});
test('diff untouched by default; opt-in preserves every changed line and hunk', () => {
 const diff = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n' + ' context\n'.repeat(500);
 assert.equal(slim(diff,DEFAULTS).text,diff);
 const out = slim(diff,{...DEFAULTS,diffContextReduction:true}).text;
 for (const line of diff.split('\n').filter(l=>l.startsWith('+')||l.startsWith('-')||l.startsWith('@@'))) assert.ok(out.includes(line));
});
test('unknown text and complete tracebacks are not discarded', () => {
 const text = 'Traceback (most recent call last):\n File "app.py", line 8\n  surprising_value()\nValueError: invalid value\n' + 'unknown critical information\n'.repeat(200);
 assert.equal(slim(text,DEFAULTS).text,text);
});
test('SHA256 distinguishes equal-length changes and supports Unicode', async () => {
 assert.equal(await hash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 assert.notEqual(await hash('áx'),await hash('áy')); assert.equal(bytes('á'),2);
});
test('optional secret patterns redact and maintain JSON parseability', () => {
 const text = '{"api_key":"sensitive","password":"private"}';
 assert.deepEqual(JSON.parse(redact(text)), {api_key:'[REDACTED]',password:'[REDACTED]'});
 assert.equal(redact('Authorization: Bearer abc.def'), 'Authorization: Bearer [REDACTED]');
});
test('config bounds invalid inputs and guard tolerates absent context data', () => {
 assert.equal(configuration({minBytes:-1}).minBytes,2048);
 assert.equal(configuration({mode:'weird'}).mode,'observe');
 assert.deepEqual(guard({},0,0,DEFAULTS),[]);
 assert.equal(guard({percent:80},31,4,DEFAULTS).length,3);
});
test('handoff is explicitly a reviewable draft and redaction is optional', () => {
 const text = handoff([{role:'user',text:'password=private',toolUses:[]}],{...DEFAULTS,redactSecrets:true});
 assert.ok(text.includes('[review]')); assert.ok(!text.includes('private'));
});
test('JSON whitespace reduction preserves large integers, numeric spelling, escapes and strings', () => {
 const raw = '{ "id": 9007199254740993, "zero": -0, "precise": 0.123456789012345678901234, "exponent": 1e99, "value": "keep \\" spaces" }';
 const out=slim(raw,{...DEFAULTS,minBytes:1}).text;
 assert.equal(out,'{"id":9007199254740993,"zero":-0,"precise":0.123456789012345678901234,"exponent":1e99,"value":"keep \\" spaces"}');
});
