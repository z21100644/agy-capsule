import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createUsageHistory, summarizeUsage } from '../agy-capsule/sidecars/agy_capsule/usage_history.mjs';
import { createUsagePresentation } from '../agy-capsule/sidecars/agy_capsule/usage_ui.mjs';
import { createPresentation } from '../agy-capsule/sidecars/agy_capsule/ui.mjs';
import { inspectUsage, parseUsageRow, readConversationUsage, startPanel, UI_HTML } from '../agy-capsule/sidecars/agy_capsule/server.mjs';
import { DEFAULT_SETTINGS } from '../agy-capsule/sidecars/agy_capsule/settings.mjs';

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
  // No request start (or an implausible small integer in field 9.4) and no display name: dated by step, falls back to response_model.
  insert.run(1, generation({ startedAt: 42, names: [text(19, 'claude-opus-5-5-medium')], usage: [integer(2, 10), integer(3, 5), text(7, 'message-2')], steps: [message(2, Buffer.concat([vi(6), vi(7), vi(8)]))] }));
  // Its step is gone as well, so the request stays undated.
  insert.run(2, generation({ usage: [integer(5, 20)], steps: [integer(2, 9)] }));
  // A preflight row reports no consumption.
  insert.run(3, generation({ startedAt: 1760000000, usage: [integer(2, 0)] }));
  db.close();
  assert.deepEqual(readConversationUsage(path), [
    { at: 1760000000000, id: 'r3:response-1', model: 'Gemini 3.8 Flash (High)', uncached: 100, cacheRead: 900, cacheWrite: 50, output: 40 },
    { at: 1760003600000, id: 'm0:message-2', model: 'claude-opus-5-5-medium', uncached: 10, cacheRead: 0, cacheWrite: 0, output: 5 },
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

  // A database without a steps table stays consistent across packed and unpacked step_indices,
  // while genuine SQLite errors from stepMetadata are never swallowed on packed step_indices.
  const noStepsPath = join(directory, 'no-steps.db');
  const noSteps = new DatabaseSync(noStepsPath);
  noSteps.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);');
  noSteps.prepare('INSERT INTO gen_metadata VALUES (?,?)').run(0, generation({ usage: [integer(2, 11)], steps: [integer(2, 1)] }));
  noSteps.prepare('INSERT INTO gen_metadata VALUES (?,?)').run(1, generation({ usage: [integer(2, 22)], steps: [message(2, Buffer.concat([vi(1), vi(2)]))] }));
  noSteps.close();
  assert.deepEqual(readConversationUsage(noStepsPath), [
    { at: null, id: '', model: '', uncached: 11, cacheRead: 0, cacheWrite: 0, output: 0 },
    { at: null, id: '', model: '', uncached: 22, cacheRead: 0, cacheWrite: 0, output: 0 },
  ]);
  const packedRow = generation({ usage: [integer(2, 10)], steps: [message(2, Buffer.concat([vi(1), vi(2)]))] });
  assert.throws(() => parseUsageRow(packedRow, () => { throw new Error('SQLITE_BUSY'); }), /SQLITE_BUSY/);
});

test('usage is added up per local day and model with deterministic response deduplication', () => {
  const request = (at, id, model, uncached, output = 0, source = '') => ({ at, id, model, uncached, cacheRead: 0, cacheWrite: 0, output, source });
  const summary = summarizeUsage([
    request(noon(10, 12), '', 'Gemini', 30),
    request(noon(10, 11), 'r1:a', 'Gemini', 100, 20, 'b.db'),
    request(noon(10, 11), '', 'Claude', 5),
    request(noon(10, 11), 'r1:a', 'Gemini', 100, 60, 'a.db'), // fullest record wins
    request(null, '', 'Gemini', 7),
  ]);
  assert.deepEqual(summary, {
    days: [
      { date: '2026-10-11', ...bucket(2, 105, 0, 0, 60), models: [{ name: 'Claude', ...bucket(1, 5, 0, 0, 0) }, { name: 'Gemini', ...bucket(1, 100, 0, 0, 60) }] },
      { date: '2026-10-12', ...bucket(1, 30, 0, 0, 0), models: [{ name: 'Gemini', ...bucket(1, 30, 0, 0, 0) }] },
    ],
    undated: bucket(1, 7, 0, 0, 0),
  });

  // Equal-token duplicates pick the dated/earlier/named record regardless of input order.
  const earlier = request(noon(10, 10), 'r1:tie', 'Gemini', 50, 10, 'z.db');
  const later = request(noon(10, 11), 'r1:tie', 'Claude', 50, 10, 'a.db');
  const undated = request(null, 'r1:tie', '', 50, 10, '0.db');
  assert.deepEqual(summarizeUsage([later, undated, earlier]), summarizeUsage([earlier, later, undated]));
  assert.deepEqual(summarizeUsage([later, undated, earlier]).days.map(d => d.date), ['2026-10-10']);
});

