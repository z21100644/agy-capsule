// Optional real-browser checks; runtime and node:test tests stay dependency-free.
// node test/browser-regressions.mjs [path to playwright module] [browser channel]
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UI_HTML } from '../agy-capsule/sidecars/agy_capsule/server.mjs';
import { DEFAULT_SETTINGS } from '../agy-capsule/sidecars/agy_capsule/settings.mjs';
import { buildRuntimeBundle, startDeckInjector } from '../agy-capsule/sidecars/agy_capsule/deck_injector.mjs';
import { readCloudConversationSnapshot } from '../agy-capsule/sidecars/agy_capsule/cloud_telemetry.mjs';
import { createPresentation } from '../agy-capsule/sidecars/agy_capsule/ui.mjs';
import { CURRENT_VERSION } from '../agy-capsule/sidecars/agy_capsule/version_check.mjs';
import { hostFixture } from './cdp-host-fixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const launch = { headless: true, ...(process.argv[3] ? { channel: process.argv[3] } : {}) };
const owner = 1234;
const apply = (page, data) => page.evaluate(({ data, owner }) => globalThis.__agyCapsuleDeck.apply(data, location.pathname, owner), { data, owner });
const snapshot = () => ({
  uiVersion: Number(UI_HTML.match(/d\.uiVersion !== (\d+)/)[1]),
  contextTokens: 128000, maxContextTokens: 256000, cachedIn: 100000,
  turn0Tokens: 20000, totalOutputTokens: 24000, totalThinkingTokens: 12000,
  lastStepEpochMs: Date.now(),
  generation: { requestIndex: 4, tps: 100, output: 400, ttft: 1, streaming: 3, duration: 4 },
  turnSpeed: { userStepIndex: 20, generation: { requestIndex: 4, tps: 100 }, hasActiveStep: false, completedAtMs: Date.now() },
  prefs: { ...DEFAULT_SETTINGS, showSpeed: false },
  quotaGroups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: .58 }, { window: 'weekly', remainingFraction: .55 }] }],
});

await test('Footer probe and capsule follow the visible composer and release the old one', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  const panel = (id, style, attrs = '') => `<section ${attrs} style="${style}"><div id="${id}" data-testid="conversation-view"><div class="agy-composer-footer"><div><button>Gemini</button></div></div></div></section>`;
  await page.setContent([
    panel('hidden', 'display:none'), panel('invisible', 'visibility:hidden'), panel('transparent', 'opacity:0'),
    panel('offscreen', 'position:fixed;left:110vw;width:950px'), panel('flat', 'width:0'),
    panel('small', 'width:320px', 'data-pane-id="small" data-pane-unfocused'),
    panel('active', 'width:300px', 'data-pane-id="active"'),
  ].join(''));
  await page.evaluate(buildRuntimeBundle(owner).code);
  const probe = () => page.evaluate(owner => globalThis.__agyCapsuleDeck.readState(owner).hasFooter, owner);
  const host = page.locator('#agy-capsule-host');
  const mountedIn = () => host.evaluate(el => el.closest('[data-testid="conversation-view"]').id);
  const data = snapshot();
  assert.equal(await probe(), true);
  await apply(page, data);
  assert.equal(await mountedIn(), 'active');

  await page.locator('section:has(#active)').evaluate(el => {
    el.querySelector('.agy-composer-footer > div').classList.add('dk-fl-squeezed');
    el.hidden = true;
  });
  await apply(page, data);
  assert.equal(await mountedIn(), 'small');
  assert.equal(await page.locator('#active .dk-fl-squeezed').count(), 0);
  await page.locator('#small').evaluate(el => { el.hidden = true; });
  assert.equal(await probe(), false);
  await apply(page, data);
  assert.equal(await host.count(), 0);
  await page.locator('section:has(#hidden)').evaluate(el => { el.style.display = 'block'; });
  assert.equal(await probe(), true);
  await apply(page, data);
  assert.equal(await mountedIn(), 'hidden');
});

await test('Injected cloud reader runs without imports and rejects stale composer identity', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage();
  const id = '11111111-1111-1111-1111-111111111111';
  const other = '22222222-2222-2222-2222-222222222222';
  await page.setContent(`<main id="root" data-testid="conversation-view" data-cascade-id="${id}"><div class="agy-composer-footer"><div><button>Model</button></div></div></main>`);
  await page.evaluate(id => {
    document.querySelector('main').__reactContainer$fixture = {child: {memoizedProps: {trajectorySlice: {
      conversationId: id, metadata: {}, totalStepsLength: 1,
      stepsInSlice: [{type: 15, status: 3, metadata: {modelUsage: {inputTokens: 50}}}],
    }}}};
  }, id);
  await page.evaluate(buildRuntimeBundle(owner).code);
  const read = (caller, path) => page.evaluate(({ caller, path, id }) => globalThis.__agyCapsuleDeck.readCloudTelemetry(caller, path ?? location.pathname, id), { caller, path, id });
  const sample = await read(owner);
  assert.equal(sample.conversationId, id);
  assert.equal(sample.steps[0].inputTokens, 50);
  assert.equal(await read(owner - 1), 'superseded');
  assert.equal(await read(owner, '/wrong'), false);
  await page.locator('main').evaluate((node, id) => node.setAttribute('data-cascade-id', id), other);
  assert.equal(await read(owner), false, 'a main view swap invalidates the pending read even without a route change');
});

await test('Cloud-only timing suppression leaves no space and clears when local data returns', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const deck = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  const panel = await browser.newPage({ viewport: { width: 360, height: 900 } });
  const fixture = snapshot();
  const local = { ...fixture, prefs: { ...fixture.prefs, showSpeed: true, showRequestMetrics: true } };
  // Keep generation data identical to exercise visibility and sidebar render invalidation independently of values.
  const cloud = { ...local, requestTimingAvailable: false, turnSpeed: { ...local.turnSpeed, hasActiveStep: true } };
  let panelData = local;
  await panel.route('http://agy.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/context') return route.fulfill({ json: panelData });
    if (path === '/preload.js') return route.fulfill({ body: '' });
    return route.fulfill({ body: UI_HTML, contentType: 'text/html' });
  });
  await panel.goto('http://agy.test/?token=panel-fixture');
  await deck.setContent('<main data-testid="conversation-view"><div class="agy-composer-footer" style="position:fixed;bottom:12px;width:90vw;display:flex"><div style="flex:1;display:flex"><button>Model</button></div><button data-testid="input-cancel-button">Cancel</button></div></main>');
  await deck.evaluate(buildRuntimeBundle(owner).code);
  const speed = deck.locator('#agy-capsule-host [data-el="pillSpeed"]');
  const ctx = deck.locator('#agy-capsule-host [data-el="grpCtx"] .dk-pill');
  const pop = deck.locator('#agy-capsule-host .dk-ctx-pop');
  const rows = page => ['timing', 'speed'].map(key => page.locator(`[data-generation-row="${key}"]`));
  const waitForRows = (page, state) => Promise.all(rows(page).map(row => row.waitFor({ state, timeout: 4000 })));

  assert.equal(await apply(deck, local), true);
  assert.equal(await speed.isVisible(), true);
  await ctx.click();
  await waitForRows(pop, 'visible');
  await waitForRows(panel, 'visible');

  panelData = cloud;
  assert.equal(await apply(deck, cloud), true);
  await waitForRows(pop, 'hidden');
  await waitForRows(panel, 'hidden');
  assert.equal(await speed.boundingBox(), null, 'an active cloud turn still takes no footer space');
  assert.equal(await pop.locator('[data-generation-block]').boundingBox(), null);
  assert.equal(await panel.locator('[data-generation-block]').boundingBox(), null);
  assert.equal(await pop.isVisible(), true);
  assert.equal(await panel.locator('#used-fraction').textContent(), '128K / 256K');

  panelData = local;
  assert.equal(await apply(deck, local), true);
  await waitForRows(pop, 'visible');
  await waitForRows(panel, 'visible');
  assert.equal(await speed.textContent(), '100.0 tok/s');

  // Exercise the opt-in using a real renderer read, then remove only the reported timing.
  const id = '11111111-1111-1111-1111-111111111111';
  await deck.locator('main').evaluate((main, id) => {
    main.dataset.cascadeId = id;
    document.body.firstElementChild.__reactContainer$fixture = { memoizedProps: { trajectorySlice: {
      conversationId: id, metadata: {}, totalStepsLength: 2,
      stepsInSlice: [{ type: 14, status: 3 }, { type: 15, status: 3, metadata: {
        modelUsage: { inputTokens: 128000, outputTokens: 90 }, modelInfo: { maxTokens: 256000 },
      } }],
      totalGeneratorMetadataLength: 4, generatorMetadataSlice: { startIndex: -1 },
      generatorMetadatasInSlice: [{ stepIndices: [1], metadata: { case: 'chatModel', value: {
        timeToFirstToken: { seconds: 1 }, streamingDuration: { seconds: 2 },
      } } }],
    } } };
  }, id);
  const read = async () => readCloudConversationSnapshot(await deck.evaluate(({ owner, id }) =>
    window.__agyCapsuleDeck.readCloudTelemetry(owner, location.pathname, id), { owner, id }));
  panelData = { ...local, ...await read() };
  assert.equal(await apply(deck, panelData), true);
  await speed.waitFor({ state: 'visible' });
  assert.equal(await speed.textContent(), '30.0 tok/s');
  await ctx.click();
  await waitForRows(pop, 'visible');
  await panel.locator('[data-generation="speed"]').filter({ hasText: '30.0 tok/s' }).waitFor({ state: 'visible', timeout: 4000 });
  assert.match(await pop.locator('[data-generation="timing"]').getAttribute('title'), /TTFT 1/);

  await deck.locator('main').evaluate(main => {
    main.__reactContainer$fixture.memoizedProps.trajectorySlice.generatorMetadatasInSlice[0].metadata = {};
  });
  panelData = { ...local, ...await read() };
  assert.equal(await apply(deck, panelData), true);
  await speed.waitFor({ state: 'hidden' });
  await waitForRows(pop, 'hidden');
  await waitForRows(panel, 'hidden');
});

