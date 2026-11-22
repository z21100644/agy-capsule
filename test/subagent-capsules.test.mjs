import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const varint = value => {
  const bytes = [];
  while (value >= 128) {
    bytes.push((value % 128) + 128);
    value = Math.floor(value / 128);
  }
  return Buffer.from([...bytes, value]);
};
const field = (id, value) => {
  if (typeof value === 'number') return Buffer.concat([varint(id * 8), varint(value)]);
  const bytes = Buffer.from(value);
  return Buffer.concat([varint(id * 8 + 2), varint(bytes.length), bytes]);
};
const message = (...fields) => Buffer.concat(fields);
const call = ({ step, tokens = 0, limit, ttft, streaming, model, error, input, write, thinking = 0 }) => {
  const meta = message(
    field(4, message(field(2, tokens), ...(write === undefined ? [] : [field(3, write + thinking), field(9, thinking), field(10, write)]))),
    ...(limit ? [field(9, field(10, field(4, limit)))] : []),
    ...(ttft ? [field(11, field(1, ttft))] : []),
    ...(streaming ? [field(12, field(1, streaming))] : []),
    ...(model ? [field(21, model)] : []),
    ...(error ? [field(17, field(3, error))] : []),
    ...(input === undefined ? [] : [field(20, message(field(1, 'last_step_index'), field(2, String(input))))]),
  );
  const steps = step === undefined ? [] : [step].flat();
  return message(field(1, meta), ...steps.map(idx => field(2, idx)));
};

