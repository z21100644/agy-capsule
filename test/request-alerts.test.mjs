import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRequestError } from '../agy-capsule/sidecars/agy_capsule/errors.mjs';
import { summarizeTurnQueue } from '../agy-capsule/sidecars/agy_capsule/metrics.mjs';
import { createPresentation } from '../agy-capsule/sidecars/agy_capsule/ui.mjs';
import { parseGenRow, readConversationSnapshot } from '../agy-capsule/sidecars/agy_capsule/server.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('request failure classification follows reported errors rather than quota percentages', () => {
  for (const [message, kind] of [
    ['quota exceeded', 'quota_exhausted'], ['429 Too Many Requests retry in 30s', 'rate_limited'],
    ['ECONNRESET', 'network_error'], ['401 Unauthorized', 'auth_error'], ['503 Service Unavailable', 'service_unavailable'],
    ['unexpected provider failure', 'unknown'], ['context canceled by user', 'canceled'],
    ['request failed: Post "https://<API>/v1internal:streamGenerateContent?alt=sse": context canceled', 'canceled'], ['User cancelled agent execution.', 'canceled'],
    ['input token count exceeds the maximum context length', 'context_overflow'], ['context deadline exceeded', 'request_timeout'],
    ['DEADLINE_EXCEEDED', 'request_timeout'], ['read ETIMEDOUT', 'request_timeout'], ['connection reset by peer', 'network_error'],
    ['The input token count (737355) exceeds the maximum number of tokens allowed (524288)', 'context_overflow'],
    ['prompt is too long: 200001 tokens > 200000 maximum', 'context_overflow'],
    ['401 permission denied; quota access rejected', 'auth_error'], ['', 'none'],
  ]) assert.equal(classifyRequestError(message).kind, kind, message);
  assert.equal(classifyRequestError('429 retry in 30s').retryAfterSec, 30);
  assert.equal(classifyRequestError('429 Too Many Requests').retryAfterSec, null);
  assert.equal(classifyRequestError('failed at https://example.invalid/private?key=secret').diagnostic, 'failed at <API>');
});

test('colors and request failure capsule are independent, with no cancellation/overflow failure capsule', () => {
  const ui = createPresentation();
  const data = { contextTokens: 75, maxContextTokens: 100, requestError: classifyRequestError('429 Too Many Requests') };
  assert.equal(ui.alertView(data).contextTone, 'warning');
  assert.equal(ui.alertView(data).visible, true);
  assert.equal(ui.alertView(data, { showContextWarnings: false }).visible, true);
  assert.equal(ui.alertView(data, { showContextWarnings: false }).contextTone, '');
  assert.equal(ui.alertView(data, { showRequestErrors: false }).contextTone, 'warning');
  assert.equal(ui.alertView(data, { showRequestErrors: false }).visible, false);
  for (const percent of [90, 100, 125]) assert.equal(ui.alertView({ ...data, contextTokens: percent }).contextTone, 'error');
  for (const error of ['context canceled by user', 'maximum context length exceeded', '']) {
    assert.equal(ui.alertView({ ...data, requestError: classifyRequestError(error) }).visible, false);
  }
  const unknown = ui.alertView({ ...data, requestError: classifyRequestError('unknown failure') }, {}, ui.dictionaries['zh-CN']);
  assert.equal(unknown.label, '未知原因');
  const disconnected = ui.alertView({ requestError: classifyRequestError('ECONNRESET') }, {}, ui.dictionaries['zh-CN']);
  assert.equal(disconnected.label, '断连');
});

function vi(value) {
  let n = BigInt(value); const bytes = [];
  while (n >= 128n) { bytes.push(Number(n & 127n) | 128); n >>= 7n; }
  return Buffer.from([...bytes, Number(n)]);
}
const field = (n, data) => Buffer.concat([vi(n * 8 + 2), vi(data.length), data]);
const retry = text => field(17, field(3, Buffer.from(text)));
const integer = (n, v) => Buffer.concat([vi(n * 8), vi(v)]);
const ts = (n, sec) => field(n, integer(1, sec));
const trans = (status, sec) => field(1, Buffer.concat([integer(1, status), ts(2, sec)]));

function waitFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agy-queue-db-'));
  const path = join(dir, 'chat.db');
  const db = new DatabaseSync(path);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB); CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB); CREATE TABLE executor_metadata (idx INTEGER PRIMARY KEY, data BLOB);');
  const ui = createPresentation();
  const prefs = { showRequestErrors: true, showQueueWarnings: true, queueWarnSec: 30 };
  return {
    step(idx, type, status, created, transitions = []) {
      const metadata = Buffer.concat([ts(1, created), field(26, Buffer.concat(transitions.map(([st, sec]) => trans(st, sec))))]);
      db.prepare('INSERT OR REPLACE INTO steps VALUES (?,?,?,?)').run(idx, type, status, metadata);
    },
    request(idx, { input, planner, ttft, error } = {}) {
      const fields = [];
      if (input != null) fields.push(field(20, Buffer.concat([field(1, Buffer.from('last_step_index')), field(2, Buffer.from(String(input)))])));
      if (ttft != null) fields.push(ts(11, ttft));
      if (error != null) fields.push(retry(error));
      const links = planner == null ? [] : [planner].flat().map(idx => integer(2, idx));
      const data = Buffer.concat([field(1, Buffer.concat(fields)), ...links]);
      db.prepare('INSERT INTO gen_metadata VALUES (?,?)').run(idx, data);
    },
    snapshot: includeMetrics => readConversationSnapshot(path, includeMetrics),
    alert: (nowSec, running = false) => ui.alertView(readConversationSnapshot(path), prefs, ui.dictionaries['zh-CN'], nowSec * 1000, running),
  };
}

test('SQLite decodes the final RetryInfo.error and clears an earlier failed retry after success', () => {
  const error = parseGenRow(3, field(1, retry('429 Too Many Requests')));
  assert.equal(error.requestError.kind, 'rate_limited');
  const recovered = parseGenRow(3, field(1, Buffer.concat([retry('ECONNRESET'), retry('')])));
  assert.equal(recovered.requestError.kind, 'none');
  const cancelled = parseGenRow(4, field(1, retry('context canceled by user')));
  assert.equal(cancelled.requestError.kind, 'canceled');
});

test('summarizeTurnQueue tracks per-turn waits, ignores active tools and prevents double counting', () => {
  const user = { idx: 10, step_type: 14, status: 3, createdAtMs: 100000 };
  const priorReq = { lastStepIndex: 4, stepIndices: [5], generation: { ttft: 90 } };
  const slowReq = { lastStepIndex: 10, stepIndices: [11], generation: { ttft: 35 } };
  const plannerDone = { idx: 11, step_type: 15, status: 3, createdAtMs: 100000, generatingAtMs: 135000, recordedCompletedAtMs: 140000 };
  const toolRunning = { idx: 12, step_type: 132, status: 2, createdAtMs: 140100 };

  const duringTool = summarizeTurnQueue([priorReq, slowReq], [user, plannerDone, toolRunning], 10);
  assert.deepEqual(duringTool.waits, [35], 'ignores prior turns and deduplicates covered planner step');
  assert.equal(duringTool.waitingSinceMs, null, 'active tool must not trigger live wait timer');

  const toolDone = { ...toolRunning, status: 3, recordedCompletedAtMs: 145000 };
  const afterTool = summarizeTurnQueue([priorReq, slowReq], [user, plannerDone, toolDone], 10);
  assert.equal(afterTool.waitingSinceMs, 145000, 'live wait anchors to completed tool timestamp');

  const streamingNext = { idx: 13, step_type: 15, status: 8, createdAtMs: 145050, generatingAtMs: 180050 };
  const duringStream = summarizeTurnQueue([priorReq, slowReq], [user, plannerDone, toolDone, streamingNext], 10);
  assert.deepEqual(duringStream.waits, [35, 35], 'streaming step exposes wait before gen_metadata commits');
  assert.equal(duringStream.waitingSinceMs, null, 'streaming response is no longer waiting for the first token');

  const terminal = summarizeTurnQueue([priorReq, slowReq], [user, plannerDone], 10, [{ lastStepIndex: 11, reason: 4, executionId: '' }]);
  assert.equal(terminal.turnTerminal, true);
  assert.equal(terminal.waitingSinceMs, null);
  assert.deepEqual(terminal.waits, [35]);
});

