import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsStore, DEFAULT_SETTINGS } from '../agy-capsule/sidecars/agy_capsule/settings.mjs';
import { createPresentation } from '../agy-capsule/sidecars/agy_capsule/ui.mjs';
import { layoutSize, toView } from '../agy-capsule/sidecars/agy_capsule/deck_injector.mjs';
import { UI_HTML } from '../agy-capsule/sidecars/agy_capsule/server.mjs';

test('sidebar is registered as an Extensions auxiliary-pane view', () => {
  const manifest = JSON.parse(readFileSync(new URL('../agy-capsule/sidecars/agy_capsule/sidecar.json', import.meta.url), 'utf8'));
  assert.equal(manifest.has_web_ui, true);
  assert.deepEqual(manifest.ui_config.views, [{ entrypoint: 'SIDECAR_UI_ENTRYPOINT_AUX_PANE', path: '/', title: 'agy-capsule' }]);
});

test('individual settings validate values, persist and propagate between sidecars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-settings-'));
  try {
    const file = join(dir, 'settings.json');
    const first = createSettingsStore(file);
    const second = createSettingsStore(file);
    assert.deepEqual(first.read(), DEFAULT_SETTINGS);
    assert.equal(first.read().language, 'en');
    assert.equal(first.read().settingsLanguage, 'zh-CN');
    assert.equal(first.read().labelCase, 'lowercase');
    assert.equal(first.read().showSpeed, true);
    assert.equal(first.read().speedAnimation, false);
    assert.equal(first.read().showRequestMetrics, true);
    assert.equal(first.read().showTurnMetrics, false);
    assert.equal(first.read().hideUnavailableQuota, true);
    assert.equal(first.read().showCacheWarnings, true);
    assert.equal(first.read().showContextWarnings, true);
    assert.equal(first.read().showRequestErrors, true);
    assert.equal('showSteps' in first.read(), false);
    first.update({ language: 'zh-TW', theme: 'dark', density: 'standard', quotaIndicator: 'bar', unexpected: true });
    const expected = { ...DEFAULT_SETTINGS, language: 'zh-TW', density: 'standard', quotaIndicator: 'bar' };
    assert.deepEqual(second.read(), expected);
    second.update({ language: 'invalid', theme: 'light', panelStyle: 'seven-categories' });
    assert.deepEqual(first.read(), expected, 'Removed theme overrides must be ignored');
    first.update({ settingsLanguage: 'en', highlightActiveModel: true });
    assert.equal(second.read().language, 'zh-TW');
    assert.equal(second.read().settingsLanguage, 'en');
    assert.equal(second.read().highlightActiveModel, true);
    first.update({ hideUnavailableQuota: false, showTurnMetrics: true, labelCase: 'titlecase' });
    assert.equal(second.read().hideUnavailableQuota, false);
    assert.equal(second.read().showTurnMetrics, true);
    assert.equal(second.read().labelCase, 'titlecase');
    first.update({ showCacheWarnings: false, showContextWarnings: false, showRequestErrors: true });
    assert.equal(second.read().showCacheWarnings, false);
    assert.equal(second.read().showContextWarnings, false);
    assert.equal(second.read().showRequestErrors, true);
    first.update({ hideUnavailableQuota: 'true' });
    assert.equal(second.read().hideUnavailableQuota, false);
    first.update({ showSpeed: false });
    first.update({ speedAnimation: true });
    assert.equal(second.read().speedAnimation, false, 'speedAnimation stays off while showSpeed is disabled');
    first.update({ showSpeed: true, speedAnimation: true });
    assert.equal(second.read().speedAnimation, true);
    first.update({ speedAnimation: 'false' });
    assert.equal(second.read().speedAnimation, true);
    first.update({ showSpeed: false });
    assert.equal(second.read().speedAnimation, false, 'turning off showSpeed resets speedAnimation');
    assert.equal(second.read().showSpeed, false);
    assert.equal(second.read().showRequestMetrics, true, 'panel request metrics are decoupled from capsule speed');
    first.update({ showSpeed: true, showRequestMetrics: false, showSteps: false });
    assert.equal(second.read().showSpeed, true);
    assert.equal(second.read().showRequestMetrics, false);
    assert.equal('showSteps' in second.read(), false);
    assert.deepEqual(createSettingsStore(file).read(), first.read());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a same-size atomic replacement that keeps its mtime is still detected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-settings-stamp-'));
  try {
    const file = join(dir, 'settings.json');
    const when = new Date(1700000000000);
    const replace = labelCase => {
      writeFileSync(file + '.next', JSON.stringify({ labelCase }));
      utimesSync(file + '.next', when, when);
      renameSync(file + '.next', file);
    };
    replace('lowercase');
    const store = createSettingsStore(file);
    assert.equal(store.read().labelCase, 'lowercase');
    replace('titlecase');
    assert.equal(store.read().labelCase, 'titlecase');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('removing presets keeps old appearance choices and persists only independent settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-style-migration-'));
  try {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ panelStyle: 'modern', quotaIndicator: 'ring', language: 'zh-TW', speedAnimation: true, showSteps: true, theme: 'dark' }));
    const store = createSettingsStore(file);
    assert.equal(store.read().density, 'standard');
    assert.equal('categoryMarker' in store.read(), false);
    assert.equal(store.read().quotaIndicator, 'ring');
    assert.equal('showSteps' in store.read(), false, 'Rejected feature ignores an old enabled setting');
    assert.equal('theme' in store.read(), false);
    const original = store.read();
    store.update({ panelStyle: 'classic' });
    assert.deepEqual(store.read(), original, 'Removed presets cannot change current appearance');
    store.update({ panelLayout: 'matched', density: 'spacious' });
    assert.equal(store.read().quotaIndicator, 'ring');
    assert.equal(store.read().language, 'zh-TW');
    assert.equal(store.read().speedAnimation, true);
    assert.equal('panelStyle' in JSON.parse(readFileSync(file, 'utf8')), false);
    assert.deepEqual(createSettingsStore(file).read(), store.read());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legacy request detail switches migrate cleanly to the single showRequestMetrics toggle', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-settings-migration-'));
  try {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ showSpeed: true, showGenerationDetails: false }));
    const store = createSettingsStore(file);
    assert.deepEqual(store.read(), { ...DEFAULT_SETTINGS, showRequestMetrics: false });
    store.update({ showSteps: true });
    assert.equal('showGenerationDetails' in JSON.parse(readFileSync(file, 'utf8')), false);
    assert.equal(createSettingsStore(file).read().showRequestMetrics, false);
    assert.equal('showSteps' in createSettingsStore(file).read(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('system language resolution and explicit language selection', () => {
  const ui = createPresentation();
  assert.equal(ui.locale({}, ['zh-Hant-TW']), 'zh-TW');
  assert.equal(ui.locale({}, ['zh-CN']), 'zh-CN');
  assert.equal(ui.locale({ language: 'en' }, ['zh-TW']), 'en');
  assert.equal(ui.dictionaries['zh-CN'].fiveHours, '5小时');
  assert.equal(ui.dictionaries['zh-TW'].fiveHours, '5小時');
  for (const dict of Object.values(ui.dictionaries)) {
    assert.deepEqual(Object.keys(dict), Object.keys(ui.dictionaries.en));
  }
});

test('Cache tooltip reports record age, separates reminder state, and handles unknown/new conversations', () => {
  const ui = createPresentation();
  const timestamp = 1700000000000;
  const data = { contextTokens: 128000, cachedIn: 100000, lastStepEpochMs: timestamp };
  for (const [seconds, age] of [[30, '<1m'], [120, '2m'], [210, '3m'], [3900, '1h 5m'], [7200, '2h']]) {
    const tip = ui.cacheTooltip(data, ui.dictionaries.en, timestamp + seconds * 1000);
    assert.ok(tip.includes(`Last recorded activity: ${age}`));
    assert.match(tip, /100K \/ 128K tokens/);
    assert.equal(tip.includes('Approaching'), seconds >= 180 && seconds < 240);
    assert.equal(tip.includes('may be cold'), seconds >= 240);
  }
  assert.match(ui.cacheTooltip(data, ui.dictionaries['zh-CN'], timestamp + 240000), /最近记录距今: 4m.*可能已冷却/);
  const mutedWarn = ui.cacheTooltip(data, ui.dictionaries.en, timestamp + 210000, { showCacheWarnings: false });
  assert.match(mutedWarn, /Last recorded activity: 3m$/);
  const mutedCold = ui.cacheTooltip(data, ui.dictionaries['zh-CN'], timestamp + 240000, { showCacheWarnings: false });
  assert.match(mutedCold, /最近记录距今: 4m$/);
  assert.equal(ui.cacheView(data, { showCacheWarnings: true }, timestamp + 210000).status, 'warning');
  assert.equal(ui.cacheView(data, { showCacheWarnings: true }, timestamp + 210000).countdown, '~1m');
  assert.equal(ui.cacheView(data, { showCacheWarnings: true }, timestamp + 240000).status, 'cold');
  assert.equal(ui.cacheView(data, { showCacheWarnings: true }, timestamp + 240000).valDeco, 'line-through');
  const suppressedWarn = ui.cacheView(data, { showCacheWarnings: false }, timestamp + 240000);
  assert.equal(suppressedWarn.status, 'fresh');
  assert.equal(suppressedWarn.ctxIconColor, '');
  assert.equal(suppressedWarn.valDeco, 'none');
  assert.equal(suppressedWarn.countdown, '');
  const coldCapsule = toView({ ...data, lastStepEpochMs: Date.now() - 250000, prefs: { showCacheWarnings: false } });
  assert.equal(coldCapsule.ctxIconColor, '');
  assert.equal(coldCapsule.cacheValDeco, 'none');
  assert.equal(coldCapsule.valCacheHitK, '');
  assert.match(ui.cacheTooltip({ ...data, lastStepEpochMs: 0 }), /Last recorded activity: —$/);
  assert.equal(ui.cacheTooltip({}), '0 / 0 cached · New conversation');
});

test('independent appearance controls preserve context counts and four-category shares', () => {
  const data = { contextTokens: 128000, maxContextTokens: 256000, cachedIn: 100000, totalOutputTokens: 24000, totalThinkingTokens: 12000, turn0Tokens: 20000, quotaGroups: [{ displayName: '<Gemini>', buckets: [{ window: '5h', remainingFraction: .85 }] }] };
  const classic = toView(data);
  const modern = toView({ ...data, prefs: { language: 'zh-CN', theme: 'dark', density: 'standard', quotaIndicator: 'bar' } });
  for (const key of ['pillCtx', 'usedFrac', 'segReadW', 'segOutW', 'segThinkW', 'segTurn0W', 'valCacheHit', 'valTurn0K', 'valReadK', 'valThinkK', 'valOutK']) {
    assert.equal(modern[key], classic[key], key);
  }
  assert.equal(modern.usedFrac, '128K / 256K');
  assert.match(classic.quotaHtml, /<svg/);
  assert.match(modern.quotaHtml, /dk-q-meter/);
  assert.ok(!modern.quotaHtml.includes('<Gemini>'));
});

test('context tooltips keep four-category arithmetic and distinguish input, cache and generated output', () => {
  const ui = createPresentation();
  const data = { contextTokens: 128000, maxContextTokens: 256000, cachedIn: 100000, turn0Tokens: 20000, totalOutputTokens: 24000, totalThinkingTokens: 12000 };
  const tips = ui.contextTooltips(data);
  assert.match(tips.overview, /Remaining 128K/);
  assert.match(tips.overview, /Cached input 100K · Uncached input 28\.0K/);
  assert.match(tips.overview, /excludes its new output/);
  assert.match(tips.read, /72\.0K tokens · 28% of context limit/);
  assert.match(tips.read, /Added context input/);
  assert.match(tips.write, /24\.0K tokens/);
  assert.match(tips.think, /12\.0K tokens/);
  assert.match(ui.contextTooltips({ ...data, maxContextTokens: 0 }).overview, /Limit — · Remaining —/);
  assert.match(ui.contextTooltips({ ...data, maxContextTokens: 64000 }).overview, /Remaining 0/);
});

test('quota tooltip reports only the reset timestamp, timezone or missing data line', () => {
  const ui = createPresentation();
  const data = { pool: 'Group "<test> &', window: 'weekly', remainingFraction: 0, resetTime: '2026-11-16T12:30:00Z' };
  const tip = ui.quotaTooltip(data);
  assert.doesNotMatch(tip, /\n/);
  assert.match(tip, /^Resets 2026-11-\d{2} \d{2}:\d{2} \(.+\)$/);
  assert.equal(ui.quotaTooltip({ ...data, resetTime: null }), 'Reset time not reported');
  assert.equal(ui.quotaTooltip({ ...data, resetTime: 'invalid', remainingFraction: null }), 'Reset time not reported');
  assert.match(ui.quotaTooltip(data, ui.dictionaries['zh-CN']), /^重置时间 2026-11-\d{2} \d{2}:\d{2} \(.+\)$/);
});

test('sidebar settings use flat dividers, same-row appearance blocks, refined capsule previews and compact metric rows', () => {
  const ui = createPresentation();
  assert.ok(!UI_HTML.includes('data-setting-card="panelStyle"'));
  assert.ok(!UI_HTML.includes('data-setting-card="theme"'));
  assert.doesNotMatch(UI_HTML, /presets-card|preset-|personal-presets|\/api\/presets/);
  assert.doesNotMatch(UI_HTML, /setting-show-steps|data-generation-row="steps"|data-settings-scope="compaction"/);
  assert.ok(!UI_HTML.includes('data-i18n="previewKeepZero"'));
  assert.ok(!UI_HTML.includes('pv-err-pop'));
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    assert.ok(['data-setting-card', 'data-pick-setting', 'data-toggle-setting', 'data-order-setting', 'data-input-setting'].some(attr => UI_HTML.includes(`${attr}="${key}"`)), `missing setting item for ${key}`);
  }
  const settingsHtml = UI_HTML.slice(UI_HTML.indexOf('<section class="settings'));
  assert.ok(
    settingsHtml.indexOf('data-setting-card="showCacheWarnings"') < settingsHtml.indexOf('data-setting-card="showContextWarnings"'),
    'showCacheWarnings should be placed above showContextWarnings'
  );
  assert.ok(
    settingsHtml.indexOf('data-settings-scope="features"') < settingsHtml.indexOf('data-setting-card="highlightActiveModel"') &&
    settingsHtml.indexOf('data-setting-card="highlightActiveModel"') < settingsHtml.indexOf('data-setting-card="hideUnavailableQuota"') &&
    settingsHtml.indexOf('data-setting-card="hideUnavailableQuota"') < settingsHtml.indexOf('data-setting-card="showCacheWarnings"') &&
    settingsHtml.indexOf('data-setting-card="showSpeed"') < settingsHtml.indexOf('data-setting-card="speedAnimation"') &&
    settingsHtml.indexOf('data-setting-card="showRequestMetrics"') < settingsHtml.indexOf('data-setting-card="showTurnMetrics"'),
    'settings should group feature toggles under one Features section cleanly'
  );
  assert.ok(!UI_HTML.includes('data-settings-scope="quota"') && !UI_HTML.includes('data-settings-scope="context"'));
  assert.ok(!UI_HTML.includes('data-settings-scope="request"') && !UI_HTML.includes('data-settings-scope="turn"'));
  assert.ok(UI_HTML.includes('id="help-language-scope"') && UI_HTML.includes('id="help-speed-pair"') && UI_HTML.includes('id="help-request-metrics"') && UI_HTML.includes('id="help-turn-metrics"'));
  assert.ok(!UI_HTML.includes('class="settings-note"'));
  assert.match(settingsHtml, /data-setting-card="language"[\s\S]*?class="setting-help-dot"[\s\S]*?id="help-language-scope"[^>]*data-i18n="languageScopeNote"/);
  assert.equal((settingsHtml.match(/class="setting-help-dot"/g) || []).length, 4, 'only 4 concise ? help dots should remain');
  assert.ok(UI_HTML.includes('data-preview-group="turn"') && !UI_HTML.includes('data-preview-group="request"'));
  assert.equal(ui.dictionaries.en.showRequestMetrics, 'Last request');
  assert.equal(ui.dictionaries.en.turnMetrics, 'Last turn');
  assert.equal(ui.dictionaries['zh-CN'].featuresSection, '功能');
  assert.equal(ui.dictionaries['zh-CN'].speedAnimation, '动效');
  assert.equal(ui.dictionaries['zh-CN'].turnRequests, '请求数');
  assert.equal(ui.dictionaries['zh-CN'].turnWrite, '写入');
  assert.equal(ui.dictionaries['zh-CN'].turnElapsed, '耗时');
  assert.equal('turnRead' in ui.dictionaries.en, false);
  assert.match(ui.generationMarkup(), /class="generation-grid"/);
  assert.match(ui.turnMetricsMarkup(), /class="turn-bar-list"/);
  assert.ok(ui.turnMetricsMarkup().indexOf('turnThinking') < ui.turnMetricsMarkup().indexOf('turnWrite'));
  const block = { hidden: true };
  const timingVal = { hidden: true, textContent: '', title: '' };
  const speedVal = { hidden: true, textContent: '', title: '' };
  const pop = {
    querySelectorAll: (sel) => sel === '[data-generation="timing"]' ? [timingVal]
      : sel === '[data-generation="speed"]' ? [speedVal]
      : sel === '[data-generation-block]' ? [block] : [],
  };
  ui.renderGeneration(pop, { requestIndex: 1, tps: 40, ttft: 1, duration: 3 }, ui.dictionaries.en, { showSpeed: false, showRequestMetrics: true });
  assert.equal(block.hidden, false);
  assert.equal(timingVal.textContent, '1.0s–3.0s');
  assert.equal(speedVal.textContent, '40.0 tok/s');
  ui.renderGeneration(pop, { requestIndex: 1, tps: 40, ttft: 1, duration: 3 }, ui.dictionaries.en, { showSpeed: true, showRequestMetrics: false });
  assert.equal(block.hidden, true);
  assert.ok(!UI_HTML.includes('data-setting-card="categoryMarker"'));
  for (const key of ['settingsLanguage', 'language', 'panelLayout', 'density', 'quotaIndicator', 'labelCase']) {
    assert.ok(UI_HTML.includes(`data-pick-setting="${key}"`), `missing clickable swatch for ${key}`);
    assert.ok(!UI_HTML.includes(`name="${key}"`), `unexpected select dropdown for ${key}`);
  }
  assert.ok(
    settingsHtml.indexOf('data-i18n="appearanceSection"') < settingsHtml.indexOf('data-setting-card="labelCase"') &&
    settingsHtml.indexOf('data-setting-card="labelCase"') < settingsHtml.indexOf('data-settings-scope="features"'),
    'labelCase should be under Appearance settings'
  );
  for (const [, key] of UI_HTML.matchAll(/data-(?:stats-)?i18n="([^"]+)"/g)) {
    if (key.startsWith('${')) continue; // Skip embedded createPresentation().toString() source template.
    assert.ok(key in ui.dictionaries.en, `missing dictionary key ${key}`);
  }
  const statsNode = { dataset: { statsI18n: 'cache' }, textContent: '' };
  const settingsNode = { dataset: { i18n: 'language' }, textContent: '', closest: (sel) => (sel === '.settings' ? {} : null) };
  const root = {
    style: { getPropertyValue: () => '', setProperty: () => {}, removeProperty: () => {} },
    dataset: {},
    querySelector: () => null,
    querySelectorAll: (sel) => sel === '[data-i18n]' ? [settingsNode] : sel === '[data-stats-i18n]' ? [statsNode] : [],
  };
  ui.apply(root, { language: 'en', settingsLanguage: 'zh-CN' });
  assert.equal(root.dataset.labelCase, 'lowercase');
  assert.equal(statsNode.textContent, 'Cache');
  assert.equal(settingsNode.textContent, '显示语言');
  ui.apply(root, { language: 'en', labelCase: 'titlecase' });
  assert.equal(root.dataset.labelCase, 'titlecase');
});

