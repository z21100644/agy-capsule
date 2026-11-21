// One user message, including queued time. No steps-as-requests or token estimates.
const ACTIVE = new Set([1, 2, 8, 9, 11]);
const TOKEN_KEYS = ['read', 'cachedRead', 'uncachedRead', 'write', 'thinking'];
const timestamp = value => Number.isFinite(value) && value > 0 ? value : null;

function summarizeAttempts(attributable, ambiguous) {
  const attempts = attributable.flatMap(request => request.attempts || []);
  const missing = attributable.reduce((sum, request) => sum + (request.missingAttempts || 0), 0);
  const pending = attributable.some(request => request.pendingAttempt);
  const knownTotals = Object.fromEntries(TOKEN_KEYS.map(key => [key, attempts.reduce((sum, attempt) => sum + (attempt.usage[key] ?? 0), 0)]));
  const totals = Object.fromEntries(TOKEN_KEYS.map(key => [key,
    ambiguous || pending || missing || attempts.some(attempt => attempt.usage[key] === null) ? null : knownTotals[key],
  ]));
  return {
    requestCount: ambiguous || pending ? null : attempts.length + missing,
    knownRequestCount: attempts.length + missing,
    missingUsageRequests: missing + attempts.filter(attempt => TOKEN_KEYS.some(key => attempt.usage[key] === null)).length,
    pending, associationIncomplete: ambiguous, knownTotals, ...totals,
  };
}

export function summarizeTurnMetrics(requests, steps, userStepIndex, executors = []) {
  const user = steps.find(step => step.idx === userStepIndex && step.step_type === 14);
  if (!user) return null;
  const scope = steps.filter(step => step.idx >= userStepIndex);
  const attributable = requests.filter(request => request.lastStepIndex >= userStepIndex);
  const ambiguous = requests.some(request => request.lastStepIndex < 0 && request.stepIndices?.some(idx => idx > userStepIndex));
  let state = 'unknown';
  let endedAtMs = null;
  const active = scope.some(step => step.step_type !== 14 && ACTIVE.has(step.status));
  const executor = executors.filter(item => item.lastStepIndex >= userStepIndex).at(-1);
  const finalStep = executor && scope.find(step => step.idx === executor.lastStepIndex);
  const laterExecution = executor && scope.some(step => step.idx > executor.lastStepIndex && ![14, 101, 17].includes(step.step_type));
  const executionMatches = finalStep && (!executor.executionId || !finalStep.executionId || executor.executionId === finalStep.executionId);
  if (user.status === 11) state = 'queued';
  else if (active) state = 'running';
  else if (executor && executionMatches && !laterExecution && ![0, 7, 12].includes(executor.reason)) {
    state = executor.reason === 1 ? 'failed' : [2, 3, 6, 11].includes(executor.reason) ? 'interrupted' : 'completed';
    if (executor.reason === 2) {
      // Last DONE step may predate cancellation. Never pretend it is cancel time.
      const lastCompleted = timestamp(finalStep.completedAtMs) || timestamp(finalStep.terminalAtMs);
      const cancellations = scope.filter(step => [6, 12].includes(step.status) && (!executor.executionId || !step.executionId || step.executionId === executor.executionId))
        .map(step => timestamp(step.terminalAtMs) || timestamp(step.completedAtMs)).filter(value => value && (!lastCompleted || value >= lastCompleted));
      endedAtMs = cancellations.length ? Math.max(...cancellations) : null;
    } else {
      const errorStep = executor.reason === 1 && scope.findLast(step => step.step_type === 17 && step.idx >= executor.lastStepIndex);
      const end = errorStep || finalStep;
      endedAtMs = timestamp(end?.completedAtMs) || timestamp(end?.terminalAtMs);
    }
  } else if ([6, 12].includes(user.status) && scope.every(step => step.step_type === 14)) {
    state = 'interrupted';
    endedAtMs = timestamp(user.terminalAtMs);
  }
  const startedAtMs = timestamp(user.createdAtMs);
  if (startedAtMs && endedAtMs && endedAtMs < startedAtMs) endedAtMs = null;
  return {
    userStepIndex, state, startedAtMs, endedAtMs,
    duration: startedAtMs && endedAtMs ? (endedAtMs - startedAtMs) / 1000 : null,
    ...summarizeAttempts(attributable, ambiguous),
  };
}

// A child can receive work from its parent without a USER_INPUT step. Callers
// supply only steps and executor records attributed to its latest execution.
export function summarizeSubagentExecution(steps, executors) {
  if (!steps.length) return null;
  const first = steps[0];
  const lastWork = steps.findLast(step => ![17, 23, 101].includes(step.step_type));
  const executor = executors.at(-1);
  const finalStep = executor && steps.find(step => step.idx === executor.lastStepIndex);
  const confirmed = finalStep && (!lastWork || lastWork.idx <= finalStep.idx) && ![0, 7, 12].includes(executor.reason);
  const cancelTime = step => timestamp(step.terminalAtMs) || timestamp(step.recordedCompletedAtMs);
  const doneTime = step => timestamp(step.recordedCompletedAtMs) || timestamp(step.terminalAtMs);
  let state = 'unknown';
  let endedAtMs = null;
  if (confirmed) {
    state = executor.reason === 1 ? 'failed' : [2, 3, 6, 11].includes(executor.reason) ? 'interrupted' : 'completed';
    if (state === 'interrupted') {
      // A completed step is not proof of when the execution was interrupted.
      const lastDoneAt = [6, 12].includes(finalStep.status) ? null : doneTime(finalStep);
      for (const step of steps) {
        const time = [6, 12].includes(step.status) && step.idx >= finalStep.idx ? cancelTime(step) : null;
        if (time && (!lastDoneAt || time >= lastDoneAt)) endedAtMs = Math.max(endedAtMs || 0, time);
      }
    } else {
      const end = state === 'failed' && steps.findLast(step => step.step_type === 17 && step.idx >= finalStep.idx);
      endedAtMs = doneTime(end || finalStep);
    }
  } else if (lastWork && [6, 12].includes(lastWork.status)) {
    state = 'interrupted';
    endedAtMs = cancelTime(lastWork);
  } else if (steps.some(step => ACTIVE.has(step.status))) {
    state = first.status === 11 ? 'queued' : 'running';
  }
  const startedAtMs = timestamp(first.createdAtMs);
  if (startedAtMs && endedAtMs && endedAtMs < startedAtMs) endedAtMs = null;
  return {
    executionId: first.executionId, state, startedAtMs, endedAtMs,
    duration: startedAtMs && endedAtMs ? (endedAtMs - startedAtMs) / 1000 : null,
  };
}

export function summarizeSubagentTurnMetrics(requests, execution, associationIncomplete) {
  return { ...execution, ...summarizeAttempts(requests, associationIncomplete) };
}
