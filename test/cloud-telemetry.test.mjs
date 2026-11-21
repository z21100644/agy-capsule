import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  readCloudTrajectory,
  readCloudConversationSnapshot,
  createCloudTelemetryStore,
} from '../agy-capsule/sidecars/agy_capsule/cloud_telemetry.mjs';

const cloudId = 'timed-cloud';
const modelStep = { type: 15, status: 3, metadata: {
  executionId: 'request', modelUsage: { inputTokens: 1000, outputTokens: 90, responseOutputTokens: 90 },
  modelInfo: { maxTokens: 10000 }, createdAt: { seconds: 10 }, viewableAt: { seconds: 11 },
  finishedGeneratingAt: { seconds: 17 }, completedAt: { seconds: 17 },
} };
const userStep = { type: 14, status: 3, metadata: { createdAt: { seconds: 9 } } };
const toolStep = { type: 21, status: 3, metadata: { createdAt: { seconds: 17 } } };
const chatModel = (idx, overrides = {}) => ({ stepIndices: [idx], executionId: 'request', metadata: {
  case: 'chatModel', value: { timeToFirstToken: { seconds: 1n, nanos: 250_000_000 },
    streamingDuration: { seconds: '2', nanos: 250_000_000 }, ...overrides },
} });
const readFixture = (overrides = {}) => {
  const trajectorySlice = { conversationId: cloudId, metadata: {}, totalStepsLength: 3,
    stepsInSlice: [userStep, modelStep, toolStep], totalGeneratorMetadataLength: 12,
    generatorMetadataSlice: { startIndex: -1 }, generatorMetadatasInSlice: [chatModel(1)], ...overrides };
  const root = { __reactContainer$fixture: { memoizedProps: { trajectorySlice } } };
  return vm.runInNewContext(`(${readCloudTrajectory.toString()})`, { document: { getElementById: () => root } })(cloudId);
};

test('cloud timing uses the last linked generator request, with the SQLite TPS formula', () => {
  const raw = readFixture({ generatorMetadatasInSlice: [chatModel(1, { usage: {
    outputTokens: 140n, responseOutputTokens: 90n, thinkingOutputTokens: 50n,
  } })] });
  const snapshot = readCloudConversationSnapshot(raw);
  assert.equal(snapshot.requestTimingAvailable, true);
  assert.deepEqual(snapshot.generation, { requestIndex: 1, ttft: 1.25, streaming: 2.25,
    duration: 3.5, output: 140, reply: 90, thinking: 50, tps: 40 });
  assert.deepEqual(snapshot.turnSpeed.generation, snapshot.generation);
  assert.equal(snapshot.contextTokens, 1000);
  assert.equal(snapshot.turnMetrics.requestCount, 1);
  assert.equal(snapshot.turnMetrics.duration, null);
  assert.deepEqual(snapshot.turnQueue.waits, [1], 'request timing does not replace step-based turn accounting');

  const unavailable = [
    { generatorMetadatasInSlice: [{ stepIndices: [1], metadata: { case: undefined } }] },
    { generatorMetadatasInSlice: [chatModel(0)] },
    { generatorMetadataSlice: { startIndex: 0 } },
    { generatorMetadatasInSlice: [{ ...chatModel(1), executionId: 'other' }] },
    { generatorMetadataSlice: { startIndex: -2 }, generatorMetadatasInSlice: [chatModel(1), { stepIndices: [], metadata: {} }] },
    { stepsInSlice: [userStep, modelStep, { type: 15, status: 2 }], generatorMetadatasInSlice: [chatModel(1)] },
    { stepsInSlice: [userStep, modelStep, userStep], generatorMetadatasInSlice: [chatModel(1)] },
  ];
  for (const fixture of unavailable) {
    const data = readCloudConversationSnapshot(readFixture(fixture));
    assert.equal(data.requestTimingAvailable, false);
    assert.equal(data.generation.tps, null);
  }
});

