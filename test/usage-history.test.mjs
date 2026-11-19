import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createUsageHistory, summarizeUsage } from '../agy-capsule/sidecars/agy_capsule/usage_history.mjs';
import { createUsagePresentation } from '../agy-capsule/sidecars/agy_capsule/usage_ui.mjs';
import { createPresentation } from '../agy-capsule/sidecars/agy_capsule/ui.mjs';
import { inspectUsage, readConversationUsage, startPanel, UI_HTML } from '../agy-capsule/sidecars/agy_capsule/server.mjs';
import { DEFAULT_SETTINGS } from '../agy-capsule/sidecars/agy_capsule/settings.mjs';
import { createStubDom } from './dom-stub.mjs';

const vi = value => { let n = BigInt(value); const bytes = []; while (n >= 128n) { bytes.push(Number(n & 127n) | 128); n >>= 7n; } return Buffer.from([...bytes, Number(n)]); };
const integer = (field, n) => Buffer.concat([vi(field * 8), vi(n)]);
const message = (field, data) => Buffer.concat([vi(field * 8 + 2), vi(data.length), data]);
const text = (field, value) => message(field, Buffer.from(value));
const stamp = (field, seconds) => message(field, integer(1, seconds));
// CortexStepGeneratorMetadata: chat_model = 1 { usage = 4, chat_start_metadata = 9 { created_at = 4 },
// response_model = 19, model_display_name = 21 }, step_indices = 2.
const generation = ({ startedAt = 0, usage = [], names = [], steps = [] }) => Buffer.concat([
  message(1, Buffer.concat([message(4, Buffer.concat(usage)), ...(startedAt ? [message(9, stamp(4, startedAt))] : []), ...names])),
  ...steps,
]);
const temporaryDirectory = t => {
  const directory = mkdtempSync(join(tmpdir(), 'agy-usage-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};
// Local noon, so the day is the same in every time zone the tests run in.
const noon = (month, day) => new Date(2026, month - 1, day, 12).getTime();
const bucket = (requests, uncached, cacheRead, cacheWrite, output) => ({ requests, uncached, cacheRead, cacheWrite, output });

test('a conversation database yields one dated record per answered request and is left as it was found', t => {
  const directory = temporaryDirectory(t);
  const path = join(directory, 'conversation.db');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB); CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);');
  db.prepare('INSERT INTO steps VALUES (?,?,?,?)').run(7, 15, 3, stamp(1, 1760003600));
  const insert = db.prepare('INSERT INTO gen_metadata VALUES (?,?)');
  insert.run(0, generation({ startedAt: 1760000000, names: [text(19, 'gemini-3.8-flash-high'), text(21, 'Gemini 3.8 Flash (High)')], usage: [integer(2, 100), integer(3, 40), integer(4, 50), integer(5, 900), integer(6, 3), text(7, 'message-1'), text(11, 'response-1')] }));
  // No request start: dated by its first step, here in the packed form. No display name either.
  insert.run(1, generation({ names: [text(19, 'claude-sonnet-4-6')], usage: [integer(2, 10), integer(3, 5), text(7, 'message-2')], steps: [message(2, Buffer.concat([vi(7), vi(8)]))] }));
  // Its step is gone as well, so the request stays undated.
  insert.run(2, generation({ usage: [integer(5, 20)], steps: [integer(2, 9)] }));
  // A preflight row reports no consumption.
  insert.run(3, generation({ startedAt: 1760000000, usage: [integer(2, 0)] }));
  db.close();
  assert.deepEqual(readConversationUsage(path), [
    { at: 1760000000000, id: 'r3:response-1', model: 'Gemini 3.8 Flash (High)', uncached: 100, cacheRead: 900, cacheWrite: 50, output: 40 },
    { at: 1760003600000, id: 'm0:message-2', model: 'claude-sonnet-4-6', uncached: 10, cacheRead: 0, cacheWrite: 0, output: 5 },
    { at: null, id: '', model: '', uncached: 0, cacheRead: 20, cacheWrite: 0, output: 0 },
  ]);
  assert.deepEqual(readdirSync(directory), ['conversation.db'], 'reading a closed conversation leaves no -wal or -shm file beside it');

  // A conversation the host has open is read through its write-ahead log.
  const host = new DatabaseSync(path);
  try {
    host.prepare('INSERT INTO gen_metadata VALUES (?,?)').run(4, generation({ startedAt: 1760007200, usage: [integer(3, 9)] }));
    assert.equal(readConversationUsage(path).at(-1).output, 9);
  } finally {
    host.close();
  }
});

test('usage is added up per local day and model, and a response stored in two conversations counts once', () => {
  const request = (at, id, model, uncached, output = 0) => ({ at, id, model, uncached, cacheRead: 0, cacheWrite: 0, output });
  const summary = summarizeUsage([
    request(noon(10, 12), '', 'Gemini', 30),
    request(noon(10, 11), 'r1:a', 'Gemini', 100, 20),
    request(noon(10, 11), '', 'Claude', 5),
    request(noon(10, 11), 'r1:a', 'Gemini', 100, 60), // the same response again, with its complete output
    request(null, '', 'Gemini', 7),
  ]);
  assert.deepEqual(summary, {
    days: [
      { date: '2026-10-11', ...bucket(2, 105, 0, 0, 60), models: [{ name: 'Claude', ...bucket(1, 5, 0, 0, 0) }, { name: 'Gemini', ...bucket(1, 100, 0, 0, 60) }] },
      { date: '2026-10-12', ...bucket(1, 30, 0, 0, 0), models: [{ name: 'Gemini', ...bucket(1, 30, 0, 0, 0) }] },
    ],
    undated: bucket(1, 7, 0, 0, 0),
  });
});

test('conversation databases are read once, again only after they change, and never in one blocking sweep', async t => {
  const directory = temporaryDirectory(t);
  const first = join(directory, 'first.db');
  const second = join(directory, 'second.db');
  writeFileSync(first, 'first');
  writeFileSync(second, 'second');
  writeFileSync(join(directory, 'notes.txt'), 'not a conversation');
  const row = uncached => ({ at: noon(10, 11), id: '', model: 'Gemini', uncached, cacheRead: 0, cacheWrite: 0, output: 0 });
  const rows = { 'first.db': [row(1)], 'second.db': [row(2)] };
  const trace = [];
  let failing = '';
  const history = createUsageHistory({
    directories: [join(directory, 'never-used'), directory],
    readRequests: path => {
      trace.push(basename(path));
      if (basename(path) === failing) throw new Error('database is locked');
      return rows[basename(path)];
    },
    pause: async () => { trace.push('pause'); },
  });
  const uncached = async () => (await history.read()).days[0]?.uncached ?? 0;

  // Both readers share one scan, and the event loop gets a turn after each database.
  const [one, other] = await Promise.all([history.read(), history.read()]);
  assert.equal(one, other);
  const scanned = trace.splice(0);
  assert.deepEqual(scanned.filter((_, index) => index % 2 === 0).sort(), ['first.db', 'second.db']);
  assert.deepEqual(scanned.filter((_, index) => index % 2 === 1), ['pause', 'pause']);
  assert.equal(one.days[0].uncached, 3);

  assert.equal(await uncached(), 3);
  assert.deepEqual(trace.splice(0), [], 'unchanged databases are not opened again');

  appendFileSync(second, ' grew');
  rows['second.db'][0].uncached = 20;
  assert.equal(await uncached(), 21);
  assert.deepEqual(trace.splice(0), ['second.db', 'pause']);

  // A database that cannot be read right now keeps its last rows, is reported and is tried again.
  appendFileSync(second, ' again');
  failing = 'second.db';
  const partial = await history.read();
  assert.deepEqual([partial.days[0].uncached, partial.unread], [21, 1]);
  failing = '';
  rows['second.db'][0].uncached = 200;
  const repaired = await history.read();
  assert.deepEqual([repaired.days[0].uncached, repaired.unread], [201, 0]);

  rmSync(second);
  assert.equal(await uncached(), 1, 'a deleted conversation leaves the history');
});

test('the history is served only by the authenticated POST route and is not scanned while it is off, the default', async () => {
  const routes = new Set();
  class SidecarApp { api(path, handler, method = 'POST') { routes.add(method + ' ' + path); } page() {} run() {} }
  await startPanel(() => ({ SidecarApp }), { ANTIGRAVITY_SIDECAR_UI_TOKEN: 'fixture' });
  assert.equal(routes.has('POST /api/usage'), true);
  assert.equal(routes.has('GET /api/usage'), false, 'the SDK does not authenticate GET requests');
  assert.deepEqual(await inspectUsage({ ...DEFAULT_SETTINGS }), { enabled: false });
});

const usageUi = () => { const ui = createPresentation(); return createUsagePresentation(ui.formatTokens, ui.escapeHtml); };
// 2026-11-19 is a Thursday: its week began on Monday the 16th, and November began on a Sunday.
const history = {
  days: [
    { date: '2026-10-31', ...bucket(1, 7, 0, 0, 0), models: [{ name: 'Gemini 3.8 Flash', ...bucket(1, 7, 0, 0, 0) }] },
    { date: '2026-11-15', ...bucket(1, 5, 0, 0, 0), models: [{ name: 'Gemini 3.8 Flash', ...bucket(1, 5, 0, 0, 0) }] },
    { date: '2026-11-16', ...bucket(2, 10, 0, 0, 0), models: [{ name: '', ...bucket(1, 4, 0, 0, 0) }, { name: 'Gemini 3.8 Flash', ...bucket(1, 6, 0, 0, 0) }] },
    { date: '2026-11-19', ...bucket(3, 100, 900, 100, 400), models: [{ name: 'Claude Sonnet 4.6', ...bucket(1, 50, 400, 100, 250) }, { name: 'Gemini 3.8 Flash', ...bucket(2, 50, 500, 0, 150) }] },
  ],
  undated: bucket(1, 3, 0, 0, 0),
};

test('totals follow the calendar: today, a week that starts on Monday, and the month', () => {
  assert.deepEqual(usageUi().usageTotals(history, '2026-11-19'), { today: 1500, week: 1510, month: 1515, all: 1525, requests: 8, since: '2026-10-31' });
});

test('activity is laid out one week per column, newest last, and the weekly view folds a week into one cell', () => {
  const ui = usageUi();
  const daily = ui.activityView(history, { today: '2026-11-19', weeks: 4 });
  assert.deepEqual(daily.columns.map(column => [column.cells[0].from, column.month]), [['2026-10-26', ''], ['2026-11-02', '2026-11'], ['2026-11-09', ''], ['2026-11-16', '']]);
  const thisWeek = daily.columns[3].cells;
  assert.deepEqual(thisWeek.map(cell => cell.level), [1, 0, 0, 4, 0, 0, 0], 'a light day still registers next to a heavy one');
  assert.deepEqual(thisWeek.map(cell => cell.future), [false, false, false, false, true, true, true]);
  assert.deepEqual([thisWeek[3].tokens, thisWeek[3].requests], [1500, 3]);

  const weekly = ui.activityView(history, { today: '2026-11-19', scale: 'week', weeks: 4 });
  assert.deepEqual(weekly.columns.map(column => column.cells.map(cell => [cell.from, cell.to, cell.tokens, cell.requests, cell.level])), [
    [['2026-10-26', '2026-11-01', 7, 1, 1]], [['2026-11-02', '2026-11-08', 0, 0, 0]], [['2026-11-09', '2026-11-15', 5, 1, 1]], [['2026-11-16', '2026-11-22', 1510, 5, 4]],
  ]);
});

test('the activity block shows loading, empty and filled states in the display language', () => {
  const ui = usageUi();
  for (const dictionary of Object.values(ui.dictionaries)) assert.deepEqual(Object.keys(dictionary), Object.keys(ui.dictionaries.en));
  assert.match(ui.activityHtml(null, { language: 'zh-TW' }), /正在讀取本機對話…/);
  assert.match(ui.activityHtml({ days: [], undated: bucket(0, 0, 0, 0, 0) }, { language: 'en' }), /No usage recorded yet\./);
  const html = ui.activityHtml(history, { today: '2026-11-19', scale: 'week', language: 'zh-CN' });
  assert.match(html, /data-usage-scale="day" aria-pressed="false">每日<\/button><button type="button" data-usage-scale="week" aria-pressed="true">每周</);
  assert.match(html, /title="1,500 tokens"><span>今日<\/span><b>1\.5K<\/b>/);
  assert.match(html, /<div class="usage-heat" data-scale="week"/);
  assert.match(html, /<span class="usage-heat-month">11月<\/span>/);
  assert.match(html, /data-level="4" title="2026-11-16 – 2026-11-22 · 1,510 tokens · 5 次请求"/);
  assert.match(html, /始于 2026-10-31 · 8 次请求/);
  assert.doesNotMatch(html, /未能读取/);
  assert.match(ui.activityHtml({ ...history, unread: 2 }, { today: '2026-11-19', language: 'en' }), /2 conversation file\(s\) could not be read\./);
  assert.equal((ui.activityHtml(history, { today: '2026-11-19' }).match(/class="usage-heat-col"/g) || []).length, 53, 'a year of weeks; the style sheet drops the oldest in a narrow block');
});

test('usage by model pages through days, weeks and months, and a model keeps its colour from page to page', () => {
  const ui = usageUi();
  const days = ui.modelView(history, { today: '2026-11-19' });
  assert.deepEqual([days.bars.length, days.bars[0].from, days.bars.at(-1).from], [14, '2026-11-06', '2026-11-19']);
  assert.deepEqual(days.bars.at(-1).parts.slice(0, 3), [800, 700, 0]);
  assert.deepEqual([days.tokens, days.requests, days.max, days.range, days.older, days.newer], [1515, 6, 1500, '2026-11-06 – 11-19', true, false]);
  assert.deepEqual(days.models.map(model => [model.name, model.color, model.tokens, model.requests]), [['Claude Sonnet 4.6', '#388bfd', 800, 1], ['Gemini 3.8 Flash', '#e86a24', 711, 4], ['', '#00b386', 4, 1]]);

  const earlier = ui.modelView(history, { today: '2026-11-19', shift: -1 });
  assert.deepEqual([earlier.range, earlier.older, earlier.newer], ['2026-10-23 – 11-05', false, true]);
  assert.deepEqual(earlier.models.map(model => [model.name, model.color, model.tokens]), [['Gemini 3.8 Flash', '#e86a24', 7]]);

  const weeks = ui.modelView(history, { today: '2026-11-19', period: 'week' });
  assert.deepEqual(weeks.bars.slice(-4).map(bar => [bar.label, bar.tokens]), [['10/26', 7], ['11/2', 0], ['11/9', 5], ['11/16', 1510]]);
  assert.equal(weeks.range, '2026-08-31 – 11-22');

  const months = ui.modelView(history, { today: '2026-11-19', period: 'month' });
  assert.deepEqual(months.bars.slice(-2).map(bar => [bar.label, bar.from, bar.to, bar.tokens]), [['10', '2026-10-01', '2026-10-31', 7], ['11', '2026-11-01', '2026-11-30', 1515]]);
  assert.equal(months.range, '2025-12 – 2026-11');

  // More models than colours: the smallest ones share the last slot.
  const crowd = { days: [{ date: '2026-11-19', ...bucket(8, 36, 0, 0, 0), models: Array.from({ length: 8 }, (_, index) => ({ name: 'Model ' + index, ...bucket(1, 8 - index, 0, 0, 0) })) }] };
  assert.deepEqual(ui.modelView(crowd, { today: '2026-11-19' }).models.map(model => [model.name, model.tokens]), [['Model 0', 8], ['Model 1', 7], ['Model 2', 6], ['Model 3', 5], ['Model 4', 4], ['Model 5', 3], [null, 3]]);
});

test('the model block draws stacked bars, a paging control and one row per model', () => {
  const ui = usageUi();
  assert.match(ui.modelsHtml(null, { language: 'zh-CN' }), /正在读取本机对话…/);
  const html = ui.modelsHtml(history, { today: '2026-11-19', language: 'zh-TW' });
  assert.match(html, /data-usage-period="day" aria-pressed="true">日<\/button><button type="button" data-usage-period="week" aria-pressed="false">週</);
  assert.match(html, /data-usage-shift="-1" aria-label="更早">‹<\/button><span class="usage-range">2026-11-06 – 11-19<\/span><button type="button" data-usage-shift="1" aria-label="更晚" disabled>›</);
  assert.match(html, /title="1,515 tokens">1\.5K · 6 次請求</);
  // Today's bar is the tallest and is split 800 : 700 between its two models.
  assert.match(html, /title="2026-11-19 · 1,500 tokens · 3 次請求\nClaude Sonnet 4\.6: 800\nGemini 3\.8 Flash: 700"><span style="flex:0 0 0"><\/span><span class="usage-bar-stack" style="flex:1000 0 0"><i style="flex:533 0 0;background:#388bfd"><\/i><i style="flex:467 0 0;background:#e86a24"><\/i><\/span><span class="usage-bar-x">19<\/span>/);
  assert.match(html, /title="非快取輸入 50 · 快取讀取 400 · 快取寫入 100 · 輸出 250 · 1 次請求"><span class="usage-dot" style="background:#388bfd"><\/span><span class="usage-model-name">Claude Sonnet 4\.6<\/span><span class="usage-model-share">53%<\/span><span class="usage-model-tokens">800<\/span>/);
  assert.match(html, /<span class="usage-model-name">未知模型<\/span>/);
  assert.match(ui.modelsHtml(history, { today: '2026-11-19', shift: -3, language: 'en' }), /No usage in this period\./);
  const hostile = { days: [{ date: '2026-11-19', ...bucket(1, 1, 0, 0, 0), models: [{ name: '<img src=x onerror=alert(1)>', ...bucket(1, 1, 0, 0, 0) }] }] };
  assert.doesNotMatch(ui.modelsHtml(hostile, { today: '2026-11-19' }), /<img/);
});

// The sidebar page script on the stand-in DOM, at a fixed noon, with answers the test can change.
const snapshot = prefs => ({
  contextTokens: 128000, maxContextTokens: 256000, cachedIn: 100000, lastStepEpochMs: noon(11, 19) - 20000,
  prefs: { ...DEFAULT_SETTINGS, ...prefs },
  quotaGroups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: .58 }] }],
});
const openSidebar = async (data, usage) => {
  const dom = createStubDom({ page: true });
  dom.now = noon(11, 19);
  const requests = [];
  const fetch = async (url, options) => {
    requests.push(options.method + ' ' + url);
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(url === '/api/usage' ? usage : data)) };
  };
  const context = vm.createContext({ ...dom.globals, fetch });
  vm.runInContext('globalThis.window = globalThis;', context);
  let listener = null;
  const root = dom.document.getElementById('usage-root');
  root.addEventListener = (type, handler) => { if (type === 'click') listener = handler; };
  // The controls inside the blocks are the only elements the page script focuses.
  const focused = [];
  const query = dom.document.querySelector;
  dom.document.querySelector = selector => {
    const element = query(selector);
    if (selector.startsWith('[data-usage-')) element.focus = () => { focused.push(selector); };
    return element;
  };
  vm.runInContext(UI_HTML.slice(UI_HTML.lastIndexOf('<script>') + '<script>'.length, UI_HTML.lastIndexOf('</script>')), context);
  // The page starts its first poll itself, and the history is requested beside the poll rather
  // than within it: let whatever is under way finish.
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  const poll = async (seconds = 1) => { const before = dom.writes; dom.now += seconds * 1000; await dom.tick(); await settle(); return dom.writes - before; };
  // Counted only as POST: the SDK does not authenticate GET requests.
  const fetched = () => requests.filter(request => request === 'POST /api/usage').length;
  const click = dataset => listener({ target: { closest: () => ({ dataset, disabled: false }) } });
  return { context, poll, fetched, focused, root, click, activity: dom.document.getElementById('usage-activity'), models: dom.document.getElementById('usage-models') };
};