test('child reads never move the main sidebar and alerts stay in the child execution', async t => {
  const profile = mkdtempSync(join(tmpdir(), 'agy-child-'));
  const envKey = 'ANTIGRAVITY_EXECUTABLE_DATA_DIR';
  const original = process.env[envKey];
  process.env[envKey] = profile;
  let child;
  t.after(() => {
    child?.close();
    if (original === undefined) delete process.env[envKey]; else process.env[envKey] = original;
    rmSync(profile, { recursive: true, force: true });
  });
  const settingsDir = join(profile, '.gemini', 'config', 'agy-capsule');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({ showTurnMetrics: true }));
  const mockedHome = t.mock.method(os, 'homedir', () => profile);
  syncBuiltinESMExports();
  const { inspectConversation, readConversationSnapshot, rememberCloudTelemetry, startPanel, UI_HTML } = await import('../agy-capsule/sidecars/agy_capsule/server.mjs?child-fixture')
    .finally(() => { mockedHome.mock.restore(); syncBuiltinESMExports(); });
  const dir = join(profile, 'conversations');
  mkdirSync(dir);
  const open = id => {
    const db = new DatabaseSync(join(dir, id + '.db'));
    db.exec('CREATE TABLE steps(idx, step_type, status, metadata); CREATE TABLE gen_metadata(idx, data); CREATE TABLE trajectory_metadata_blob(id, data); CREATE TABLE executor_metadata(idx, data)');
    return db;
  };
  const main = open('main');
  main.prepare('INSERT INTO steps VALUES (0, 14, 3, ?)').run(field(1, field(1, 900)));
  main.prepare('INSERT INTO steps VALUES (1, 15, 3, ?)').run(field(8, field(1, 950)));
  main.prepare('INSERT INTO gen_metadata VALUES (0, ?)').run(call({ step: 1, input: 0, tokens: 77, write: 42, thinking: 3, ttft: 1, streaming: 2 }));
  main.close();
  const emptyChild = open('empty-child');
  emptyChild.prepare("INSERT INTO trajectory_metadata_blob VALUES ('main', ?)").run(message(field(5, 'main'), field(8, field(1, 'worker'))));
  emptyChild.close();
  child = open('child');
  child.prepare("INSERT INTO trajectory_metadata_blob VALUES ('main', ?)").run(message(
    field(5, 'main'), field(8, field(1, 'worker')),
  ));
  const addStep = (idx, type, status, execution, epoch = 1000, done) => child.prepare('INSERT INTO steps VALUES (?, ?, ?, ?)')
    .run(idx, type, status, message(field(12, execution), ...(epoch ? [field(1, field(1, epoch))] : []), ...(done ? [field(8, field(1, done))] : [])));
  const addCall = (idx, args) => child.prepare('INSERT INTO gen_metadata VALUES (?, ?)').run(idx, call(args));
  addStep(0, 15, 3, 'first', 1000, 1050);
  addCall(0, { step: 0, tokens: 150, limit: 300, model: 'Worker (High)', ttft: 45, streaming: 5, write: 9, thinking: 4 });
  child.prepare('INSERT INTO executor_metadata VALUES (0, ?)').run(message(field(1, 4), field(9, 'first')));
  const parent = await inspectConversation('main', true);
  assert.equal(parent.contextTokens, 77);
  assert.equal(parent.turnMetrics.write, 42);
  assert.equal(parent.turnSpeed.generation.tps, 15);
  const data = await inspectConversation('child', true, true);
  assert.deepEqual(data.subagent, { model: 'Worker (High)' });
  assert.equal(data.contextTokens, 150);
  assert.equal(data.maxContextTokens, 300);
  assert.deepEqual(data.turnQueue.waits, [45], 'a linked planner at step zero is in scope');
  assert.deepEqual([data.turnMetrics.executionId, data.turnMetrics.state, data.turnMetrics.duration,
    data.turnMetrics.requestCount, data.turnMetrics.write, data.turnMetrics.thinking], ['first', 'completed', 50, 1, 9, 4]);
  assert.deepEqual([data.turnSpeed.executionId, data.turnSpeed.generation.tps,
    data.turnSpeed.completedAtMs, data.turnSpeed.hasActiveStep], ['first', 13 / 50, 1_050_000, false]);
  assert.equal(data.turnQueue.waitingSinceMs, null, 'do not guess a live wait after a completed step');
  assert.deepEqual(data.quotaGroups, []);
  assert.equal(await inspectConversation('main', true, true), null, 'a normal DB cannot supply child capsules');
  assert.equal(await inspectConversation('missing', true, true), null);
  const noExecution = await inspectConversation('empty-child', true, true);
  assert.equal(noExecution.turnMetrics, null, 'a child with no execution never uses the parent turn');
  assert.equal(noExecution.turnSpeed, null, 'a child with no execution never uses the parent speed');
  assert.equal((await inspectConversation()).contextTokens, 77);

  let postContext;
  class SidecarApp {
    config = { conversationId: 'main' };
    page() {}
    run() {}
    api(path, handler, method) {
      if (path === '/api/context' && method === 'POST') postContext = handler;
    }
  }
  await startPanel(() => ({ SidecarApp }), { ANTIGRAVITY_SIDECAR_UI_TOKEN: 'fixture' });
  assert.equal((await postContext({ conversationId: 'main' })).contextTokens, 77, 'a parallel tab keeps the sidecar on the parent');
  const full = await postContext({ conversationId: 'child' });
  assert.equal(full.contextTokens, 150, 'Full View supplies the child ID even without a composer');
  assert.deepEqual(full.turnMetrics, data.turnMetrics, 'the sidebar and the child capsule share the same turn');
  assert.deepEqual(full.turnSpeed, data.turnSpeed);
  assert.equal(full.uiVersion, Number(UI_HTML.match(/d\.uiVersion !== (\d+)/)?.[1]), 'the response and panel agree on when to reload');
  assert.equal((await postContext({ conversationId: 'empty-child' })).turnMetrics, null);
  assert.equal((await postContext({ conversationId: 'missing' })).contextTokens, 0, 'no parent fallback for a missing child DB');
  assert.equal((await postContext({ conversationId: '' })).contextTokens, 0, 'an explicitly empty view must not display an old chat');
  assert.equal((await inspectConversation()).contextTokens, 77, 'sidebar reads do not move the CDP composer pointer');

  const sample = conversationId => ({ conversationId, steps: [{ idx: 0, stepType: 15,
    status: 3, hasUsage: true, inputTokens: 500, maxContextTokens: 1000 }] });
  rememberCloudTelemetry('cloud', sample('cloud'));
  rememberCloudTelemetry('main', sample('main'));
  rememberCloudTelemetry('child', sample('child'));
  const cloud = await postContext({ conversationId: 'cloud' });
  assert.equal(cloud.contextTokens, 500);
  assert.equal(cloud.requestTimingAvailable, false);
  assert.equal((await inspectConversation()).contextTokens, 77, 'cloud sidebar reads do not select the composer');
  const cloudDeck = await inspectConversation('cloud', true);
  assert.equal(cloudDeck.contextTokens, 500);
  assert.equal(cloudDeck.requestTimingAvailable, false);
  assert.equal(await inspectConversation('cloud', true, true), null, 'child-only paths never read cloud telemetry');
  const local = await postContext({ conversationId: 'main' });
  assert.equal(local.contextTokens, 77, 'the local parent DB wins');
  assert.equal(local.requestTimingAvailable, undefined);
  const localChild = await postContext({ conversationId: 'child' });
  assert.equal(localChild.contextTokens, 150, 'the local child DB wins');
  assert.equal(localChild.requestTimingAvailable, undefined);
  assert.equal((await postContext({ conversationId: 'missing' })).contextTokens, 0);
  rememberCloudTelemetry('cloud', { ...sample('cloud'), requestTiming: { stepIndex: 0, ttft: 1, streaming: 2, output: 90 } });
  const timed = await postContext({ conversationId: 'cloud' });
  assert.equal(timed.requestTimingAvailable, true);
  assert.equal(timed.generation.tps, 30);
  assert.equal((await inspectConversation('cloud', true)).turnSpeed.generation.tps, 30);
  assert.equal(await inspectConversation('cloud', true, true), null);
  rememberCloudTelemetry('cloud', null);
  assert.equal((await postContext({ conversationId: 'cloud' })).contextTokens, 0);

  const read = (enabled = true) => readConversationSnapshot(join(dir, 'child.db'), enabled);
  addStep(1, 15, 1, 'second', 2000);
  assert.deepEqual(read().turnQueue.waits, []);
  assert.equal(read().turnQueue.waitingSinceMs, 2_000_000);
  assert.deepEqual([read().turnMetrics.state, read().turnMetrics.requestCount, read().turnMetrics.startedAtMs], ['running', 0, 2_000_000]);
  assert.deepEqual(read().turnSpeed, { executionId: 'second', generation: null, completedAtMs: 0, hasActiveStep: true });
  assert.equal(read(false).turnMetrics, null);
  addCall(1, { input: 0, step: 1, model: 'Worker (Low)', error: '429 Too Many Requests', ttft: 40 });
  assert.equal(read().requestError.kind, 'rate_limited');
  assert.deepEqual(read().turnQueue.waits, [40], 'new execution owns its output even if input came from the old one');
  assert.equal(read().turnMetrics.requestCount, 1, 'the output step establishes ownership without counting the first execution');
  assert.equal(read().turnMetrics.write, null, 'an error without usage is not zero usage');
  assert.equal(read().turnQueue.waitingSinceMs, null, 'TTFT already records this planner wait');
  addStep(2, 15, 1, 'second', 2100);
  addCall(2, { input: 2, error: '429 Too Many Requests' });
  assert.equal(read().requestError.kind, 'rate_limited', 'a failure before producing output can use its execution input');
  child.prepare('INSERT INTO executor_metadata VALUES (1, ?)').run(message(field(1, 2), field(3, 2), field(9, 'second')));
  assert.equal(read().turnQueue.waitingSinceMs, null, 'a confirmed executor stop beats a stale pending planner');
  assert.equal(read().turnMetrics.state, 'interrupted');
  assert.equal(read().turnMetrics.duration, null, 'no inferred cancellation time');
  assert.equal(read().turnSpeed.hasActiveStep, false, 'executor stop clears speed animation even with a stale pending planner');
  addStep(3, 132, 6, 'second', 2200, 2250);
  assert.equal(read().turnMetrics.duration, 250, 'a recorded cancelled step supplies its terminal time');
  addStep(4, 101, 3, 'third', null);
  addCall(3, { input: 4, step: 5, tokens: 110, ttft: 5 });
  const latest = read();
  assert.equal(latest.requestError.kind, 'none', 'a later execution does not inherit a failed request');
  assert.equal(latest.subagent.model, '');
  assert.equal(latest.maxContextTokens, 0, 'do not pair new prompt usage with an old model limit');
  assert.equal(latest.turnMetrics.executionId, 'third');
  assert.equal(latest.turnMetrics.startedAtMs, null);
  assert.equal(latest.turnMetrics.requestCount, null, 'unpersisted output does not inherit or invent request attribution');

  addStep(6, 15, 3, 'fourth', 3000, 3003);
  addStep(7, 15, 3, 'fourth', 3003, 3006);
  addStep(8, 15, 8, 'fourth', 3006);
  addCall(4, { input: 4, step: 6, ttft: 1, streaming: 2, write: 60 });
  assert.equal(read(false).turnSpeed.generation.tps, 20, 'an output link can establish ownership even when the input came from the preceding execution');
  addCall(5, { step: 7, ttft: 1, streaming: 2, write: 90 });
  addCall(6, { step: 8, ttft: 1, streaming: 2, write: 999 });
  addCall(7, { step: [7, 0], ttft: 1, streaming: 2, write: 999 });
  addCall(8, { step: [7, 99], ttft: 1, streaming: 2, write: 999 });
  addCall(9, { step: 0, ttft: 1, streaming: 2, write: 999 });
  const running = read(false).turnSpeed;
  assert.deepEqual([running.executionId, running.generation.requestIndex, running.generation.tps,
    running.completedAtMs, running.hasActiveStep], ['fourth', 5, 30, 3_006_000, true],
  'only the latest measured, completed and unambiguously linked request counts, even when Turn Metrics is off');
  child.prepare('INSERT INTO executor_metadata VALUES (2, ?)').run(message(field(1, 4), field(3, 8), field(9, 'fourth')));
  assert.deepEqual(read().turnSpeed, { ...running, hasActiveStep: false });
});
