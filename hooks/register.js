import { companionSvg, companionState, companionAlt, companionText, SKINS } from '../src/companion.js';
import { pickTip, costLine } from '../src/tips.js';
import { contextTone, toneColor, toneWord, barSvg, textBar, modelLabel, agentsLabel, tasksLabel, tokensLabel, chipSvg, MODEL_COLOR, AGENT_COLOR, savingsLines } from '../src/status.js';
import { configuration, textView, slim, redact, hash, bytes, initialMetrics, account, report, guard, handoff, formatStats, reductionLabel } from '../src/core.js';

// Reads what the session already holds (turns, context fill, cost), for a resumed or restarted chat.
async function readSession($) {
  try {
    const turns = await $.session.turns();
    const usage = await $.session.usage();
    const out = { turns, costUsd: usage.cost?.usd };
    if (typeof usage.context?.percent === 'number') {
      out.percent = Math.min(100, Math.max(0, usage.context.percent)); out.estimated = false;
      out.tokens = tokensLabel(usage.context.tokens, usage.context.window);
    } else if (turns > 0) {
      const b = (await $.session.usage({ breakdown: 'summary' })).context?.breakdown;
      if (b && b.rawMaxTokens > 0) {
        out.percent = Math.min(100, Math.max(0, Math.round(b.percentage))); out.estimated = true;
        out.tokens = tokensLabel(b.totalTokens, b.rawMaxTokens);
      }
    }
    return out;
  } catch { return null; }
}