test('conversation databases are read once, skip immutable when active or recent, and discard torn mid-read writes', async t => {
  const directory = temporaryDirectory(t);
  const idle = join(directory, 'idle.db');
  const recent = join(directory, 'recent.db');
  const active = join(directory, 'active.db');
  const nowMs = Date.UTC(2026, 10, 20, 12, 0, 0);
  const oldDate = new Date(nowMs - 5 * 60_000);
  const freshDate = new Date(nowMs - 10_000);
  for (const [file, mtime] of [[idle, oldDate], [recent, freshDate], [active, oldDate]]) {
    writeFileSync(file, basename(file));
    utimesSync(file, mtime, mtime);
  }
  writeFileSync(join(directory, 'notes.txt'), 'not a conversation');
  mkdirSync(join(directory, 'folder.db')); // directory named *.db must be ignored cleanly

  const row = uncached => ({ at: noon(10, 11), id: '', model: 'Gemini', uncached, cacheRead: 0, cacheWrite: 0, output: 0 });
  const rows = { 'idle.db': [row(1)], 'recent.db': [row(2)], 'active.db': [row(4)] };
  const trace = [];
  const modes = new Map();
  let failing = '';
  let mutateDuringRead = false;
  let deleteDuringRead = false;
  const history = createUsageHistory({
    directories: [join(directory, 'never-used'), directory],
    getActiveIds: () => ['active'],
    recentMs: 60_000,
    now: () => nowMs,
    readRequests: (path, opts) => {
      const name = basename(path);
      trace.push(name);
      modes.set(name, opts.immutable);
      if (name === failing) throw new Error('database is locked');
      if (name === 'recent.db' && mutateDuringRead) {
        mutateDuringRead = false;
        appendFileSync(path, ' mid-read');
        return [row(999)];
      }
      if (name === 'idle.db' && deleteDuringRead) {
        deleteDuringRead = false;
        rmSync(path);
        return [row(888)];
      }
      return rows[name];
    },
    pause: async () => { trace.push('pause'); },
  });
  const uncached = async () => (await history.read()).days[0]?.uncached ?? 0;

  // Both readers share one scan, and the event loop gets a turn after each database.
  const [one, other] = await Promise.all([history.read(), history.read()]);
  assert.equal(one, other);
  assert.deepEqual(trace.splice(0), ['active.db', 'pause', 'idle.db', 'pause', 'recent.db', 'pause']);
  assert.equal(modes.get('idle.db'), true, 'old closed DB without WAL uses immutable=1');
  assert.equal(modes.get('recent.db'), false, 'recently modified DB skips immutable=1');
  assert.equal(modes.get('active.db'), false, 'active conversation DB skips immutable=1');
  assert.equal(one.days[0].uncached, 7);
  assert.equal(one.unread, 0, 'directory named *.db is not treated as an unreadable database');

  assert.equal(await uncached(), 7);
  assert.deepEqual(trace.splice(0), [], 'unchanged databases are not opened again');

  // If the file changes while being read, discard that round, report unread, and keep prior rows until next scan.
  appendFileSync(recent, ' trigger');
  mutateDuringRead = true;
  rows['recent.db'][0].uncached = 20;
  const torn = await history.read();
  assert.deepEqual([torn.days[0]?.uncached, torn.unread], [7, 1], 'mid-read write discards the torn result (999), keeps prior cached rows, and reports unread');
  assert.deepEqual(trace.splice(0), ['recent.db', 'pause']);
  const afterTorn = await history.read();
  assert.deepEqual([afterTorn.days[0]?.uncached, afterTorn.unread], [25, 0], 'next scan cleanly re-reads the updated file and clears unread');
  assert.deepEqual(trace.splice(0), ['recent.db', 'pause']);

  // On an initial scan, a mid-read write must also report unread rather than looking silently empty.
  const coldDir = temporaryDirectory(t);
  const coldPath = join(coldDir, 'busy.db');
  writeFileSync(coldPath, 'v1');
  let coldMutate = true;
  const coldHistory = createUsageHistory({
    directories: [coldDir],
    readRequests: file => {
      if (coldMutate) { coldMutate = false; appendFileSync(file, 'v2'); return [row(999)]; }
      return [row(42)];
    },
  });
  const coldFirst = await coldHistory.read();
  assert.deepEqual([coldFirst.days.length, coldFirst.unread], [0, 1], 'first scan reports unread when concurrent write discards the only file');
  const coldSecond = await coldHistory.read();
  assert.deepEqual([coldSecond.days[0]?.uncached, coldSecond.unread], [42, 0]);

  // A database that cannot be read right now keeps its last rows, is reported and is tried again.
  appendFileSync(recent, ' again');
  failing = 'recent.db';
  const partial = await history.read();
  assert.deepEqual([partial.days[0].uncached, partial.unread], [25, 1]);
  failing = '';
  rows['recent.db'][0].uncached = 200;
  const repaired = await history.read();
  assert.deepEqual([repaired.days[0].uncached, repaired.unread], [205, 0]);

  // If a previously cached file is deleted during a read, drop its stale rows on the same scan.
  appendFileSync(idle, ' before-delete');
  deleteDuringRead = true;
  assert.equal(await uncached(), 204, 'mid-read deletion immediately removes stale rows instead of waiting a round');

  rmSync(recent);
  assert.equal(await uncached(), 4, 'a deleted conversation leaves the history');

  // A real recently-modified WAL database read with immutable=false can leave a 0-byte -wal
  // side-effect file; that must not falsely trigger a torn-read discard on the first scan,
  // and once aged past recentMs a fresh scanner can return to immutable=1.
  const walDir = temporaryDirectory(t);
  const walPath = join(walDir, 'fresh.db');
  const writer = new DatabaseSync(walPath);
  writer.exec('PRAGMA journal_mode=WAL; CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB); CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);');
  writer.prepare('INSERT INTO gen_metadata VALUES (?,?)').run(0, generation({ startedAt: 1760000000, usage: [integer(2, 123)] }));
  writer.close();
  let walReads = 0;
  const realHistory = createUsageHistory({
    directories: [walDir],
    recentMs: 60_000,
    readRequests: (file, opts) => {
      walReads++;
      assert.equal(opts.immutable, false, 'freshly written DB skips immutable=1');
      return readConversationUsage(file, opts);
    },
  });
  const firstScan = await realHistory.read();
  assert.equal(firstScan.days[0]?.uncached, 123, 'first scan succeeds despite 0-byte -wal created by plain read-only open');
  assert.equal(walReads, 1);
  await realHistory.read();
  assert.equal(walReads, 1, 'second scan reuses cached snapshot when nothing was written');

  const restarted = createUsageHistory({
    directories: [walDir],
    recentMs: 60_000,
    now: () => Date.now() + 120_000,
    readRequests: (file, opts) => {
      assert.equal(opts.immutable, true, 'idle DB with only a 0-byte -wal returns to immutable=1');
      return readConversationUsage(file, opts);
    },
  });
  assert.equal((await restarted.read()).days[0]?.uncached, 123);
});