test('sidebar stats uses container-responsive layout and fluid quota rows without panelLayout height stretching', () => {
  assert.match(UI_HTML, /class="stats-layout"/);
  assert.match(UI_HTML, /class="stats-context"/);
  assert.match(UI_HTML, /id="quota-root" class="stats-quota"/);
  assert.match(UI_HTML, /\.panel\s*\{[^}]*container-type:\s*inline-size;\s*container-name:\s*stats;/s);
  assert.match(UI_HTML, /@container stats \(min-width:\s*420px\)/);
  assert.match(UI_HTML, /@container stats \(min-width:\s*540px\)/);
  assert.match(UI_HTML, /\.quota-meter\s*\{[^}]*max-width:\s*none;/s);
  assert.match(UI_HTML, /body\[data-quota-indicator="bar"\] \.quota-line1\s*\{\s*grid-template-columns:\s*54px minmax\(0,\s*1fr\)/);
});

test('reset countdown format is a user setting and is shielded from page translators', () => {
  const ui = createPresentation();
  const now = Date.parse('2026-11-17T00:00:00Z');
  const at = (min) => new Date(now + min * 60000).toISOString();
  assert.equal(DEFAULT_SETTINGS.resetFormat, 'compact');
  assert.equal(ui.formatReset(at(4 * 60 + 55), { language: 'zh-CN' }, now), '4h 55m');
  assert.equal(ui.formatReset(at(5 * 1440 + 11 * 60), { language: 'en' }, now), '5d 11h');
  assert.equal(ui.formatReset(at(4 * 60), { language: 'en' }, now), '4h 00m');
  assert.equal(ui.formatReset(at(4 * 60 + 55), { language: 'zh-CN', resetFormat: 'localized' }, now), '4小时55分');
  assert.equal(ui.formatReset(at(5 * 1440 + 11 * 60), { language: 'zh-TW', resetFormat: 'localized' }, now), '5天11小時');
  assert.equal(ui.formatReset(at(3), { language: 'zh-CN', resetFormat: 'localized' }, now), '3分钟');
  assert.equal(ui.formatReset(at(4 * 60 + 55), { language: 'en', resetFormat: 'localized' }, now), '4 hr 55 min');
  assert.equal(ui.formatReset(at(-1), { language: 'zh-CN' }, now), '即将重置');
  assert.equal(ui.formatReset(''), '');

  const view = toView({ quotaGroups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: 1, resetTime: at(300) }] }], prefs: { quotaIndicator: 'bar' } });
  assert.match(view.quotaHtml, /class="dk-q-pct notranslate" translate="no">100%</);
  assert.match(view.quotaHtml, /class="dk-q-mid notranslate" translate="no">/);
  assert.match(UI_HTML, /class="quota-mid notranslate" translate="no"/);
  assert.match(UI_HTML, /data-setting-card="resetFormat"/);
});

