import { summarizeGeneration, summarizeTurnSpeed, summarizeTurnQueue } from './metrics.mjs';
import { summarizeTurnMetrics } from './turn_metrics.mjs';
import { classifyRequestError } from './errors.mjs';

// Runs inside the Antigravity renderer via buildRuntimeBundle().
// Must remain self-contained (no module imports or outer closures).
export function readCloudTrajectory(conversationId) {
  if (!conversationId || typeof conversationId !== 'string') return null;
  const rootEl = document.getElementById('root') || document.body?.firstElementChild;
  if (!rootEl) return null;
  const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
  if (!fiberKey) return null;

  const toNum = value => {
    if (value === null || value === undefined || value === '') return 0;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const tsMs = ts => {
    if (!ts || typeof ts !== 'object') return 0;
    if (ts.seconds === undefined && ts.nanos === undefined) return 0;
    const sec = Number(ts.seconds || 0);
    const nano = Number(ts.nanos || 0);
    if (!Number.isFinite(sec) || !Number.isFinite(nano)) return 0;
    const ms = sec * 1000 + nano / 1e6;
    return ms > 0 ? ms : 0;
  };
  const errText = value => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      if (typeof value.message === 'string' && value.message) return value.message;
      if (typeof value.error === 'string' && value.error) return value.error;
      if (typeof value.userErrorMessage === 'string' && value.userErrorMessage) return value.userErrorMessage;
    }
    return '';
  };
  const tailStart = (length, total, start = 0) => {
    if (!length || !Number.isSafeInteger(total) || !Number.isSafeInteger(start)) return null;
    const offset = start < 0 ? Math.max(0, total + start) : start;
    return offset + length === total ? offset : null;
  };
  const durationSeconds = duration => {
    if (!duration || typeof duration !== 'object') return null;
    const integer = value => typeof value === 'number' || typeof value === 'bigint' ||
      (typeof value === 'string' && /^\d+$/.test(value)) ? Number(value) : NaN;
    const sec = duration.seconds === undefined ? 0 : integer(duration.seconds);
    const nanos = duration.nanos === undefined ? 0 : integer(duration.nanos);
    if (!Number.isInteger(sec) || sec < 0 || sec >= 86_400 ||
        !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9 || (!sec && !nanos)) return null;
    return sec + nanos / 1e9;
  };

  const container = rootEl[fiberKey];
  const seen = new WeakSet();
  const queue = [container?.stateNode?.current ?? container];
  let slice = null;
  let offset = null;
  for (let i = 0; i < queue.length && i < 6000; i++) {
    const fiber = queue[i];
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    const ts = fiber.memoizedProps?.trajectorySlice;
    if (ts?.conversationId === conversationId && Array.isArray(ts.stepsInSlice)) {
      const meta = ts.metadata;
      if (meta?.parentConversationId || meta?.subagentSpec || meta?.nestingDepth > 0) return null;
      // A retained prefix cannot identify the latest request; prefer a full slice over a tail.
      const start = tailStart(ts.stepsInSlice.length, ts.totalStepsLength, ts.stepsSlice?.startIndex);
      if (meta && start !== null && (offset === null || start < offset)) {
        slice = ts;
        offset = start;
        if (offset === 0) break;
      }
    }
    if (fiber.child) queue.push(fiber.child);
    if (fiber.sibling) queue.push(fiber.sibling);
  }
  if (!slice) return null;

  const steps = slice.stepsInSlice.map((step, i) => {
    const m = step?.metadata || {};
    const u = m.modelUsage || null;
    const retryErrors = Array.isArray(m.retryInfos)
      ? m.retryInfos.map(r => errText(r?.error ?? r))
      : [];
    return {
      idx: offset + i,
      stepType: toNum(step?.type),
      status: toNum(step?.status),
      createdAtMs: tsMs(m.createdAt),
      viewableAtMs: tsMs(m.viewableAt),
      finishedGeneratingAtMs: tsMs(m.finishedGeneratingAt),
      completedAtMs: tsMs(m.completedAt),
      executionId: typeof m.executionId === 'string' ? m.executionId : '',
      hasUsage: Boolean(u),
      inputTokens: u ? toNum(u.inputTokens) : 0,
      cacheReadTokens: u ? toNum(u.cacheReadTokens) : 0,
      outputTokens: u ? toNum(u.outputTokens) : 0,
      thinkingTokens: u ? toNum(u.thinkingOutputTokens) : 0,
      replyTokens: u ? toNum(u.responseOutputTokens) : 0,
      maxContextTokens: toNum(m.modelInfo?.maxTokens),
      retryErrors,
    };
  });

  // The renderer often only holds the final generator record. It is evidence for
  // one request, never for the rest of the turn. Don't walk back to an older timing.
  let requestTiming = null;
  const generators = slice.generatorMetadatasInSlice;
  if (Array.isArray(generators) && tailStart(generators.length, slice.totalGeneratorMetadataLength,
      slice.generatorMetadataSlice?.startIndex) !== null) {
    const generator = generators.findLast(record => record?.metadata?.case !== 'injected');
    const latest = steps.findLast(step => step.stepType === 15 || step.hasUsage || step.retryErrors.length);
    const user = steps.findLast(step => step.stepType === 14 && step.status !== 11);
    if (generator?.metadata?.case === 'chatModel' && !generator.error &&
        latest?.stepType === 15 && latest.status === 3 && (!user || latest.idx > user.idx) &&
        !latest.retryErrors.at(-1) && Array.isArray(generator.stepIndices) && generator.stepIndices.includes(latest.idx) &&
        (!generator.executionId || !latest.executionId || generator.executionId === latest.executionId)) {
      const model = generator.metadata.value;
      const ttft = durationSeconds(model?.timeToFirstToken);
      const streaming = durationSeconds(model?.streamingDuration);
      // Use the request's usage or, if not sent, the explicitly linked response's usage.
      const useGeneratorUsage = model?.usage?.outputTokens != null;
      const output = useGeneratorUsage ? toNum(model.usage.outputTokens) : latest.outputTokens;
      if (ttft !== null && streaming !== null && Number.isSafeInteger(output) && output > 0) {
        requestTiming = { stepIndex: latest.idx, ttft, streaming, output,
          reply: useGeneratorUsage ? toNum(model.usage.responseOutputTokens) : latest.replyTokens,
          thinking: useGeneratorUsage ? toNum(model.usage.thinkingOutputTokens) : latest.thinkingTokens };
      }
    }
  }
  const executors = Array.isArray(slice.executorMetadatasInSlice)
    ? slice.executorMetadatasInSlice.map(ex => ({
        reason: toNum(ex?.terminationReason ?? ex?.reason),
        lastStepIndex: Number.isInteger(ex?.lastStepIndex) ? ex.lastStepIndex : -1,
        executionId: typeof ex?.executionId === 'string' ? ex.executionId : '',
      }))
    : [];

  return {
    conversationId: slice.conversationId,
    totalStepsLength: slice.totalStepsLength,
    lastStepError: errText(slice.lastStepError),
    steps,
    executors,
    requestTiming,
  };
}