test('third capsule shows first-token wait alerts with xN multiplier, respects toggle and yields to request errors', () => {
  const ui = createPresentation();
  const t0 = 200000;
  const liveQueue = { userStepIndex: 10, waits: [], waitingSinceMs: t0, hasPendingPlanner: false, turnTerminal: false };

  // Below threshold or not running -> hidden
  assert.equal(ui.alertView({ turnQueue: liveQueue }, { showQueueWarnings: true, queueWarnSec: 30 }, ui.dictionaries.en, t0 + 29000, true).visible, false);
  assert.equal(ui.alertView({ turnQueue: liveQueue }, { showQueueWarnings: true, queueWarnSec: 30 }, ui.dictionaries.en, t0 + 45000, false).visible, false);

  // Live wait >= 30s while running -> pops up with live seconds
  const live1 = ui.alertView({ turnQueue: liveQueue }, { showQueueWarnings: true, queueWarnSec: 30 }, ui.dictionaries['zh-CN'], t0 + 35000, true);
  assert.equal(live1.mode, 'queue');
  assert.equal(live1.visible, true);
  assert.equal(live1.label, '等待 35s');
  assert.equal(live1.heading, '首字等待');
  assert.equal(live1.queueCount, 1);

  // Second slow wait in the same turn -> x2 multiplier
  const multi = { ...liveQueue, waits: [32.4], waitingSinceMs: t0 };
  const live2 = ui.alertView({ turnQueue: multi }, { showQueueWarnings: true, queueWarnSec: 30 }, ui.dictionaries['zh-CN'], t0 + 40000, true);
  assert.equal(live2.label, '等待×2 40s');
  assert.equal(live2.heading, '首字等待 ×2');
  assert.equal(live2.queueCount, 2);
  assert.match(live2.diagnostic, /32s, 40s\+/);

  // Turn finished with 2 slow waits -> keeps x2 without live seconds
  const finished = ui.alertView({ turnQueue: { userStepIndex: 10, waits: [31, 45], waitingSinceMs: null, hasPendingPlanner: false, turnTerminal: true } }, { showQueueWarnings: true, queueWarnSec: 30 }, ui.dictionaries.en, t0 + 999000, false);
  assert.equal(finished.mode, 'queue');
  assert.equal(finished.label, 'Wait×2');
  assert.equal(finished.heading, 'First-token wait ×2');

  // Toggle off hides queue warning
  assert.equal(ui.alertView({ turnQueue: multi }, { showQueueWarnings: false, queueWarnSec: 30 }, ui.dictionaries.en, t0 + 40000, true).visible, false);

  // Request failure takes priority over queue warning on third capsule
  const errAndQueue = ui.alertView({ turnQueue: multi, requestError: classifyRequestError('429 Too Many Requests') }, { showRequestErrors: true, showQueueWarnings: true, queueWarnSec: 30 }, ui.dictionaries.en, t0 + 40000, true);
  assert.equal(errAndQueue.mode, 'error');
  assert.equal(errAndQueue.label, 'Rate limited');

  // When request errors are hidden, queue warning still renders if enabled
  const queueOnly = ui.alertView({ turnQueue: multi, requestError: classifyRequestError('429 Too Many Requests') }, { showRequestErrors: false, showQueueWarnings: true, queueWarnSec: 30 }, ui.dictionaries.en, t0 + 40000, true);
  assert.equal(queueOnly.mode, 'queue');
  assert.equal(queueOnly.visible, true);
});