test('the history is served only by the authenticated POST route and is not scanned while it is off, the default', async () => {
  const routes = new Set();
  class SidecarApp { api(path, handler, method = 'POST') { routes.add(method + ' ' + path); } page() {} run() {} }
  await startPanel(() => ({ SidecarApp }), { ANTIGRAVITY_SIDECAR_UI_TOKEN: 'fixture' });
  assert.equal(DEFAULT_SETTINGS.showUsageActivity, false);
  assert.equal(DEFAULT_SETTINGS.showModelUsage, false);
  assert.ok(routes.has('POST /api/usage'));
  assert.ok(!routes.has('GET /api/usage'));
  assert.deepEqual(await inspectUsage({ ...DEFAULT_SETTINGS }), { enabled: false });
});

const ui = createPresentation();
const usageUi = createUsagePresentation(ui.formatTokens, ui.escapeHtml);
const history = {
  days: [
    { date: '2026-10-20', ...bucket(1, 2000, 0, 0, 1000), models: [{ name: 'Gemini 4 Argon (High)', ...bucket(1, 2000, 0, 0, 1000) }] },
    { date: '2026-11-05', ...bucket(1, 1000, 5000, 0, 0), models: [{ name: 'Claude Opus 5.5 (Medium)', ...bucket(1, 1000, 5000, 0, 0) }] },
    { date: '2026-11-16', ...bucket(1, 100, 200, 300, 400), models: [{ name: 'Gemini 4 Argon (Medium)', ...bucket(1, 100, 200, 300, 400) }] }, // Monday of this week
    {
      date: '2026-11-19', ...bucket(2, 500, 600, 200, 200),
      models: [
        { name: 'Gemini 4 Argon (High)', ...bucket(1, 400, 600, 0, 0) },
        { name: 'claude-opus-5-5-high', ...bucket(1, 100, 0, 200, 200) },
      ],
    }, // Thursday (today)
  ],
  undated: bucket(1, 50, 0, 0, 0),
  unread: 0,
};