test('cloud Duration accepts omitted zero components, not missing, zero or malformed timings', () => {
  for (const invalid of [undefined, {}, { seconds: 0, nanos: 0 }, { seconds: -1 }, { nanos: -1 },
    { seconds: 1, nanos: 1e9 }, { seconds: 'NaN', nanos: 1 }, { seconds: 0.5 }, { seconds: 86_400 }]) {
    for (const key of ['timeToFirstToken', 'streamingDuration']) {
      const read = readFixture({ generatorMetadatasInSlice: [chatModel(1, { [key]: invalid })] });
      const snapshot = readCloudConversationSnapshot(read);
      assert.equal(snapshot.requestTimingAvailable, false, key);
      assert.equal(snapshot.generation.ttft, null);
    }
  }
  const read = readFixture({ generatorMetadatasInSlice: [chatModel(1, {
    timeToFirstToken: { nanos: 500_000_000 }, streamingDuration: { seconds: '2' },
  })] });
  const snapshot = readCloudConversationSnapshot(read);
  assert.equal(snapshot.requestTimingAvailable, true);
  assert.equal(snapshot.generation.ttft, 0.5);
  assert.equal(snapshot.generation.streaming, 2);
  assert.equal(snapshot.generation.tps, 36);
});

test('a truncated step tail with linked timing exposes the request, never a whole turn', () => {
  const tail = { totalStepsLength: 10, stepsSlice: { startIndex: -2 }, stepsInSlice: [modelStep, toolStep] };
  const snapshot = readCloudConversationSnapshot(readFixture({ ...tail, generatorMetadatasInSlice: [chatModel(8)] }));
  assert.equal(snapshot.requestTimingAvailable, true);
  assert.equal(snapshot.generation.requestIndex, 8);
  assert.equal(snapshot.turnSpeed.generation.duration, 3.5);
  assert.equal(snapshot.turnMetrics, null);
  assert.equal(snapshot.turnQueue, null);
  assert.equal(snapshot.contextTokens, undefined);
  const unmeasured = readCloudConversationSnapshot(readFixture({ ...tail, generatorMetadatasInSlice: [chatModel(7)] }));
  assert.equal(unmeasured.requestTimingAvailable, false, 'no unrelated timing');
  assert.equal(unmeasured.turnSpeed, null);
  assert.equal(unmeasured.turnMetrics, null);
  assert.equal(readFixture({ ...tail, stepsSlice: { startIndex: 0 }, generatorMetadatasInSlice: [chatModel(1)] }), null,
    'a retained prefix does not prove the latest request');
});

test('a known cloud conversation stays timing-hidden before the first measured request', () => {
  const raw = readFixture({ stepsInSlice: [userStep, { type: 15, status: 2 }, toolStep] });
  const snapshot = readCloudConversationSnapshot(raw);
  assert.equal(snapshot.requestTimingAvailable, false);
  assert.equal(snapshot.generation.requestIndex, null);
});

test('readCloudTrajectory extracts matching trajectorySlice from React fiber and ignores other conversations', () => {
  const convId = 'fdeb3371-3973-474c-9765-b789e9a2aa18';
  const matching = {
    conversationId: convId, metadata: {}, totalStepsLength: 2, stepsSlice: { startIndex: -50 },
    stepsInSlice: [
      {
        type: 14, status: 3,
        metadata: {
          executionId: 'exec-1',
          createdAt: { seconds: '1795177897', nanos: 283102310 },
          sourceTrajectoryStepInfo: { stepIndex: 55 },
        },
      },
      {
        type: 15, status: 3,
        metadata: {
          executionId: 'exec-1',
          createdAt: { seconds: '1795177915', nanos: 710358978 },
          viewableAt: { seconds: '1795177918', nanos: 991327900 },
          finishedGeneratingAt: { seconds: '1795177919', nanos: 145412754 },
          completedAt: { seconds: '1795177919', nanos: 145412754 },
          modelUsage: {
            inputTokens: '16822', outputTokens: '57', thinkingOutputTokens: '54',
            responseOutputTokens: '3', cacheReadTokens: '0',
          },
          modelInfo: { maxTokens: 1048576 },
          sourceTrajectoryStepInfo: { stepIndex: 57 },
          retryInfos: [{ error: 'HTTP 429 rate limit exceeded' }, { error: '' }],
        },
      },
    ],
  };
  const fiber = (trajectorySlice, sibling) => ({ memoizedProps: { trajectorySlice }, sibling });
  const unidentified = { ...matching, conversationId: '' };
  const other = { ...matching, conversationId: 'other-conv-id' };
  const current = { child: fiber(other, fiber(unidentified, fiber(matching))) };
  const rootEl = { __reactContainer$abc: { stateNode: { current } } };

  const sandbox = {
    document: { getElementById: id => (id === 'root' ? rootEl : null), body: null },
  };
  const fn = vm.runInNewContext(`(${readCloudTrajectory.toString()})`, sandbox);

  assert.equal(fn('non-existent-id'), null);
  const extracted = fn(convId);
  assert.ok(extracted);
  assert.equal(extracted.conversationId, convId);
  assert.equal(extracted.steps.length, 2);
  assert.equal(extracted.steps[0].idx, 0);
  assert.equal(extracted.steps[1].idx, 1);
  assert.equal(extracted.steps[1].inputTokens, 16822);
  assert.equal(extracted.steps[1].thinkingTokens, 54);
  assert.equal(extracted.steps[1].replyTokens, 3);
  assert.equal(extracted.steps[1].maxContextTokens, 1048576);
  assert.deepEqual(Array.from(extracted.steps[1].retryErrors), ['HTTP 429 rate limit exceeded', '']);
  const retried = readCloudConversationSnapshot(extracted);
  assert.equal(retried.requestError.kind, 'none', 'the final successful retry clears the earlier error');
  assert.equal(retried.turnMetrics.requestCount, 2);
  assert.equal(retried.turnMetrics.missingUsageRequests, 1);
  assert.equal(retried.turnMetrics.read, null, 'the earlier retry has no observed usage');
  matching.metadata.parentConversationId = 'parent';
  assert.equal(fn(convId), null, 'do not use a child trajectory even in Full View');
  delete matching.metadata.parentConversationId;
  matching.totalStepsLength = 4;
  assert.equal(fn(convId), null, 'do not present an incomplete trajectory as full');
});