test('SQLite snapshot exposes turnQueue regardless of showTurnMetrics', t => {
  const f = waitFixture(t);
  f.step(10, 14, 3, 100);
  f.step(11, 15, 8, 101, [[8, 136]]);
  const snapOff = f.snapshot(false);
  const snapOn = f.snapshot(true);
  assert.deepEqual(snapOff.turnQueue.waits, [35]);
  assert.deepEqual(snapOn.turnQueue, snapOff.turnQueue);
});

test('a request TTFT or generating timestamp on a pending planner stops its live estimate', () => {
  const steps = [
    { idx: 10, step_type: 14, status: 3, createdAtMs: 100000 },
    { idx: 11, step_type: 15, status: 2, createdAtMs: 100000 },
  ];
  const request = { lastStepIndex: 10, stepIndices: [11], generation: { ttft: 40 } };
  const queue = summarizeTurnQueue([request], steps, 10);
  assert.deepEqual(queue.waits, [40]);
  assert.equal(queue.waitingSinceMs, null);
  assert.equal(queue.hasPendingPlanner, false);

  const generatingSteps = [
    { idx: 10, step_type: 14, status: 3, createdAtMs: 100000 },
    { idx: 11, step_type: 15, status: 2, createdAtMs: 100000, generatingAtMs: 140000 },
  ];
  const generatingQueue = summarizeTurnQueue([], generatingSteps, 10);
  assert.deepEqual(generatingQueue.waits, [40]);
  assert.equal(generatingQueue.waitingSinceMs, null);
  assert.equal(generatingQueue.hasPendingPlanner, false);
});

test('a planner explicitly linked only to an earlier turn supplies no current wait', () => {
  const steps = [
    { idx: 20, step_type: 14, status: 3, createdAtMs: 130000 },
    { idx: 21, step_type: 15, status: 3, createdAtMs: 131000, generatingAtMs: 171000 },
  ];
  const oldRequest = { lastStepIndex: 10, stepIndices: [21], generation: { ttft: 40 } };
  assert.deepEqual(summarizeTurnQueue([oldRequest], steps, 20).waits, []);
  // A current request with no TTFT can still use its associated step estimate.
  const current = { lastStepIndex: 20, stepIndices: [21], generation: {} };
  assert.deepEqual(summarizeTurnQueue([oldRequest, current], steps, 20).waits, [40]);
});

test('missing explicit completion timestamps cannot start a post-step waiting clock', () => {
  const user = { idx: 10, step_type: 14, status: 3, createdAtMs: 100000 };
  assert.equal(summarizeTurnQueue([], [user, { idx: 11, step_type: 132, status: 3, createdAtMs: 110000 }], 10).waitingSinceMs, null);
  assert.equal(summarizeTurnQueue([], [user, { idx: 11, step_type: 132, status: 3, createdAtMs: 110000, completedAtMs: 120000 }], 10).waitingSinceMs, null);
  assert.equal(summarizeTurnQueue([], [user, { idx: 11, step_type: 15, status: 3, createdAtMs: 110000, completedAtMs: 120000 }], 10).waitingSinceMs, null);
});

test('an older active planner blocks the fallback clock but not a new confirmed pending planner', t => {
  const f = waitFixture(t);
  f.step(10, 14, 3, 100);
  f.step(20, 14, 3, 150, [[3, 150]]);
  f.step(21, 15, 8, 151, [[8, 154]]);
  f.request(1, { input: 10, planner: 21, ttft: 3 });
  assert.equal(f.alert(185, true).visible, false, 'Working can still belong to the older streaming request');
  assert.deepEqual(f.snapshot().turnQueue.waits, []);

  f.step(22, 15, 2, 185);
  assert.equal(f.alert(215, true).label, '等待 30s', 'a current pending planner has its own anchor');
});

