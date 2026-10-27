import { register } from '../hooks/register.js';
// Test double only. Production never imports this or accesses Node APIs.
export async function harness(options = {}, backing = new Map()) {
  const handlers = []; const logs = []; let turns = 0; let id = 'test-session';
  const timers = []; let modelId = 'claude-sonnet-5-5'; let calls = 0; let storeFails = false; let usageNow = () => ({ context: { window: 1000 } });
  const api = {
    session: { usage: async args => usageNow(args), model: async () => modelId, id: async () => id, turns: async () => turns, messages: async () => [] },
    store: { keys: async () => [...backing.keys()], get: async k => backing.get(k),
      set: async (k, v) => { if (storeFails) throw new Error('disk full'); backing.set(k, structuredClone(v)); },
      delete: async k => backing.delete(k) },
    command: { register: async () => {} }, clock: { now: async () => 0, after: (ms, fn) => { const t = { ms, fn, on: true, cancel() { t.on = false; } }; timers.push(t); return t; } },
    ui: { log: s => logs.push(s), invalidate: () => {}, open: async () => {}, close: async () => {}, ask: async () => 'Keep everything', resolve: () => Object.fromEntries(['Box', 'Text', 'Button', 'Markdown', 'Svg'].map(type => [type, props => ({type, ...props})])) }
  };
  register((event, filter, fn) => {
    if (typeof filter === 'function') { fn = filter; filter = {}; }
    handlers.push({ event, filter, fn });
  }, options);
  const emit = async (event, e, core = async () => ({})) => {
    const handler = handlers.find(h => h.event === event && Object.entries(h.filter).every(([k,v]) => e[k] === v));
    const out = handler ? handler.fn(api, Object.freeze(e), core) : core(e);
    if (out && typeof out[Symbol.asyncIterator] === 'function') { let step = await out.next(); while (!step.done) step = await out.next(); return step.value; }
    return out;
  };
  await emit('session.start', { cwd: '/test', surface: null, isInteractive: false });
  return { setModel: m => modelId = m, timers, fireIdle: () => timers.filter(t => t.on).forEach(t => { t.on = false; t.fn(); }), setUsage: fn => usageNow = fn, backing, logs, emit, api, setTurns: n => turns = n, setId: n => id = n,
    failStore: () => storeFails = true, calls: () => calls,
    tool: (e, result, extra = {}) => emit('tool.call', e, async () => { calls++; return { result, ref: 7, text: 'CORE ORIGINAL', ...extra }; }),
    command: (command, args = '') => emit('command.run', { command, args }) };
}
export const bash = stdout => ({ stdout, stderr: '', interrupted: false, isImage: false });
export const read = (content, path = '/test/a.txt') => ({ type: 'text', file: { filePath: path, content,
  numLines: content.split('\n').length, totalLines: content.split('\n').length, startLine: 1 } });
export const noisy = () => ['build started', ...Array.from({ length: 400 }, (_, i) => `PASS tests/unit-${i}.js`),
 'ERROR: missing DATABASE_URL', '  at connect (src/db.js:42:8)', '1 failed, 400 passed', 'build finished'].join('\n');
