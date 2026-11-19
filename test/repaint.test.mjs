import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildRuntimeBundle } from '../agy-capsule/sidecars/agy_capsule/deck_injector.mjs';
import { DEFAULT_SETTINGS } from '../agy-capsule/sidecars/agy_capsule/settings.mjs';
import { createStubDom } from './dom-stub.mjs';

const snapshot = now => ({
  contextTokens: 128000, maxContextTokens: 256000, cachedIn: 100000,
  turn0Tokens: 20000, totalOutputTokens: 24000, totalThinkingTokens: 12000,
  lastStepEpochMs: now - 20000,
  prefs: { ...DEFAULT_SETTINGS },
  quotaGroups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: .58 }, { window: 'weekly', remainingFraction: .55 }] }],
});
const windowOf = dom => {
  const context = vm.createContext(dom.globals);
  vm.runInContext('globalThis.window = globalThis;', context);
  return context;
};

test('the footer strip is repainted only when what it shows or where it sits changed', () => {
  const owner = 1234;
  const dom = createStubDom();
  const footer = dom.element(), footerLeft = dom.element(), controls = dom.element();
  footer.appendChild(footerLeft);
  footer.appendChild(controls);
  dom.footers = [footerLeft];
  const context = windowOf(dom);
  assert.equal(vm.runInContext(buildRuntimeBundle(owner).code, context), true);
  const data = snapshot(dom.now);
  const apply = next => context.__agyCapsuleDeck.apply(next, '/', owner);
  // One second of the runtime's own timer; returns how many DOM writes it made.
  const second = () => { const before = dom.writes; dom.now += 1000; dom.tick(); return dom.writes - before; };
  assert.equal(apply(data), true);
  const strip = dom.document.getElementById('agy-capsule-host').shadowRoot.getElementById('deck-metrics-strip');
  const pill = strip.querySelector('[data-k="pillCtx"]');
  assert.equal(pill.textContent, '50%');
  assert.equal(second() + second(), 0, 'an idle second writes nothing to the page');

  apply({ ...data, contextTokens: 64000 });
  assert.equal(pill.textContent, '25%');

  // Clocks still repaint: three idle minutes turn the cache to its warning state.
  dom.now += 200000;
  dom.tick();
  assert.equal(strip.querySelector('[data-el="ctxIconSvg"]').style.color, 'rgba(206, 168, 92, 0.88)');

  // So does a live server-queue wait, which counts up every second.
  apply({ ...data, turnQueue: { userStepIndex: 10, waits: [], waitingSinceMs: dom.now - 31000, hasPendingPlanner: true, turnTerminal: false } });
  const alertPill = strip.querySelector('[data-el="grpError"]').querySelector('.dk-pill');
  assert.equal(alertPill.getAttribute('aria-label'), 'Server queue: Queue 31s');
  assert.ok(second() > 0);
  assert.equal(alertPill.getAttribute('aria-label'), 'Server queue: Queue 32s');

  // The expiry bar advances every second too, but only its fill is touched.
  apply({ ...data, prefs: { ...data.prefs, cacheIndicator: 'bar' } });
  const fill = strip.querySelector('[data-el="cacheMeterFill"]');
  const width = fill.style.width;
  assert.ok(second() <= 2);
  assert.notEqual(fill.style.width, width);

  // A host control that moved without an observer noticing gets the footer fitted again.
  apply(data);
  assert.equal(second(), 0);
  controls._rect = { ...controls._rect, left: 180 };
  assert.ok(second() > 0);
});