test('only an eligible request error can mask the current turn wait', t => {
  const f = waitFixture(t);
  f.step(10, 14, 3, 100);
  f.request(1, { input: 10, error: '429 Too Many Requests' });
  f.step(20, 14, 11, 150);
  assert.equal(f.alert(190).label, '429 限流', 'queued input does not reset the current error');

  f.step(20, 14, 3, 150);
  f.step(21, 15, 2, 151);
  assert.equal(f.alert(191).label, '等待 40s');

  f.request(2, { input: 20, error: '429 Too Many Requests' });
  f.request(3, { input: 10, error: '503 Service Unavailable' });
  assert.equal(f.alert(191).label, '429 限流', 'late older errors do not replace the current error');
  f.request(4, { input: 20 });
  assert.equal(f.alert(191).label, '等待 40s', 'a newer current request clears the error');
  f.request(5, { error: '429 Too Many Requests' });
  assert.equal(f.alert(191).label, '429 限流', 'an error of unknown age is not assumed stale');
});

test('a new response clears a linked timeout before its request metadata is saved', t => {
  const f = waitFixture(t);
  const timeout = 'stream reading error: stream idle timeout (10m0s): context deadline exceeded';
  f.step(10, 14, 3, 100);
  f.step(11, 15, 3, 101, [[8, 105], [3, 705]]);
  f.step(12, 17, 3, 705, [[3, 705]]);
  f.request(1, { input: 10, planner: [11, 12], ttft: 4, error: timeout });
  const timedOut = f.alert(706, true);
  assert.equal(timedOut.label, '请求超时', 'the composer can still be Working when the request times out');
  assert.match(timedOut.detail, /本轮仍可能继续/);
  assert.match(timedOut.diagnostic, /stream idle timeout/);

  f.step(13, 15, 8, 704, [[8, 706]]);
  assert.equal(f.alert(706, true).mode, 'error', 'a response started before the failure does not establish recovery');
  f.step(13, 15, 2, 709);
  assert.equal(f.alert(710, true).mode, 'error', 'a pending step alone does not establish recovery');
  f.step(13, 15, 8, 709, [[8, 714]]);
  assert.equal(f.alert(714, true).visible, false, 'the newer response already has output');
  f.step(13, 15, 3, 709, [[8, 714], [3, 715]]);
  assert.equal(f.alert(716, true).visible, false, 'the old error does not return when that response finishes');

  f.step(14, 17, 3, 716, [[3, 716]]);
  f.request(2, { input: 12, planner: [13, 14], ttft: 5, error: '503 Service Unavailable' });
  assert.equal(f.snapshot().requestError.kind, 'service_unavailable', 'a fresh failure is still reported');
});

test('queued input creation time never starts the live first-token timer', t => {
  const f = waitFixture(t);
  f.step(10, 14, 3, 100);
  f.step(20, 14, 11, 143);
  assert.equal(f.snapshot().turnQueue.userStepIndex, 10);

  f.step(20, 14, 3, 143);
  assert.equal(f.snapshot().turnQueue.userStepIndex, 20);
  assert.equal(f.alert(190, true).visible, false, 'the consumption timestamp is unknown');
  f.step(20, 14, 3, 143, [[11, 143], [2, 190], [3, 191]]);
  assert.equal(f.alert(191, true).visible, false, 'do not display the 47 seconds spent queued');
  assert.equal(f.alert(220, true).label, '等待 30s', 'use the first transition out of queued');

  f.step(20, 14, 3, 143);
  f.step(21, 15, 2, 190);
  assert.equal(f.alert(220, true).label, '等待 30s', 'otherwise wait for a planner timestamp');
});

test('a TTFT linked to the current pending planner stops the clock even without a request input index', t => {
  const f = waitFixture(t);
  f.step(10, 14, 3, 90);
  f.step(20, 14, 3, 100);
  f.step(21, 15, 2, 100);
  f.step(22, 15, 2, 100);
  f.request(1, { planner: 22, ttft: 2 });
  f.request(2, { input: 10, planner: 21, ttft: 50 });
  f.request(3, { planner: 21, ttft: 50 });
  f.request(4, { ttft: 60 });
  assert.equal(f.alert(140).visible, false);
  assert.deepEqual(f.snapshot().turnQueue.waits, [2], 'only the TTFT linked to a current planner is usable');
  assert.equal(f.snapshot().turnQueue.hasPendingPlanner, false);
});
