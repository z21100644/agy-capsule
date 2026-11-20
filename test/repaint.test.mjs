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

  // So does a live first-token wait, which counts up every second.
  apply({ ...data, turnQueue: { userStepIndex: 10, waits: [], waitingSinceMs: dom.now - 31000, hasPendingPlanner: true, turnTerminal: false } });
  const alertPill = strip.querySelector('[data-el="grpError"]').querySelector('.dk-pill');
  assert.equal(alertPill.getAttribute('aria-label'), 'First-token wait: Wait 31s');
  assert.ok(second() > 0);
  assert.equal(alertPill.getAttribute('aria-label'), 'First-token wait: Wait 32s');

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

  // The compact status bar is drawn only while it is switched on, and then keeps to the same rule.
  // By now the cache is close to expiry, so the time left stands where its hit rate was.
  const bar = strip.querySelector('.dk-ctx-pop').querySelector('[data-telemetry-bar]');
  const shown = () => [bar.dataset.mode, bar.dataset.cacheStatus, bar.querySelector('[data-telemetry="cacheValue"]').textContent, bar.querySelector('[data-telemetry="speedNum"]').textContent];
  const request = { requestIndex: 2, ttft: 1, streaming: 2, duration: 3, output: 300, tps: 100 };
  apply({ ...data, generation: request });
  assert.deepEqual(shown(), [undefined, undefined, '', ''], 'nothing is computed for the bar while it is off');
  apply({ ...data, generation: request, prefs: { ...data.prefs, compactTelemetryBar: true } });
  assert.equal(strip.dataset.compactTelemetryBar, 'true');
  assert.deepEqual(shown(), ['trio', 'warning', '~1m', '100']);
  assert.equal(second() + second(), 0, 'an idle second writes nothing to the bar either');
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

  // The compact status bar is drawn only while it is switched on: here as a single cache row.
  const bar = dom.document.querySelector('.panel').querySelector('[data-telemetry-bar]');
  const cached = bar.querySelector('[data-telemetry="cacheSub"]');
  assert.deepEqual([bar.dataset.mode, cached.textContent], [undefined, ''], 'nothing is computed for the bar while it is off');
  data.prefs.compactTelemetryBar = true;
  await poll();
  assert.deepEqual([bar.dataset.mode, cached.textContent], ['cache-only', '100K']);
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
  data.availableModels = ['Gemini 4 Argon', 'Claude'];
  await poll();
  await poll();
  assert.equal(used.textContent, '50%');
  assert.equal(dom.document.getElementById('cdp-notice').hidden, false, 'the notice shown on both tabs stays live');
  assert.deepEqual(
    dom.document.getElementById('setting-model-list').children.map(node => node.textContent),
    ['Gemini 4 Argon', 'Claude'],
    'the model list on the settings tab still populates as models arrive'
  );

  vm.runInContext("selectSidebarView('stats')", context);
  assert.equal(used.textContent, '25%');
});

test('the enhanced model capsule reacts to late trigger hydration and host model changes without idle repaints', () => {
  const owner = 1234;
  const dom = createStubDom();
  const footer = dom.element(), footerLeft = dom.element(), controls = dom.element();
  const trigger = dom.element('button');
  trigger.setAttribute('data-testid', 'model-selector-trigger');
  footerLeft.appendChild(trigger);
  footer.appendChild(footerLeft);
  footer.appendChild(controls);
  dom.footers = [footerLeft];
  const context = windowOf(dom);
  assert.equal(vm.runInContext(buildRuntimeBundle(owner).code, context), true);
  const data = { ...snapshot(dom.now), prefs: { ...DEFAULT_SETTINGS, modelEffortPicker: true } };
  const apply = next => context.__agyCapsuleDeck.apply(next, '/', owner);
  const second = () => { const before = dom.writes; dom.now += 1000; dom.tick(); return dom.writes - before; };

  assert.equal(apply(data), true);
  const strip = dom.document.getElementById('agy-capsule-host').shadowRoot.getElementById('deck-metrics-strip');
  assert.equal(strip._modelPicker, undefined, 'no picker before the host fiber is ready');
  assert.equal(second(), 0);

  // React hydrates the trigger without any new snapshot from the sidecar.
  const opts = [{ label: 'Argon (Low)' }, { label: 'Argon (High)' }];
  const selector = { modelOptions: opts, selectedModel: opts[0], setSelectedModel(opt) { this.selectedModel = opt; } };
  trigger.__reactFiber$test = {
    memoizedProps: { value: selector },
    return: { memoizedProps: { conversationId: 'conv-1', placement: 'top-start' } },
  };
  assert.ok(second() > 0, 'hydrating the host trigger mounts the picker on the next tick');
  assert.equal(strip._modelPicker?.id, 'conv-1');
  assert.equal(strip.children[0].dataset.label, 'Argon (Low)');
  assert.equal(second() + second(), 0, 'idle seconds still write nothing once mounted');

  // Host model changes without a new sidecar snapshot still update the picker.
  selector.selectedModel = opts[1];
  assert.ok(second() > 0);
  assert.equal(strip.children[0].dataset.label, 'Argon (High)');
  assert.equal(second(), 0);

  // Turning the setting off disposes the picker and releases the native trigger.
  apply({ ...data, prefs: { ...DEFAULT_SETTINGS, modelEffortPicker: false } });
  assert.equal(strip._modelPicker, undefined);
  assert.equal(trigger.getAttribute('data-deck-model-bubble'), null);
});
