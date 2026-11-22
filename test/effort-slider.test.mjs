import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpstreamEffort } from '../agy-capsule/sidecars/agy_capsule/effort_upstream.mjs';
import { createMotionThemes } from '../agy-capsule/sidecars/agy_capsule/motion_themes.mjs';

function makeElement() {
  const attributes = new Map();
  const classes = new Set();
  const listeners = new Map();
  return {
    children: [],
    classList: {
      add(...names) { for (const name of names) classes.add(name); },
      remove(...names) { for (const name of names) classes.delete(name); },
      contains: name => classes.has(name),
    },
    style: { setProperty(name, value) { this[name] = value; } },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
    hasAttribute: name => attributes.has(name),
    removeAttribute: name => attributes.delete(name),
    appendChild(child) { this.children.push(child); child.parentNode = this; },
    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1);
      child.parentNode = null;
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name),
    dispatch: (name, event) => listeners.get(name)?.(event),
  };
}

function mountSlider(baseName, startingEffort, mode = 'fast') {
  const frames = new Map();
  const elements = new Map();
  const levels = [{ effort: 'low', label: 'Low' }, { effort: 'medium', label: 'Medium' }, { effort: 'high', label: 'High' }];
  const counters = { seatReads: 0, styleReads: 0, rectReads: 0, contextReads: 0, paints: 0 };
  const resize = { disconnected: false };
  const motion = { matches: false };
  const store = new Map([['agy-capsule.effort-bar.v1', JSON.stringify({ v: 1, motion: mode })]]);
  let frameId = 0;
  let now = 1;
  const window = {
    localStorage: {
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    ResizeObserver: class {
      constructor(callback) { resize.update = rect => callback([{ contentRect: rect }]); }
      observe(target) { resize.target = target; }
      disconnect() { resize.disconnected = true; }
    },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    matchMedia: () => motion,
    getComputedStyle() { counters.styleReads++; return { backgroundColor: 'rgb(20, 20, 20)' }; },
    performance: { now: () => now },
  };
  const document = {
    body: makeElement(),
    documentElement: makeElement(),
    createElement(tag) {
      const element = makeElement();
      elements.set(tag, element);
      element.getBoundingClientRect = () => {
        counters.rectReads++;
        return { width: 280, height: 28, left: 0 };
      };
      if (tag === 'canvas') {
        element.getContext = () => {
          counters.contextReads++;
          return {
            clearRect() { counters.paints++; },
            createLinearGradient: () => ({ addColorStop() {} }),
            beginPath() {},
            moveTo() {},
            lineTo() {},
            quadraticCurveTo() {},
            closePath() {},
            fill() {},
            fillRect() {},
          };
        };
      }
      return element;
    },
  };
  const container = makeElement();
  const value = makeElement();
  const selections = [];
  const seat = {
    baseName,
    currentEffort: startingEffort,
    get effortLevels() { counters.seatReads++; return levels; },
    selectEffort(item) {
      selections.push(item.effort);
      this.currentEffort = item.effort;
    },
  };
  const slider = createUpstreamEffort().mountCodexEffortSlider({ container, valueElement: value, seat, document, window });
  const root = container.children[0];
  return {
    slider, value, root, track: root.children[0], selections, canvas: elements.get('canvas'), frames, resize, counters, motion,
    tick(time) {
      now = time;
      const scheduled = [...frames.values()];
      frames.clear();
      for (const callback of scheduled) callback(time);
    },
  };
}

const pointer = clientX => ({ clientX, button: 0, buttons: 1, pointerId: 1 });

test('dragging across tiers previews their effects and only commits the release tier', t => {
  const { slider, value, track, selections } = mountSlider('Gemini', 'low');
  t.after(() => slider.unmount());

  track.dispatch('pointerdown', pointer(140));
  assert.equal(value.textContent, 'Medium');
  track.dispatch('pointermove', pointer(266));
  assert.equal(value.textContent, 'High');
  assert.equal(value.classList.contains('is-glowing'), true);
  track.dispatch('pointermove', pointer(140));
  assert.equal(value.textContent, 'Medium');
  assert.deepEqual(selections, []);

  track.dispatch('pointerup', pointer(140));
  track.dispatch('lostpointercapture', pointer(140));
  assert.deepEqual(selections, ['medium']);
});

test('tap and keyboard commit without waiting for the slider animation', t => {
  const { slider, root, track, selections } = mountSlider('Gemini', 'low');
  t.after(() => slider.unmount());

  track.dispatch('pointerdown', pointer(140));
  track.dispatch('pointerup', pointer(140));
  assert.deepEqual(selections, ['medium']);
  root.dispatch('keydown', { key: 'ArrowRight' });
  assert.deepEqual(selections, ['medium', 'high']);
});

test('pointer cancellation discards the draft and restores the selected tier', t => {
  const { slider, value, track, selections } = mountSlider('Gemini', 'low');
  t.after(() => slider.unmount());

  track.dispatch('pointerdown', pointer(14));
  track.dispatch('pointermove', pointer(266));
  assert.equal(value.textContent, 'High');
  track.dispatch('pointercancel', pointer(266));
  assert.equal(value.textContent, 'Low');
  assert.deepEqual(selections, []);
});

test('switching tiers replays only the matching CSS effects without reading offsetWidth', t => {
  const { slider, value, root } = mountSlider('Gemini', 'low');
  t.after(() => slider.unmount());
  let widthReads = 0;
  Object.defineProperty(value, 'offsetWidth', { get() { widthReads++; return 100; } });
  const replayed = [];
  const rise = { animationName: 'ces-claude-rise', currentTime: 80, play: () => replayed.push('rise') };
  const glow = { animationName: 'ces-glow-flash', currentTime: 100, play: () => replayed.push('glow') };
  const other = { currentTime: 160, play: () => replayed.push('other') };
  value.getAnimations = ({ subtree }) => [rise, other, ...(subtree ? [glow] : [])];

  root.dispatch('keydown', { key: 'ArrowRight' });
  value.classList.add('is-glowing');
  root.dispatch('keydown', { key: 'End' });

  assert.equal(value.textContent, 'High');
  assert.equal(widthReads, 0);
  assert.deepEqual(replayed, ['rise', 'glow', 'rise']);
  assert.equal(rise.currentTime, 0);
  assert.equal(glow.currentTime, 0);
  assert.equal(other.currentTime, 160);
});

test('Claude frames reuse observed dimensions and redraw on resize in reduced-motion mode', t => {
  const { slider, canvas, counters, frames, resize, motion, tick } = mountSlider('Claude', 'high');
  t.after(() => slider.unmount());
  resize.update?.({ width: 250, height: 30 });
  const initialSeatReads = counters.seatReads;
  for (let time = 16; time <= 160; time += 16) tick(time);

  assert.equal(counters.rectReads, 0);
  assert.equal(counters.seatReads, initialSeatReads);
  assert.equal(canvas.width, 236);
  assert.equal(canvas.height, 30);
  assert.equal(counters.paints, 10);
  assert.equal(counters.styleReads, 1);
  assert.equal(counters.contextReads, 1);

  motion.matches = true;
  tick(176);
  assert.equal(frames.size, 0);
  resize.update({ width: 310, height: 28 });
  tick(192);
  assert.equal(canvas.width, 296);
  assert.equal(canvas.height, 28);
  assert.equal(counters.paints, 12);
  assert.equal(frames.size, 0);
  slider.unmount();
  assert.equal(resize.disconnected, true);
});

test('effort bar settings schema normalizes orchestratorMode, orchestrator3dStyle, codexTheme and orchestratorIcon choices', () => {
  const store = new Map();
  const win = {
    localStorage: {
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
  const upstream = createUpstreamEffort();
  assert.equal(upstream.readSettings(win).orchestratorMode, 'follow');
  assert.equal(upstream.readSettings(win).orchestrator3dStyle, 'helix');
  assert.equal(upstream.readSettings(win).codexTheme, 'nebula');
  assert.equal(upstream.readSettings(win).orchestratorIcon, 'prism');

  for (const mode of ['follow', 'dock', 'custom3d']) {
    upstream.writeSettings({ orchestratorMode: mode }, win);
    assert.equal(upstream.readSettings(win).orchestratorMode, mode);
  }
  for (const style of ['chamber', 'helix', 'orbital', 'c-matrix', 'c-louver', 'c-spark', 'nebula', 'beam', 'orb']) {
    upstream.writeSettings({ orchestrator3dStyle: style }, win);
    assert.equal(upstream.readSettings(win).orchestrator3dStyle, style);
  }
  for (const cx of ['nebula', 'beam', 'orb']) {
    upstream.writeSettings({ codexTheme: cx }, win);
    assert.equal(upstream.readSettings(win).codexTheme, cx);
  }
  for (const icon of ['prism', 'gravity', 'semicircle', 'none']) {
    upstream.writeSettings({ orchestratorIcon: icon }, win);
    assert.equal(upstream.readSettings(win).orchestratorIcon, icon);
  }
  upstream.writeSettings({ orchestratorMode: 'invalid', orchestrator3dStyle: 'invalid', codexTheme: 'invalid', orchestratorIcon: 'invalid' }, win);
  assert.equal(upstream.readSettings(win).orchestratorMode, 'follow');
  assert.equal(upstream.readSettings(win).orchestrator3dStyle, 'helix');
  assert.equal(upstream.readSettings(win).codexTheme, 'nebula');
  assert.equal(upstream.readSettings(win).orchestratorIcon, 'prism');

  assert.equal(upstream.readSettings(win).motion, 'fast');
  upstream.writeSettings({ motion: 'full' }, win);
  assert.equal(upstream.readSettings(win).motion, 'full');
  upstream.writeSettings({ motion: 'fast' }, win);
  assert.equal(upstream.readSettings(win).motion, 'fast');
  upstream.writeSettings({ motion: 'quick' }, win);
  assert.equal(upstream.readSettings(win).motion, 'fast');
});

test('tapping glides smoothly from the current position without teleporting, and fast finishes sooner than full', t => {
  const runTap = mode => {
    const { slider, track, selections, frames, tick } = mountSlider('Codex', 'low', mode);
    t.after(() => slider.unmount());
    track.dispatch('pointerdown', pointer(266));
    assert.equal(track.style['--ces-fill'], 'calc(14px + (100% - 28px) * 0)', 'knob stays at origin on pointerdown rather than teleporting');
    assert.ok(frames.size > 0, 'schedules rAF glide immediately');
    track.dispatch('pointerup', pointer(266));
    assert.deepEqual(selections, ['high']);
    let count = 0;
    for (let time = 17; frames.size > 0 && count < 120; time += 16) {
      tick(time);
      count++;
    }
    assert.equal(frames.size, 0, 'glide settles completely');
    assert.equal(track.style['--ces-fill'], 'calc(14px + (100% - 28px) * 1)');
    return count;
  };
  const fastFrames = runTap('fast');
  const fullFrames = runTap('full');
  assert.ok(fastFrames >= 3 && fastFrames < fullFrames, `expected fast (${fastFrames}) to glide and finish sooner than full (${fullFrames})`);
});

test('both fast and full use the 1/2 midpoint rule without 1/3 ratchet or flick inertia', t => {
  for (const mode of ['fast', 'full']) {
    const { slider, track, selections, tick } = mountSlider('Gemini', 'low', mode);
    t.after(() => slider.unmount());
    // Move to 40% of the first interval (past 1/3, before 1/2 midpoint) quickly (as a flick)
    track.dispatch('pointerdown', pointer(14));
    tick(17);
    track.dispatch('pointermove', pointer(64.4)); // 14 + 0.20 * 252 (between Low=0 and Medium=0.5)
    tick(33);
    track.dispatch('pointerup', pointer(64.4));
    assert.deepEqual(selections, [], `${mode}: below 1/2 midpoint does not advance even past 1/3 or on fast move`);
  }
});

test('motionThemes classifies Gemini 5 elements (with Flash fallback), Claude 3 models, and Codex accurately', () => {
  const mt = createMotionThemes();
  assert.deepEqual(mt.classifyModel('Gemini 4 Neon'), { family: 'gemini', element: 'neon' });
  assert.deepEqual(mt.classifyModel('Gemini 4 Argon'), { family: 'gemini', element: 'argon' });
  assert.deepEqual(mt.classifyModel('Gemini 4 Hydrogen'), { family: 'gemini', element: 'hydrogen' });
  assert.deepEqual(mt.classifyModel('Gemini 4 Carbon'), { family: 'gemini', element: 'carbon' });
  assert.deepEqual(mt.classifyModel('Gemini 3 Pro'), { family: 'gemini', element: 'flash' });
  assert.deepEqual(mt.classifyModel('Gemini 3 Flash'), { family: 'gemini', element: 'flash' });
  assert.deepEqual(mt.classifyModel('Orchestrator → Gemini 4 Argon'), { family: 'gemini', element: 'argon' });
  assert.deepEqual(mt.classifyModel('Claude Opus 4.6'), { family: 'claude', element: 'opus' });
  assert.deepEqual(mt.classifyModel('Claude Sonnet 4.6'), { family: 'claude', element: 'sonnet' });
  assert.deepEqual(mt.classifyModel('Claude Haiku 4.5'), { family: 'claude', element: 'haiku' });
  assert.deepEqual(mt.classifyModel('Claude'), { family: 'claude', element: 'opus' });
  assert.deepEqual(mt.classifyModel('GPT-5.4 Codex'), { family: 'codex', element: 'codex' });
  assert.equal(mt.dotColorFor('Claude Opus 4.6'), mt.CLAUDE_PALETTES.opus.accent);
  assert.equal(mt.dotColorFor('Claude Opus 4.6'), '#e07b53');
  assert.ok(mt.CLAUDE_PALETTES.opus.core[0] > mt.CLAUDE_PALETTES.opus.core[2], 'Opus slider core should be warm orange, not purple');
  assert.equal(mt.dotColorFor('Claude Sonnet 4.6'), mt.CLAUDE_PALETTES.sonnet.accent);
  assert.equal(mt.dotColorFor('Claude Haiku 4.5'), mt.CLAUDE_PALETTES.haiku.accent);
  assert.equal(mt.dotColorFor('Gemini 4 Neon'), mt.GEMINI_PALETTES.neon.accent);
  assert.equal(mt.dotColorFor('GPT-5.4 Codex'), '#8b5cf6');
  assert.equal(mt.dotColorFor('Gemini 3 Flash'), '#eab308');
  // Forcing Gemini animation style still preserves each model's own palette (never turns Claude into Flash yellow)
  assert.equal(mt.resolvePalette('Claude Opus 5.5', 'gemini').id, 'opus');
  assert.equal(mt.resolvePalette('Claude Sonnet 5.5', 'gemini').id, 'sonnet');
  assert.equal(mt.resolvePalette('Gemini 3.8 Flash', 'gemini').id, 'flash');

  // Orchestrator engine mapping: follow (3 families × 3 themes), dock, custom3d (9 styles)
  assert.deepEqual(mt.resolveOrchestratorEngine({ orchestratorMode: 'follow', effortTheme: 'auto', geminiTheme: 'physical' }, 'Gemini 4 Neon'), { kind: '3d', style: 'chamber', shape: 'pill' });
  assert.deepEqual(mt.resolveOrchestratorEngine({ orchestratorMode: 'follow', effortTheme: 'auto', geminiTheme: 'ribbon' }, 'Gemini 4 Argon'), { kind: '3d', style: 'helix', shape: 'pill' });
  assert.deepEqual(mt.resolveOrchestratorEngine({ orchestratorMode: 'follow', effortTheme: 'auto', geminiTheme: 'nebula' }, 'Gemini 3 Pro'), { kind: '3d', style: 'orbital', shape: 'pill' });
  assert.deepEqual(mt.resolveOrchestratorEngine({ orchestratorMode: 'follow', effortTheme: 'auto', claudeTheme: 'matrix' }, 'Claude Sonnet 4.6'), { kind: '3d', style: 'c-matrix', shape: 'claude' });
  assert.deepEqual(mt.resolveOrchestratorEngine({ orchestratorMode: 'follow', effortTheme: 'auto', claudeTheme: 'bars' }, 'Claude Haiku 4.5'), { kind: '3d', style: 'c-louver', shape: 'claude' });
  assert.deepEqual(mt.resolveOrchestratorEngine({ orchestratorMode: 'follow', effortTheme: 'auto', claudeTheme: 'spark' }, 'Claude Opus 4.6'), { kind: '3d', style: 'c-spark', shape: 'claude' });
  assert.deepEqual(mt.resolveOrchestratorEngine({ orchestratorMode: 'follow', effortTheme: 'auto', codexTheme: 'nebula' }, 'GPT-5.4 Codex'), { kind: 'classic', style: 'nebula', shape: 'pill' });
  assert.deepEqual(mt.resolveOrchestratorEngine({ orchestratorMode: 'follow', effortTheme: 'auto', codexTheme: 'beam' }, 'GPT-5.4 Codex'), { kind: 'classic', style: 'beam', shape: 'pill' });
  assert.deepEqual(mt.resolveOrchestratorEngine({ orchestratorMode: 'follow', effortTheme: 'auto', codexTheme: 'orb' }, 'GPT-5.4 Codex'), { kind: 'classic', style: 'orb', shape: 'pill' });
  assert.deepEqual(mt.resolveOrchestratorEngine({ orchestratorMode: 'dock' }, 'Claude Sonnet 4.6'), { kind: 'classic', style: 'dock', shape: 'pill' });
  assert.deepEqual(mt.resolveOrchestratorEngine({ orchestratorMode: 'custom3d', orchestrator3dStyle: 'c-spark' }, 'Gemini 4 Neon'), { kind: '3d', style: 'c-spark', shape: 'claude' });
  assert.deepEqual(mt.resolveOrchestratorEngine({ orchestratorMode: 'custom3d', orchestrator3dStyle: 'orb' }, 'Gemini 4 Neon'), { kind: 'classic', style: 'orb', shape: 'pill' });
});

test('Gemini elemental slider paints on canvas, labels element, and stops under reduced motion', t => {
  const { slider, root, counters, frames, motion, tick } = mountSlider('Gemini 4 Neon', 'high', 'fast');
  t.after(() => slider.unmount());
  assert.equal(root.getAttribute('data-theme'), 'gemini');
  assert.equal(root.getAttribute('data-element'), 'neon');
  assert.equal(root.getAttribute('data-motion'), 'fast');
  for (let time = 16; time <= 96; time += 16) tick(time);
  assert.ok(counters.paints >= 4);
  assert.ok(frames.size > 0);
  motion.matches = true;
  tick(112);
  assert.equal(frames.size, 0, 'stops continuous elemental rAF under reduced motion');
});

test('bidirectional settings sync prevents sidecar overwrite while host patch is pending and avoids loopbacks', () => {
  const store = new Map();
  let events = 0;
  const win = {
    localStorage: {
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { events++; },
  };
  const upstream = createUpstreamEffort();
  assert.equal(upstream.readPendingPatch(), null);

  // Sidecar -> Host sync updates localStorage without queueing a host patch back
  const applied = upstream.applySidecarPrefs({
    effortTheme: 'gemini',
    geminiTheme: 'nebula',
    claudeTheme: 'spark',
    orchestratorMode: 'custom3d',
    orchestrator3dStyle: 'orbital',
    effortMotion: 'full',
  }, win);
  assert.equal(applied, true);
  assert.equal(upstream.readPendingPatch(), null, 'fromSidecar does not emit loopback patch');
  assert.equal(upstream.readSettings(win).geminiTheme, 'nebula');
  assert.equal(upstream.readSettings(win).orchestrator3dStyle, 'orbital');
  assert.equal(upstream.readSettings(win).motion, 'full');
  const eventsAfterSidecar = events;

  // Identical sidecar prefs are a no-op
  assert.equal(upstream.applySidecarPrefs({ effortTheme: 'gemini', geminiTheme: 'nebula', claudeTheme: 'spark', orchestratorMode: 'custom3d', orchestrator3dStyle: 'orbital', effortMotion: 'full' }, win), false);
  assert.equal(events, eventsAfterSidecar);

  // Host right-click write queues pending sidecar patch & shields against stale sidecar push
  upstream.writeSettings({ geminiTheme: 'ribbon', motion: 'fast' }, win);
  const pending = upstream.readPendingPatch();
  assert.ok(pending && pending.rev >= 1);
  assert.deepEqual(pending.patch, { geminiTheme: 'ribbon', effortMotion: 'fast' });
  assert.equal(upstream.applySidecarPrefs({ geminiTheme: 'nebula', effortMotion: 'full' }, win), false, 'stale sidecar prefs ignored until ack');
  assert.equal(upstream.readSettings(win).geminiTheme, 'ribbon');

  // After sidecar acks rev, subsequent sidecar changes apply normally
  upstream.ackPendingPatch(pending.rev);
  assert.equal(upstream.readPendingPatch(), null);
  assert.equal(upstream.applySidecarPrefs({ geminiTheme: 'physical', effortMotion: 'full' }, win), true);
  assert.equal(upstream.readSettings(win).geminiTheme, 'physical');
  assert.equal(upstream.readSettings(win).motion, 'full');
});

test('fast vs full motion scales steady-state ambient loops on Codex stars and Orchestrator CSS', t => {
  const fastRun = mountSlider('GPT-5.4 Codex', 'high', 'fast');
  const fullRun = mountSlider('GPT-5.4 Codex', 'high', 'full');
  t.after(() => { fastRun.slider.unmount(); fullRun.slider.unmount(); });
  const firstStar = run => run.track.children.find(c => c.className === 'ces-stars').children[0];
  const fastDur = parseFloat(firstStar(fastRun).style.animationDuration);
  const fullDur = parseFloat(firstStar(fullRun).style.animationDuration);
  assert.ok(Number.isFinite(fastDur) && Number.isFinite(fullDur));
  assert.ok(fastDur < fullDur, `expected fast star duration (${fastDur}s) < full (${fullDur}s)`);
  assert.equal(fastRun.root.getAttribute('data-motion'), 'fast');
  assert.equal(fullRun.root.getAttribute('data-motion'), 'full');
});