await test('A wider side-question composer never takes the main footer capsule', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  const id = '11111111-1111-1111-1111-111111111111';
  const footer = '<div data-testid="agent-input-box"><div class="agy-composer-footer"><div><button>Gemini</button></div></div></div>';
  await page.route('http://agy.test/**', route => route.fulfill({ body: '', contentType: 'text/html' }));
  await page.goto(`http://agy.test/c/${id}?tab=side_question__fixture`);
  await page.setContent(`<div style="display:flex">
    <aside data-testid="side-question-tab-content" style="width:600px">
      <div data-testid="side-question-tab-composer" data-side-panel-composer>${footer}</div>
    </aside>
    <main data-testid="conversation-view" data-cascade-id="${id}" style="width:320px">${footer}</main>
  </div>`);
  await page.evaluate(buildRuntimeBundle(owner).code);
  const state = () => page.evaluate(owner => globalThis.__agyCapsuleDeck.readState(owner), owner);
  const host = page.locator('#agy-capsule-host');
  const side = page.getByTestId('side-question-tab-content');
  const main = page.getByTestId('conversation-view');
  assert.ok((await side.locator('.agy-composer-footer').boundingBox()).width >
    (await main.locator('.agy-composer-footer').boundingBox()).width);
  assert.equal(await apply(page, snapshot()), true);
  assert.equal(await main.locator('#agy-capsule-host').count(), 1);
  assert.equal(await side.locator('#agy-capsule-host, [data-agy-capsule-subagent]').count(), 0);
  assert.deepEqual((await state()).subagentIds, []);

  await main.evaluate(el => { el.hidden = true; });
  assert.equal((await state()).hasFooter, false, 'a visible side question cannot stand in for a missing main composer');
  assert.equal(await host.count(), 0);
  await main.evaluate(el => { el.hidden = false; });
  await side.evaluate(el => { el.hidden = true; });
  await apply(page, snapshot());
  assert.equal(await main.locator('#agy-capsule-host').count(), 1);
});

await test('Child capsules follow the transcript in side and main views without borrowing the parent', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const main = '11111111-1111-1111-1111-111111111111';
  const first = '22222222-2222-2222-2222-222222222222';
  const second = '33333333-3333-3333-3333-333333333333';
  await page.route('http://agy.test/**', route => route.fulfill({ body: '', contentType: 'text/html' }));
  await page.goto('http://agy.test/c/' + main);
  await page.setContent(`
    <div style="display:flex;gap:10px">
      <main data-testid="conversation-view" data-cascade-id="${main}" style="width:600px;min-height:150px">
        <div class="agy-composer-footer"><div><button>Parent model</button></div></div>
      </main>
      <aside style="width:220px;overflow:hidden">
        <div data-testid="subagent-tab-conversation" data-cascade-id="${first}" style="height:300px"></div>
        <div data-testid="subagent-tab-composer">
          <div id="native-child-input" style="position:relative;z-index:3;height:104px;background:white"></div>
        </div>
      </aside>
      <aside hidden>
        <div data-testid="subagent-tab-conversation" data-cascade-id="${second}" style="height:150px"></div>
        <div data-testid="subagent-tab-composer"></div>
      </aside>
    </div>
  `);
  const presentationVersion = createPresentation().version;
  await page.evaluate(stale => { globalThis.__agyCapsulePresentation = { version: stale }; }, presentationVersion - 1);
  await page.evaluate(buildRuntimeBundle(owner).code);
  assert.equal(await page.evaluate(() => globalThis.__agyCapsulePresentation.version), presentationVersion);
  const state = () => page.evaluate(owner => globalThis.__agyCapsuleDeck.readState(owner), owner);
  const applyMain = (id, data) => page.evaluate(({ owner, id, data }) =>
    globalThis.__agyCapsuleDeck.apply(data, location.pathname, owner, id), { owner, id, data });
  const applyChild = (id, data) => page.evaluate(({ owner, id, data }) =>
    globalThis.__agyCapsuleDeck.applySubagent(data, location.pathname, owner, id), { owner, id, data });
  const parent = page.locator('#agy-capsule-host');
  const child = page.locator('[data-agy-capsule-subagent]');
  const nativeStyle = page.locator('#agy-capsule-native-layout');
  const firstData = { ...snapshot(), subagent: { model: 'Child model (High)' }, contextTokens: 64000,
    turnQueue: { waits: [60], turnTerminal: true } };
  assert.deepEqual((await state()).subagentIds, [first], 'a retained hidden tab is ignored');
  await apply(page, snapshot());
  assert.equal(await parent.locator('[data-k="pillCtx"]').textContent(), '50%');
  await page.evaluate(() => history.replaceState({}, '', '/'));
  assert.equal((await state()).conversationId, main);
  assert.equal((await state()).hasFooter, true, 'an ordinary main composer survives without a /c/ route');
  assert.equal(await applyMain(main, snapshot()), true);
  assert.equal(await parent.locator('[data-k="pillCtx"]').textContent(), '50%');
  assert.equal(await child.count(), 0);
  assert.equal(await applyChild(first, firstData), true);
  assert.equal(await child.locator('[data-el="childModel"]').textContent(), 'Child model (High)');
  assert.match(await child.locator('[data-el="childModel"]').getAttribute('title'), /^Model used in the last request: Child model/);
  assert.equal(await child.locator('[data-el="grpCtx"] [data-k="pillCtx"]').textContent(), '25%');
  assert.equal(await child.locator('[data-el="grpQuota"]').isVisible(), false);
  assert.equal(await child.locator('[data-el="grpError"]').getAttribute('data-alert-mode'), 'queue');
  assert.ok((await child.locator('#deck-metrics-strip').boundingBox()).width <= 220);
  await child.locator('[data-el="grpCtx"] .dk-pill').click();
  assert.equal(await child.locator('.dk-ctx-pop').isVisible(), true);
  assert.equal(await child.evaluate(host => {
    const pop = host.shadowRoot.querySelector('.dk-ctx-pop');
    const panel = pop.getBoundingClientRect();
    const input = document.querySelector('#native-child-input').getBoundingClientRect();
    const x = Math.max(panel.left, input.left) + 15;
    const y = Math.min(panel.bottom, input.bottom) - 15;
    return y > Math.max(input.top, panel.top)
      && host.shadowRoot.elementFromPoint(x, y)?.closest('.dk-pop') === pop;
  }), true, 'where the two overlap, the pinned popover receives clicks above the native input');
  await page.keyboard.press('Escape');
  assert.equal(await child.locator('.dk-ctx-pop').isVisible(), false);
  await page.mouse.move(20, 20);
  await child.locator('[data-el="grpCtx"] .dk-pill').hover();
  await child.locator('.dk-ctx-pop:popover-open').waitFor();

  const childPane = page.locator('aside:not([hidden])');
  await childPane.evaluate(el => { el.style.width = '64px'; });
  await child.locator('#deck-metrics-strip').waitFor({ state: 'hidden' });
  assert.equal(await child.locator('.dk-ctx-pop:popover-open').count(), 0, 'the width fallback must also close the overlay');
  await page.mouse.move(20, 20);
  await childPane.evaluate(el => { el.style.width = '220px'; });
  await child.locator('#deck-metrics-strip').waitFor({ state: 'visible' });
  assert.equal(await child.locator('[data-el="grpError"]').isVisible(), true, 'all pills come back after resizing without a poll');
  assert.equal(await parent.locator('[data-k="pillCtx"]').textContent(), '50%');

  await page.locator('aside:not([hidden]) [data-testid="subagent-tab-conversation"]').evaluate((el, id) => {
    el.dataset.cascadeId = id;
  }, second);
  assert.equal(await child.count(), 0, 'the same URL must not keep the previous child strip');
  assert.deepEqual((await state()).subagentIds, [second]);
  assert.equal(await nativeStyle.count(), 1, 'side cleanup preserves the main native layout');
  assert.equal(await applyChild(first, firstData), false, 'reject a delayed snapshot for the previous child');
  const incomplete = { ...firstData, subagent: { model: '' }, maxContextTokens: 0,
    requestError: { kind: 'rate_limited' } };
  await applyChild(second, incomplete);
  assert.equal(await child.locator('[data-el="childModel"]').isVisible(), false);
  assert.equal(await child.locator('[data-el="grpCtx"]').isVisible(), false);
  assert.equal(await child.locator('[data-el="grpError"]').getAttribute('data-alert-mode'), 'error');

  const running = { ...incomplete, turnQueue: null, contextTokens: 0, requestError: null,
    prefs: { ...incomplete.prefs, showTurnMetrics: true, turnLayout: 'rows', turnMarker: 'dot', language: 'zh-TW' },
    turnMetrics: { executionId: 'child-execution', state: 'running', startedAtMs: Date.now() - 15_000,
      requestCount: 1, write: null, thinking: 5 } };
  await applyChild(second, running);
  assert.equal(await child.locator('[data-k="pillCtx"]').textContent(), '本輪');
  await child.getByRole('button', { name: '本輪', exact: true }).click();
  assert.equal(await child.locator('.dk-cache-bar').isVisible(), false);
  assert.equal(await child.locator('[data-turn-metric="requests"]').textContent(), '1');
  assert.equal(await child.locator('[data-turn-metric="write"]').textContent(), '—');
  assert.match(await child.locator('[data-turn-row="elapsed"]').getAttribute('title'), /此子 Agent 最近一次執行/);
  assert.equal(await child.locator('#deck-metrics-strip').getAttribute('data-turn-marker'), 'dot');
  assert.equal(await parent.locator('[data-turn-metrics-block]').isVisible(), false);
  await page.keyboard.press('Escape');

  await page.evaluate(id => {
    document.querySelector('aside:not([hidden])').remove();
    document.querySelector('main').dataset.cascadeId = id;
    document.querySelector('.agy-composer-footer').remove();
  }, second);
  assert.deepEqual((await state()).subagentIds, [second], 'read the displayed transcript ID, not the old URL');
  assert.equal(await parent.count(), 0);
  await applyChild(second, null);
  assert.equal(await child.count(), 0, 'no verified child snapshot means no strip');
  await page.evaluate(id => history.pushState({}, '', '/c/' + id), second);
  assert.deepEqual((await state()).subagentIds, [second]);
  await applyChild(second, firstData);
  assert.equal(await page.locator('main > [data-agy-capsule-subagent]').count(), 1);
  await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend',
    '<div><div class="agy-composer-footer"><div style="min-height:24px"></div></div></div>'));
  assert.equal((await state()).hasFooter, true);
  await apply(page, firstData);
  assert.equal(await child.count(), 1);
  assert.equal(await parent.count(), 0, 'a child in the main composer is still read-only');
  await page.locator('main').evaluate((el, id) => { el.dataset.cascadeId = id; }, main);
  assert.equal(await child.count(), 0, 'main transcript changes also clear the current child');
  assert.equal(await applyMain(second, firstData), false, 'reject a delayed snapshot for the old main transcript');
  assert.equal(await applyMain(main, snapshot()), true);
  assert.equal(await parent.count(), 1, 'the visible normal transcript still wins over the stale URL');
  await page.evaluate(() => globalThis.__agyCapsuleDeck.dispose());
  assert.equal(await child.count(), 0);
  assert.equal(await parent.count(), 0);
});