test('cloud snapshots report measured context and usage, not model timing or an unconfirmed turn end', () => {
  const raw = {
    conversationId: 'cloud-1',
    steps: [
      {
        idx: 0, stepType: 14, status: 3,
        createdAtMs: 1_700_000_000_000, viewableAtMs: 0, finishedGeneratingAtMs: 0, completedAtMs: 0,
        executionId: 'e1', hasUsage: false, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0,
        thinkingTokens: 0, replyTokens: 0, maxContextTokens: 0, retryErrors: [],
      },
      {
        idx: 1, stepType: 15, status: 3,
        createdAtMs: 1_700_000_001_000, viewableAtMs: 1_700_000_003_000,
        finishedGeneratingAtMs: 1_700_000_004_000, completedAtMs: 1_700_000_004_000,
        executionId: 'e1', hasUsage: true, inputTokens: 16822, cacheReadTokens: 0, outputTokens: 60,
        thinkingTokens: 50, replyTokens: 10, maxContextTokens: 1048576, retryErrors: [],
      },
      {
        idx: 2, stepType: 14, status: 3,
        createdAtMs: 1_700_000_010_000, viewableAtMs: 0, finishedGeneratingAtMs: 0, completedAtMs: 0,
        executionId: 'e2', hasUsage: false, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0,
        thinkingTokens: 0, replyTokens: 0, maxContextTokens: 0, retryErrors: [],
      },
      {
        idx: 3, stepType: 15, status: 3,
        createdAtMs: 1_700_000_011_000, viewableAtMs: 1_700_000_012_000,
        finishedGeneratingAtMs: 1_700_000_014_000, completedAtMs: 1_700_000_014_000,
        executionId: 'e2', hasUsage: true, inputTokens: 2000, cacheReadTokens: 16000, outputTokens: 90,
        thinkingTokens: 60, replyTokens: 30, maxContextTokens: 1048576, retryErrors: [],
      },
    ],
    executors: [],
    lastStepError: '',
  };
  const snapshot = readCloudConversationSnapshot(raw);

  assert.equal(snapshot.contextTokens, 18000);
  assert.equal(snapshot.cachedIn, 16000);
  assert.equal(snapshot.uncachedIn, 2000);
  assert.equal(snapshot.maxContextTokens, 1048576);
  assert.equal(snapshot.turn0Tokens, 16822);
  assert.equal(snapshot.totalThinkingTokens, 50);
  assert.equal(snapshot.totalOutputTokens, 10);
  assert.equal(snapshot.generation.output, 90);
  assert.equal(snapshot.generation.ttft, null);
  assert.equal(snapshot.generation.streaming, null);
  assert.equal(snapshot.generation.tps, null);
  assert.equal(snapshot.turnSpeed.generation, null);
  assert.equal(snapshot.turnMetrics.state, 'unknown');
  assert.equal(snapshot.turnMetrics.duration, null);
  assert.equal(snapshot.turnQueue.waitingSinceMs, null);
  const confirmed = readCloudConversationSnapshot({ ...raw, executors: [{ reason: 4, lastStepIndex: 3, executionId: 'e2' }] });
  assert.equal(confirmed.turnMetrics.state, 'completed');
  assert.equal(confirmed.turnMetrics.duration, 4);
  assert.equal(snapshot.requestError.kind, 'none');
});