test('totals follow the calendar with four-part breakdowns for hover tooltips', () => {
  const totals = usageUi.usageTotals(history, '2026-11-19');
  assert.equal(totals.today, 1500);
  assert.equal(totals.week, 2500);
  assert.equal(totals.month, 8500);
  assert.equal(totals.all, 11550);
  assert.equal(totals.requests, 6);
  assert.equal(totals.since, '2026-10-20');
  assert.deepEqual(totals.parts.today, bucket(2, 500, 600, 200, 200));
  assert.deepEqual(totals.parts.week, bucket(3, 600, 800, 500, 600));
  assert.deepEqual(totals.parts.month, bucket(4, 1600, 5800, 500, 600));
  assert.deepEqual(totals.parts.all, bucket(6, 3650, 5800, 500, 1600));
  // On a Sunday, the week still runs back to Monday.
  assert.equal(usageUi.usageTotals(history, '2026-11-22').week, 2500);
});

test('activity is laid out one week per column, newest last, and weekly cells sum all four counters', () => {
  const daily = usageUi.activityView(history, { today: '2026-11-19', scale: 'day', weeks: 4 });
  assert.equal(daily.columns.length, 4);
  const current = daily.columns.at(-1).cells;
  assert.deepEqual(current.map(cell => cell.from), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  assert.deepEqual(current.map(cell => cell.future), [false, false, false, false, true, true, true]);
  assert.equal(current[0].level, 2);
  assert.equal(current[3].level, 2);
  assert.equal(daily.columns[1].cells[3].level, 4); // Nov 5 is the peak (6000)

  const weekly = usageUi.activityView(history, { today: '2026-11-19', scale: 'week', weeks: 4 });
  assert.ok(weekly.columns.every(column => column.cells.length === 1));
  const thisWeek = weekly.columns.at(-1).cells[0];
  assert.equal(thisWeek.tokens, 2500);
  assert.equal(thisWeek.requests, 3);
  assert.deepEqual(
    [thisWeek.uncached, thisWeek.cacheRead, thisWeek.cacheWrite, thisWeek.output],
    [600, 800, 500, 600],
  );
  assert.equal(thisWeek.from, '2026-11-16');
  assert.equal(thisWeek.to, '2026-11-22');
});

test('the activity block renders four-part tooltips, All-time scope note, and loading/empty/unread states', () => {
  assert.match(usageUi.activityHtml(null, { language: 'zh-CN' }), /正在读取本机对话/);
  assert.match(usageUi.activityHtml({ days: [], undated: bucket(0, 0, 0, 0, 0), unread: 2 }, { language: 'en' }), /No usage recorded yet.*2 conversation file\(s\)/);
  const html = usageUi.activityHtml({ ...history, unread: 1 }, { today: '2026-11-19', language: 'zh-CN' });
  assert.match(html, /今日<\/span><b>1\.5K<\/b>/);
  assert.match(html, /非缓存输入 500 · 缓存读取 600 · 缓存写入 200 · 输出 200/);
  assert.match(html, /仅统计现存本机对话/);
  assert.match(html, /2026-11-19 · 1,500 tokens · 2 次请求\n非缓存输入 500 · 缓存读取 600 · 缓存写入 200 · 输出 200/);
  assert.match(html, /始于 2026-10-20 · 6 次请求/);
  assert.match(html, /1 个对话文件未能读取/);
});

test('usage by model aggregates effort tiers into model families, merges response_model fallbacks, and keeps colours across pages', () => {
  const recent = usageUi.modelView(history, { today: '2026-11-19', period: 'day', shift: 0 });
  assert.equal(recent.bars.length, 14);
  assert.equal(recent.range, '2026-11-06 – 11-19');
  assert.deepEqual([recent.older, recent.newer, recent.tokens, recent.requests], [true, false, 2500, 3]);
  // Claude Opus 5.5 (6500 all-time: 6000 Medium + 500 claude-opus-5-5-high) outranks Gemini 4 Argon (5000).
  assert.deepEqual(recent.models.map(m => [m.name, m.tokens]), [['Gemini 4 Argon', 2000], ['Claude Opus 5.5', 500]]);
  assert.deepEqual(recent.models[0].tiers.map(t => [t.tier, t.tokens]), [['High', 1000], ['Medium', 1000]]);
  assert.deepEqual(recent.models[1].tiers.map(t => [t.tier, t.tokens]), [['High', 500]]);
  const claudeColor = recent.models[1].color;
  const argonColor = recent.models[0].color;

  const previous = usageUi.modelView(history, { today: '2026-11-19', period: 'day', shift: -1 });
  assert.equal(previous.range, '2026-10-23 – 11-05');
  assert.deepEqual([previous.older, previous.newer], [true, true]);
  assert.equal(previous.models[0].color, claudeColor, 'Claude keeps its all-time colour on earlier pages');
  assert.equal(usageUi.modelView(history, { today: '2026-11-19', period: 'day', shift: -2 }).models[0].color, argonColor);

  const months = usageUi.modelView(history, { today: '2026-11-19', period: 'month', shift: 0 });
  assert.equal(months.range, '2025-12 – 2026-11');
  assert.deepEqual([months.older, months.newer, months.tokens], [false, false, 11500]);

  // Multiple Gemini thinking tiers do not crowd Claude out of the 6-colour palette, and
  // standalone response_model fallbacks (gemini-3.8-flash) are preserved and grouped cleanly.
  const realistic = {
    days: [{
      date: '2026-11-19',
      ...bucket(10, 0, 0, 0, 0),
      models: [
        { name: 'Gemini 4 Hydrogen (High)', ...bucket(2, 4000, 0, 0, 0) },
        { name: 'Gemini 4 Hydrogen (XHigh)', ...bucket(1, 2000, 0, 0, 0) },
        { name: 'Gemini 4 Argon (High)', ...bucket(2, 3000, 0, 0, 0) },
        { name: 'Gemini 4 Argon (Medium)', ...bucket(1, 1500, 0, 0, 0) },
        { name: 'Gemini 4 Neon (Low)', ...bucket(1, 1200, 0, 0, 0) },
        { name: 'Gemini 4 Neon (High)', ...bucket(1, 1100, 0, 0, 0) },
        { name: 'gemini-3.8-flash', ...bucket(1, 900, 0, 0, 0) },
        { name: 'gemini-3.8-flash-high', ...bucket(1, 300, 0, 0, 0) },
        { name: 'Claude Opus 5.5 (Medium)', ...bucket(1, 1000, 0, 0, 0) },
      ],
    }],
  };
  const merged = usageUi.modelView(realistic, { today: '2026-11-19', period: 'day' });
  assert.deepEqual(
    merged.models.map(m => [m.name, m.tokens]),
    [
      ['Gemini 4 Hydrogen', 6000],
      ['Gemini 4 Argon', 4500],
      ['Gemini 4 Neon', 2300],
      ['gemini-3.8-flash', 1200],
      ['Claude Opus 5.5', 1000],
    ],
  );
  assert.ok(merged.models.every(m => m.name !== null), 'all 5 families fit in the palette without overflowing into Other models');

  // Past 6 distinct model families, the smallest share the "Other models" slot with collapsed-family breakdown,
  // and "Other models" always stays at the bottom of the list even when its combined tokens exceed a named family.
  const many = {
    days: [{
      date: '2026-11-19', ...bucket(9, 430, 0, 0, 0),
      models: [
        { name: 'm1', ...bucket(1, 90, 0, 0, 0) },
        { name: 'm2', ...bucket(1, 80, 0, 0, 0) },
        { name: 'm3', ...bucket(1, 70, 0, 0, 0) },
        { name: 'm4', ...bucket(1, 60, 0, 0, 0) },
        { name: 'm5', ...bucket(1, 50, 0, 0, 0) },
        { name: 'm6', ...bucket(1, 30, 0, 0, 0) },
        { name: 'm7', ...bucket(1, 20, 0, 0, 0) },
        { name: 'm8', ...bucket(1, 16, 0, 0, 0) },
        { name: 'm9', ...bucket(1, 14, 0, 0, 0) },
      ],
    }],
  };
  const grouped = usageUi.modelView(many, { today: '2026-11-19', period: 'day' });
  const other = grouped.models.at(-1);
  assert.equal(grouped.models.length, 7);
  assert.equal(other.name, null, 'Other models stays last even when its sum (50) beats m6 (30)');
  assert.equal(other.tokens, 50);
  assert.deepEqual(grouped.models.map(m => m.name), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', null]);
  assert.deepEqual(other.families.map(f => [f.name, f.tokens]), [['m7', 20], ['m8', 16], ['m9', 14]]);

  // Edge cases: whitespace after models/, -thinking-<tier> and (Thinking, <tier>) orderings,
  // unknown period fallback, and future dates (> today) excluded before palette ranking and across periods.
  assert.deepEqual(usageUi.splitModelName('models/  gemini-3-pro-high'), { key: 'gemini-3-pro', family: 'gemini-3-pro', tier: 'High', isDisplay: false });
  assert.deepEqual(usageUi.splitModelName('claude-opus-4-6-thinking-high'), { key: 'claude-opus-4-6', family: 'claude-opus-4-6', tier: 'High', isDisplay: false });
  assert.deepEqual(usageUi.splitModelName('Claude Opus 4.6 (Thinking, High)'), { key: 'claude-opus-4-6', family: 'Claude Opus 4.6', tier: 'High', isDisplay: true });
  assert.equal(usageUi.modelView(history, { today: '2026-11-19', period: 'unknown' }).range, '2026-11-06 – 11-19');
  const withFuture = {
    days: [
      { date: '2026-11-19', ...bucket(1, 100, 0, 0, 0), models: [{ name: 'Gemini 4 Argon (High)', ...bucket(1, 100, 0, 0, 0) }] },
      {
        date: '2026-11-21', ...bucket(6, 3000, 0, 0, 0),
        models: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map(name => ({ name, ...bucket(1, 500, 0, 0, 0) })),
      },
    ],
  };
  const futureWeek = usageUi.modelView(withFuture, { today: '2026-11-19', period: 'week' });
  assert.equal(futureWeek.tokens, 100);
  assert.deepEqual(futureWeek.models.map(m => [m.name, m.tokens]), [['Gemini 4 Argon', 100]], 'future-dated models must not crowd real models into Other models');
  assert.equal(usageUi.modelView(withFuture, { today: '2026-11-19', period: 'month' }).tokens, 100);
});

test('the model block renders effort-tier tooltips, stacked bars, paging controls, and standalone unread notices', () => {
  assert.match(usageUi.modelsHtml(null, { language: 'zh-CN' }), /正在读取本机对话/);
  assert.match(
    usageUi.modelsHtml({ days: [], unread: 2 }, { language: 'en' }),
    /No usage recorded yet.*2 conversation file\(s\)/,
    'standalone empty Usage by model still reports unread files',
  );
  const html = usageUi.modelsHtml({ ...history, unread: 3 }, { today: '2026-11-19', period: 'day', language: 'zh-CN' });
  assert.match(html, /class="usage-range" title="2026-11-06 – 11-19">2026-11-06 – 11-19<\/span>/);
  assert.match(html, /data-usage-shift="-1" aria-label="更早">‹/);
  assert.match(html, /data-usage-shift="1" aria-label="更晚" disabled>›/);
  assert.match(html, /class="usage-model-name">Gemini 4 Argon<\/span><span class="usage-model-share">80%<\/span><span class="usage-model-tokens">2\.0K<\/span>/);
  assert.match(html, /class="usage-model-name">Claude Opus 5\.5<\/span><span class="usage-model-share">20%<\/span><span class="usage-model-tokens">500<\/span>/);
  assert.match(html, /非缓存输入 500 · 缓存读取 800 · 缓存写入 300 · 输出 400 · 2 次请求\nHigh: 1,000 \(50%\) · 1 次请求\nMedium: 1,000 \(50%\) · 1 次请求/);
  assert.match(html, /3 个对话文件未能读取/, 'standalone populated Usage by model also renders the unread notice');
  assert.doesNotMatch(usageUi.modelsHtml({ ...history, unread: 3 }, { today: '2026-11-19', period: 'day', language: 'zh-CN', showUnread: false }), /未能读取/);
  assert.match(usageUi.modelsHtml({ days: [{ date: '2026-11-19', ...bucket(1, 10, 0, 0, 0), models: [{ name: '', ...bucket(1, 10, 0, 0, 0) }] }] }, { today: '2026-11-19', language: 'zh-CN' }), /未知模型/);
});

// Minimal stand-in DOM for driving the sidebar page script in node:vm.
function createSidebarStub() {
  const dom = { now: noon(11, 19), tick: null };
  const makeElement = (tag = 'div') => {
    const found = new Map();
    const attrs = new Map();
    let html = '';
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      textContent: '',
      hidden: false,
      style: { setProperty() {}, getPropertyValue: () => '', removeProperty() {} },
      dataset: {},
      writes: 0,
      get innerHTML() { return html; },
      set innerHTML(value) { el.writes++; html = String(value); },
      getAttribute: name => attrs.get(name) ?? null,
      setAttribute(name, value) { attrs.set(name, String(value)); },
      removeAttribute(name) { attrs.delete(name); },
      toggleAttribute(name, force) { const on = force ?? !attrs.has(name); if (on) attrs.set(name, ''); else attrs.delete(name); return on; },
      querySelector: sel => found.get(sel) ?? found.set(sel, makeElement()).get(sel),
      querySelectorAll: () => [],
      closest: () => null,
      append(...nodes) { el.children.push(...nodes); },
      replaceChildren(...nodes) { el.children = [...nodes]; },
      addEventListener() {}, removeEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 240, bottom: 24, width: 240, height: 24 }),
      focus() {},
    };
    return el;
  };
  const body = makeElement('body');
  dom.document = {
    documentElement: makeElement('html'),
    body,
    createElement: makeElement,
    getElementById: id => body.querySelector('#' + id),
    querySelector: sel => body.querySelector(sel),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  dom.globals = {
    document: dom.document,
    navigator: { language: 'en', languages: ['en'] },
    location: { pathname: '/', search: '?conversationId=conv-active' },
    scrollY: 0, scrollTo() {},
    Date: class extends Date { static now() { return dom.now; } },
    setInterval(cb) { dom.tick = cb; return 1; }, clearInterval() {},
    console, URLSearchParams, AbortSignal,
  };
  return dom;
}

