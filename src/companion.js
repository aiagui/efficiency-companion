// A tiny original vector character, drawn as a local SVG (no remote assets, scripts or timers).
// Motion is plain CSS inside the image: breathing, blinking, and one small reaction per state.
// Everything stops under the system's Reduce Motion setting, and when the user pauses animation;
// each state keeps its own expression and badge, so it still reads when still.
const INK = '#31261F';
export const SKINS = {
  orange: { base: '#CC785A', warm: '#D78B56' },
  blue: { base: '#5B8DEF', warm: '#7AA2F0' },
  green: { base: '#4FAF8A', warm: '#6DBF9F' },
  purple: { base: '#8E7CE0', warm: '#A596E8' },
};
export const skinNames = Object.keys(SKINS);
const STATES = {
  hello: 'Your efficiency helper says hello.',
  tool: 'Your efficiency helper is watching a tool run.',
  compacting: 'Your efficiency helper is tidying the chat.',
  ready: 'Your efficiency helper is ready.',
  working: 'Your efficiency helper is waiting while Claude works.',
  done: 'Your efficiency helper is happy: Claude finished.',
  saved: 'Your efficiency helper trimmed some long output.',
  pressure: 'Your efficiency helper suggests a fresh chat.',
  curious: 'Your efficiency helper noticed a repeated prompt.',
  stopped: 'Your efficiency helper is calm: the turn was stopped.',
  error: 'Your efficiency helper is concerned: the turn did not finish.',
  sleepy: 'Your efficiency helper is resting while you are away.',
};
export const companionStates = Object.keys(STATES);
export const companionAlt = state => STATES[state] ?? STATES.ready;

const stroke = (d, w = 1.5, c = INK) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const openEyes = `<g class="look"><g class="eye"><ellipse cx="13.5" cy="17" rx="1.6" ry="2.1" fill="${INK}"/><ellipse cx="22.5" cy="17" rx="1.6" ry="2.1" fill="${INK}"/></g></g>`;
const EYES = {
  open: openEyes,
  happy: stroke('M11.6 18.2q1.9-3 3.8 0') + stroke('M20.6 18.2q1.9-3 3.8 0'),
  flat: stroke('M11.8 17.5h3.4') + stroke('M20.8 17.5h3.4'),
  worried: openEyes + stroke('M11.4 13.2l3.4-1.2', 1.2) + stroke('M24.6 13.2l-3.4-1.2', 1.2),
  asleep: stroke('M11.6 16.6q1.9 2.6 3.8 0') + stroke('M20.6 16.6q1.9 2.6 3.8 0'),
  // Sunglasses: two dark lenses, a bridge and a small glint.
  shades: `<rect x="10" y="14.2" width="7.4" height="5" rx="2.3" fill="${INK}"/><rect x="18.6" y="14.2" width="7.4" height="5" rx="2.3" fill="${INK}"/>${stroke('M17.4 15.6h1.2', 1.1)}<path class="glint" d="M11.6 15.4h2" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".55"/><path class="glint" d="M20.2 15.4h2" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".55"/>`,
};
const MOUTHS = {
  smile: stroke('M15.4 22.6q2.6 1.9 5.2 0', 1.4),
  grin: stroke('M14.6 22q3.4 3.6 6.8 0', 1.4),
  flat: stroke('M16 23.2h4', 1.4),
  wavy: stroke('M15.2 23.4q1.2-1.2 2.4 0t2.4 0t2 0', 1.3),
  small: `<circle cx="18" cy="23.2" r="1.2" fill="none" stroke="${INK}" stroke-width="1.3"/>`,
  frown: stroke('M15.4 24.2q2.6-2 5.2 0', 1.4),
};
const FACES = {
  hello: ['open', 'grin'], tool: ['open', 'flat'], compacting: ['happy', 'small'], ready: ['open', 'smile'],
  working: ['open', 'flat'], done: ['happy', 'grin'], saved: ['open', 'grin'], pressure: ['open', 'wavy'],
  curious: ['open', 'small'], stopped: ['flat', 'flat'], error: ['worried', 'frown'], sleepy: ['asleep', 'small'],
};
const RELAXED = new Set(['hello', 'ready', 'done', 'saved']);