await test('Child footer speed and dot stay scoped to the execution and fit without context', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 700, height: 550 }, reducedMotion: 'no-preference' });
  const id = '22222222-2222-2222-2222-222222222222';
  await page.route('http://agy.test/**', route => route.fulfill({ body: '', contentType: 'text/html' }));
  await page.goto('http://agy.test/c/11111111-1111-1111-1111-111111111111');
  await page.setContent(`<aside style="width:240px;overflow:hidden">
    <div data-testid="subagent-tab-conversation" data-cascade-id="${id}" style="height:150px"></div>
    <div data-testid="subagent-tab-composer"></div>
  </aside>`);
  await page.evaluate(buildRuntimeBundle(owner).code);
  const applyChild = data => page.evaluate(({ id, owner, data }) =>
    globalThis.__agyCapsuleDeck.applySubagent(data, location.pathname, owner, id), { id, owner, data });
  const child = page.locator('[data-agy-capsule-subagent]');
  const strip = child.locator('#deck-metrics-strip');
  const context = child.locator('[data-el="grpCtx"]');
  const speed = child.locator('[data-el="pillSpeed"]');
  const dot = speed.locator('.dk-speed-dot');
  const animation = () => dot.evaluate(node => getComputedStyle(node).animationName);
  const measured = { executionId: 'first', generation: { requestIndex: 7, tps: 35 }, hasActiveStep: true };
  const data = { ...snapshot(), subagent: { model: '' }, turnSpeed: measured,
    prefs: { ...DEFAULT_SETTINGS, showSpeed: true, speedAnimation: true, showTurnMetrics: true },
    turnMetrics: { executionId: 'first', state: 'running', startedAtMs: Date.now(), requestCount: 1, write: 12, thinking: 3 } };

  assert.equal(await applyChild(data), true);
  await context.locator('[data-el="pillSpeed"]').waitFor();
  assert.equal(await speed.textContent(), '35.0 tok/s');
  assert.equal(await speed.getAttribute('data-motion'), 'active');
  assert.equal(await animation(), 'dk-speed-breathe');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await animation(), 'none');
  assert.equal(await speed.isVisible(), true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  data.contextTokens = data.maxContextTokens = 0;
  await applyChild(data);
  assert.equal(await context.locator('[data-k="pillCtx"]').textContent(), 'Turn');
  assert.equal(await speed.isVisible(), true);
  await page.locator('aside').evaluate(el => { el.style.width = '95px'; });
  await speed.waitFor({ state: 'hidden' });
  assert.equal(await context.isVisible(), true, 'fold speed first when the turn button still fits');
  await page.locator('aside').evaluate(el => { el.style.width = '240px'; });
  await speed.waitFor({ state: 'visible' });

  data.prefs.showTurnMetrics = false;
  await applyChild(data);
  await strip.locator(':scope > [data-el="pillSpeed"]').waitFor();
  assert.equal(await context.isVisible(), false, 'standalone speed does not expose a blank popover');
  assert.equal(await speed.textContent(), '35.0 tok/s');
  await page.locator('aside').evaluate(el => { el.style.width = '35px'; });
  await strip.waitFor({ state: 'hidden' });
  await page.locator('aside').evaluate(el => { el.style.width = '240px'; });
  await speed.waitFor({ state: 'visible' });

  data.prefs.speedAnimation = false;
  await applyChild(data);
  assert.equal(await speed.isVisible(), true);
  assert.equal(await dot.isVisible(), false);
  data.prefs.speedAnimation = true;
  await applyChild(data);
  data.turnSpeed = { ...measured, hasActiveStep: false };
  await applyChild(data);
  assert.equal(await speed.getAttribute('data-motion'), 'recent');
  assert.equal(await animation(), 'none');

  data.turnSpeed = { ...data.turnSpeed, executionId: 'second', generation: { requestIndex: 8, tps: 9 } };
  await applyChild(data);
  assert.equal(await speed.getAttribute('data-motion'), 'idle', 'the preceding run does not supply animation history');
  assert.equal(await speed.textContent(), '9.0 tok/s');
  data.turnSpeed = { executionId: 'third', generation: null, hasActiveStep: true };
  await applyChild(data);
  assert.equal(await speed.textContent(), '—', 'a new execution never shows the last measured value from an older one');
  assert.equal(await speed.getAttribute('data-motion'), 'active');
  data.prefs.showSpeed = false;
  await applyChild(data);
  assert.equal(await speed.isVisible(), false);
  data.prefs.showSpeed = true;
  data.turnSpeed.hasActiveStep = false;
  await applyChild(data);
  assert.equal(await speed.isVisible(), false, 'an inactive execution without a measurement has no speed pill');
});

await test('Sidebar clears empty or missing quotas and renders a later fresh snapshot', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 360, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const data = snapshot();
  let authorized = true;
  await page.route('http://agy.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/context') {
      assert.equal(route.request().method(), 'POST');
      assert.equal(route.request().headers()['x-sidecar-token'], 'panel-fixture');
      assert.equal(new URL(route.request().url()).search, '');
      if (!authorized) return route.fulfill({ status: 401, contentType: 'text/plain', body: 'Unauthorized' });
      return route.fulfill({ json: data });
    }
    if (path === '/preload.js') return route.fulfill({ body: '' });
    return route.fulfill({ contentType: 'text/html', body: UI_HTML });
  });
  await page.goto('http://agy.test/?token=panel-fixture');
  await page.waitForFunction(() => document.querySelectorAll('#quota-root .quota-group').length === 1);
  const quotas = data.quotaGroups;
  for (const empty of [[], null]) {
    data.quotaGroups = empty;
    await page.waitForFunction(() => document.getElementById('quota-root').childElementCount === 0, null, { timeout: 3000 });
    assert.equal(await page.locator('#quota-root').textContent(), '');
    data.quotaGroups = quotas;
    await page.waitForFunction(() => document.querySelectorAll('#quota-root .quota-group').length === 1);
  }
  assert.deepEqual(errors, []);
  authorized = false;
  await page.locator('#panel-auth-notice').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.sidebar-content').isVisible(), false);
  assert.match(await page.locator('#panel-auth-notice').textContent(), /Antigravity/);
  assert.match(await page.locator('#panel-auth-notice').textContent(), /S1/);
});