const snapshot = (prefs = {}) => ({
  uiVersion: Number(UI_HTML.match(/d\.uiVersion !== (\d+)/)[1]),
  contextTokens: 128000, maxContextTokens: 256000, cachedIn: 100000,
  turn0Tokens: 20000, totalOutputTokens: 24000, totalThinkingTokens: 12000,
  lastStepEpochMs: noon(11, 19),
  prefs: { ...DEFAULT_SETTINGS, ...prefs },
  quotaGroups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: .58 }] }],
});

const openSidebar = async (data, usage, { onFetch } = {}) => {
  const dom = createSidebarStub();
  const requests = [];
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body || '{}');
    requests.push({ method: options.method, url, body });
    if (onFetch) {
      const custom = await onFetch(url, body);
      if (custom) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(custom)) };
    }
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(url === '/api/usage' ? usage : data)) };
  };
  const context = vm.createContext({ ...dom.globals, fetch });
  vm.runInContext('globalThis.window = globalThis;', context);
  let listener = null;
  const root = dom.document.getElementById('usage-root');
  root.addEventListener = (type, handler) => { if (type === 'click') listener = handler; };
  const focused = [];
  const query = dom.document.querySelector;
  dom.document.querySelector = selector => {
    const element = query(selector);
    if (selector.startsWith('[data-usage-')) element.focus = () => { focused.push(selector); };
    return element;
  };
  vm.runInContext(UI_HTML.slice(UI_HTML.lastIndexOf('<script>') + '<script>'.length, UI_HTML.lastIndexOf('</script>')), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  const activity = dom.document.getElementById('usage-activity');
  const models = dom.document.getElementById('usage-models');
  const poll = async (seconds = 1) => {
    const before = activity.writes + models.writes;
    dom.now += seconds * 1000;
    await dom.tick();
    await settle();
    return (activity.writes + models.writes) - before;
  };
  const usageCalls = () => requests.filter(req => req.method === 'POST' && req.url === '/api/usage');
  const click = dataset => listener({ target: { closest: () => ({ dataset, disabled: false }) } });
  return { context, poll, settle, usageCalls, focused, root, click, activity, models };
};

