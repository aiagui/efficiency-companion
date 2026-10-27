// Pure transformations: no filesystem, process, model or network access.
export const DEFAULTS = Object.freeze({ enabled: true, mode: 'apply', redactSecrets: false,
  minBytes: 2048, contextPercent: 75, maxTurns: 30, duplicateThreshold: 3,
  maxCacheEntries: 256, archiveBudgetBytes: 2000000, diffContextReduction: false, telemetry: true, animateCompanion: true, tips: true, skin: 'orange' });
export function configuration(options = {}) {
  const c = { ...DEFAULTS };
  for (const k of Object.keys(c)) {
    if (typeof options[k] === typeof c[k]) c[k] = options[k];
  }
  for (const k of ['minBytes','maxTurns','duplicateThreshold','maxCacheEntries','archiveBudgetBytes']) {
    if (!Number.isFinite(c[k]) || c[k] < 1) c[k] = DEFAULTS[k];
    c[k] = Math.floor(c[k]);
  }
  c.maxCacheEntries = Math.min(c.maxCacheEntries, 1024);
  c.archiveBudgetBytes = Math.min(c.archiveBudgetBytes, 2000000);
  if (!Number.isFinite(c.contextPercent) || c.contextPercent < 1 || c.contextPercent > 100) c.contextPercent = 75;
  if (!['apply','observe'].includes(c.mode)) c.mode = 'observe';
  if (!['orange','blue','green','purple'].includes(c.skin)) c.skin = 'orange';
  return c;
}
export const bytes = text => new TextEncoder().encode(text).length;
export const estimateTokens = text => Math.ceil(bytes(text) / 4);
export async function hash(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export function redact(text) {
  return text.replace(/\b(?:sk-ant-[\w-]+|sk-[\w-]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/(\b(?:authorization\s*[:=]\s*bearer\s+))[\w.+/=-]+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:password|api[_-]?key|access[_-]?token|secret)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]');
}
const DIAGNOSTIC = /error|warn|fail|exception|traceback|assert|fatal|panic|\bat\s+\S+\s*\(|^\s*File\s+"|^\s*[EF]\s|caused by|\bexpected\b|\bactual\b|\bnot ok\b/i;
const NOISE = /^(?:\s*PASS\s+\S.*|\s*✓\s+.*|\s*\.{10,}\s*(?:\[\s*\d+%\])?\s*|\s*\[?\d+\/\d+\]?\s+(?:Building|Compiling|Bundling)\b.*|\s*npm (?:http fetch|timing)\b.*|\s*Successfully (?:compiled|built)\b.*|\s*collected \d+ items\s*)$/i;
export function slim(text, config) {
  if (bytes(text) < config.minBytes) return { text, reason: 'small' };
  // All JSON values survive; only representation whitespace is removed.
  try {
    JSON.parse(text); // Validate only: serialization would round large numeric literals.
    let compact = '', inString = false, escaped = false;
    for (const char of text) {
      if (inString) {
        compact += char;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') { inString = true; compact += char; }
      else if (!/[ \t\r\n]/.test(char)) compact += char;
    }
    return { text: compact, reason: 'json-whitespace' };
  } catch {}
  const lines = text.split('\n');
  if (/^(?:diff --git|@@ |--- a\/)/m.test(text)) {
    if (!config.diffContextReduction) return { text, reason: 'diff-preserved' };
    const kept = lines.filter(l => !l.startsWith(' '));
    return { text: kept.join('\n'), reason: 'diff-context-only' };
  }
  const protectedLines = new Set();
  for (let i = 0; i < lines.length; i++) if (DIAGNOSTIC.test(lines[i])) {
    for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 5); j++) protectedLines.add(j);
  }
  let omitted = 0;
  const kept = lines.filter((l, i) => {
    if (i < 3 || i >= lines.length - 3 || protectedLines.has(i) || !NOISE.test(l)) return true;
    omitted++; return false;
  });
  return { text: kept.join('\n'), reason: omitted ? `log-noise:${omitted}` : 'unknown-preserved' };
}
export function textView(tool, result) {
  if (!result || typeof result !== 'object') return null;
  if (tool === 'Bash' && typeof result.stdout === 'string' && typeof result.stderr === 'string'
      && !result.interrupted && !result.isImage && !result.backgroundTaskId && !result.rawOutputPath
      && !result.backgroundedByUser && !result.backgroundedByTurnAbort && !result.backgroundedToDeliverMessage
      && !result.timedOutAfterMs) {
    return { text: result.stdout, combined: JSON.stringify(result),
      rebuild: text => ({ ...result, stdout: text }) };
  }
  if (tool === 'Read' && result.type === 'text' && typeof result.file?.content === 'string'
      && !result.file.truncatedByTokenCap) {
    return { text: result.file.content, combined: JSON.stringify(result),
      rebuild: text => ({ ...result, file: { ...result.file, content: text, numLines: text.split('\n').length } }) };
  }
  return null;
}
export function initialMetrics() {
  return { schemaVersion: 1, outputsSeen: 0, beforeBytes: 0, afterBytes: 0,
    estimatedTokensBefore: 0, estimatedTokensAfter: 0, outputsCompressed: 0,
    duplicateReadsAvoided: 0, originalsRecovered: 0, potentialBytesSaved: 0, guardNotices: 0,
    archiveFailures: 0, telemetryFailures: 0, bypassed: 0, compactions: 0 };
}
export function report(m) {
  return { ...m, bytesRemoved: m.beforeBytes - m.afterBytes,
    savingsPercent: m.beforeBytes ? Number((100 * (m.beforeBytes - m.afterBytes) / m.beforeBytes).toFixed(2)) : 0,
    tokenEstimateMethod: 'ceil(UTF-8 bytes / 4); not billing tokens' };
}
export function account(m, before, after, kind, potential = 0) {
  m.outputsSeen++; m.beforeBytes += bytes(before); m.afterBytes += bytes(after);
  m.estimatedTokensBefore += estimateTokens(before); m.estimatedTokensAfter += estimateTokens(after);
  m.potentialBytesSaved += Math.max(0, potential);
  if (kind === 'duplicate') m.duplicateReadsAvoided++;
  else if (kind === 'slim') m.outputsCompressed++;
}
export function guard(context, turns, duplicates, config) {
  const reasons = [];
  if (typeof context?.percent === 'number' && context.percent >= config.contextPercent) reasons.push(`context ${context.percent}%`);
  if (turns >= config.maxTurns) reasons.push(`${turns} user turns`);
  if (duplicates >= config.duplicateThreshold) reasons.push(`${duplicates} duplicate reads`);
  return reasons;
}
export function handoff(messages, config) {
  const user = messages.filter(m => m.role === 'user' && m.text);
  const assistant = messages.filter(m => m.role === 'assistant' && m.text);
  const files = [...new Set(messages.flatMap(m => (m.toolUses ?? []).map(t => t.input?.file_path).filter(Boolean)))];
  const clean = s => config.redactSecrets ? redact(s) : s;
  const excerpt = s => clean(s).slice(0, 1600);
  return ['# 📋 Handoff draft — review before restarting',
    'Deterministic excerpts, not a validated task summary. Fill missing decisions and next steps.',
    '## Initial request', excerpt(user[0]?.text ?? '(not available)'),
    '## Latest request', excerpt(user.at(-1)?.text ?? '(not available)'),
    '## Latest assistant note', excerpt(assistant.at(-1)?.text ?? '(not available)'),
    '## Files mentioned by tools', ...files.slice(-20).map(clean),
    '## ✍️ Verify and complete', '- Completed: [review]', '- Decisions and constraints: [review]',
    '- Open issues: [review]', '- Next step: [review]',
    'Recover any reduced tool output with /efficiency-original <id> before relying on omitted details.'].join('\n');
}

export function formatStats(metrics) {
  const m = report(metrics);
  const number = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (m.outputsSeen === 0) return [
    '📊 Claude Efficiency',
    'Ready when you are.',
    '',
    'No eligible tool outputs processed yet.',
    'Read a project file or run tests, then check back.',
    '',
    '📂 Originals stay available when output is reduced.',
    'Details: /efficiency-stats json'
  ].join('\n');
  return [
    '📊 Claude Efficiency',
    `🪶 Estimated tool-output reduction: ${m.savingsPercent}%`,
    '',
    `Estimated tokens: ${number(m.estimatedTokensBefore)} → ${number(m.estimatedTokensAfter)}`,
    `Outputs reduced: ${number(m.outputsCompressed)}`,
    `♻️ Duplicate reads avoided: ${number(m.duplicateReadsAvoided)}`,
    `📂 Originals recovered: ${number(m.originalsRecovered)}`,
    ...(m.potentialBytesSaved ? [`Observed potential reduction: ${number(m.potentialBytesSaved)} bytes`] : []),
    ...(m.archiveFailures ? [`⚠️ Archive issues: ${number(m.archiveFailures)}; full outputs retained on write failure`] : []),
    ...(m.telemetryFailures ? [`⚠️ Metric storage issues: ${number(m.telemetryFailures)}`] : []),
    '',
    'Estimates use UTF-8 bytes / 4; not billed tokens.',
    'Original retrieval overhead is included.',
    'Details: /efficiency-stats json'
  ].join('\n');
}
export function reductionLabel(reason, duplicate) {
  if (duplicate) return '♻️ duplicate content avoided';
  if (reason.startsWith('log-noise:')) return `🪶 ${reason.slice('log-noise:'.length)} routine log lines omitted`;
  if (reason === 'json-whitespace') return '🪶 JSON formatting condensed';
  if (reason === 'diff-context-only') return '🪶 diff context lines omitted';
  return '🪶 output adjusted';
}
