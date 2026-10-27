import test from 'node:test';
import assert from 'node:assert/strict';
import { contextTone, barSvg, textBar, modelLabel, agentsLabel, tokensLabel, toneColor } from '../src/status.js';
import { pickTip } from '../src/tips.js';
import { harness } from './harness.js';

test('context colour follows the fill and the configured warning level', () => {
  assert.equal(contextTone(10), 'low');
  assert.equal(contextTone(50), 'mid');
  assert.equal(contextTone(75), 'warn');
  assert.equal(contextTone(95), 'high');
  assert.equal(contextTone(60, 60), 'warn');
  assert.equal(contextTone(undefined), 'unknown');
  assert.notEqual(toneColor('low'), toneColor('high'));
});
test('bar is a bounded, local SVG with a plain-English title', () => {
  assert.match(barSvg(42), /<title>Context 42% full<\/title>/);
  assert.match(barSvg(42), /width="30\.2"/);
  assert.match(barSvg(500), /width="72\.0"/);
  assert.ok(!/<script|href=/.test(barSvg(42)));
  assert.equal(textBar(50), '█████░░░░░');
});
test('labels are short and plain', () => {
  assert.equal(modelLabel('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(modelLabel('claude-opus-5-5[1m]'), 'Opus 5.5');
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelLabel(''), '');
  assert.equal(agentsLabel(0), '');
  assert.equal(agentsLabel(1), '1 agent working');
  assert.equal(agentsLabel(3), '3 agents working');
  assert.equal(tokensLabel(84000, 200000), '84k of 200k tokens');
});
test('the strip shows context, model and working agents, and clears them afterwards', async () => {
  const h = await harness();
  h.setTurns(0);
  const pass = async e => e;
  const stream = async function* (e) { return e; };
  const draw = async () => JSON.stringify(await h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined));
  await h.emit('session.measure', { context: { percent: 42, tokens: 84000, window: 200000 }, rateLimits: [], changed: ['context'] }, pass);
  await h.emit('turn.start', { text: 'go', turnId: 't' }, pass);
  let out = await draw();
  assert.match(out, /Context 42 percent full\. Plenty of room\./);
  assert.match(out, /Sonnet 5\.5/);
  assert.ok(out.includes('"42% used"'));
  assert.match(out, /Model: Sonnet 5\.5/);
  assert.ok(!/agent/.test(out.replace(/Your efficiency helper[^"]*/g, '')));
  await h.emit('turn.step', { agentId: 'a1', turnId: 't' }, stream);
  await h.emit('turn.step', { agentId: 'a2', turnId: 't' }, stream);
  assert.match(await draw(), /2 agents working/);
  await h.emit('turn.complete', { reason: 'answer', agentId: 'a1', answer: '', durationMs: 1, isAborted: false, turnId: 't' }, pass);
  assert.match(await draw(), /1 agent working/);
  await h.emit('turn.complete', { reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' }, pass);
  assert.doesNotMatch(await draw(), /agents? working/);
  await h.emit('session.measure', { context: { percent: 91, window: 200000 }, rateLimits: [], changed: ['context'] }, pass);
  assert.match(await draw(), /Almost full/);
});
test('terminal surface gets a text bar instead of an image', async () => {
  const h = await harness();
  await h.emit('session.measure', { context: { percent: 50, window: 1 }, rateLimits: [], changed: [] }, async e => e);
  const out = JSON.stringify(await h.emit('ui.render', { component: 'AbovePrompt', surface: 'terminal' }, async () => undefined));
  assert.ok(out.includes('█████░░░░░'));
  assert.ok(!out.includes('"Svg"'));
});

test('chips and Details wording are plain and safe', async () => {
  const { chipSvg, savingsLines } = await import('../src/status.js');
  assert.ok(!/<script|href=/.test(chipSvg('Sonnet 5.5<x>', '#8E7CE0')));
  assert.ok(!chipSvg('a<b', '#000').includes('<b'));
  assert.deepEqual(savingsLines({ outputsCompressed: 0, duplicateReadsAvoided: 0 }, 0), ['Nothing shortened yet. When a command prints a lot, I trim it and keep the original.']);
  const lines = savingsLines({ outputsCompressed: 2, duplicateReadsAvoided: 1 }, 38.2);
  assert.match(lines[0], /Shortened 2 long results, roughly 38% less text\./);
  assert.equal(lines[1], 'Skipped 1 repeated file read.');
  for (const l of lines) assert.ok(!/estimate|bill|tool text/i.test(l));
});

test('tips fire only on reported facts, can be dismissed, and never name a person', async () => {
  const { pickTip, costLine } = await import('../src/tips.js');
  assert.equal(pickTip({ modelName: 'Sonnet 5.5', effort: 'medium' }), null);
  assert.equal(pickTip({ modelName: 'Opus 5.5' }).id, 'opus');
  assert.equal(pickTip({ modelName: 'Opus 5.5', dismissed: new Set(['opus']) }), null);
  assert.equal(pickTip({ modelName: 'Sonnet 5.5', effort: 'max' }).id, 'effort');
  assert.equal(pickTip({ modelName: 'Opus 5.5', effort: 'high', dismissed: new Set(['opus']) }).id, 'effort');
  assert.equal(costLine(1.8), 'Cost so far: $1.80 (Claude Code’s own estimate).');
  assert.equal(costLine(undefined), '');
});
test('tip shows on Opus, is dismissible, and can be turned off', async () => {
  const pass = async e => e;
  const stream = async function* (e) { return e; };
  const draw = h => h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined).then(JSON.stringify);
  const h = await harness();
  h.setModel('claude-opus-5-5');
  await h.emit('turn.start', { text: 'go', turnId: 't' }, pass);
  await h.emit('turn.complete', { reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' }, pass);
  assert.match(await draw(h), /Tip: You’re on Opus 5\.5\./);
  const node = JSON.parse(await draw(h));
  assert.ok(JSON.stringify(node).includes('Got it'));
  const off = await harness({ tips: false });
  off.setModel('claude-opus-5-5');
  await off.emit('turn.start', { text: 'go', turnId: 't' }, pass);
  await off.emit('turn.complete', { reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' }, pass);
  assert.doesNotMatch(await draw(off), /Tip:/);
  await h.emit('turn.start', { text: 'go', turnId: 't' }, pass);
  assert.doesNotMatch(await draw(h), /Tip:/, 'no tips while Claude is working');
});

test('Details shows only chat space, cost and savings; working agents sit on the right', async () => {
  const pass = async e => e;
  const stream = async function* (e) { return e; };
  const h = await harness();
  await h.emit('session.measure', { context: { percent: 22, tokens: 219000, window: 1000000 }, cost: { usd: 1.8 }, rateLimits: [], changed: [] }, pass);
  await h.emit('turn.step', { agentId: 'a1', turnId: 't' }, stream);
  const tree = await h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined);
  const top = tree.children[0].children[0];
  assert.equal(top.justifyContent, 'space-between');
  assert.equal(top.children.length, 2);
  assert.match(JSON.stringify(top.children[1]), /1 agent working/);
  assert.match(JSON.stringify(top.children[0]), /Sonnet 5\.5/);
  await h.emit('ui.press', {}, async e => e).catch(() => {});
  const details = { ...tree };
  const text = JSON.stringify(await h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined));
  assert.doesNotMatch(text, /Habits/);
});

test('a resumed session reads its real state instead of greeting as new', async () => {
  const draw = h => h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined).then(JSON.stringify);
  const h = await harness();
  h.setTurns(7);
  h.setUsage(() => ({ context: { percent: 36, tokens: 72000, window: 200000 }, cost: { usd: 2.4 } }));
  await h.emit('session.start', { cwd: '/test', surface: 'desktop', isInteractive: true }, async e => e);
  const out = await draw(h);
  assert.doesNotMatch(out, /Hi! I’ll keep this chat light/);
  assert.match(out, /Looking good\. Keep going\./);
  assert.match(out, /Context 36 percent full/);
  assert.ok(out.includes('"36% used"'));
});
test('without a live reading, a resumed chat is estimated and labelled as an estimate', async () => {
  const draw = h => h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined).then(JSON.stringify);
  const h = await harness();
  h.setTurns(4);
  h.setUsage(args => args?.breakdown
    ? { context: { window: 200000, breakdown: { rawMaxTokens: 200000, totalTokens: 90000, percentage: 45 } } }
    : { context: { window: 200000 } });
  await h.emit('session.start', { cwd: '/test', surface: 'desktop', isInteractive: true }, async e => e);
  const out = await draw(h);
  assert.ok(out.includes('"~45% used"'));
  assert.doesNotMatch(out, /Hi! I’ll keep this chat light/);
});
test('a brand-new session still greets', async () => {
  const h = await harness();
  h.setTurns(0);
  const out = await h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined).then(JSON.stringify);
  assert.match(out, /Hi! I’ll keep this chat light/);
});

test('a small side-request model never changes the shown model or effort', async () => {
  const stream = async function* (e) { return e; };
  const h = await harness();
  await h.emit('turn.start', { text: 'go', turnId: 't' }, async e => e);
  await h.emit('turn.step', { turnId: 't', model: 'claude-haiku-4-5-20251001', effort: 'max' }, stream);
  const out = await h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined).then(JSON.stringify);
  assert.match(out, /Model: Sonnet 5\.5/);
  assert.doesNotMatch(out, /Haiku/);
  assert.doesNotMatch(out, /Tip:/);
  await h.emit('turn.step', { turnId: 't', model: 'claude-sonnet-5-5', effort: 'max' }, stream);
  await h.emit('turn.complete', { reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' }, async e => e);
  assert.match(await h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined).then(JSON.stringify), /Effort is set to max/);
});

test('many messages alone do not warn while the chat still has room, and nothing warns during compaction', async () => {
  const pass = async e => e;
  const draw = h => h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined).then(JSON.stringify);
  const h = await harness();
  h.setTurns(45);
  h.setUsage(() => ({ context: { percent: 39 }, cost: { usd: 1 } }));
  await h.emit('session.measure', { context: { percent: 39 }, cost: { usd: 1 } }, pass);
  assert.doesNotMatch(await draw(h), /fresh chat could help/);
  const full = await harness();
  full.setTurns(45);
  await full.emit('session.measure', { context: { percent: 80 }, cost: { usd: 1 } }, pass);
  assert.match(await draw(full), /fresh chat could help/);
  await full.emit('session.compact', {}, pass);
  assert.doesNotMatch(await draw(full), /Start fresh/);
});

test('the fresh-chat suggestion says why, and the Opus price claim matches the checked list prices', async () => {
  const pass = async e => e;
  const draw = h => h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined).then(JSON.stringify);
  const long = await harness();
  long.setTurns(45);
  await long.emit('session.measure', { context: { percent: 60 }, cost: { usd: 1 } }, pass);
  const a = await draw(long);
  assert.match(a, /You’ve sent 45 messages and the chat is 60% full\. A fresh chat could help\./);
  const full = await harness();
  full.setTurns(5);
  await full.emit('session.measure', { context: { percent: 82 }, cost: { usd: 1 } }, pass);
  assert.match(await draw(full), /The chat is 82% full\. A fresh chat could help\./);
  assert.match(pickTip({ modelName: 'Opus 5.5' }).text, /about twice Sonnet 5\.5/);
  assert.match(pickTip({ modelName: 'Opus 4.8' }).text, /about 2\.5 times Sonnet 5\.5/);
});

test('Done never hides background tasks that are still running', async () => {
  const pass = async e => e;
  const draw = h => h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined).then(JSON.stringify);
  const h = await harness();
  await h.emit('turn.start', { text: 'go', turnId: 't' }, pass);
  await h.emit('turn.complete', { reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't' }, pass);
  assert.match(await draw(h), /Done\. Ready for your next step/);
  const tasks = [{ id: 'a', type: 'shell', status: 'running', description: 'baseline', command: 'bash run_all.sh' }, { id: 'b', type: 'monitor', status: 'running', description: 'baseline run finishes' }];
  await h.emit('classic.Stop', { background_tasks: tasks }, pass);
  const waiting = await draw(h);
  assert.match(waiting, /Waiting on 2 background tasks…/);
  assert.doesNotMatch(waiting, /Done\. Ready for your next step/);
  assert.match(waiting, /2 background tasks/);
  await h.emit('classic.Stop', { background_tasks: [tasks[0]] }, pass);
  assert.match(await draw(h), /Waiting on 1 background task…/);
  await h.emit('classic.Stop', { background_tasks: [] }, pass);
  assert.match(await draw(h), /Done\. Ready for your next step/);
});