test('the sidebar leaves the history alone while it is off and reads it about once a minute while it is shown', async () => {
  const data = snapshot();
  const usage = { enabled: true, ...JSON.parse(JSON.stringify(history)) };
  const { context, poll, usageCalls, focused, root, click, activity } = await openSidebar(data, usage);
  await poll();
  await poll();
  assert.equal(usageCalls().length, 0);
  assert.equal(root.hidden, true);

  data.prefs.showUsageActivity = true;
  await poll();
  assert.equal(root.hidden, false);
  assert.match(activity.innerHTML, /Reading local conversations…/);
  await poll();
  assert.equal(usageCalls().length, 1);
  assert.equal(usageCalls()[0].body.conversationId, 'conv-active');
  assert.match(activity.innerHTML, /<div class="usage-heat" data-scale="day"/);
  assert.equal(await poll(), 0);
  assert.equal(usageCalls().length, 1, 'not every second');

  assert.equal(await poll(60), 0, 'an unchanged history is read again without repainting');
  assert.equal(usageCalls().length, 2);
  usage.days.at(-1).uncached += 1000;
  await poll(60);
  assert.match(activity.innerHTML, /2,500 tokens/);

  // The control inside the block switches the view and keeps the keyboard focus on itself.
  click({ usageScale: 'week' });
  assert.match(activity.innerHTML, /<div class="usage-heat" data-scale="week"/);
  assert.deepEqual(focused, ['[data-usage-scale="week"]']);

  vm.runInContext("selectSidebarView('settings')", context);
  await poll(60);
  assert.equal(usageCalls().length, 3, 'nothing is read behind the settings tab');
  vm.runInContext("selectSidebarView('stats')", context);
  await poll();
  assert.equal(usageCalls().length, 4);

  vm.runInContext("window.sidecar = { conversationId: '' };", context);
  await poll(60);
  assert.equal(usageCalls().at(-1).body.conversationId, '', 'explicit empty sidecar conversationId does not fall back to the URL query');
});

