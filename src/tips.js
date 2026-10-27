// Plain-English efficiency coaching. Tips only fire on facts the session reports:
// the model in use and the effort level of the main conversation.
const HIGH = new Set(['high', 'xhigh', 'max']);
export function pickTip({ modelName = '', effort, dismissed = new Set() } = {}) {
  if (/^opus/i.test(modelName) && !dismissed.has('opus')) {
    const times = /^opus 5\.5/i.test(modelName) ? 'about twice' : 'about 2.5 times';
    return { id: 'opus', text: `You’re on ${modelName}. Its list price per token is ${times} Sonnet 5.5’s. For everyday work, Sonnet is usually enough. Switch with /model.` };
  }
  if ((HIGH.has(effort) || (typeof effort === 'number' && effort >= 50000)) && !dismissed.has('effort')) {
    const level = typeof effort === 'string' ? effort : 'high';
    return { id: 'effort', text: `Effort is set to ${level}. That thinks longer and uses more of your allowance. Lower it when the task is simple.` };
  }
  return null;
}
export const costLine = usd => typeof usd === 'number' && Number.isFinite(usd) && usd > 0
  ? `Cost so far: $${usd < 10 ? usd.toFixed(2) : Math.round(usd)} (Claude Code’s own estimate).` : '';
