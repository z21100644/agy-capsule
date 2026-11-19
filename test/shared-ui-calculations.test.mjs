import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createPresentation, getPresentationScript } from '../agy-capsule/sidecars/agy_capsule/ui.mjs';
import { buildRuntimeBundle, toView } from '../agy-capsule/sidecars/agy_capsule/deck_injector.mjs';
import { UI_HTML } from '../agy-capsule/sidecars/agy_capsule/server.mjs';

test('contextBreakdown preserves four-category arithmetic, widths, and missing-limit fallbacks', () => {
  const ui = createPresentation();
  const data = {
    contextTokens: 128000,
    maxContextTokens: 256000,
    cachedIn: 100000,
    turn0Tokens: 20000,
    totalOutputTokens: 24000,
    totalThinkingTokens: 12000,
  };
  const b = ui.contextBreakdown(data);
  assert.equal(b.read, 72000);
  assert.equal(b.usedPct, '50%');
  assert.equal(b.usedFrac, '128K / 256K');
  assert.equal(b.segTurn0W, '7.81%');
  assert.equal(b.segReadW, '28.13%');
  assert.equal(b.segThinkW, '4.69%');
  assert.equal(b.segOutW, '9.38%');
  assert.equal(b.turn0Pct, '8%');
  assert.equal(b.readPct, '28%');
  assert.equal(b.thinkPct, '5%');
  assert.equal(b.outPct, '9%');
  assert.equal(b.turn0K, '20.0K');
  assert.equal(b.readK, '72.0K');
  assert.equal(b.thinkK, '12.0K');
  assert.equal(b.outK, '24.0K');

  const view = toView(data);
  assert.equal(view.pillCtx, b.usedPct);
  assert.equal(view.usedFrac, b.usedFrac);
  assert.equal(view.segReadW, b.segReadW);
  assert.equal(view.valReadK, b.readK);
  assert.equal(view.valReadPct, b.readPct);

  const empty = ui.contextBreakdown({});
  assert.equal(empty.usedPct, '0%');
  assert.equal(empty.usedFrac, '0 / --');
  assert.equal(empty.readPct, '0%');

  const unknownLimit = ui.contextBreakdown({ contextTokens: 5000, maxContextTokens: 0 });
  assert.equal(unknownLimit.usedPct, '--%');
  assert.equal(unknownLimit.usedFrac, '5.0K / --');
  assert.equal(unknownLimit.readPct, '--%');

  const clamped = ui.contextBreakdown({ contextTokens: 1000, maxContextTokens: 10000, turn0Tokens: 2000 });
  assert.equal(clamped.read, 0);
});

test('shared quota helpers match colors, SVG ring sizes, labels, sorting, and weekly-exhaustion override', () => {
  const ui = createPresentation();
  assert.equal(ui.quotaColor(0.5), '#4ea84e');
  assert.equal(ui.quotaColor(0.25), '#f59e0b');
  assert.equal(ui.quotaColor(0.1), '#ef4444');
  assert.equal(ui.quotaColor(0), '#ef4444');

  const ring16 = ui.makeRingSvg(0.5);
  const ring18 = ui.makeRingSvg(0.5, 18);
  assert.match(ring16, /^<svg width="16" height="16" viewBox="0 0 18 18"/);
  assert.match(ring18, /^<svg width="18" height="18" viewBox="0 0 18 18"/);
  assert.ok(ring16.includes('stroke="#4ea84e"'));

  assert.equal(ui.formatGroupTitle('Gemini Models'), 'Gemini');
  assert.equal(ui.formatGroupTitle('Claude and GPT models'), 'Claude');
  assert.equal(ui.formatGroupTitle('Gemini 4 Argon'), 'Gemini 4 Argon');

  assert.equal(ui.formatBucketLabel({ window: '5h' }, ui.dictionaries['zh-CN']), '5小时');
  assert.equal(ui.formatBucketLabel({ window: 'weekly' }, ui.dictionaries['zh-TW']), '每週');
  assert.equal(ui.formatBucketLabel({ window: 'custom', displayName: '5hours Limit' }), '5 Hours');

  assert.equal(
    ui.activeGroupColor({ buckets: [{ window: '5h', remainingFraction: 0.9 }, { window: 'weekly', remainingFraction: 0 }] }),
    '#ef4444',
    'weekly exhaustion should override a healthy 5h window',
  );
  assert.equal(ui.activeGroupColor({ buckets: [{ window: '5h', remainingFraction: null }] }), 'var(--muted-foreground, #8e8e93)');

  const now = Date.parse('2026-11-18T00:00:00Z');
  const groups = ui.quotaView(
    [{
      displayName: 'Gemini Models',
      description: 'Models within this group: Argon, Flash.',
      buckets: [
        { window: 'weekly', remainingFraction: 0.2, resetTime: '2026-11-20T00:00:00Z' },
        { window: '5h', remainingFraction: 0.85, resetTime: '2026-11-18T03:00:00Z' },
      ],
    }],
    { language: 'en' },
    ui.dictionaries.en,
    now,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, 'Gemini');
  assert.equal(groups[0].modelsInGroup, 'argon, flash');
  assert.equal(groups[0].q5h, '85%');
  assert.equal(groups[0].qWk, '20%');
  assert.deepEqual(groups[0].buckets.map(b => b.window), ['5h', 'weekly']);
  assert.equal(groups[0].buckets[0].color, '#4ea84e');
  assert.equal(groups[0].buckets[1].color, '#f59e0b');
  assert.deepEqual(ui.quotaView(null), []);
});

test('embedded runtime bundle and sidebar script use shared ui.mjs helpers without syntax errors', () => {
  const ctx = vm.createContext({
    window: {},
    location: { pathname: '/' },
    navigator: { language: 'en', languages: ['en'] },
    document: { querySelectorAll: () => [] },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  ctx.globalThis = ctx;
  const bundle = buildRuntimeBundle(42);
  assert.equal(vm.runInContext(bundle.code, ctx), true);
  assert.equal(ctx.__agyCapsulePresentation.version, 72);
  for (const key of ['contextBreakdown', 'cacheThresholds', 'makeCacheRingSvg', 'quotaColor', 'makeRingSvg', 'formatGroupTitle', 'formatBucketLabel', 'activeGroupColor', 'quotaView']) {
    assert.equal(typeof ctx.__agyCapsulePresentation[key], 'function', `missing ${key} in embedded presentation`);
  }
  assert.ok(getPresentationScript().includes('version !== 72'));

  const scriptMatch = UI_HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'UI_HTML should contain inline script');
  assert.doesNotThrow(() => new vm.Script(scriptMatch[1]));
  const sidebarScript = scriptMatch[1].slice(scriptMatch[1].indexOf('const presentation ='));
  assert.ok(sidebarScript.includes('presentation.contextBreakdown('));
  assert.ok(sidebarScript.includes('presentation.quotaView('));
  assert.ok(sidebarScript.includes('presentation.makeRingSvg('));
  assert.doesNotMatch(sidebarScript, /\n\s*function (makeRingSvg|formatGroupTitle|fmtK|fmtColK)\(/);
});