await test('Sidebar skips unchanged and hidden statistics but catches up on time and data changes', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 360, height: 700 } });
  const now = 1_700_000_000_000;
  const data = snapshot();
  data.prefs.showTurnMetrics = true;
  data.lastStepEpochMs = now - 171_000;
  data.turnMetrics = { state: 'running', startedAtMs: now - 10_000 };
  data.quotaGroups[0].buckets[0].resetTime = new Date(now + 125_000).toISOString();
  let polls = 0;
  await page.addInitScript(now => {
    window.testNow = now;
    Date.now = () => window.testNow;
    const interval = window.setInterval;
    window.setInterval = (fn, ms, ...args) => {
      if (fn.name !== 'refresh') return interval(fn, ms, ...args);
      window.testRefresh = fn;
    };
  }, now);
  await page.route('http://agy.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/context') { polls++; return route.fulfill({ json: data }); }
    return route.fulfill(path === '/preload.js' ? { body: '' } : { contentType: 'text/html', body: UI_HTML });
  });
  await page.goto('http://agy.test/?token=fixture');
  await page.waitForFunction(() => document.querySelector('#used-pct').textContent === '50%');
  const text = selector => page.locator(selector).first().textContent();
  const tick = () => page.evaluate(() => window.testRefresh());
  await page.evaluate(() => {
    window.quotaBefore = document.querySelector('.quota-bucket');
  });
  const tickAndCount = () => page.evaluate(async () => {
    let records = 0;
    const observer = new MutationObserver(changes => { records += changes.length; });
    observer.observe(document.querySelector('#sidebar-stats'), { subtree: true, childList: true, attributes: true, characterData: true });
    await window.testRefresh();
    records += observer.takeRecords().length;
    observer.disconnect();
    return records;
  });
  assert.equal(await tickAndCount(), 0, 'an identical poll must not write statistics DOM');
  assert.equal(await text('[data-turn-metric="elapsed"]'), '10s');
  assert.equal(await text('.quota-mid'), '2m');
  await page.evaluate(now => { window.testNow = now + 1000; }, now);
  await tick();
  assert.equal(await text('[data-turn-metric="elapsed"]'), '11s');
  assert.equal(await page.evaluate(() => window.quotaBefore === document.querySelector('.quota-bucket')), true);
  await page.evaluate(now => { window.testNow = now + 10_000; }, now);
  await tick();
  assert.equal(await text('[data-turn-metric="elapsed"]'), '20s');
  assert.equal(await text('.quota-mid'), '1m');
  assert.equal(await text('#val-cache-hit-k'), '~1m');
  data.requestError = { kind: 'context_overflow' };
  await tick();
  assert.equal(await page.locator('body').getAttribute('data-context-tone'), 'error');
  const overview = page.locator('[data-context-tip="overview"]').first();
  const overflowTip = await overview.getAttribute('title');
  assert.equal(await tickAndCount(), 0);
  assert.equal(await overview.getAttribute('title'), overflowTip, 'unchanged alerts do not append another warning');

  await page.locator('#sidebar-tab-settings').click();
  const before = polls;
  data.contextTokens = 64_000;
  data.availableModels = ['Gemini Fixture'];
  data.deckCdp = 'no-anchor';
  assert.equal(await tickAndCount(), 0, 'changed data must not write hidden statistics');
  assert.equal(polls, before + 1, 'settings still receives fresh data for its own controls and health');
  assert.equal(await text('#used-pct'), '50%');
  assert.equal(await text('[data-model-toggle="Gemini Fixture"]'), 'Fixture');
  assert.match(await text('#health-code'), /F3/);
  await page.locator('#sidebar-tab-stats').click();
  assert.equal(await text('#used-pct'), '25%');
  assert.equal(polls, before + 1, 'returning to statistics paints the latest snapshot without waiting for a poll');
});

await test('Sidebar version bar saves its toggle and reports manual checks', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 700 } });
  const data = snapshot();
  data.prefs = { ...data.prefs, settingsLanguage: 'zh-TW', showTurnMetrics: true, turnLayout: 'rows' };
  data.subagent = { model: 'Fixture' };
  data.turnMetrics = { executionId: 'child-execution', state: 'completed', duration: 15, requestCount: 1, write: null, thinking: 5 };
  const checks = [];
  const saves = [];
  const update = { status: 'update', currentVersion: CURRENT_VERSION, latestVersion: '1.5.0',
    releaseUrl: 'https://github.com/Lumidarin/agy-capsule/releases/tag/v1.5.0' };
  let response = update;
  await page.route('http://agy.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/context') return route.fulfill({ json: data });
    if (path === '/api/settings') {
      assert.equal(route.request().headers()['x-sidecar-token'], 'fixture');
      const patch = route.request().postDataJSON();
      saves.push(patch);
      data.prefs = { ...data.prefs, ...patch };
      return route.fulfill({ json: data.prefs });
    }
    if (path === '/api/version') {
      checks.push(route.request().postDataJSON().mode);
      assert.equal(route.request().headers()['x-sidecar-token'], 'fixture');
      return route.fulfill(response ? { json: response } : { status: 403 });
    }
    return route.fulfill(path === '/preload.js' ? { body: '' } : { contentType: 'text/html', body: UI_HTML });
  });
  await page.goto('http://agy.test/?token=fixture');
  const check = page.locator('#version-check');
  const status = page.locator('#version-status');
  const notice = page.locator('#version-notice');
  const toggle = page.getByRole('button', { name: '更新提醒' });
  const version = page.locator('#version-number');
  await notice.waitFor();
  assert.deepEqual(checks, ['auto']);
  assert.equal(await version.isVisible(), false, 'version bar stays hidden on the statistics tab');
  await page.locator('#sidebar-tab-settings').click();
  assert.equal(await version.textContent(), `v${CURRENT_VERSION}`);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(await toggle.getAttribute('data-active'), 'true');
  assert.match(await toggle.getAttribute('title'), /關閉後不再於背景檢查/);
  assert.equal(await toggle.evaluate(el => getComputedStyle(el).borderTopColor), 'rgba(0, 0, 0, 0)');
  const [toggleBox, checkBox] = await Promise.all([toggle.boundingBox(), check.boundingBox()]);
  assert.ok(Math.abs((toggleBox.y + toggleBox.height / 2) - (checkBox.y + checkBox.height / 2)) < 2, 'both buttons are in one row');

  assert.equal(await page.locator('#sidebar-settings [data-setting-card="notifyUpdates"], #setting-notify-updates').count(), 0);
  await Promise.all([page.waitForResponse(res => res.url().endsWith('/api/settings')), toggle.click()]);
  assert.deepEqual(saves, [{ notifyUpdates: false }]);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await toggle.getAttribute('data-active'), 'false');
  await notice.waitFor({ state: 'hidden' });
  await page.reload();
  await page.locator('#version-notify[aria-pressed="false"]').waitFor({ state: 'attached' });
  assert.deepEqual(checks, ['auto'], 'the saved opt-out still blocks automatic requests after reload');

  const turn = page.locator('#sidebar-stats [data-turn-metrics-block]');
  assert.equal(await turn.locator('[data-turn-metric="elapsed"]').textContent(), '15s');
  assert.equal(await turn.locator('[data-turn-metric="requests"]').textContent(), '1');
  assert.equal(await turn.locator('[data-turn-metric="write"]').textContent(), '—');
  await page.locator('#sidebar-tab-settings').click();
  response = { status: 'current', currentVersion: CURRENT_VERSION };
  await check.click();
  await status.getByText('已是最新版本').waitFor();
  assert.equal(await check.textContent(), '檢查更新');
  response = update;
  await check.click();
  await notice.waitFor();
  const title = notice.locator('#version-available');
  assert.equal(await title.textContent(), `發現新版本:\u00a0${CURRENT_VERSION} → 1.5.0`);
  const geometry = await title.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const box = id => document.getElementById(id).getBoundingClientRect();
    const centerY = b => (b.top + b.bottom) / 2;
    return { lines: range.getClientRects().length, offset: Math.abs(centerY(box('version-update')) - centerY(box('version-dismiss'))) };
  });
  assert.equal(geometry.lines, 1, 'the full update title fits on one line at 320px');
  assert.ok(geometry.offset < 1, 'Update and dismiss stay on the same row');
  assert.equal(await notice.getByRole('link', { name: '版本說明' }).getAttribute('href'), update.releaseUrl);
  assert.equal(await check.textContent(), '檢查更新');
  await notice.getByRole('button', { name: '暫不更新' }).click();
  await notice.waitFor({ state: 'hidden' });
  response = null;
  await check.click();
  await page.getByText('檢查失敗：無法連線至側欄的版本檢查服務。').waitFor();
  assert.equal(await check.textContent(), '檢查更新');
  assert.deepEqual(checks, ['auto', 'manual', 'manual', 'manual']);
  await Promise.all([page.waitForResponse(res => res.url().endsWith('/api/settings')), toggle.click()]);
  assert.deepEqual(saves, [{ notifyUpdates: false }, { notifyUpdates: true }]);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await page.locator('#sidebar-tab-stats').click();
  assert.equal(await turn.isVisible(), true, 'failure in the optional version route does not lock the sidebar');
});

await test('Sidebar downloads only after an update click and offers retry before reload', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 700 } });
  const data = snapshot();
  data.prefs = { ...data.prefs, settingsLanguage: 'zh-CN' };
  const latestVersion = '999.0.0';
  const requests = [];
  let respondToFirst;
  const first = new Promise(resolve => { respondToFirst = resolve; });
  await page.route('http://agy.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/context') return route.fulfill({ json: data });
    if (url.pathname === '/api/version') return route.fulfill({ json: {
      status: 'update', currentVersion: CURRENT_VERSION, latestVersion,
      releaseUrl: 'https://github.com/Lumidarin/agy-capsule/releases/tag/v' + latestVersion,
    } });
    if (url.pathname === '/api/update') {
      assert.equal(route.request().method(), 'POST');
      assert.equal(route.request().headers()['x-sidecar-token'], 'fixture');
      requests.push(route.request().postDataJSON());
      const json = requests.length === 1 ? await first : { status: 'updated', version: latestVersion };
      return route.fulfill({ json });
    }
    return route.fulfill(url.pathname === '/preload.js' ? { body: '' } : { contentType: 'text/html', body: UI_HTML });
  });
  await page.goto('http://agy.test/?token=fixture');
  const button = page.locator('#version-update');
  const message = page.locator('#version-update-status');
  await button.waitFor();
  assert.equal(await button.textContent(), '更新');
  assert.deepEqual(requests, []);
  assert.equal(await page.locator('#version-notice').getByText(/update\.bat|update\.sh/).count(), 0);
  await button.click();
  await page.getByRole('button', { name: '更新中…' }).waitFor();
  assert.equal(await button.isDisabled(), true);
  respondToFirst({ status: 'error', reason: 'archive' });
  await message.getByText(/归档不完整或未通过校验/).waitFor();
  assert.equal(await button.textContent(), '重试');
  assert.equal(await page.getByRole('link', { name: '手动更新' }).getAttribute('href'), 'https://github.com/Lumidarin/agy-capsule/releases/tag/v' + latestVersion);
  assert.equal(await button.isEnabled(), true);
  await button.click();
  await message.getByText('更新完成，正在重新加载…').waitFor();
  assert.equal(await button.isDisabled(), true);
  assert.deepEqual(requests, [{ version: latestVersion }, { version: latestVersion }]);
});