const badges = c => ({
  hello: `<g class="wave"><rect x="30.2" y="14" width="3.4" height="7" rx="1.7" fill="${c}"/></g>`,
  tool: `<g class="gear"><circle cx="29.5" cy="7.5" r="2.7" fill="none" stroke="${c}" stroke-width="1.7" stroke-dasharray="2.2 1.2"/></g>`,
  compacting: `<g class="squeeze">${stroke('M25.5 5.5l2 2l-2 2M33.5 5.5l-2 2l2 2', 1.2, c)}</g>`,
  working: `<g class="dots" fill="${c}"><circle cx="24" cy="5" r="1.2"/><circle cx="27.5" cy="5" r="1.2"/><circle cx="31" cy="5" r="1.2"/></g>`,
  done: `<g class="spark">${stroke('M30 4.5v5.5M27.2 7.2h5.6', 1.3, '#F0B84A')}</g>`,
  saved: '<circle cx="29.5" cy="8.5" r="4" fill="#5FA882"/><path d="M27.6 8.6l1.4 1.4 2.6-2.8" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  pressure: '<path class="drop" d="M30 8.6q2.1 2.7 0 4.4q-2.1-1.7 0-4.4z" fill="#7FB2D6"/>',
  error: '<circle cx="29.5" cy="8.5" r="4" fill="#C4553F"/><path d="M29.5 6.5v2.4" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><circle cx="29.5" cy="10.6" r=".8" fill="#fff"/>',
  sleepy: `<g class="zz" fill="${c}" font-family="-apple-system,system-ui,sans-serif" font-weight="600"><text x="26" y="10" font-size="7">z</text><text x="30" y="6" font-size="5">z</text></g>`,
});

// A little accessory that shows which model is in use: headphones (Sonnet), crown (Opus), cap (Haiku).
export function modelKind(label = '') {
  const m = String(label).toLowerCase().match(/opus|sonnet|haiku/);
  return m ? m[0] : '';
}
const accessory = kind => ({
  sonnet: `<g class="acc">${stroke('M6.8 15.5Q6.8 6.8 18 6.8T29.2 15.5', 1.7, '#5A5550')}<rect x="4.4" y="13.4" width="3.4" height="6.4" rx="1.5" fill="#8E7CE0"/><rect x="28.2" y="13.4" width="3.4" height="6.4" rx="1.5" fill="#8E7CE0"/></g>`,
  opus: '<g class="acc"><path d="M11.5 9.4l1.3-4.6 2.9 2.6 2.3-4.2 2.3 4.2 2.9-2.6 1.3 4.6z" fill="#F0B84A" stroke="#C98F1E" stroke-width=".6" stroke-linejoin="round"/></g>',
  haiku: '<g class="acc"><path d="M9.5 10q8.5-9 17 0z" fill="#3FB3A0"/><path d="M23.5 9.6h6.5" stroke="#2C8576" stroke-width="1.6" stroke-linecap="round"/><circle cx="18" cy="3.6" r="1" fill="#2C8576"/></g>',
})[kind] ?? '';

const confetti = '<g class="conf"><rect x="6" y="2" width="2" height="2" fill="#F0B84A"/><rect x="11" y="0" width="2" height="2" fill="#5FA882"/><rect x="17" y="1" width="2" height="2" fill="#6FA8DC"/><rect x="22" y="0" width="2" height="2" fill="#E0883E"/><rect x="27" y="2" width="2" height="2" fill="#9B8AD6"/><rect x="31" y="1" width="2" height="2" fill="#C4553F"/></g>';

const BREATHE = s => `.b{animation:breathe ${s}s ease-in-out infinite}`;
const MOTION = {
  hello: BREATHE(3.6) + '.h{animation:hop .9s ease-out 1}.wave{animation:wave 1s ease-in-out 3}',
  tool: BREATHE(2.2) + '.gear{animation:spin 2.2s linear infinite}.look{animation:look 2.4s ease-in-out infinite}',
  compacting: '.b{animation:squash 1.4s ease-in-out infinite}.squeeze{animation:pulse 1.4s ease-in-out infinite}',
  ready: BREATHE(4.2),
  working: BREATHE(2.4) + '.look{animation:look 3.2s ease-in-out infinite}.dots circle{animation:pulse 1.4s ease-in-out infinite}.dots circle:nth-child(2){animation-delay:.2s}.dots circle:nth-child(3){animation-delay:.4s}',
  done: BREATHE(4.2) + '.h{animation:hop .8s ease-out 1}.spark{animation:twinkle 2.6s ease-in-out infinite}',
  saved: BREATHE(4.2) + '.h{animation:hop .8s ease-out 1}',
  pressure: BREATHE(3.4) + '.drop{animation:drip 3s ease-in infinite}',
  curious: BREATHE(4.2), stopped: BREATHE(6), error: BREATHE(4.8),
  sleepy: BREATHE(7) + '.zz{animation:float 3.6s ease-in-out infinite}',
};
const KEYFRAMES = '@keyframes wave{0%,100%{transform:rotate(-15deg)}50%{transform:rotate(30deg)}}'
  + '@keyframes spin{to{transform:rotate(360deg)}}'
  + '@keyframes squash{0%,100%{transform:scale(1,1)}50%{transform:scale(1.14,.8)}}'
  + '@keyframes breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.05,1.08)}}'
  + '@keyframes blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}'
  + '@keyframes look{0%,100%{transform:translateX(0)}30%{transform:translateX(-1.1px)}70%{transform:translateX(1.1px)}}'
  + '@keyframes pulse{0%,100%{opacity:.25}50%{opacity:1}}'
  + '@keyframes hop{0%,100%{transform:translateY(0)}35%{transform:translateY(-3px)}65%{transform:translateY(0)}80%{transform:translateY(-1px)}}'
  + '@keyframes twinkle{0%,100%{opacity:.35}50%{opacity:1}}'
  + '@keyframes drip{0%,60%{transform:translateY(0);opacity:1}100%{transform:translateY(4px);opacity:0}}'
  + '@keyframes float{0%,100%{transform:translateY(0);opacity:.5}50%{transform:translateY(-2px);opacity:1}}'
  + '@keyframes fall{0%{transform:translateY(-3px);opacity:0}15%{opacity:1}100%{transform:translateY(11px) rotate(160deg);opacity:0}}'
  + '@keyframes glint{0%,70%,100%{opacity:.25}85%{opacity:.9}}';

