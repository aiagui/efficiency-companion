import test from 'node:test';
import assert from 'node:assert/strict';
import { companionSvg, companionState, companionStates, companionAlt } from '../src/companion.js';
import { harness } from './harness.js';

test('every state draws valid, local, script-free SVG with its own description', () => {
  const seen = new Set();
  for (const state of companionStates) {
    const svg = companionSvg(state, true);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 36 36"/);
    assert.ok(svg.endsWith('</svg>'));
    assert.ok(!/<script|href=|onload|on\w+=|url\(/i.test(svg));
    assert.ok(svg.includes(`<title>${companionAlt(state)}</title>`));
    assert.ok(svg.includes('@keyframes breathe') && svg.includes('animation:blink'));
    seen.add(svg);
  }
  assert.equal(seen.size, companionStates.length);
});

test('Reduce Motion and Pause both stop all motion but keep the expression', () => {
  for (const state of companionStates) {
    assert.match(companionSvg(state, true), /prefers-reduced-motion:reduce\)\{\*\{animation:none!important/);
    const paused = companionSvg(state, false);
    assert.ok(!/animation|@keyframes/.test(paused));
    assert.ok(paused.includes(`<title>${companionAlt(state)}</title>`));
  }
  assert.notEqual(companionSvg('done', false), companionSvg('error', false));
});

test('state follows verified facts in a fixed order', () => {
  assert.equal(companionState({ phase: 'idle' }), 'ready');
  assert.equal(companionState({}), 'ready');
  assert.equal(companionState({ phase: 'hello' }), 'hello');
  assert.equal(companionState({ phase: 'tool', warning: true }), 'tool');
  assert.equal(companionState({ phase: 'compacting' }), 'compacting');
  assert.equal(companionState({ phase: 'working', warning: true }), 'working');
  assert.equal(companionState({ phase: 'error', warning: true }), 'error');
  assert.equal(companionState({ phase: 'done' }), 'done');
  assert.equal(companionState({ phase: 'done', saved: true }), 'saved');
  assert.equal(companionState({ phase: 'done', warning: true }), 'pressure');
  assert.equal(companionState({ phase: 'done', warning: true, repeated: true }), 'curious');
  assert.equal(companionState({ phase: 'stopped' }), 'stopped');
  assert.equal(companionSvg('nonsense'), companionSvg('ready'));
});

test('turn events drive the helper and are always passed on unchanged', async () => {
  const h = await harness();
  h.setTurns(0);
  const draw = async () => JSON.stringify(await h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined));
  const pass = async e => e;
  assert.match(await draw(), /Hi! I’ll keep this chat light\./);
  const start = { text: 'hi', turnId: 't1' };
  assert.deepEqual(await h.emit('turn.start', start, pass), start);
  assert.match(await draw(), /Working on it/);
  const done = { reason: 'answer', answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1' };
  assert.deepEqual(await h.emit('turn.complete', done, pass), done);
  assert.match(await draw(), /Done\. Ready for your next step\./);
  await h.emit('turn.start', start, pass);
  await h.emit('turn.complete', { ...done, reason: 'aborted', isAborted: true }, pass);
  assert.match(await draw(), /Stopped\. Nothing is lost\./);
  await h.emit('turn.start', start, pass);
  await h.emit('turn.complete', { ...done, reason: 'error' }, pass);
  assert.match(await draw(), /didn’t finish/);
  await h.emit('turn.start', start, pass);
  await h.emit('turn.complete', { ...done, agentId: 'sub-1', reason: 'error' }, pass);
  assert.match(await draw(), /Working on it/, 'a subagent turn must not end the main turn');
});

test('trimmed output in a turn shows the trimmed state and keeps the original link', async () => {
  const { bash, noisy } = await import('./harness.js');
  const h = await harness();
  const pass = async e => e;
  await h.emit('turn.start', { text: 'build', turnId: 't2' }, pass);
  await h.tool({ tool: 'Bash' }, bash(noisy()));
  await h.emit('turn.complete', { reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't2' }, pass);
  const drawn = JSON.stringify(await h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined));
  assert.match(drawn, /(trimmed some long output|Big trim: that saved a lot of text)\. Originals are kept\./);
});

test('a running tool and a compaction each show their own state, then return', async () => {
  const { bash } = await import('./harness.js');
  const h = await harness();
  const draw = async () => JSON.stringify(await h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined));
  const pass = async e => e;
  await h.emit('turn.start', { text: 'go', turnId: 't3' }, pass);
  let during = '';
  await h.emit('tool.call', { tool: 'Bash' }, async () => { during = await draw(); return { result: bash('ok'), ref: 1, text: 'x' }; });
  assert.match(during, /Running a tool/);
  assert.match(await draw(), /Working on it/);
  let compacting = '';
  await h.emit('session.compact', { trigger: 'manual' }, async () => { compacting = await draw(); return {}; });
  assert.match(compacting, /Tidying up this chat/);
  assert.doesNotMatch(await draw(), /Tidying up/);
});