await test('Sidebar drops an in-flight response and never replays another conversation on tab return', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 360, height: 700 } });
  await page.addInitScript(() => {
    window.sidecar = { conversationId: 'A' };
    const interval = window.setInterval;
    window.setInterval = (fn, ms, ...args) => {
      if (fn.name !== 'refresh') return interval(fn, ms, ...args);
      window.testRefresh = fn;
    };
  });
  let holdA = false, releaseA, polls = 0;
  await page.route('http://agy.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/context') {
      const { conversationId } = route.request().postDataJSON();
      polls++;
      if (conversationId === 'A' && holdA) {
        await new Promise(resolve => { releaseA = resolve; });
        return route.fulfill({ json: { ...snapshot(), contextTokens: 192000, deckCdp: 'no-anchor' } });
      }
      return route.fulfill({ json: conversationId === 'A'
        ? { ...snapshot(), health: { code: 'S4' } }
        : { ...snapshot(), contextTokens: 64000 } });
    }
    return route.fulfill(path === '/preload.js' ? { body: '' } : { contentType: 'text/html', body: UI_HTML });
  });
  await page.goto('http://agy.test/?token=fixture');
  await page.waitForFunction(() => document.querySelector('#used-pct').textContent === '50%');
  await page.locator('#cdp-notice').waitFor();
  await page.locator('#sidebar-tab-settings').click();
  holdA = true;
  const sent = page.waitForRequest(request => new URL(request.url()).pathname === '/api/context');
  const stale = page.evaluate(() => window.testRefresh());
  await sent;
  await page.evaluate(() => { window.sidecar.conversationId = 'B'; });
  await page.locator('#sidebar-tab-stats').click();
  assert.equal(await page.locator('.stats-layout').isVisible(), false, 'A is not replayed while awaiting B');
  assert.equal(await page.locator('#cdp-notice').isVisible(), false, 'A’s visible health notice also clears');
  releaseA();
  await stale;
  assert.equal(await page.locator('.stats-layout').isVisible(), false, 'late A response cannot unhide the stats');
  assert.equal(await page.locator('#used-pct').textContent(), '50%', 'late 75% response never renders');
  assert.equal(await page.locator('#cdp-notice').isVisible(), false, 'late health status is discarded too');

  await page.locator('#sidebar-tab-settings').click();
  await page.evaluate(() => window.testRefresh());
  const before = polls;
  await page.locator('#sidebar-tab-stats').click();
  assert.equal(await page.locator('.stats-layout').isVisible(), true);
  assert.equal(await page.locator('#used-pct').textContent(), '25%', 'a matching B snapshot is replayed synchronously');
  assert.equal(polls, before);
});

await test('Chinese health notice debounces failures, prioritizes sidebar data and recovers without losing statistics', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 360, height: 700 } });
  const data = snapshot(); data.prefs.language = 'zh-CN';
  let failure = 0;
  await page.addInitScript(() => {
    const interval = window.setInterval;
    window.setInterval = (fn, ms, ...args) => {
      if (fn.name !== 'refresh') return interval(fn, ms, ...args);
      window.testRefresh = fn;
    };
  });
  await page.route('http://agy.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/context') {
      if (failure === 1) return route.abort();
      if (failure === 2) return route.fulfill({ status: 503, body: 'busy' });
      if (failure === 3) return route.fulfill({ body: '{' });
      if (failure === 4) return route.fulfill({ status: 403, body: '' });
      return route.fulfill({ json: data });
    }
    return route.fulfill(path === '/preload.js' ? { body: '' } : { contentType: 'text/html', body: UI_HTML });
  });
  await page.goto('http://agy.test/?token=fixture');
  await page.waitForFunction(() => document.querySelector('#used-pct').textContent === '50%');
  const tick = () => page.evaluate(() => window.testRefresh());
  const box = page.locator('#cdp-notice'), badge = box.locator('#health-code');
  data.deckCdp = 'unverified'; await tick(); assert.equal(await box.isVisible(), false);
  await tick(); assert.equal(await badge.textContent(), '代码 F2');
  assert.match(await box.textContent(), /侧栏统计不受影响/);
  assert.equal(await box.locator('details').isVisible(), false);
  assert.equal(await box.locator('#cdp-fix-btn').isVisible(), false);
  failure = 1; await tick(); failure = 0; await tick();
  assert.ok(await box.isVisible(), 'an already-confirmed F2 must not flicker after a failed poll');
  assert.equal(await badge.textContent(), '代码 F2');
  data.deckCdp = 'ok'; await tick(); assert.equal(await box.isVisible(), false);
  data.health = { code: 'S3' }; await tick(); assert.equal(await box.isVisible(), false);
  await tick(); assert.equal(await badge.textContent(), '代码 S3');
  data.health = null; await tick(); assert.equal(await box.isVisible(), false);
  data.health = { code: 'S4' }; await tick(); assert.equal(await badge.textContent(), '代码 S4');
  for (const f of [1, 2, 3, 1]) { failure = f; await tick(); assert.equal(await badge.textContent(), '代码 S4'); }
  failure = 2; await tick(); assert.equal(await badge.textContent(), '代码 S2');
  assert.match(await box.textContent(), /数据可能已过时/);
  assert.equal(await page.locator('#sidebar-stats').getAttribute('data-stale'), 'true');
  assert.equal(await page.locator('#used-pct').textContent(), '50%');
  data.health = null; data.deckCdp = 'ok'; failure = 0; await tick();
  assert.equal(await box.isVisible(), false);
  assert.equal(await page.locator('#sidebar-stats').getAttribute('data-stale'), 'false');
  data.deckCdp = 'missing'; await tick(); assert.equal(await box.isVisible(), false);
  await tick(); assert.equal(await badge.textContent(), '代码 F1'); assert.equal(await box.locator('details').isVisible(), true);
  data.deckCdp = 'ok'; await tick(); assert.equal(await box.isVisible(), false);
  data.deckCdp = 'unreachable'; await tick(); assert.equal(await box.isVisible(), false);
  await tick(); assert.equal(await badge.textContent(), '代码 F1');
  for (const [state, code] of [['inject-failed', 'F4'], ['no-anchor', 'F3']]) {
    data.deckCdp = state; await tick(); assert.equal(await badge.textContent(), '代码 ' + code);
    assert.equal(await box.locator('details').isVisible(), false);
  }
  data.deckCdp = 'ok'; await tick(); assert.equal(await box.isVisible(), false);
  data.deckCdp = 'unverified'; await tick(); await tick();
  assert.ok(await box.isVisible());
  failure = 4; await tick();
  const auth = page.locator('#panel-auth-notice');
  assert.ok(await auth.isVisible()); assert.match(await auth.innerText(), /S1/);
  assert.equal(await box.isVisible(), false);
  const bounds = await auth.boundingBox();
  assert.ok(bounds.x >= 10 && bounds.x + bounds.width <= 350, 'S1 has margins at 360px');
  failure = 0; data.deckCdp = 'ok'; await page.reload();
  await page.waitForFunction(() => document.querySelector('#used-pct').textContent === '50%');
  assert.equal(await auth.isVisible(), false); assert.equal(await box.isVisible(), false);
});

