import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpstreamEffort } from '../agy-capsule/sidecars/agy_capsule/effort_upstream.mjs';

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

function mountSlider(baseName, startingEffort) {
  const frames = new Map();
  const elements = new Map();
  const levels = [{ effort: 'low', label: 'Low' }, { effort: 'medium', label: 'Medium' }, { effort: 'high', label: 'High' }];
  const counters = { seatReads: 0, styleReads: 0, rectReads: 0, contextReads: 0, paints: 0 };
  const resize = { disconnected: false };
  const motion = { matches: false };
  let frameId = 0;
  const window = {
    ResizeObserver: class {
      constructor(callback) { resize.update = rect => callback([{ contentRect: rect }]); }
      observe(target) { resize.target = target; }
      disconnect() { resize.disconnected = true; }
    },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    matchMedia: () => motion,
    getComputedStyle() { counters.styleReads++; return { backgroundColor: 'rgb(20, 20, 20)' }; },
    performance: { now: () => 1 },
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