test('the sidebar leaves the history alone while it is off and reads it about once a minute while it is shown', async () => {
  const data = snapshot();
  const usage = { enabled: true, ...JSON.parse(JSON.stringify(history)) };
  const { context, poll, fetched, focused, root, click, activity } = await openSidebar(data, usage);
  await poll();
  await poll();
  assert.equal(fetched(), 0);
  assert.equal(root.hidden, true);

  data.prefs.showUsageActivity = true;
  await poll();
  assert.equal(root.hidden, false);
  assert.match(activity.innerHTML, /Reading local conversations…/);
  await poll();
  assert.equal(fetched(), 1);
  assert.match(activity.innerHTML, /<div class="usage-heat" data-scale="day"/);
  await poll();
  assert.equal(await poll(), 0);
  assert.equal(fetched(), 1, 'not every second');

  assert.equal(await poll(60), 0, 'an unchanged history is read again without repainting');
  assert.equal(fetched(), 2);
  usage.days.at(-1).uncached += 1000;
  await poll(60);
  assert.match(activity.innerHTML, /title="2,500 tokens"><span>Today<\/span>/);

  // The control inside the block switches the view and keeps the keyboard focus on itself.
  click({ usageScale: 'week' });
  assert.match(activity.innerHTML, /<div class="usage-heat" data-scale="week"/);
  assert.deepEqual(focused, ['[data-usage-scale="week"]']);

  vm.runInContext("selectSidebarView('settings')", context);
  await poll(60);
  assert.equal(fetched(), 3, 'nothing is read behind the settings tab');
  vm.runInContext("selectSidebarView('stats')", context);
  await poll();
  assert.equal(fetched(), 4);
});