test('footer quota popover shares one column grid across groups so percentages and bars align', () => {
  const source = readFileSync(new URL('../agy-capsule/sidecars/agy_capsule/deck_injector.mjs', import.meta.url), 'utf8');
  assert.match(source, /\.dk-quota-pop > \.dk-panel-content \{\s*display: grid;/);
  assert.match(source, /\.dk-q-row \{\s*grid-column: 1 \/ -1;\s*display: grid;\s*grid-template-columns: subgrid;/);
  assert.match(source, /\.dk-q-right \{\s*grid-column: 2 \/ 4;\s*display: grid;\s*grid-template-columns: subgrid;/);
  assert.doesNotMatch(source, /\.dk-q-row \{[^}]*grid-template-columns: minmax/);
});

test('context breakdown and turn metrics each switch between columns and rows, with column field toggles', () => {
  assert.equal(DEFAULT_SETTINGS.contextLayout, 'columns');
  assert.equal(DEFAULT_SETTINGS.turnLayout, 'columns');
  assert.equal(DEFAULT_SETTINGS.contextMarker, 'square');
  assert.equal(DEFAULT_SETTINGS.turnMarker, 'square');
  assert.equal(DEFAULT_SETTINGS.showContextBreakdown, true);
  assert.equal(DEFAULT_SETTINGS.columnLabel, true);
  assert.equal(DEFAULT_SETTINGS.columnValue, true);
  assert.equal(DEFAULT_SETTINGS.columnPercent, false);

  const dir = mkdtempSync(join(tmpdir(), 'agy-layout-'));
  try {
    const store = createSettingsStore(join(dir, 'settings.json'));
    store.update({ contextLayout: 'rows', turnLayout: 'sideways', contextMarker: 'dot', columnPercent: true, showContextBreakdown: false });
    const saved = store.read();
    assert.equal(saved.contextLayout, 'rows');
    assert.equal(saved.turnLayout, 'columns');
    assert.equal(saved.contextMarker, 'dot');
    assert.equal(saved.turnMarker, 'square');
    assert.equal(saved.showContextBreakdown, false);
    assert.equal(saved.columnPercent, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const ui = createPresentation();
  assert.deepEqual(
    ['contextLayout', 'turnLayout', 'contextMarker', 'turnMarker', 'showContextBreakdown', 'columnLabel', 'columnValue', 'columnPercent'].map(k => ui.appearance({ contextLayout: 'rows', turnMarker: 'dot', columnLabel: false })[k]),
    ['rows', 'columns', 'square', 'dot', 'true', 'false', 'true', 'false']
  );

  const view = toView({ contextTokens: 100000, maxContextTokens: 400000, totalOutputTokens: 40000 });
  assert.equal(view.valOutPct, '10%');
  const deck = readFileSync(new URL('../agy-capsule/sidecars/agy_capsule/deck_injector.mjs', import.meta.url), 'utf8');
  for (const k of ['Turn0', 'Read', 'Think', 'Out']) {
    assert.match(deck, new RegExp(`class="dk-item-pct" data-k="val${k}Pct"`));
    assert.ok(deck.includes(`setK('val${k}Pct', d.val${k}Pct)`), k);
  }
  assert.match(deck, /\[data-context-layout="rows"\] \.dk-item-row,\s*#deck-metrics-strip\[data-turn-layout="rows"\] \.turn-bar-item \{ grid-column: 1 \/ -1; display: grid; grid-template-columns: subgrid;/);
  assert.match(deck, /\[data-turn-layout="rows"\] \.turn-bar-item\[data-turn-row="requests"\] \{ container-type: normal; \}/);
  for (const id of ['turn0', 'read', 'think', 'out']) assert.match(UI_HTML, new RegExp(`class="item-pct" id="val-${id}-pct"`));
  // Layout choices live inside their feature cards; the feature card comes first, then its live preview.
  const contextCard = UI_HTML.indexOf('id="setting-show-context-breakdown"');
  assert.ok(contextCard > 0 && contextCard < UI_HTML.indexOf('id="setting-show-request-metrics"'), 'context breakdown sits above recent requests');
  assert.ok(UI_HTML.indexOf('data-preview-group="context"') > contextCard);
  for (const [card, keys] of [['showContextBreakdown', ['contextLayout', 'contextMarker', 'columnLabel', 'columnValue', 'columnPercent']], ['showTurnMetrics', ['turnLayout', 'turnMarker']]]) {
    const start = UI_HTML.indexOf(`data-setting-card="${card}" data-layout-key=`);
    const end = card === 'showContextBreakdown' ? UI_HTML.indexOf('id="setting-show-request-metrics"') : UI_HTML.indexOf('class="pv-detail-pop"', start);
    const block = UI_HTML.slice(start, end > 0 ? end : undefined);
    for (const key of keys) assert.ok(block.includes(`data-pick-setting="${key}"`) || block.includes(`data-toggle-setting="${key}"`), `${key} inside ${card}`);
  }
  assert.match(UI_HTML, /class="setting-seg-opt" data-pick-setting="contextLayout"/);
  assert.match(UI_HTML, /\.setting-option-card:not\(\[data-layout="columns"\]\) \[data-for-layout="columns"\]/);
  assert.match(UI_HTML, /body\[data-show-context-breakdown="false"\] \.panel \.list \{ display: none; \}/);
  assert.match(deck, /\[data-context-marker="dot"\]\[data-context-layout="rows"\]/);
  assert.match(deck, /\[data-turn-marker="dot"\]\[data-turn-layout="rows"\]/);
  assert.doesNotMatch(UI_HTML + deck, /rowMarker|row-marker/);
  assert.match(UI_HTML, /data-pick-value="columns" data-pick-label="layoutColumns"><span class="seg-ico seg-ico-cols"/);
  assert.match(UI_HTML, /\.setting-seg \{[^}]*border-radius: 6px;/);
  assert.match(UI_HTML, /\.setting-seg-opt\[data-active="true"\] \{[^}]*color: #4ea84e; \}/);
  assert.doesNotMatch(UI_HTML, /setting-chip|setting-opts-sub/);
});

test('column field order is adjustable, applied via CSS order, and edited inside the context preview', async () => {
  assert.equal(DEFAULT_SETTINGS.columnOrder, 'label,value,percent');
  const dir = mkdtempSync(join(tmpdir(), 'agy-order-'));
  try {
    const store = createSettingsStore(join(dir, 'settings.json'));
    store.update({ columnOrder: 'value,percent,label' });
    assert.equal(store.read().columnOrder, 'value,percent,label');
    store.update({ columnOrder: 'value,value,label' });
    assert.equal(store.read().columnOrder, 'value,percent,label');
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const ui = createPresentation();
  const props = {};
  const root = { dataset: {}, style: { setProperty: (k, v) => { props[k] = v; }, getPropertyValue: () => '', removeProperty() {} }, querySelector: () => null, querySelectorAll: () => [] };
  ui.apply(root, { language: 'en', columnOrder: 'percent,label,value' });
  assert.deepEqual([props['--agy-order-label'], props['--agy-order-value'], props['--agy-order-percent']], ['1', '2', '0']);

  const deck = readFileSync(new URL('../agy-capsule/sidecars/agy_capsule/deck_injector.mjs', import.meta.url), 'utf8');
  assert.match(deck, /\.dk-item-pct \{ order: var\(--agy-order-percent, 2\); \}/);
  assert.match(UI_HTML, /\.item-label \{ order: var\(--agy-order-label, 0\); \}/);

  // Editor: visible lines first in saved order, hidden lines struck at the bottom without the colour line.
  const editor = UI_HTML.slice(UI_HTML.indexOf('data-field-editor'), UI_HTML.indexOf('data-for-layout="rows" aria-hidden="true"'));
  assert.deepEqual([...editor.matchAll(/data-field="(\w+)" data-on="(\w+)"/g)].map(m => m[1] + ':' + m[2]), ['label:true', 'value:true', 'percent:false']);
  assert.match(UI_HTML, /\.pv-field-row\[data-on="false"\] \.pv-field-cell \{ border-left-color: transparent; text-decoration: line-through;/);
  assert.match(UI_HTML, /function renderFieldEditor\(prefs, labels\)/);
  assert.match(UI_HTML, /addEventListener\('drop'/);
});

test('failure panel shares matched height and quota-style placement; countdown sample follows display language', () => {
  const deck = readFileSync(new URL('../agy-capsule/sidecars/agy_capsule/deck_injector.mjs', import.meta.url), 'utf8');
  assert.ok(deck.includes("if (errorPop && !errorPop.closest('.dk-grp').hidden) pops.push(errorPop);"));
  assert.ok(deck.includes('let left = Math.max(stripLeft, pill.right - width);'));
  assert.ok(!deck.includes("grp.dataset.el === 'grpError' ? pill.right - width"));
  assert.ok(UI_HTML.includes('<span data-stats-i18n="localizedTimeSample"></span>'));
  assert.ok(!UI_HTML.includes('<span data-i18n="localizedTimeSample"></span>'));
});

test('popovers are placed and height-matched by layout size, not by a transformed box', () => {
  const original = globalThis.getComputedStyle;
  // A scaled panel paints smaller than the room it takes once the transform ends.
  const panel = { getBoundingClientRect: () => ({ width: 224.58, height: 147.75 }) };
  try {
    globalThis.getComputedStyle = () => ({ width: '228px', height: '150px' });
    assert.equal(layoutSize(panel, 'width'), 228);
    assert.equal(layoutSize(panel, 'height'), 150);
    globalThis.getComputedStyle = () => ({ width: 'auto', height: 'auto' });
    assert.equal(layoutSize(panel, 'width'), 224.58);
  } finally { globalThis.getComputedStyle = original; }
  const deck = readFileSync(new URL('../agy-capsule/sidecars/agy_capsule/deck_injector.mjs', import.meta.url), 'utf8');
  assert.ok(deck.includes("const width = layoutSize(pop, 'width');"));
  assert.ok(deck.includes("const heights = pops.map(pop => layoutSize(pop, 'height'));"));
});

test('help dots, disabled option controls, turn preview short labels, and convId validation stay consistent', async () => {
  const settingsHtml = UI_HTML.slice(UI_HTML.indexOf('<section class="settings'));
  assert.equal((settingsHtml.match(/<span class="setting-help-dot" aria-hidden="true">\?<\/span>/g) || []).length, 4);
  assert.doesNotMatch(settingsHtml, /<button[^>]*setting-help-dot/);
  assert.doesNotMatch(UI_HTML, /\.setting-help-dot\s*\{[^}]*margin-left:\s*auto/);
  assert.match(UI_HTML, /\.metric-setting > \.setting-head \{ justify-content: flex-start; \}/);
  assert.match(UI_HTML, /\.metric-setting > \.setting-head > \.setting-check \{ flex: 0 1 auto; \}/);
  assert.match(UI_HTML, /\.setting-head\.setting-pair-head > \.setting-help-dot \{ margin-left: -8px; \}/);
  assert.match(UI_HTML, /data-preview-group="turn"[^]*?data-turn-row="requests"[^]*?class="turn-bar-short"/);
  assert.match(UI_HTML, /optionCard\.dataset\.checked === 'false'/);
  assert.match(UI_HTML, /detailPop\.dataset\.open === 'false'/);
  const { inspectConversation } = await import('../agy-capsule/sidecars/agy_capsule/server.mjs');
  const unsafe = await inspectConversation('../../nonexistent', true);
  assert.equal(unsafe.contextTokens, 0);
});

test('cache warning thresholds, cache indicator (icon/ring/bar) and queue warning settings validate, render and stay ordered', () => {
  assert.equal(DEFAULT_SETTINGS.cacheWarnMin, 3);
  assert.equal(DEFAULT_SETTINGS.cacheColdMin, 4);
  assert.equal(DEFAULT_SETTINGS.cacheIndicator, 'icon');
  assert.equal(DEFAULT_SETTINGS.showQueueWarnings, true);
  assert.equal(DEFAULT_SETTINGS.queueWarnSec, 30);

  const dir = mkdtempSync(join(tmpdir(), 'agy-cache-queue-'));
  try {
    const store = createSettingsStore(join(dir, 'settings.json'));
    store.update({ cacheWarnMin: 5 });
    assert.equal(store.read().cacheWarnMin, 5);
    assert.equal(store.read().cacheColdMin, 6, 'raising warn above cold bumps cold by 1');
    store.update({ cacheColdMin: 10, cacheIndicator: 'bar', queueWarnSec: 45, showQueueWarnings: false });
    assert.equal(store.read().cacheWarnMin, 5);
    assert.equal(store.read().cacheColdMin, 10);
    assert.equal(store.read().cacheIndicator, 'bar');
    assert.equal(store.read().queueWarnSec, 45);
    assert.equal(store.read().showQueueWarnings, false);
    store.update({ cacheColdMin: 3 });
    assert.equal(store.read().cacheColdMin, 3);
    assert.equal(store.read().cacheWarnMin, 2, 'lowering cold below warn lowers warn by 1');
    store.update({ cacheWarnMin: 0, cacheColdMin: 1000, queueWarnSec: 1000, cacheIndicator: 'gauge' });
    assert.equal(store.read().cacheWarnMin, 2);
    assert.equal(store.read().cacheColdMin, 3);
    assert.equal(store.read().queueWarnSec, 45);
    assert.equal(store.read().cacheIndicator, 'bar');
    store.update({ cacheWarnMin: 998, cacheColdMin: 999, queueWarnSec: 999 });
    assert.equal(store.read().cacheWarnMin, 998);
    assert.equal(store.read().cacheColdMin, 999);
    assert.equal(store.read().queueWarnSec, 999);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const ui = createPresentation();
  const t0 = 1700000000000;
  const data = { contextTokens: 100000, cachedIn: 80000, lastStepEpochMs: t0 };
  const custom = { showCacheWarnings: true, cacheWarnMin: 5, cacheColdMin: 8, cacheIndicator: 'bar' };
  const freshBar = ui.cacheView(data, custom, t0 + 240 * 1000); // 4m of 8m = 50%
  assert.equal(freshBar.status, 'fresh');
  assert.equal(freshBar.indicator, 'bar');
  assert.equal(freshBar.progress, 0.5);
  assert.equal(freshBar.progressPct, '50.0%');
  assert.equal(freshBar.progressColor, '#4ea84e');
  assert.equal(freshBar.iconSvg, '');

  const warnBar = ui.cacheView(data, custom, t0 + 360 * 1000); // 6m of 8m = 75%
  assert.equal(warnBar.status, 'warning');
  assert.equal(warnBar.progress, 0.75);
  assert.equal(warnBar.progressColor, '#d4940a');
  assert.equal(warnBar.countdown, '~2m');
  assert.match(ui.cacheTooltip(data, ui.dictionaries.en, t0 + 360 * 1000, custom), /Approaching the 8m reminder threshold/);

  const coldBar = ui.cacheView(data, custom, t0 + 600 * 1000); // 10m > 8m => stays full red
  assert.equal(coldBar.status, 'cold');
  assert.equal(coldBar.progress, 1);
  assert.equal(coldBar.progressPct, '100%');
  assert.equal(coldBar.progressColor, '#e06c75');
  assert.match(ui.cacheTooltip(data, ui.dictionaries['zh-CN'], t0 + 600 * 1000, custom), /已达 8 分钟阈值/);

  const ringFresh = ui.cacheView(data, { showCacheWarnings: true, cacheIndicator: 'ring' }, t0 + 120 * 1000);
  assert.equal(ringFresh.indicator, 'ring');
  assert.equal(ringFresh.progress, 0.5);
  assert.match(ringFresh.iconSvg, /stroke="#4ea84e"/);
  const ringZero = ui.cacheView(data, { showCacheWarnings: true, cacheIndicator: 'ring' }, t0);
  assert.equal(ringZero.progress, 0);
  assert.doesNotMatch(ringZero.iconSvg, /stroke-dashoffset/, '0% ring should not draw a round-cap dot');
  const ringCold = ui.cacheView(data, { showCacheWarnings: true, cacheIndicator: 'ring' }, t0 + 300 * 1000);
  assert.equal(ringCold.progress, 1);
  assert.match(ringCold.iconSvg, /stroke="#e06c75"[^>]*stroke-dashoffset="0\.00"/);

  const offBar = ui.cacheView(data, { showCacheWarnings: false, cacheIndicator: 'bar' }, t0 + 600 * 1000);
  assert.equal(offBar.status, 'fresh');
  assert.equal(offBar.progress, 0);

  const view = toView({ ...data, lastStepEpochMs: Date.now() - 120 * 1000, prefs: { showCacheWarnings: true, cacheIndicator: 'bar' } });
  assert.equal(view.cacheIndicator, 'bar');
  assert.equal(view.cacheProgressColor, '#4ea84e');
  assert.equal(view.cacheIconSvg, '');

  const settingsHtml = UI_HTML.slice(UI_HTML.indexOf('<section class="settings'));
  assert.ok(settingsHtml.indexOf('data-setting-card="quotaIndicator"') < settingsHtml.indexOf('data-setting-card="cacheIndicator"'));
  assert.ok(settingsHtml.indexOf('data-setting-card="cacheIndicator"') < settingsHtml.indexOf('data-settings-scope="features"'));
  assert.ok(settingsHtml.indexOf('data-preview-group="turn"') < settingsHtml.indexOf('data-setting-card="showQueueWarnings"'), 'queue warning card should sit at the end of settings');
  assert.match(settingsHtml, /setting-threshold-card" data-setting-card="showCacheWarnings"[\s\S]*name="cacheWarnMin"[^>]*max="998"[\s\S]*name="cacheColdMin"[^>]*max="999"/);
  assert.match(settingsHtml, /setting-threshold-card" data-setting-card="showQueueWarnings"[\s\S]*name="queueWarnSec"[^>]*max="999"/);
  assert.match(UI_HTML, /\.setting-thresholds \{ display: inline-flex; align-items: center; gap: 5px; min-width: 0;/);
  assert.match(UI_HTML, /\.setting-threshold-card\[data-checked="false"\] \.setting-thresholds \{ opacity: \.42; pointer-events: none; \}/);
  assert.match(UI_HTML, /select\.addEventListener\('input', \(\) => \{/);
});
