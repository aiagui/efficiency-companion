// Plain helpers for the helper's status strip: context bar, colour, model name and agent count.
export function contextTone(percent, warnAt = 75) {
  if (typeof percent !== 'number') return 'unknown';
  if (percent >= Math.max(90, warnAt + 10)) return 'high';
  if (percent >= warnAt) return 'warn';
  return percent >= 50 ? 'mid' : 'low';
}
const COLORS = { low: '#5FA882', mid: '#C9A23F', warn: '#E0883E', high: '#C4553F', unknown: '#8A8680' };
export const toneColor = tone => COLORS[tone] ?? COLORS.unknown;
export const toneWord = tone => ({ low: 'Plenty of room', mid: 'Half full', warn: 'Getting full', high: 'Almost full', unknown: 'Not measured yet' })[tone];

export function barSvg(percent, warnAt = 75) {
  const p = typeof percent === 'number' ? Math.min(100, Math.max(0, percent)) : 0;
  const tone = contextTone(percent, warnAt);
  const fill = p > 0 ? `<rect x="0" y="0" width="${(p * 0.72).toFixed(1)}" height="8" rx="4" fill="${toneColor(tone)}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="8" viewBox="0 0 72 8"><title>Context ${Math.round(p)}% full</title><rect width="72" height="8" rx="4" fill="#8A8680" opacity=".28"/>${fill}</svg>`;
}
export function textBar(percent, cells = 10) {
  const n = Math.round((Math.min(100, Math.max(0, percent ?? 0)) / 100) * cells);
  return '█'.repeat(n) + '░'.repeat(cells - n);
}
export function modelLabel(id) {
  if (typeof id !== 'string' || !id) return '';
  const m = id.match(/(opus|sonnet|haiku|fable)[-\s]?(\d+)(?:[-.](\d))?/i);
  if (!m) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '');
  const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return `${name} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
}
export function agentsLabel(count) {
  return count > 0 ? `${count} ${count === 1 ? 'agent' : 'agents'} working` : '';
}
export function tokensLabel(tokens, window) {
  if (typeof tokens !== 'number' || typeof window !== 'number') return '';
  const k = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
  return `${k(tokens)} of ${k(window)} tokens`;
}

// A small coloured pill, drawn locally: a dot (optionally pulsing) and a short label.
export function chipSvg(label, color, pulse = false) {
  const text = String(label).replace(/[<>&"]/g, '');
  const w = Math.round(text.length * 7.2 + 28);
  const dot = `<circle class="d" cx="12" cy="12" r="3.4" fill="${color}"/>`;
  const css = pulse ? '.d{animation:p 1.6s ease-in-out infinite}@keyframes p{0%,100%{opacity:1}50%{opacity:.3}}@media (prefers-reduced-motion:reduce){.d{animation:none}}' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="24" viewBox="0 0 ${w} 24"><style>${css}</style><title>${text}</title><rect width="${w}" height="24" rx="12" fill="${color}" opacity=".18"/>${dot}<text x="21" y="16.2" font-family="-apple-system,system-ui,sans-serif" font-size="12.5" font-weight="500" fill="${color}">${text}</text></svg>`;
}
export const MODEL_COLOR = '#8E7CE0';
export const AGENT_COLOR = '#3FB3A0';

// Plain-English lines for the Details view.
export function savingsLines(m, savingsPercent) {
  const lines = [];
  if (m.outputsCompressed > 0) {
    const n = m.outputsCompressed;
    lines.push(`Shortened ${n} long ${n === 1 ? 'result' : 'results'}, roughly ${Math.max(0, Math.round(savingsPercent))}% less text. Nothing is lost: the full originals can be restored.`);
  } else lines.push('Nothing shortened yet. When a command prints a lot, I trim it and keep the original.');
  if (m.duplicateReadsAvoided > 0) lines.push(`Skipped ${m.duplicateReadsAvoided} repeated file ${m.duplicateReadsAvoided === 1 ? 'read' : 'reads'}.`);
  return lines;
}
export const tasksLabel = count => `${count} background task${count === 1 ? '' : 's'}`;
