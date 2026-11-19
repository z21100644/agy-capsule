import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildRuntimeBundle } from '../agy-capsule/sidecars/agy_capsule/deck_injector.mjs';
import { UI_HTML } from '../agy-capsule/sidecars/agy_capsule/server.mjs';
import { DEFAULT_SETTINGS } from '../agy-capsule/sidecars/agy_capsule/settings.mjs';
import { createStubDom } from './dom-stub.mjs';

const snapshot = now => ({
  contextTokens: 128000, maxContextTokens: 256000, cachedIn: 100000,
  turn0Tokens: 20000, totalOutputTokens: 24000, totalThinkingTokens: 12000,
  lastStepEpochMs: now - 20000,
  prefs: { ...DEFAULT_SETTINGS },
  quotaGroups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: .58 }, { window: 'weekly', remainingFraction: .55 }] }],
});
const windowOf = (dom, extra = {}) => {
  const context = vm.createContext({ ...dom.globals, ...extra });
  vm.runInContext('globalThis.window = globalThis;', context);
  return context;
};
// The sidebar page script, polling a snapshot the test can change.
const openSidebar = async data => {
  const dom = createStubDom({ page: true });
  const context = windowOf(dom, { fetch: async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) }) });
  vm.runInContext(UI_HTML.slice(UI_HTML.lastIndexOf('<script>') + '<script>'.length, UI_HTML.lastIndexOf('</script>')), context);
  // The page starts one refresh by itself and runs only one at a time; let that one finish.
  await new Promise(resolve => setImmediate(resolve));
  // One poll, a second later; resolves to how many DOM writes it made.
  const poll = async () => { const before = dom.writes; dom.now += 1000; await dom.tick(); return dom.writes - before; };
  return { dom, context, poll, used: dom.document.getElementById('used-pct') };
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

test('the sidebar repaints only when its data or settings changed', async () => {
  const data = snapshot(Date.now());
  const { dom, poll, used } = await openSidebar(data);
  await poll();
  assert.equal(used.textContent, '50%');
  assert.equal(await poll(), 0, 'an unchanged snapshot writes nothing to the page');

  data.contextTokens = 64000;
  await poll();
  assert.equal(used.textContent, '25%');

  data.prefs.language = 'zh-CN';
  await poll();
  assert.equal(dom.document.body.dataset.language, 'zh-CN');

  // The expiry bar advances every second, but only its fill is touched.
  data.prefs.cacheIndicator = 'bar';
  await poll();
  const fill = dom.document.getElementById('cache-meter-fill');
  const width = fill.style.width;
  assert.ok(await poll() <= 2);
  assert.notEqual(fill.style.width, width);
});

test('statistics behind the settings tab are not refreshed and catch up when it is left', async () => {
  const data = snapshot(Date.now());
  const { dom, context, poll, used } = await openSidebar(data);
  await poll();
  assert.equal(used.textContent, '50%');

  // A missing debugging port is reported once two polls in a row have seen it.
  vm.runInContext("selectSidebarView('settings')", context);
  data.contextTokens = 64000;
  data.deckCdp = 'missing';
  await poll();
  await poll();
  assert.equal(used.textContent, '50%');
  assert.equal(dom.document.getElementById('cdp-notice').hidden, false, 'the notice shown on both tabs stays live');

  vm.runInContext("selectSidebarView('stats')", context);
  assert.equal(used.textContent, '25%');
});