await test('Footer reveals and wider speed values never overlap the native controls', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<style>
    *{box-sizing:border-box}:root{--foreground:#eee;--muted-foreground:#aaa;--background:#141414;--card:#222;--border:#444}
    body{margin:16px;font:13px Arial}.agy-composer-footer{display:flex;align-items:center;gap:4px;padding:2px;position:absolute;bottom:40px}
    .footer-left{display:flex;align-items:center;flex:1;min-width:0}.model{display:flex;white-space:nowrap}
    .right{display:flex;align-items:center;gap:2px;flex-shrink:0}button{font:inherit;white-space:nowrap}
    [data-testid=permissions-selector-trigger]{display:flex;align-items:center;gap:4px;padding:6px;border:0;height:28px}
    [data-testid=permissions-selector-trigger] svg{width:14px;height:14px;flex-shrink:0}
    </style><main data-testid="conversation-view"><div class="agy-composer-footer"><div class="footer-left"><button>+</button><div class="model"><button>Gemini 4 Argon Medium</button></div></div><div class="right"><button data-testid="permissions-selector-trigger"><svg></svg><span>Turbo</span><svg></svg></button><button>Send</button></div></div></main>`);
  await page.evaluate(buildRuntimeBundle(owner).code);
  const samples = () => page.evaluate(async () => {
    const gaps = [];
    for (let i = 0; i < 18; i++) {
      await new Promise(requestAnimationFrame);
      const strip = document.getElementById('agy-capsule-host').shadowRoot.getElementById('deck-metrics-strip');
      const bounds = strip.getBoundingClientRect(), controls = document.querySelector('.right').getBoundingClientRect();
      if (bounds.width > 0) gaps.push(bounds.right - controls.left);
    }
    return gaps;
  });
  for (const width of [260, 300, 340, 380, 420, 460, 500, 540, 580]) {
    await page.locator('.agy-composer-footer').evaluate((element, value) => element.style.width = value + 'px', width);
    const data = snapshot();
    await apply(page, data);
    await page.waitForTimeout(250);
    data.prefs.showSpeed = true;
    await apply(page, data);
    assert.ok((await samples()).every(overlap => overlap <= 1), `Speed reveal overlaps at ${width}px`);
    data.turnSpeed.generation.tps = 10000;
    await apply(page, data);
    assert.ok((await samples()).every(overlap => overlap <= 1), `Wider text overlaps at ${width}px`);
  }
  assert.deepEqual(errors, []);
});

await test('Pinned popovers fit a narrower clipping container and regain their width when it grows', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.setContent(`<style>
    body{font:13px Arial}#clipper{width:400px;overflow:hidden;position:absolute;bottom:50px;left:100px;padding-top:330px}
    .agy-composer-footer{display:flex;align-items:center;gap:4px}.footer-left{display:flex;align-items:center;flex:1;min-width:0}
    </style><div id="clipper" data-testid="conversation-view"><div class="agy-composer-footer"><div class="footer-left"><button>Gemini</button></div><button>Send</button></div></div>`);
  await page.evaluate(buildRuntimeBundle(owner).code);
  const data = snapshot();
  data.prefs = { ...data.prefs, panelLayout: 'matched', quotaIndicator: 'bar', resetFormat: 'localized' };
  data.quotaGroups[0].buckets[0].resetTime = new Date(Date.now() + 5 * 86400000 + 3 * 3600000).toISOString();
  data.requestError = { kind: 'rate_limited', diagnostic: 'Too many requests: ' + 'x'.repeat(110) };
  assert.equal(await apply(page, data), true);
  const clipper = page.locator('#clipper');
  for (const name of ['Ctx', 'Quota', 'Error']) {
    const group = page.locator(`#agy-capsule-host [data-el="grp${name}"]`);
    const panel = group.locator('.dk-pop');
    await group.locator('.dk-pill').click();
    const wide = await panel.boundingBox();
    assert.ok(wide.width >= 228);
    await clipper.evaluate(el => { el.style.width = '210px'; });
    await page.waitForFunction(name => {
      const root = document.getElementById('agy-capsule-host').shadowRoot;
      const pop = root.querySelector(`[data-el="grp${name}"] .dk-pop`);
      const { left, right } = document.getElementById('clipper').getBoundingClientRect();
      const bounds = pop.getBoundingClientRect();
      return bounds.width > 0 && bounds.left >= left + 3 && bounds.right <= right - 3;
    }, name, { timeout: 2500 });
    assert.equal(await group.getAttribute('data-pinned'), 'true');
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${name} content fits the constrained panel`);
    await clipper.evaluate(el => { el.style.width = '400px'; });
    await page.waitForFunction(({ name, width }) => {
      const root = document.getElementById('agy-capsule-host').shadowRoot;
      return Math.abs(root.querySelector(`[data-el="grp${name}"] .dk-pop`).getBoundingClientRect().width - width) <= 1;
    }, { name, width: wide.width }, { timeout: 2500 });
    await page.keyboard.press('Escape');
  }
});

await test('A newer injector takes over the same bundle and rejects an in-flight write from the old owner', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('https://127.0.0.1:5351/', route => route.fulfill({ body: '<!doctype html>', contentType: 'text/html' }));
  await page.goto('https://127.0.0.1:5351/');
  await page.setContent('<main data-media-drop-scope><div data-testid="agent-input-box"><div class="agy-composer-footer" style="display:flex;width:600px"><div style="display:flex;flex:1"><button>Gemini</button></div><button>Send</button></div></div></main>');

  const directory = mkdtempSync(join(tmpdir(), 'agy-cdp-takeover-'));
  const portFile = join(directory, 'port');
  writeFileSync(portFile, '12345\n');
  const originals = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  const fixture = hostFixture(directory);
  globalThis.fetch = async () => ({ ok: true, json: async () => [{ id: 'page', type: 'page', url: page.url(), webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/page' }] });
  globalThis.WebSocket = class {
    constructor() {
      page.context().newCDPSession(page).then(session => {
        this.session = session;
        for (const method of ['Runtime.executionContextCreated', 'Runtime.executionContextDestroyed', 'Runtime.executionContextsCleared']) {
          session.on(method, params => this.onmessage?.({ data: JSON.stringify({ method, params }) }));
        }
        this.readyState = 1; this.onopen?.();
      });
    }
    async send(raw) {
      const { id, method, params } = JSON.parse(raw);
      let result;
      try { result = await this.session.send(method, params); } catch {}
      this.onmessage?.({ data: JSON.stringify({ id, result }) });
    }
    close() { this.readyState = 3; void this.session.detach().catch(() => {}); this.onclose?.(); }
  };
  const data = contextTokens => ({ ...snapshot(), contextTokens, maxContextTokens: 1000 });
  const waiting = Promise.withResolvers();
  const release = Promise.withResolvers();
  let startedRace = false, superseded = false;
  const old = startDeckInjector(async () => {
    if (!startedRace) return data(100);
    waiting.resolve();
    await release.promise;
    return data(200);
  }, { ...fixture, portFile, instanceTs: owner, onSuperseded: () => { superseded = true; } });
  const newer = startDeckInjector(async () => data(800), { ...fixture, portFile, instanceTs: owner + 1 });
  try {
    await old.tick();
    const pill = page.locator('#agy-capsule-host [data-k="pillCtx"]');
    assert.equal(await pill.textContent(), '10%');
    startedRace = true;
    const oldTick = old.tick();
    await waiting.promise;
    await newer.tick();
    assert.equal(await pill.textContent(), '80%');
    assert.equal(await page.evaluate(() => globalThis.__agyCapsuleDeck.owner), owner + 1);
    release.resolve();
    await oldTick;
    assert.equal(superseded, true);
    assert.equal(await pill.textContent(), '80%');
  } finally {
    release.resolve();
    await old.stop();
    await newer.stop();
    Object.assign(globalThis, originals);
    rmSync(directory, { recursive: true, force: true });
  }
});

await test('Model picker submits one host option and releases the native trigger', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<main data-testid="conversation-view"><textarea>draft</textarea><div class="agy-composer-footer" style="position:fixed;bottom:12px;width:90vw;display:flex"><div style="flex:1;display:flex"><button data-testid="model-selector-trigger">Native menu</button></div><div>Send</div></div></main>');
  const trigger = page.getByTestId('model-selector-trigger');
  await trigger.evaluate(button => {
    const options = ['Claude (Low)', 'Argon (Low)', 'Argon (High)', 'Fixed'].map(label => ({ label }));
    options.push({ label: 'Disabled', disabled: true });
    let selected = options[0];
    window.calls = [];
    button.__reactFiber$fixture = { memoizedProps: { conversationId: 'fixture', placement: 'top' }, return: {
      memoizedProps: { value: {
        visibleModelConfigs: options, getModelConfigForConversation: () => selected,
        setModelConfigByLabelForConversation(label, conversation, persist) {
          window.calls.push([label, conversation, persist]);
          selected = options.find(option => option.label === label);
        },
      } },
    } };
  });
  await page.evaluate(buildRuntimeBundle(owner).code);
  const data = snapshot();
  await apply(page, data);
  const picker = page.locator('[data-el="modelPicker"]');
  assert.equal(await picker.count(), 0);
  data.prefs.modelEffortPicker = true;
  await apply(page, data);
  assert.equal(await trigger.getAttribute('data-deck-model-bubble'), 'hidden');
  assert.equal(await trigger.evaluate(el => el.getBoundingClientRect().width), 0);
  await picker.click();
  assert.equal(await page.getByRole('menuitem', { name: 'Disabled', exact: true }).count(), 0);
  await page.getByRole('menuitem', { name: 'Argon (Low)', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Argon (High)', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), [['Argon (High)', 'fixture', false]]);
  assert.equal(await picker.textContent(), 'Argon High');
  assert.equal(await page.locator('textarea').inputValue(), 'draft');
  await picker.click();
  await trigger.evaluate(button => { button.__reactFiber$fixture.memoizedProps.conversationId = 'other'; });
  await page.getByRole('menuitem', { name: 'Fixed', exact: true }).click();
  assert.equal(await page.evaluate(() => window.calls.length), 1);
  data.prefs.modelEffortPicker = false;
  await apply(page, data);
  assert.equal(await picker.count(), 0);
  assert.equal(await trigger.getAttribute('data-deck-model-bubble'), null);
});

await test('2.33 model picker shows the inherited effort, can hide previews, and restores the native button', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<main data-testid="conversation-view"><div class="agy-composer-footer" style="position:fixed;bottom:12px;width:90vw;display:flex"><div style="flex:1;display:flex"><button data-testid="model-selector-trigger">Native menu</button></div><div>Send</div></div></main>');
  const trigger = page.getByTestId('model-selector-trigger');
  await trigger.evaluate(button => {
    const modelOptions = ['Claude (Low)', 'Argon (Low)', 'Argon (Medium)', 'Argon (High)', 'Fixed (High)']
      .map((label, value) => ({ label, value }));
    window.calls = [];
    const selector = {
      modelOptions,
      selectedModel: modelOptions[0],
      setSelectedModel(option) {
        window.calls.push({ label: option.label, exact: modelOptions.includes(option) });
        this.selectedModel = option;
      },
    };
    button.__reactFiber$fixture = { memoizedProps: { value: selector }, return: {
      memoizedProps: { conversationId: 'fixture', placement: 'top-start' },
    } };
  });
  await page.evaluate(buildRuntimeBundle(owner).code);
  const data = snapshot();
  Object.assign(data.prefs, { modelEffortPicker: true });
  await apply(page, data);
  const picker = page.locator('[data-el="modelPicker"]');
  assert.equal(await trigger.getAttribute('data-deck-model-bubble'), 'hidden');
  await picker.click();
  const argon = page.locator('button.dk-model-row[data-family="Argon"]');
  assert.equal(await argon.locator('.dk-mp-effort').textContent(), 'Low');
  await argon.click();
  assert.deepEqual(await page.evaluate(() => window.calls), [{ label: 'Argon (Low)', exact: true }]);

  data.prefs.hideDefaultEffort = true;
  await apply(page, data);
  assert.equal(await picker.textContent(), 'Argon Low');
  await picker.click();
  assert.equal(await argon.locator('.dk-mp-effort').count(), 0);
  assert.equal(await page.getByRole('menuitem', { name: 'Fixed (High)', exact: true }).textContent(), 'Fixed');
  await argon.hover();
  assert.equal(await page.getByRole('menuitem', { name: 'Argon (High)', exact: true }).isVisible(), true);

  data.prefs.modelEffortPicker = false;
  await apply(page, data);
  assert.equal(await picker.count(), 0);
  assert.equal(await trigger.getAttribute('data-deck-model-bubble'), null);
});

await test('Orchestrator inherits the main model color and the picker keeps its widest row width', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 620 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.route('http://orch.test/', route => route.fulfill({ contentType: 'text/html', body:
    '<style>:root{color-scheme:dark;--foreground:#eee;--card:#16161b}body{background:#111}</style><main data-testid="conversation-view"><div class="agy-composer-footer" style="position:fixed;bottom:12px;width:90vw;display:flex"><div style="flex:1;display:flex"><button data-testid="model-selector-trigger">Native menu</button></div><div>Send</div></div></main>' }));
  await page.goto('http://orch.test/');
  await page.getByTestId('model-selector-trigger').evaluate(button => {
    const planners = [
      'Gemini 4 Neon (High)', 'Gemini 4 Neon (Low)',
      'Gemini 4 Hydrogen Extended (Medium)', 'Gemini 4 Hydrogen Extended (Low)',
      'Claude Opus (Medium)', 'Claude Opus (Low)',
    ].map((label, i) => ({ label, value: i + 1 }));
    const orch = { label: 'Orchestrator', value: 30, modelId: 'gemini-pro-coordinator' };
    const modelOptions = [...planners, orch];
    const selector = {
      modelOptions, groups: [{ options: modelOptions }], selectedModel: planners[0],
      orchestratorPlanners: planners, orchestratorDefaultPlanner: planners[0],
      orchestratorPick: { model: 0, select(value) { this.model = value; } },
      setSelectedModel(option) { this.selectedModel = option; },
    };
    button.__reactFiber$fixture = { memoizedProps: { value: selector }, return: {
      memoizedProps: { conversationId: 'fixture', placement: 'top-start' },
    } };
  });
  await page.evaluate(buildRuntimeBundle(owner).code);
  const data = snapshot();
  Object.assign(data.prefs, { modelEffortPicker: true, showEffortBar: true });
  await apply(page, data);
  await page.locator('[data-el="modelPicker"]').click();
  const panel = page.locator('.dk-model-options');
  const orch = page.getByRole('switch', { name: 'Orchestrator' });
  const width = () => panel.evaluate(el => el.getBoundingClientRect().width);
  const initialWidth = await width();
  const foreground = () => orch.evaluate(async el => {
    const label = el.querySelector('.dk-orch-label, .dk-orch-inner');
    getComputedStyle(label).color;
    await Promise.all(label.getAnimations().map(animation => animation.finished));
    const sample = document.createElement('canvas').getContext('2d');
    sample.fillStyle = getComputedStyle(label).color;
    sample.fillRect(0, 0, 1, 1);
    return [...sample.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  });
  for (const [orchestratorMode, orchestrator3dStyle, engine] of [
    ['follow', 'helix', 'chamber'], ['dock', 'helix', 'dock'],
    ...['chamber', 'helix', 'orbital', 'c-matrix', 'c-louver', 'c-spark', 'nebula', 'beam', 'orb']
      .map(style => ['custom3d', style, style]),
  ]) {
    Object.assign(data.prefs, { orchestratorMode, orchestrator3dStyle });
    await apply(page, data);
    assert.equal(await orch.getAttribute('data-engine'), engine);
    const [r, , b] = await foreground();
    assert.ok(r > b, engine + ' OFF must use Neon red, not purple (' + [r, b] + ')');
    await orch.click();
    assert.equal(await orch.getAttribute('aria-checked'), 'true');
    if (engine === 'beam') assert.deepEqual(await foreground(), [225, 77, 103], 'Beam ON uses the main model accent');
    await orch.click();
    assert.equal(await orch.getAttribute('aria-checked'), 'false');
    assert.equal(await width(), initialWidth, engine + ' must not affect menu width');
  }
  Object.assign(data.prefs, { orchestrator3dStyle: 'orbital', effortTheme: 'claude' });
  await apply(page, data);
  await page.locator('[data-family="Gemini 4 Hydrogen Extended"]').click();
  assert.equal(await width(), initialWidth, 'selecting the longest row does not grow the popup');
  const hydrogen = await foreground();
  assert.ok(hydrogen[2] > hydrogen[0], 'the model color wins over the forced Claude style');
  const pins = await orch.locator('canvas').evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    const ratio = canvas.height / 28;
    const y = Math.round(14 * ratio);
    return [Math.round(14 * ratio), canvas.width - Math.round(14 * ratio)].map(x => {
      const [r, g, b] = ctx.getImageData(x, y - Math.round(2.5 * ratio), 1, 1).data;
      return b > g && g > r;
    });
  });
  assert.ok(pins.every(Boolean), 'both 3D pins use related Hydrogen tones');
  await page.getByRole('slider', { name: 'Effort level' }).press('Home');
  assert.equal(await width(), initialWidth, 'a shorter effort label does not shrink the popup');
  await page.locator('[data-family="Claude Opus"]').click();
  const claude = await foreground();
  assert.ok(claude[0] > claude[2] && claude[1] > claude[2], 'changing models repaints the capsule');
  assert.equal(await width(), initialWidth);
});

await test('Models tab reverts to native without resetting options and expands the customized model list', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const sidebar = await browser.newPage({ viewport: { width: 360, height: 760 } });
  const data = snapshot();
  data.availableModels = ['Gemini Titanium', 'Claude Silver'];
  const patches = [];
  await sidebar.route('http://agy.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/context') return route.fulfill({ json: data });
    if (path === '/api/settings') {
      const patch = route.request().postDataJSON();
      patches.push(patch);
      Object.assign(data.prefs, patch);
      return route.fulfill({ json: data.prefs });
    }
    return route.fulfill(path === '/preload.js' ? { body: '' } : { contentType: 'text/html', body: UI_HTML });
  });
  await sidebar.goto('http://agy.test/?token=fixture');
  await sidebar.getByRole('tab', { name: '模型', exact: true }).click();
  const nativeCapsule = sidebar.getByRole('checkbox', { name: '退回原生模型胶囊' });
  const toggle = sidebar.getByRole('checkbox', { name: '思考强度滑条和Orchestrator胶囊' });
  assert.equal(await nativeCapsule.isChecked(), true);
  assert.equal(await toggle.isDisabled(), true);
  await nativeCapsule.hover();
  const nativeTip = sidebar.getByRole('tooltip', { name: '退回后本页所有功能均暂时失效' });
  await nativeTip.waitFor({ state: 'visible' });
  await sidebar.keyboard.press('Escape');
  await nativeTip.waitFor({ state: 'hidden' });
  await nativeCapsule.uncheck();
  const modelList = sidebar.locator('#setting-model-list');
  const customize = sidebar.getByRole('checkbox', { name: '定制模型列表' });
  assert.equal(await modelList.isVisible(), false);
  await customize.check();
  const titanium = modelList.getByRole('button', { name: 'Titanium' });
  await titanium.click();
  assert.equal(await titanium.getAttribute('aria-pressed'), 'false');
  await customize.uncheck();
  await modelList.waitFor({ state: 'hidden' });
  await customize.check();
  await modelList.waitFor({ state: 'visible' });
  await toggle.check();
  await nativeCapsule.check();
  await sidebar.waitForFunction(() => !document.getElementById('setting-native-model-capsule').disabled);
  const theme = sidebar.locator('button[data-pick-setting="effortTheme"][data-pick-value="auto"]');
  assert.equal(await theme.isDisabled(), true);
  assert.equal(await titanium.isDisabled(), true);
  assert.equal(await toggle.isDisabled(), true);
  assert.equal(await toggle.isChecked(), true);
  assert.equal(await sidebar.locator('.setting-model-card').evaluate(el => getComputedStyle(el).opacity), '0.45');
  assert.equal(await sidebar.locator('.fx-preview-card').evaluate(el => el.inert), true);
  await nativeCapsule.uncheck();
  await sidebar.waitForFunction(() => !document.querySelector('input[name="showEffortBar"]').disabled);
  assert.equal(await theme.isEnabled(), true);
  assert.equal(await toggle.isChecked(), true);
  assert.equal(await titanium.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(patches.slice(-2), [{ modelEffortPicker: false }, { modelEffortPicker: true }]);
});

await test('Opt-in effort bar animates and switches models in place; default picker still uses submenus', async t => {
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 600 }, colorScheme: 'dark' });
  const sidebar = await browser.newPage({ viewport: { width: 360, height: 760 } });
  const data = snapshot();
  await sidebar.route('http://agy.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/context') return route.fulfill({ json: data });
    if (path === '/api/settings') {
      Object.assign(data.prefs, route.request().postDataJSON());
      return route.fulfill({ json: data.prefs });
    }
    return route.fulfill(path === '/preload.js' ? { body: '' } : { contentType: 'text/html', body: UI_HTML });
  });
  await sidebar.goto('http://agy.test/?token=fixture');
  await sidebar.getByRole('tab', { name: '模型', exact: true }).click();
  const toggle = sidebar.getByRole('checkbox', { name: '思考强度滑条和Orchestrator胶囊' });
  assert.equal(await toggle.isDisabled(), true);
  await sidebar.getByRole('checkbox', { name: '退回原生模型胶囊' }).uncheck();

  await page.route('http://effort.test/', route => route.fulfill({ contentType: 'text/html', body:
    `<style>:root{color-scheme:dark;--foreground:#f1f1f1;--card:#1c1c20}body{background:#121214}</style>
    <main data-testid="conversation-view"><div class="agy-composer-footer" style="position:fixed;bottom:16px;width:90vw;display:flex"><div style="flex:1;display:flex"><button data-testid="model-selector-trigger">Native menu</button></div><div>Send</div></div></main>` }));
  await page.goto('http://effort.test/');
  await page.getByTestId('model-selector-trigger').evaluate(button => {
    const modelOptions = [
      'Gemini 4 Argon (Low)', 'Gemini 4 Argon (Medium)', 'Gemini 4 Argon (High)',
      'Gemini 4 Neon (Low)', 'Gemini 4 Neon (XHigh)', 'Orchestrator (Argon)', 'Orchestrator (Neon)',
      'Claude Sonnet (Low)', 'Claude Sonnet (High)', 'Fixed (High)', 'Custom',
    ].map((label, value) => ({ label, value }));
    window.effortCalls = [];
    button.__reactFiber$fixture = { memoizedProps: { value: {
      modelOptions, selectedModel: modelOptions[0], setSelectedModel(option) {
        if (!modelOptions.includes(option)) throw new Error('Expected the host option object');
        this.selectedModel = option;
        window.effortCalls.push(option.label);
      },
    } }, return: { memoizedProps: { conversationId: 'fixture', placement: 'top-start' } } };
  });
  await page.evaluate(buildRuntimeBundle(owner).code);
  await apply(page, data);
  const picker = page.locator('[data-el="modelPicker"]');
  const bar = page.locator('.agy-effort');
  const range = page.getByRole('slider', { name: 'Effort level' });
  const panel = page.locator('.dk-model-options');
  const flyout = page.locator('.dk-model-sub');
  const gemini = page.locator('button.dk-model-row[data-family="Gemini 4 Argon"]');
  const claude = page.locator('button.dk-model-row[data-family="Claude Sonnet"]');
  await picker.click();
  assert.equal(await bar.count(), 0);

  await toggle.check();
  await sidebar.locator('.pv-effort-bar').waitFor({ state: 'visible' });
  assert.match(await sidebar.locator('#help-effort-bar').textContent(), /LLYSH-HANNARI\/antigravity-Codex-Claude-effort-slider/);
  assert.equal(data.prefs.showEffortBar, true);
  await apply(page, data);
  assert.equal(await range.getAttribute('aria-valuetext'), 'Low');
  await claude.hover();
  assert.equal(await flyout.isVisible(), false);
  const box = await range.locator('.ces-track').boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 14, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, y, { steps: 6 });
  assert.deepEqual(await page.evaluate(() => window.effortCalls), [], 'dragging previews tiers without committing');
  await page.mouse.move(box.x + box.width - 14, y, { steps: 6 });
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => window.effortCalls), ['Gemini 4 Argon (High)'], 'only the release tier is committed');
  assert.equal(await range.getAttribute('aria-valuetext'), 'High', 'the menu stays open');
  assert.equal(await range.getAttribute('data-theme'), 'gemini');
  assert.equal(await range.getAttribute('data-element'), 'argon');
  const geminiCanvas = range.locator('canvas');
  const firstGeminiFrame = await geminiCanvas.evaluate(el => el.toDataURL());
  await page.waitForFunction(frame => {
    const canvas = document.getElementById('agy-capsule-host').shadowRoot.querySelector('.ces-claude-canvas');
    return canvas && canvas.width > 0 && canvas.toDataURL() !== frame;
  }, firstGeminiFrame);

  await claude.click();
  assert.equal(await panel.isVisible(), true, 'selecting a different model keeps the menu open');
  assert.equal(await range.getAttribute('data-theme'), 'claude');
  assert.equal(await range.getAttribute('aria-valuetext'), 'Low', 'a model without a remembered tier starts at its own default');
  await range.press('End');
  const canvas = range.locator('canvas');
  const firstFrame = await canvas.evaluate(el => el.toDataURL());
  await page.waitForFunction(frame => {
    const canvas = document.getElementById('agy-capsule-host').shadowRoot.querySelector('.ces-claude-canvas');
    return canvas.width < 560 && canvas.toDataURL() !== frame;
  }, firstFrame);
  await range.click({ button: 'right' });
  const controls = page.getByRole('dialog', { name: '思考强度滑条', exact: true });
  assert.equal(await controls.getByText('思考强度滑条', { exact: true }).count(), 0);
  assert.equal(await controls.getByRole('tab', { name: '滑条', exact: true }).getAttribute('aria-selected'), 'true');
  await controls.getByRole('button', { name: '慢速' }).click();
  await controls.getByRole('button', { name: '隐藏' }).click();
  await controls.getByRole('button', { name: 'Codex' }).click();
  assert.equal(await range.getAttribute('data-theme'), 'codex');
  assert.equal(await range.locator('.ces-ticks').isVisible(), false);
  await controls.getByRole('tab', { name: 'Orchestrator', exact: true }).click();
  await controls.getByRole('button', { name: '指定样式' }).click();
  await controls.getByRole('button', { name: '液态流珠' }).click();
  await controls.getByRole('button', { name: '扇形声部' }).click();
  await page.keyboard.press('Escape');
  assert.equal(await controls.count(), 0);
  assert.equal(await panel.isVisible(), true);
  await range.press('Shift+F10');
  assert.equal(await controls.getByRole('button', { name: '慢速' }).getAttribute('aria-pressed'), 'true');
  await controls.getByRole('button', { name: '全部同色' }).click();
  assert.equal(await range.locator('.ces-tick.is-dim').count(), 2);
  await controls.getByRole('button', { name: '跟随模型' }).click();
  assert.equal(await range.getAttribute('data-theme'), 'claude');
  await controls.getByRole('tab', { name: 'Orchestrator', exact: true }).click();
  assert.equal(await controls.getByRole('button', { name: '液态流珠' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await controls.getByRole('button', { name: '扇形声部' }).getAttribute('aria-pressed'), 'true');
  await controls.getByRole('button', { name: '跟随主题' }).click();
  await controls.getByRole('button', { name: '棱镜分流' }).click();
  await page.mouse.click(700, 100);
  assert.equal(await controls.count(), 0);
  await picker.click();

  await range.press('Home');
  assert.equal(await picker.textContent(), 'Claude Sonnet Low');
  await page.locator('button.dk-model-row[data-family="Fixed (High)"]').click();
  assert.equal(await range.getAttribute('aria-disabled'), 'true');
  assert.equal(await range.getAttribute('aria-valuetext'), 'High');
  assert.equal(await range.getAttribute('data-energy'), '0', 'a fixed option with an explicit tier keeps its existing style');
  await gemini.click();
  assert.equal(await range.getAttribute('aria-valuetext'), 'High', 'each model keeps its last tier');

  await page.locator('button.dk-model-row[data-family="Gemini 4 Neon"]').click();
  await range.press('End');
  await page.waitForFunction(() => {
    const slider = document.getElementById('agy-capsule-host').shadowRoot.querySelector('.ces-root');
    return slider.getAttribute('aria-valuetext') === 'XHigh' && slider.style.getPropertyValue('--ces-energy') === '1';
  });
  for (const [model, expectedTheme, expectedElement] of [
    ['Orchestrator (Argon)', 'gemini', 'argon'],
    ['Orchestrator (Neon)', 'gemini', 'neon'],
    ['Custom', 'codex', 'codex'],
  ]) {
    await page.getByRole('menuitem', { name: model, exact: true }).click();
    assert.equal(await range.getAttribute('data-theme'), expectedTheme);
    assert.equal(await range.getAttribute('data-element'), expectedElement);
    assert.equal(await range.evaluate(el => el.style.getPropertyValue('--ces-energy')), '1', 'a model without a known effort tier runs at full energy');
    assert.equal(await range.getAttribute('aria-disabled'), 'true');
    assert.equal(await range.getAttribute('aria-valuemax'), '0');
    assert.equal(await range.getAttribute('aria-valuetext'), null);
    assert.equal(await bar.locator('.ces-ag-effort-value').textContent(), '');
  }

  await toggle.uncheck();
  await sidebar.locator('.pv-effort-bar').waitFor({ state: 'hidden' });
  await apply(page, data);
  assert.equal(await bar.count(), 0);
  assert.equal(await page.getByRole('menuitem', { name: 'Fixed (High)', exact: true }).isVisible(), true);
  await claude.hover();
  assert.equal(await flyout.isVisible(), true);
  await claude.click();
  assert.equal(await panel.isVisible(), false, 'the default picker still closes after selecting a model');
});