test('optimistic settings saves do not race /api/usage into a 10-second loading stall', async () => {
  const data = snapshot({ showUsageActivity: false });
  let backendEnabled = false;
  let releaseSave;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  const usage = { enabled: true, ...JSON.parse(JSON.stringify(history)) };
  let disabledOnce = true;
  const { context, poll, settle, usageCalls, activity } = await openSidebar(data, usage, {
    onFetch: async (url, body) => {
      if (url === '/api/settings') {
        await saveGate;
        Object.assign(data.prefs, body);
        backendEnabled = data.prefs.showUsageActivity === true || data.prefs.showModelUsage === true;
        return data.prefs;
      }
      if (url === '/api/usage') {
        if (!backendEnabled) return { enabled: false };
        if (disabledOnce) { disabledOnce = false; return { enabled: false }; }
        return usage;
      }
      return null;
    },
  });

  // Switch to Settings, trigger saveSettings({ showUsageActivity: true }), and immediately
  // switch back to Stats while /api/settings is still in flight.
  vm.runInContext("selectSidebarView('settings')", context);
  const saving = vm.runInContext('saveSettings({ showUsageActivity: true })', context);
  vm.runInContext("selectSidebarView('stats')", context);
  await poll();
  assert.equal(usageCalls().length, 0, 'refreshUsage waits while saveSettings is in flight');
  assert.match(activity.innerHTML, /Reading local conversations…/);

  // Once /api/settings finishes, usage fetch runs immediately; even if the first response was
  // { enabled: false }, it must not trigger a 10-second backoff.
  releaseSave();
  await saving;
  await settle();
  assert.equal(usageCalls().length, 1);
  await poll(1);
  assert.equal(usageCalls().length, 2, '{ enabled: false } retries on the next 1s poll instead of stalling 10s');
  assert.match(activity.innerHTML, /<div class="usage-heat" data-scale="day"/);
});