test('the model block shares the one history request and changes period and page without another', async () => {
  const { poll, fetched, click, activity, models } = await openSidebar(snapshot({ showModelUsage: true }), { enabled: true, ...history });
  await poll();
  await poll();
  assert.equal(fetched(), 1);
  assert.equal(activity.hidden, true, 'the activity block stays off');
  assert.match(models.innerHTML, /<span class="usage-range">2026-11-06 – 11-19<\/span>/);

  click({ usageShift: '-1' });
  assert.match(models.innerHTML, /<span class="usage-range">2026-10-23 – 11-05<\/span>/);
  click({ usagePeriod: 'month' });
  assert.match(models.innerHTML, /<span class="usage-range">2025-12 – 2026-11<\/span>/, 'a new period starts at the current page');
  click({ usageShift: '1' });
  assert.match(models.innerHTML, /<span class="usage-range">2025-12 – 2026-11<\/span>/, 'there is no page after today');
  assert.equal(fetched(), 1);
});

test('both history blocks are opt-in settings next to the other statistics, without help dots of their own', () => {
  const settingsHtml = UI_HTML.slice(UI_HTML.indexOf('<section class="settings'));
  const activity = settingsHtml.indexOf('data-setting-card="showUsageActivity" data-checked="false"');
  const models = settingsHtml.indexOf('data-setting-card="showModelUsage" data-checked="false"');
  assert.ok(settingsHtml.indexOf('data-preview-group="turn"') < activity && activity < models && models < settingsHtml.indexOf('data-setting-card="showQueueWarnings"'));
  assert.match(UI_HTML, /<section class="stats-usage" id="usage-root" hidden>\s*<div class="usage-block" id="usage-activity" hidden><\/div>\s*<div class="usage-block" id="usage-models" hidden><\/div>/);
  assert.match(UI_HTML, /\.stats-usage\[hidden\], \.usage-block\[hidden\] \{ display: none; \}/);
});