test('sunglasses only when relaxed, model accessory by model, skins change colour', async () => {
  const { SKINS } = await import('../src/companion.js');
  for (const state of ['ready', 'done', 'saved', 'hello']) assert.match(companionSvg(state, true, { relaxed: true }), /class="glint"/);
  for (const state of ['working', 'error', 'pressure', 'sleepy', 'tool']) assert.doesNotMatch(companionSvg(state, true, { relaxed: true }), /class="glint"/);
  assert.doesNotMatch(companionSvg('ready', true, { relaxed: false }), /class="glint"/);
  assert.match(companionSvg('ready', true, { model: 'Sonnet 5.5' }), /fill="#8E7CE0"/);
  assert.match(companionSvg('ready', true, { model: 'Opus 5.5' }), /#F0B84A/);
  assert.match(companionSvg('ready', true, { model: 'Haiku 4.5' }), /#3FB3A0/);
  assert.doesNotMatch(companionSvg('ready', true, { model: 'Mystery 1' }), /class="acc"/);
  for (const skin of Object.keys(SKINS)) assert.ok(companionSvg('ready', true, { skin }).includes(`fill="${SKINS[skin].base}"`));
  assert.equal(companionSvg('ready', true, { skin: 'nope' }), companionSvg('ready', true));
});
test('confetti only for a finished, animated turn, and Reduce Motion hides it', () => {
  assert.match(companionSvg('saved', true, { party: true }), /class="conf"/);
  assert.match(companionSvg('saved', true, { party: true }), /\.conf\{display:none\}/);
  assert.doesNotMatch(companionSvg('saved', false, { party: true }), /conf/);
  assert.doesNotMatch(companionSvg('working', true, { party: true }), /class="conf"/);
  assert.doesNotMatch(companionSvg('done', true), /class="conf"/);
});
test('sleepy ranks below working and warnings, above stopped', () => {
  assert.equal(companionState({ phase: 'done', sleepy: true }), 'sleepy');
  assert.equal(companionState({ phase: 'working', sleepy: true }), 'working');
  assert.equal(companionState({ phase: 'done', sleepy: true, warning: true }), 'pressure');
});
test('helper dozes off after idle time, wakes on a prompt, and a big trim gets a celebration', async () => {
  const { bash, noisy } = await import('./harness.js');
  const pass = async e => e;
  const draw = h => h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined).then(JSON.stringify);
  const h = await harness();
  await h.emit('turn.start', { text: 'a', turnId: '1' }, pass);
  await h.emit('turn.complete', { reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: '1' }, pass);
  assert.doesNotMatch(await draw(h), /Resting/);
  h.fireIdle();
  assert.match(await draw(h), /Resting\. Say something/);
  await h.emit('prompt.submit', { text: 'back', origin: { kind: 'composer' } }, pass);
  assert.doesNotMatch(await draw(h), /Resting/);
  await h.emit('turn.start', { text: 'b', turnId: '2' }, pass);
  await h.tool({ tool: 'Bash' }, bash(noisy()));
  await h.emit('turn.complete', { reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: '2' }, pass);
  const out = await draw(h);
  assert.match(out, /Big trim/);
  assert.match(out, /class=\\"conf\\"/);
});

test('terminals get a text face for every state, and desktop keeps the image', async () => {
  const { companionText } = await import('../src/companion.js');
  const seen = new Set();
  for (const state of companionStates) { const t = companionText(state); assert.ok(t && t.length < 12, state); seen.add(t); }
  assert.equal(seen.size, companionStates.length);
  assert.equal(companionText('ready', { relaxed: true }), '(⌐■‿■)');
  assert.equal(companionText('working', { relaxed: true }), '(•_•)…');
  const h = await harness();
  const term = JSON.stringify(await h.emit('ui.render', { component: 'AbovePrompt', surface: 'terminal' }, async () => undefined));
  assert.ok(term.includes('(⌐■‿■)/') || term.includes('(•‿•)/') || term.includes('(⌐■‿■)'));
  assert.ok(!term.includes('"Svg"'));
  const desk = JSON.stringify(await h.emit('ui.render', { component: 'AbovePrompt', surface: 'desktop' }, async () => undefined));
  assert.ok(desk.includes('"Svg"'));
  assert.ok(!desk.includes('(•‿•)/'));
});