test('the model block shares the one history request and changes period and page without another', async () => {
  const data = snapshot({ showModelUsage: true });
  const { poll, usageCalls, click, activity, models } = await openSidebar(data, { enabled: true, ...history, unread: 1 });
  await poll();
  await poll();
  assert.equal(usageCalls().length, 1);
  assert.equal(activity.hidden, true, 'the activity block stays off');
  assert.match(models.innerHTML, /<span class="usage-range" title="2026-11-06 – 11-19">2026-11-06 – 11-19<\/span>/);
  assert.match(models.innerHTML, /1 conversation file\(s\) could not be read/);

  click({ usageShift: '-1' });
  assert.match(models.innerHTML, /<span class="usage-range" title="2026-10-23 – 11-05">2026-10-23 – 11-05<\/span>/);
  click({ usagePeriod: 'month' });
  assert.match(models.innerHTML, /<span class="usage-range" title="2025-12 – 2026-11">2025-12 – 2026-11<\/span>/, 'a new period starts at the current page');
  click({ usageShift: '1' });
  assert.match(models.innerHTML, /<span class="usage-range" title="2025-12 – 2026-11">2025-12 – 2026-11<\/span>/, 'there is no page after today');
  assert.equal(usageCalls().length, 1);

  // Turning Token activity on shows the unread notice once (in activity) rather than duplicating it;
  // turning Token activity back off restores the unread notice inside Usage by model.
  data.prefs.showUsageActivity = true;
  await poll();
  assert.match(activity.innerHTML, /1 conversation file\(s\) could not be read/);
  assert.doesNotMatch(models.innerHTML, /1 conversation file\(s\) could not be read/);
  data.prefs.showUsageActivity = false;
  await poll();
  assert.match(models.innerHTML, /1 conversation file\(s\) could not be read/);
});

test('both history blocks sit in the dedicated bottom Settings section with one ? scope tooltip', () => {
  const settingsHtml = UI_HTML.slice(UI_HTML.indexOf('<section class="settings'));
  const queue = settingsHtml.indexOf('data-setting-card="showQueueWarnings"');
  const scope = settingsHtml.indexOf('data-settings-scope="usage"');
  const help = settingsHtml.indexOf('id="help-usage-scope"');
  const activity = settingsHtml.indexOf('data-setting-card="showUsageActivity" data-checked="false"');
  const models = settingsHtml.indexOf('data-setting-card="showModelUsage" data-checked="false"');
  assert.ok(queue > 0 && queue < scope && scope < help && help < activity && activity < models);
  assert.match(settingsHtml, /data-settings-scope="usage"[\s\S]*?<div class="setting-head" tabindex="0" aria-describedby="help-usage-scope">/);
  assert.match(UI_HTML, /\.usage-total > b \{ overflow: hidden; text-overflow: ellipsis;/);
  assert.match(UI_HTML, /<section class="stats-usage" id="usage-root" hidden>\s*<div class="usage-block" id="usage-activity" hidden><\/div>\s*<div class="usage-block" id="usage-models" hidden><\/div>/);
  assert.match(UI_HTML, /\.stats-usage\[hidden\], \.usage-block\[hidden\] \{ display: none; \}/);
});