test('readCloudConversationSnapshot classifies retry errors and lastStepError and respects compaction checkpoints', () => {
  const snapshot = readCloudConversationSnapshot({
    conversationId: 'cloud-2',
    steps: [
      {
        idx: 0, stepType: 14, status: 3, createdAtMs: 1000, viewableAtMs: 0, finishedGeneratingAtMs: 0, completedAtMs: 0,
        executionId: 'e1', hasUsage: false, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0, replyTokens: 0, maxContextTokens: 0, retryErrors: [],
      },
      {
        idx: 1, stepType: 15, status: 3, createdAtMs: 2000, viewableAtMs: 0, finishedGeneratingAtMs: 0, completedAtMs: 3000,
        executionId: 'e1', hasUsage: true, inputTokens: 50000, cacheReadTokens: 0, outputTokens: 2000, thinkingTokens: 1500, replyTokens: 500, maxContextTokens: 200000, retryErrors: [],
      },
      {
        idx: 2, stepType: 23, status: 3, createdAtMs: 4000, viewableAtMs: 0, finishedGeneratingAtMs: 0, completedAtMs: 4000,
        executionId: 'e1', hasUsage: false, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0, replyTokens: 0, maxContextTokens: 0, retryErrors: [],
      },
      {
        idx: 3, stepType: 14, status: 3, createdAtMs: 5000, viewableAtMs: 0, finishedGeneratingAtMs: 0, completedAtMs: 0,
        executionId: 'e2', hasUsage: false, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0, replyTokens: 0, maxContextTokens: 0, retryErrors: [],
      },
      {
        idx: 4, stepType: 15, status: 7, createdAtMs: 6000, viewableAtMs: 0, finishedGeneratingAtMs: 0, completedAtMs: 7000,
        executionId: 'e2', hasUsage: true, inputTokens: 10000, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0, replyTokens: 0, maxContextTokens: 200000,
        retryErrors: ['HTTP 429 rate limit exceeded, retry in 15s'],
      },
    ],
    executors: [],
    lastStepError: '',
  }, false);

  assert.equal(snapshot.contextTokens, 10000);
  assert.equal(snapshot.turn0Tokens, 10000);
  assert.equal(snapshot.totalOutputTokens, 0);
  assert.equal(snapshot.totalThinkingTokens, 0);
  assert.equal(snapshot.requestError.kind, 'rate_limited');
  assert.equal(snapshot.requestError.retryAfterSec, 15);
  assert.equal(snapshot.turnMetrics, null);
});

test('cloud telemetry stays bound to its exact ID and is cleared, evicted or expired', () => {
  let now = 0;
  const store = createCloudTelemetryStore(2, () => now);
  const mk = (conversationId, tokens) => ({
    conversationId,
    steps: [{
      idx: 0, stepType: 15, status: 3, createdAtMs: 1000, viewableAtMs: 0, finishedGeneratingAtMs: 0, completedAtMs: 2000,
      executionId: '', hasUsage: true, inputTokens: tokens, cacheReadTokens: 0, outputTokens: 10, thinkingTokens: 5, replyTokens: 5, maxContextTokens: 100000, retryErrors: [],
    }],
  });
  store.set('c1', mk('c1', 100));
  store.set('c2', mk('c2', 200));
  store.set('c3', mk('c3', 300));
  assert.equal(store.read('c1'), null);
  store.set('c2', mk('some-other-conversation', 444));
  assert.equal(store.read('c2').contextTokens, 200);
  assert.equal(store.read('c3').contextTokens, 300);
  store.set('c2', null);
  assert.equal(store.read('c2'), null);
  now += 10_000;
  assert.equal(store.read('c3'), null);
});