// All host access is explicit through the official Mods API. No Node imports.
export function register(on, options) {
  const config = configuration(options);
  const cache = new Map();
  const metrics = initialMetrics();
  let queue = Promise.resolve();
  let epoch = 0;
  let archiveBytes = 0;
  let bypass = false;
  let sessionId = '';
  let lastNotice = -100;
  let baselineTurns = 0;
  let baselineDuplicates = 0;
  const paneId = 'efficiency-companion';
  let contextPercent = null;
  let currentTurns = 0;
  let snoozeUntil = 0;
  let repeatedPrompt = false;
  let promptHashes = [];
  let draft = '';
  let panelMessage = '';
  let motionEnabled = config.animateCompanion;
  let showDetails = false;
  let smallMessage = '';
  // What the session verifiably is doing: hello (no turn yet) | working | tool | compacting | done | stopped | error | idle.
  let phase = 'hello';
  let sleepy = false;
  let party = false;
  let idleTimer;
  let turnBytesBase = 0;
  const IDLE_MS = 5 * 60 * 1000;
  let modelName = '';
  let tokenInfo = '';
  const activeAgents = new Set();
  let bgTasks = [];
  let effortNow;
  let costUsd;
  let dismissedTips = new Set();
  let hydrated = false;
  let contextEstimated = false;
  // A resumed or restarted session has history this plugin never saw; `seen` is what the session reports.
  function applySeen(seen) {
    hydrated = true;
    if (!seen) return;
    currentTurns = Math.max(currentTurns, seen.turns);
    if (seen.turns > 0 && phase === 'hello') phase = 'idle';
    if (seen.costUsd !== undefined) costUsd = seen.costUsd;
    if (seen.percent !== undefined) { contextPercent = seen.percent; contextEstimated = seen.estimated; tokenInfo = seen.tokens; }
  }
  let turnSavedBase = 0;
  let turnSaved = false;
  const savedCount = () => metrics.outputsCompressed + metrics.duplicateReadsAvoided;


  on('session.start', async ($, e, next) => {
    sessionId = await $.session.id();
    try { modelName = modelLabel(await $.session.model()); } catch { /* Model name is optional. */ }
    if (config.telemetry) {
      const retained = await $.store.get(`metrics:${sessionId}`);
      if (retained?.schemaVersion === 1) for (const key of Object.keys(metrics)) {
        if (typeof retained[key] === 'number' && Number.isFinite(retained[key])) metrics[key] = retained[key];
      }
    }
    // Remembered choice from the last session; never blocks startup.
    try { const t = await $.store.get('pref:tips'); if (Array.isArray(t)) dismissedTips = new Set(t.filter(x => typeof x === 'string')); } catch { /* Tips simply show again. */ }
    try { const pref = await $.store.get('pref:motion'); if (typeof pref === 'boolean') motionEnabled = pref && config.animateCompanion; } catch { /* Keep the configured default. */ }
    applySeen(await readSession($));
    if (idleTimer) idleTimer.cancel(); idleTimer = $.clock.after(IDLE_MS, () => { if (phase !== 'working' && phase !== 'tool' && phase !== 'compacting') { sleepy = true; $.ui.invalidate('ui.render'); } });
    // Measure the plugin's existing archive; never silently evict originals.
    archiveBytes = 0;
    const storedKeys = await $.store.keys();
    const oldMetrics = storedKeys.filter(key => key.startsWith('metrics:'));
    for (const key of oldMetrics.slice(0, Math.max(0, oldMetrics.length - 63))) await $.store.delete(key);
    for (const key of storedKeys) if (key.startsWith('original:')) {
      const value = await $.store.get(key);
      archiveBytes += bytes(JSON.stringify(value));
    }
    // Isolate registration failures: a rejected name must not hide later commands.
    try { await $.command.register({ name: 'efficiency-open', description: '✳ Show the small helper above the typing box' }); }
    catch { $.ui.log('⚠️ Could not register /efficiency-open. Other efficiency commands remain available.'); }
    try { await $.command.register({ name: 'efficiency-stats', description: '📊 Show local estimated context savings', argumentHint: '[json]' }); }
    catch { $.ui.log('⚠️ Could not register /efficiency-stats. Other efficiency commands remain available.'); }
    try { await $.command.register({ name: 'efficiency-original', description: '📂 Recover an archived original output', argumentHint: '<id>' }); }
    catch { $.ui.log('⚠️ Could not register /efficiency-original. Other efficiency commands remain available.'); }
    try { await $.command.register({ name: 'efficiency-draft', description: '📋 Create a local handoff draft for review' }); }
    catch { $.ui.log('⚠️ Could not register /efficiency-draft. Other efficiency commands remain available.'); }
    try { await $.command.register({ name: 'efficiency-bypass', description: '🔎 Keep the next tool output complete' }); }
    catch { $.ui.log('⚠️ Could not register /efficiency-bypass. Other efficiency commands remain available.'); }
    try { await $.command.register({ name: 'efficiency-purge', description: '🧹 Delete locally retained originals and metrics', argumentHint: 'confirm' }); }
    catch { $.ui.log('⚠️ Could not register /efficiency-purge. Other efficiency commands remain available.'); }
    try { await $.ui.close({id: paneId}); } catch { /* No pane on headless surfaces. */ }
    return next(e);
  });

  // Observe-only: these read verified turn events and always pass them on unchanged.
  on('turn.start', async ($, e, next) => {
    if (config.enabled) { try { modelName = modelLabel(await $.session.model()); } catch { /* optional */ } phase = 'working'; sleepy = false; if (idleTimer) idleTimer.cancel(); party = false; turnBytesBase = metrics.beforeBytes - metrics.afterBytes; turnSavedBase = savedCount(); turnSaved = false; smallMessage = ''; $.ui.invalidate('ui.render'); }
    return next(e);
  });
  // turn.step streams, so this hook is an async generator that forwards the stream untouched.
  on('turn.step', async function* ($, e, next) {
    // Side requests (titles, summaries) can run on a small model; only the session's own model counts for effort.
    if (config.enabled && !e.agentId && (!modelName || modelLabel(e.model) === modelName) && e.effort !== effortNow) { effortNow = e.effort; $.ui.invalidate('ui.render'); }
    if (config.enabled && e.agentId && !activeAgents.has(e.agentId)) { activeAgents.add(e.agentId); $.ui.invalidate('ui.render'); }
    return yield* next(e);
  });
  on('turn.complete', async ($, e, next) => {
    if (config.enabled && e.agentId) { activeAgents.delete(e.agentId); $.ui.invalidate('ui.render'); }
    if (config.enabled && !e.agentId) {
      activeAgents.clear();
      phase = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'error';
      turnSaved = savedCount() > turnSavedBase;
      party = turnSaved && (metrics.beforeBytes - metrics.afterBytes) - turnBytesBase >= 8000;
      sleepy = false; if (idleTimer) idleTimer.cancel(); idleTimer = $.clock.after(IDLE_MS, () => { if (phase !== 'working' && phase !== 'tool' && phase !== 'compacting') { sleepy = true; $.ui.invalidate('ui.render'); } });
      $.ui.invalidate('ui.render');
    }
    return next(e);
  });

  on('prompt.submit', async ($, e, next) => {
    if (config.enabled && e.origin?.kind === 'composer' && typeof e.text === 'string') {
      smallMessage = '';
      sleepy = false; if (idleTimer) idleTimer.cancel();
      // Exact normalized wording only: no semantic judgment, persisted text, or model call.
      try {
      const normalized = e.text.trim().toLowerCase().replace(/\s+/g, ' ');
      if (normalized.length >= 40) {
        const digest = await hash(normalized);
        repeatedPrompt = promptHashes.includes(digest);
        promptHashes.push(digest);
        promptHashes = promptHashes.slice(-8);
      } else repeatedPrompt = false;
      $.ui.invalidate('ui.render');
      } catch { /* A presentation heuristic must never block a prompt. */ }
    }
    return next(e);
  });

  on('command.run', { command: 'efficiency-open' }, async ($) => {
    await $.ui.close({id: paneId});
    showDetails = false; smallMessage = ''; $.ui.invalidate('ui.render');
    return { text: 'Your helper is above the typing box.' };
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!config.enabled) return next(e);
    if (!hydrated) applySeen(await readSession($));
    const base = await next(e);
    const { Box, Text, Button, Svg, Markdown } = $.ui.resolve(e);
    const warning = currentTurns >= snoozeUntil && phase !== 'compacting' && (repeatedPrompt || (contextPercent !== null && contextPercent >= config.contextPercent) || (currentTurns - baselineTurns >= config.maxTurns && (contextPercent === null || contextPercent >= 50)));
    const sent = currentTurns - baselineTurns;
    const warnWhy = repeatedPrompt ? 'You’ve sent this same message more than once.'
      : contextPercent !== null && contextPercent >= config.contextPercent ? `The chat is ${Math.round(contextPercent)}% full.`
      : `You’ve sent ${sent} messages${contextPercent === null ? ' and the chat space isn’t measured yet' : ` and the chat is ${Math.round(contextPercent)}% full`}.`;
    const bgWaiting = bgTasks.length > 0 && (phase === 'done' || phase === 'idle');
    const mood = companionState({ phase: bgWaiting ? 'working' : phase, warning, repeated: repeatedPrompt, saved: turnSaved, sleepy });
    const idle = contextPercent === null ? 'Ready when you are.' : 'Looking good. Keep going.';
    const moodText = {
      sleepy: 'Resting. Say something when you’re back.',
      hello: 'Hi! I’ll keep this chat light.',
      tool: 'Running a tool…',
      compacting: 'Tidying up this chat…',
      working: bgWaiting ? `Waiting on ${tasksLabel(bgTasks.length)}…` : 'Working on it…',
      error: 'That didn’t finish. You can try again.',
      curious: `${warnWhy} Carry on, or start fresh?`,
      pressure: `${warnWhy} A fresh chat could help.`,
      stopped: 'Stopped. Nothing is lost.',
      saved: party ? 'Done. Big trim: that saved a lot of text. Originals are kept.' : 'Done. I trimmed some long output. Originals are kept.',
      done: party ? 'Done. Big trim: that saved a lot of text.' : 'Done. Ready for your next step.',
      ready: idle,
    }[mood];
    const message = ['working', 'tool', 'compacting', 'error'].includes(mood) ? moodText : smallMessage || moodText;
    const tone = contextTone(contextPercent, config.contextPercent);
    const row = [
      ...(e.surface !== 'desktop' ? [Text({children:[companionText(mood, { relaxed: contextPercent === null ? currentTurns < 3 : contextPercent < 50 })], color: (SKINS[config.skin] ?? SKINS.orange).base})] : []),
      ...(e.surface === 'desktop' ? [Svg({source: companionSvg(mood, motionEnabled, { skin: config.skin, model: modelName, relaxed: contextPercent === null ? currentTurns < 3 : contextPercent < 50, party }), alt: companionAlt(mood), width:32, height:32})] : []),
      Text({children:[message]}),
      ...(e.surface === 'desktop' && contextPercent !== null ? [Svg({source: barSvg(contextPercent, config.contextPercent), alt: `Context ${Math.round(contextPercent)} percent full. ${toneWord(tone)}.`, width:72, height:8})] : []),
      ...(e.surface !== 'desktop' && contextPercent !== null ? [Text({children:[textBar(contextPercent)], color: toneColor(tone)})] : []),
      ...(contextPercent !== null ? [Text({children:[`${contextEstimated ? '~' : ''}${Math.round(contextPercent)}% used`], color: toneColor(tone)})] : []),
      ...(modelName ? [e.surface === 'desktop' ? Svg({source: chipSvg(modelName, MODEL_COLOR), alt: `Model: ${modelName}`, height:24}) : Text({children:[modelName], dimColor:true})] : []),
      Markdown({key:'details',text:showDetails ? '[Hide](https://efficiency.invalid/details)' : '[Details](https://efficiency.invalid/details)',onLinkPress:async()=>{showDetails=!showDetails;$.ui.invalidate('ui.render');}}),
    ];
    const taskChip = bgTasks.length ? (e.surface === 'desktop' ? Svg({source: chipSvg(tasksLabel(bgTasks.length), AGENT_COLOR, motionEnabled), alt: tasksLabel(bgTasks.length), height:24}) : Text({children:[tasksLabel(bgTasks.length)], dimColor:true})) : null;
    const agentChip = activeAgents.size ? (e.surface === 'desktop' ? Svg({source: chipSvg(agentsLabel(activeAgents.size), AGENT_COLOR, motionEnabled), alt: agentsLabel(activeAgents.size), height:24}) : Text({children:[agentsLabel(activeAgents.size)], dimColor:true})) : null;
    const extra = [];
    const tip = config.tips && !['working', 'tool', 'compacting'].includes(mood) ? pickTip({ modelName, effort: effortNow, dismissed: dismissedTips }) : null;
    if (tip) extra.push(Box({flexDirection:'row',flexWrap:'wrap',columnGap:1,children:[
      Text({children:['Tip: ' + tip.text], color:'#E0A64A'}),
      Markdown({key:'tip-ok',text:'[Got it](https://efficiency.invalid/tip)',onLinkPress:async()=>{dismissedTips.add(tip.id);try{await $.store.set('pref:tips',[...dismissedTips]);}catch{/* Dismissal lasts this session. */}$.ui.invalidate('ui.render');}}),
    ]}));
    if (warning) extra.push(Box({flexDirection:'row',flexWrap:'wrap',columnGap:1,children:[
      Button({key:'start-fresh',label:'Start fresh',onPress:async()=>{
        try {
          const text = handoff(await $.session.messages(), config);
          const result = await $.prompt.fill({text, mode:'append'});
          smallMessage = result.isFilled ? 'Your handoff is in the typing box. Review it, then copy it into a new chat.' : 'Use /efficiency-draft for a handoff you can take to a new chat.';
        } catch {smallMessage='Use /efficiency-draft to prepare your next chat.';}
        $.ui.invalidate('ui.render');
      }}),
      Button({key:'stay-here',label:'Stay here',onPress:async()=>{
        try {
          const choice=await $.ui.ask('Make room here? Claude will summarize older messages. This uses your Claude allowance; review the summary afterward.', ['Make room', 'Keep everything']);
          if(choice==='Make room')await $.session.compact({instructions:'Preserve the objective, decisions, constraints, unfinished work, errors, file paths, and efficiency-original recovery IDs.'});
        } catch {smallMessage='Let Claude finish, then try again.';}
        $.ui.invalidate('ui.render');
      }}),
      Button({key:'later',label:'Later',dimColor:true,onPress:async()=>{snoozeUntil=currentTurns+5;smallMessage='Carry on. I’ll stay quiet for a while.';$.ui.invalidate('ui.render');}}),
    ]}));
    if (showDetails) {
      const stats=report(metrics);
      extra.push(Text({children:[contextPercent === null ? 'Chat space: not measured yet.' : `Chat space: ${toneWord(tone)}${tokenInfo ? ' · ' + tokenInfo : ''}${contextEstimated ? ' (estimate)' : ''}.`],dimColor:true}));
      if (warning) extra.push(Text({children:[`When I suggest a fresh chat: you repeat a message, the chat reaches ${config.contextPercent}% full, or you pass ${config.maxTurns} messages and the chat is at least half full.`],dimColor:true}));
      for (const t of bgTasks.slice(0, 3)) extra.push(Text({children:[`Running in background: ${String(t.command || t.description || t.type).replace(/\s+/g, ' ').slice(0, 70)}`],dimColor:true}));
      const spend = costLine(costUsd); if (spend) extra.push(Text({children:[spend],dimColor:true}));
      for (const line of savingsLines(metrics, stats.savingsPercent)) extra.push(Text({children:[line],dimColor:true}));
      extra.push(Markdown({key:'pause-small',text:motionEnabled ? '[Pause animation](https://efficiency.invalid/motion)' : '[Resume animation](https://efficiency.invalid/motion)',onLinkPress:async()=>{motionEnabled=!motionEnabled;try{await $.store.set('pref:motion',motionEnabled);}catch{/* Preference is optional. */}$.ui.invalidate('ui.render');}}));
    }
    return Box({flexDirection:'column',children:[...(base ? [base] : []),Box({flexDirection:'column',children:[Box({flexDirection:'row',justifyContent:'space-between',alignItems:'center',columnGap:2,children:[Box({flexDirection:'row',flexWrap:'wrap',columnGap:1,alignItems:'center',children:row}),...(agentChip || taskChip ? [Box({flexDirection:'row',columnGap:1,alignItems:'center',children:[agentChip, taskChip].filter(Boolean)})] : [])]}),...extra]})]});
  });

  on('tool.call', async ($, e, next) => {
    const enteredEpoch = epoch;
    // Always execute the original call once, with the normal permission chain.
    if (!e.agentId && phase === 'working') { phase = 'tool'; $.ui.invalidate('ui.render'); }
    const output = await next(e);
    if (!e.agentId && phase === 'tool') { phase = 'working'; $.ui.invalidate('ui.render'); }
    const job = queue.then(async () => {
      if (!config.enabled || output.deny || output.isError) return output;
      try {
        const idNow = await $.session.id();
        if (idNow !== sessionId) {
          sessionId = idNow; hydrated = false; epoch++; cache.clear(); Object.assign(metrics, initialMetrics());
          baselineTurns = 0; baselineDuplicates = 0; lastNotice = -100;
          promptHashes = []; repeatedPrompt = false; contextPercent = null; currentTurns = 0; snoozeUntil = 0; draft = ''; panelMessage = ''; phase = 'idle'; turnSaved = false;
        }
        const view = textView(e.tool, output.result);
        if (!view) return output;
        const before = JSON.stringify(output.result);
        if (bypass) { bypass = false; cache.clear(); metrics.bypassed++; account(metrics, before, before, 'same'); return output; }
        const digest = await hash(view.combined);
        const key = JSON.stringify([sessionId, e.agentId ?? 'main', e.tool, e.file_path ?? '', e.offset ?? null, e.limit ?? null, e.pages ?? null]);
        const previous = e.tool === 'Read' && enteredEpoch === epoch ? cache.get(key) : undefined;
        const duplicate = previous?.hash === digest;
        // Code/files are not summarized on a first read. Only identical later reads change.
        const transformed = e.tool === 'Bash' ? slim(view.text, config) : { text: view.text, reason: 'file-preserved' };
        let candidate = duplicate ? '♻️ Unchanged since the previous read. Already available in this conversation.' : transformed.text;
        if (config.redactSecrets) candidate = redact(candidate);
        const stderr = e.tool === 'Bash' && config.redactSecrets ? redact(output.result.stderr) : undefined;
        const changed = candidate !== view.text || (stderr !== undefined && stderr !== output.result.stderr);
        const kind = duplicate ? 'duplicate' : 'slim';
        const id = duplicate ? previous.id : crypto.randomUUID();
        const pointer = `\n[efficiency: ${reductionLabel(transformed.reason, duplicate)}; 📂 original: /efficiency-original ${id}; use original for exact details]`;
        const replacement = view.rebuild(candidate + (changed ? pointer : ''));
        if (stderr !== undefined) replacement.stderr = stderr;
        const after = JSON.stringify(replacement);
        // Redaction may increase size; allow it anyway. Savings metrics can be negative.
        const useful = changed && (bytes(after) < bytes(before) || config.redactSecrets);
        const seedRead = e.tool === 'Read' && enteredEpoch === epoch && bytes(view.text) >= config.minBytes;
        if (config.mode === 'observe') {
          if (seedRead) {
            cache.delete(key); cache.set(key, { hash: digest, id });
            if (cache.size > config.maxCacheEntries) cache.delete(cache.keys().next().value);
          }
          account(metrics, before, before, 'same', useful ? bytes(before) - bytes(after) : 0);
          return output;
        }
        if (!useful && !seedRead) { account(metrics, before, before, 'same'); return output; }
        const archive = { schemaVersion: 1, createdAt: await $.clock.now(), result: output.result };
        const size = bytes(JSON.stringify(archive));
        if (!duplicate && archiveBytes + size > config.archiveBudgetBytes) {
          metrics.archiveFailures++; account(metrics, before, before, 'same'); return output;
        }
        // Archive must succeed before any content is replaced.
        if (!duplicate) {
          await $.store.set(`original:${id}`, archive);
          archiveBytes += size;
        }
        if (e.tool === 'Read' && enteredEpoch === epoch) {
          cache.delete(key); cache.set(key, { hash: digest, id });
          if (cache.size > config.maxCacheEntries) cache.delete(cache.keys().next().value);
        }
        account(metrics, before, useful ? after : before, useful ? kind : 'same');
        if (!useful) return output;
        // ref/text belong to core's original messages: don't forward them on a rewrite.
        return { result: replacement, ...(output.context ? { context: output.context } : {}) };
      } catch { metrics.archiveFailures++; return output; }
    });
    const saved = job.then(async result => {
      if (config.enabled && config.telemetry) {
        try { await $.store.set(`metrics:${sessionId}`, report(metrics)); } catch { metrics.telemetryFailures++; }
      }
      return result;
    });
    queue = saved.then(() => undefined, () => undefined);
    const result = await saved;
    $.ui.invalidate('ui.render');
    return result;
  });

  on('session.measure', async ($, e, next) => {
    if (config.enabled) {
      try { modelName = modelLabel(await $.session.model()) || modelName; } catch { /* Model name is optional. */ }
      const turns = await $.session.turns();
      currentTurns = turns;
      costUsd = e.cost?.usd; contextEstimated = false;
      tokenInfo = tokensLabel(e.context?.tokens, e.context?.window);
      contextPercent = typeof e.context?.percent === 'number' && Number.isFinite(e.context.percent) ? Math.min(100, Math.max(0, e.context.percent)) : null;
      $.ui.invalidate('ui.render');
      const reasons = guard(e.context, turns - baselineTurns, metrics.duplicateReadsAvoided - baselineDuplicates, config);
      if (reasons.length && turns >= snoozeUntil && turns - lastNotice >= 5) {
        lastNotice = turns; metrics.guardNotices++;
        // Show the nudge only in the small composer box, not in the transcript.
        $.ui.invalidate('ui.render');
      }
    }
    return next(e);
  });
  on('session.compact', async ($, e, next) => {
    // Clear before compaction as concurrent reads may finish during it; precompute also clears conservatively.
    epoch++; cache.clear();
    const before = phase; if (!e.agentId && e.trigger !== 'precompute') { phase = 'compacting'; $.ui.invalidate('ui.render'); }
    let result; try { result = await next(e); } finally { if (phase === 'compacting') { phase = before; $.ui.invalidate('ui.render'); } }
    if (!result.skip && e.trigger !== 'precompute' && !e.agentId) {
      baselineTurns = await $.session.turns(); baselineDuplicates = metrics.duplicateReadsAvoided;
      metrics.compactions++; lastNotice = -100;
      contextPercent = null; repeatedPrompt = false; promptHashes = []; if (phase !== 'working') { phase = 'done'; turnSaved = true; smallMessage = 'Made room. This chat is lighter now.'; } $.ui.invalidate('ui.render');
    }
    return result;
  });
  // The end of each turn lists the background work still running, so "Done" never hides it.
  on('classic.Stop', async ($, e, next) => {
    if (config.enabled) { bgTasks = Array.isArray(e.background_tasks) ? e.background_tasks : []; $.ui.invalidate('ui.render'); }
    return next(e);
  });
  on('session.end', async ($, e, next) => { bgTasks = []; if (idleTimer) idleTimer.cancel(); epoch++; cache.clear(); promptHashes = []; return next(e); });
  on('command.run', { command: 'efficiency-stats' }, async ($, e) => ({
    text: e.args.trim() === 'json' ? JSON.stringify(report(metrics), null, 2) : formatStats(metrics)
  }));
  on('command.run', { command: 'efficiency-bypass' }, async () => {
    cache.clear(); bypass = true;
    return { text: '🔎 Next eligible tool result will be returned unchanged. Duplicate cache cleared.' };
  });
  on('command.run', { command: 'efficiency-original' }, async ($, e) => {
    const id = e.args.trim();
    if (!/^[0-9a-f-]{36}$/.test(id)) return { text: '📂 Supply the original ID from an efficiency marker.' };
    const original = await $.store.get(`original:${id}`);
    if (!original) return { text: '⚠️ Original unavailable (purged or different machine/user). Re-run with /efficiency-bypass.' };
    const text = JSON.stringify(original.result, null, 2);
    // Include recovery context in net estimates; recovering originals can erase savings.
    account(metrics, '', text, 'recovery'); metrics.originalsRecovered++;
    if (config.telemetry) {
      try { await $.store.set(`metrics:${sessionId}`, report(metrics)); } catch { metrics.telemetryFailures++; }
    }
    return { text, context: [text] };
  });
  on('command.run', { command: 'efficiency-draft' }, async ($) => {
    const text = handoff(await $.session.messages(), config);
    return { text };
  });
  on('command.run', { command: 'efficiency-purge' }, async ($, e) => {
    if (e.args.trim() !== 'confirm') return { text: '🧹 Run /efficiency-purge confirm to delete all originals and persisted metrics. Existing recovery IDs will stop working.' };
    await queue;
    cache.clear(); epoch++;
    for (const key of await $.store.keys()) if (key.startsWith('original:') || key.startsWith('metrics:')) await $.store.delete(key);
    archiveBytes = 0;
    return { text: '✅ Local originals and persisted metrics deleted. In-memory session counters remain.' };
  });
}