// opts: { skin, model, relaxed, party }. All optional; the defaults give the plain orange helper.
export function companionSvg(state = 'ready', animated = true, opts = {}) {
  const name = STATES[state] ? state : 'ready';
  const skin = SKINS[opts.skin] ?? SKINS.orange;
  const color = name === 'pressure' ? skin.warm : skin.base;
  const party = !!opts.party && (name === 'done' || name === 'saved');
  const css = animated
    ? '.b,.h,.eye,.look,.dots circle,.spark,.drop,.gear,.wave,.squeeze,.zz,.conf rect{transform-box:fill-box}.wave{transform-origin:50% 100%}.gear{transform-origin:50% 50%}.b{transform-origin:50% 100%}.eye{transform-origin:50% 50%;animation:blink 5.4s infinite}.glint{animation:glint 6s ease-in-out infinite}.conf rect{animation:fall 1.8s ease-out 1 both}.conf rect:nth-child(2n){animation-delay:.15s}.conf rect:nth-child(3n){animation-delay:.3s}'
      + KEYFRAMES + MOTION[name] + '@media (prefers-reduced-motion:reduce){*{animation:none!important}.conf{display:none}}'
    : '';
  const [eyeKey, mouthKey] = FACES[name];
  const shades = !!opts.relaxed && RELAXED.has(name);
  const face = (shades ? EYES.shades : EYES[eyeKey]) + MOUTHS[mouthKey];
  const body = `<rect x="6" y="9" width="24" height="20" rx="8" fill="${color}"/>${face}${accessory(modelKind(opts.model))}`;
  const tilt = name === 'curious' ? ' transform="rotate(-7 18 29)"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><style>${css}</style><title>${companionAlt(name)}</title><ellipse cx="18" cy="31.2" rx="9" ry="1.3" fill="${INK}" opacity=".12"/><g class="h"${tilt}><g class="b">${body}</g></g>${badges(skin.base)[name] ?? ''}${party && animated ? confetti : ''}</svg>`;
}

// Picks the state from facts the plugin has verified. `phase` is what the session last did:
// hello (no turn yet), working, tool, compacting, done, stopped, error or idle.
export function companionState({ phase = 'idle', warning = false, repeated = false, saved = false, sleepy = false } = {}) {
  if (phase === 'compacting') return 'compacting';
  if (phase === 'tool') return 'tool';
  if (phase === 'working') return 'working';
  if (phase === 'error') return 'error';
  if (warning) return repeated ? 'curious' : 'pressure';
  if (sleepy) return 'sleepy';
  if (phase === 'stopped') return 'stopped';
  if (phase === 'done') return saved ? 'saved' : 'done';
  if (phase === 'hello') return 'hello';
  return saved ? 'saved' : 'ready';
}

// A text-only face for terminals, which cannot draw the SVG. Same states, same facts.
const TEXT_FACES = {
  hello: '(•‿•)/', working: '(•_•)…', tool: '(•_•)⚙', ready: '(•‿•)', done: '(^‿^)',
  saved: '(•‿•)✓', pressure: '(•~•);', curious: '(•o•)?', stopped: '(-_-)', error: '(•︵•)!',
  sleepy: '(-‿-) zZ', compacting: '(>‿<)',
};
export function companionText(state = 'ready', opts = {}) {
  const name = STATES[state] ? state : 'ready';
  if (opts.relaxed && RELAXED.has(name)) return name === 'done' ? '(⌐■‿■)✧' : '(⌐■‿■)';
  return TEXT_FACES[name];
}