const ACTIVE_STATUSES = new Set([1, 2, 8, 9, 11]);

export function readCloudConversationSnapshot(raw, includeTurnMetrics = true) {
  if (!raw || !Array.isArray(raw.steps) || raw.steps.length === 0) return null;
  const steps = [...raw.steps].sort((a, b) => a.idx - b.idx);
  const timedStep = raw.requestTiming && steps.find(step => step.idx === raw.requestTiming.stepIndex);
  const requestGeneration = timedStep ? summarizeGeneration({ ...raw.requestTiming, requestIndex: timedStep.idx }) : null;
  const requestTimingAvailable = requestGeneration?.ttft > 0 && requestGeneration.streaming > 0 &&
    Number.isFinite(requestGeneration.tps) && requestGeneration.tps > 0;
  const timedSpeed = requestTimingAvailable ? {
    generation: requestGeneration,
    completedAtMs: timedStep.finishedGeneratingAtMs || timedStep.completedAtMs || 0,
  } : null;

  const requestOnly = () => ({
    requestTimingAvailable,
    generation: requestTimingAvailable ? requestGeneration : summarizeGeneration(),
    turnSpeed: timedSpeed,
    turnQueue: null,
    turnMetrics: null,
    requestError: classifyRequestError(raw.lastStepError),
  });
  // A verified tail can expose the latest request, but not the full turn or context breakdown.
  if (raw.totalStepsLength > steps.length) return requestOnly();

  let userStepIndex = null;
  let metricsUserStepIndex = null;
  const cpIndices = [];
  for (const step of steps) {
    if (step.stepType === 23) cpIndices.push(step.idx);
    if (step.stepType === 14) {
      metricsUserStepIndex = step.idx;
      if (step.status !== 11) userStepIndex = step.idx;
    }
  }
  cpIndices.sort((a, b) => b - a);
  if (!includeTurnMetrics) metricsUserStepIndex = null;

  const lastStep = steps.at(-1);
  let lastStepEpochMs = lastStep?.createdAtMs || lastStep?.completedAtMs || lastStep?.finishedGeneratingAtMs || 0;

  const firstTurnStep = userStepIndex ?? metricsUserStepIndex;
  const turnSteps = firstTurnStep === null ? [] : steps
    .filter(step => step.idx >= firstTurnStep)
    .map(step => {
      const completed = step.finishedGeneratingAtMs || step.completedAtMs || 0;
      const recordedCompleted = step.completedAtMs || step.finishedGeneratingAtMs || null;
      return {
        idx: step.idx,
        step_type: step.stepType,
        status: step.status,
        completedAtMs: completed,
        recordedCompletedAtMs: recordedCompleted,
        createdAtMs: step.createdAtMs || null,
        inputStartedAtMs: null, // Creation can be queue time, not consumption time.
        generatingAtMs: step.viewableAtMs || null,
        terminalAtMs: [3, 6, 7, 12].includes(step.status) ? recordedCompleted : null,
        executionId: step.executionId || '',
      };
    });

  const executors = Array.isArray(raw.executors) ? raw.executors : [];

  const turns = [];
  const parsedRequests = [];
  let latestGeneration = null;
  let latestRequestError = classifyRequestError();

  let reqIdx = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const retries = Array.isArray(step.retryErrors) ? step.retryErrors : [];
    const uncachedIn = step.inputTokens || 0;
    const cachedIn = step.cacheReadTokens || 0;
    const contextTokens = uncachedIn + cachedIn;
    const thinkTokens = step.thinkingTokens || 0;
    const outTokens = step.replyTokens || 0;
    const totalOut = step.outputTokens || (thinkTokens + outTokens);
    const hasOutput = step.hasUsage && totalOut > 0;
    if (!step.hasUsage && !retries.length) continue;

    const lastRetryErr = retries.at(-1);
    const requestError = classifyRequestError(lastRetryErr);
    const prevIdx = i > 0 ? steps[i - 1].idx : Math.max(0, step.idx - 1);
    const splitMatches = totalOut === thinkTokens + outTokens;
    const hasAttemptUsage = step.hasUsage && (retries.length <= 1 || !lastRetryErr);
    const usageRecord = {
      read: hasAttemptUsage ? contextTokens : null,
      cachedRead: hasAttemptUsage ? cachedIn : null,
      uncachedRead: hasAttemptUsage ? uncachedIn : null,
      write: hasAttemptUsage && hasOutput && splitMatches ? outTokens : null,
      thinking: hasAttemptUsage && hasOutput && splitMatches ? thinkTokens : null,
    };
    const generation = {
      requestIndex: reqIdx,
      // Step transitions are not request timings. Keep the generator's single
      // measured request separate from aggregation over the step window.
      ttft: null,
      streaming: null,
      output: hasOutput ? totalOut : null,
      reply: hasOutput ? outTokens : null,
      thinking: hasOutput ? thinkTokens : null,
    };
    const parsed = {
      turn: reqIdx,
      uncachedIn,
      cachedIn,
      contextTokens,
      outTokens,
      thinkTokens,
      maxContextTokens: step.maxContextTokens || 0,
      lastStepIndex: prevIdx,
      stepIndices: [step.idx],
      requestError,
      attempts: [{ usage: usageRecord }],
      missingAttempts: Math.max(0, retries.length - 1),
      pendingAttempt: false,
      generation,
    };
    reqIdx++;
    parsedRequests.push(parsed);
    latestGeneration = generation;
    const earlierRequest = userStepIndex !== null && parsed.lastStepIndex >= 0 && parsed.lastStepIndex < userStepIndex;
    if (!earlierRequest) latestRequestError = requestError;
    if (contextTokens > 0) turns.push(parsed);
  }

  if (latestRequestError.kind === 'none' && raw.lastStepError) {
    latestRequestError = classifyRequestError(raw.lastStepError);
  }
  // Recognized cloud conversations still suppress an empty speed chip while the host is working.
  if (!parsedRequests.length && latestRequestError.kind === 'none') return requestOnly();

  let epochStart = 0;
  if (turns.length > 0) {
    for (const cpIdx of cpIndices) {
      const postIdx = turns.findIndex(t => t.lastStepIndex >= cpIdx);
      if (postIdx >= 0) {
        epochStart = postIdx;
        break;
      }
    }
    for (let i = epochStart + 1; i < turns.length; i++) {
      if (turns[i].contextTokens < turns[i - 1].contextTokens * 0.7) {
        epochStart = i;
      }
    }
  }

  const latest = turns.at(-1) || {
    uncachedIn: 0,
    cachedIn: 0,
    contextTokens: 0,
    outTokens: 0,
    thinkTokens: 0,
  };
  if (turns.length === 0 || latest.contextTokens === 0) {
    lastStepEpochMs = 0;
  }

  let rawOut = 0;
  let rawThink = 0;
  for (let i = epochStart; i < turns.length - 1; i++) {
    rawOut += turns[i].outTokens;
    rawThink += turns[i].thinkTokens;
  }

  const turn0Tokens = Math.min(turns[epochStart]?.contextTokens || 0, latest.contextTokens);
  const availGen = Math.max(0, latest.contextTokens - turn0Tokens);
  const genSum = rawOut + rawThink;
  const genScale = genSum > availGen && genSum > 0 ? availGen / genSum : 1;
  const totalOutputTokens = Math.round(rawOut * genScale);
  const totalThinkingTokens = Math.round(rawThink * genScale);

  const turnQueue = summarizeTurnQueue(parsedRequests, turnSteps, userStepIndex, executors);
  // With no active step, a finished planner may be either the end of the turn
  // or a gap before another step. Do not show a live wait on that evidence alone.
  if (turnQueue && !turnSteps.some(step => step.step_type !== 14 && ACTIVE_STATUSES.has(step.status))) {
    turnQueue.waitingSinceMs = null;
  }
  const turnSpeed = summarizeTurnSpeed(parsedRequests, turnSteps, userStepIndex);
  return {
    requestTimingAvailable,
    turnSpeed: timedSpeed ? { ...turnSpeed, ...timedSpeed } : turnSpeed,
    turnQueue,
    turnMetrics: includeTurnMetrics
      ? summarizeTurnMetrics(parsedRequests, turnSteps.map(step => ({ ...step, completedAtMs: step.recordedCompletedAtMs })), metricsUserStepIndex, executors)
      : null,
    requestError: latestRequestError,
    generation: requestTimingAvailable ? requestGeneration : summarizeGeneration(latestGeneration),
    cachedIn: latest.cachedIn,
    uncachedIn: latest.uncachedIn,
    contextTokens: latest.contextTokens,
    maxContextTokens: latest.maxContextTokens || 0,
    lastStepEpochMs,
    turn0Tokens,
    totalOutputTokens,
    totalThinkingTokens,
  };
}

export function createCloudTelemetryStore(maxEntries = 8, now = Date.now) {
  const entries = new Map();
  return {
    set(convId, raw) {
      if (!convId || typeof convId !== 'string') return;
      if (raw === null) { entries.delete(convId); return; }
      if (raw?.conversationId !== convId || !Array.isArray(raw.steps) || raw.steps.length === 0) return;
      entries.delete(convId);
      entries.set(convId, { raw, expiresAt: now() + 10_000 });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    read(convId, includeTurnMetrics = true) {
      const entry = entries.get(convId);
      if (!entry) return null;
      if (now() >= entry.expiresAt) { entries.delete(convId); return null; }
      return readCloudConversationSnapshot(entry.raw, includeTurnMetrics);
    },
  };
}
