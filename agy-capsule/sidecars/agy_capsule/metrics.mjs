// Metrics describe ONE model request, not a user turn or tool execution.
export function summarizeGeneration(raw = null) {
  const number = value => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const ttft = number(raw?.ttft);
  const streaming = number(raw?.streaming);
  const duration = ttft !== null && streaming !== null ? ttft + streaming : null;
  const output = number(raw?.output);
  const reply = number(raw?.reply);
  const thinking = number(raw?.thinking);
  const splitMatches = output !== null && reply !== null && thinking !== null && output === reply + thinking;
  return {
    requestIndex: raw?.requestIndex ?? null,
    ttft, streaming, duration, output,
    reply: splitMatches ? reply : null,
    thinking: splitMatches ? thinking : null,
    tps: output !== null && output > 0 && duration !== null && duration > 0 ? output / duration : null,
  };
}

// Footer speed is the latest COMPLETED request after the latest user input.
// Verified local enums: USER_INPUT=14, PLANNER_RESPONSE=15, DONE=3.
export function summarizeTurnSpeed(requests, steps, userStepIndex) {
  if (!Number.isInteger(userStepIndex)) return null;
  const stepMap = new Map(steps.map(step => [step.idx, step]));
  let generation = null;
  let completedAtMs = 0;
  for (const request of requests) {
    if (request.lastStepIndex < userStepIndex || request.requestError?.kind !== 'none') continue;
    const response = request.stepIndices?.map(idx => stepMap.get(idx)).find(step => step?.step_type === 15 && step.idx > userStepIndex && step.status === 3);
    if (!response) continue;
    const candidate = summarizeGeneration(request.generation);
    if (candidate.tps === null) continue;
    generation = candidate;
    completedAtMs = response.completedAtMs || 0;
  }
  return {
    userStepIndex, generation, completedAtMs,
    hasActiveStep: steps.some(step => step.idx > userStepIndex && step.step_type !== 14 && [1, 2, 8, 9, 11].includes(step.status)),
  };
}

// Reported TTFTs and local step-based estimates have different timing boundaries.
const ACTIVE_STEP_STATUSES = new Set([1, 2, 8, 9, 11]);
const validEpoch = value => Number.isFinite(value) && value > 0 ? value : null;

export function summarizeTurnQueue(requests, steps, userStepIndex, executors = []) {
  if (!Number.isInteger(userStepIndex)) return null;
  // An older request can create its response step after the next input.
  const priorPlannerLinks = new Set();
  const currentPlannerLinks = new Set();
  for (const request of requests) {
    const input = request.lastStepIndex;
    if (!Number.isInteger(input) || input < 0) continue;
    const links = input < userStepIndex ? priorPlannerLinks : currentPlannerLinks;
    for (const idx of request.stepIndices || []) {
      if (idx > userStepIndex) links.add(idx);
    }
  }
  const isPriorLink = idx => priorPlannerLinks.has(idx) && !currentPlannerLinks.has(idx);
  const isPriorPlanner = step => step.step_type === 15 && isPriorLink(step.idx);
  const scope = steps.filter(step => step.idx >= userStepIndex && !isPriorPlanner(step));
  const user = scope.find(step => step.idx === userStepIndex && step.step_type === 14);
  if (!user) return null;

  const active = scope.some(step => step.step_type !== 14 && ACTIVE_STEP_STATUSES.has(step.status));
  const executor = executors.filter(item => item.lastStepIndex >= userStepIndex).at(-1);
  const finalStep = executor && scope.find(step => step.idx === executor.lastStepIndex);
  const laterExecution = executor && scope.some(step => step.idx > executor.lastStepIndex && ![14, 101, 17].includes(step.step_type));
  const executionMatches = finalStep && (!executor.executionId || !finalStep.executionId || executor.executionId === finalStep.executionId);
  const turnTerminal = !active && (
    Boolean(executor && executionMatches && !laterExecution && ![0, 7, 12].includes(executor.reason))
    || ([6, 12].includes(user.status) && scope.every(step => step.step_type === 14))
  );

  const plannerIndices = new Set(scope.filter(step => step.step_type === 15).map(step => step.idx));
  const coveredSteps = new Set();
  const waits = [];
  for (const request of requests) {
    const input = request.lastStepIndex;
    const links = request.stepIndices || [];
    if (Number.isInteger(input) && input >= 0) {
      if (input < userStepIndex) continue;
    } else if (!links.some(idx => plannerIndices.has(idx)) ||
        links.some(idx => idx <= userStepIndex || isPriorLink(idx))) {
      // A generated step can identify the wait when the request has no input index.
      continue;
    }
    const ttft = request.generation?.ttft;
    if (ttft !== null && ttft !== undefined && Number.isFinite(ttft) && ttft >= 0) {
      waits.push(ttft);
      for (const idx of links) coveredSteps.add(idx);
    }
  }
  for (const step of scope) {
    if (step.step_type !== 15 || coveredSteps.has(step.idx)) continue;
    const created = validEpoch(step.createdAtMs);
    const generating = validEpoch(step.generatingAtMs);
    if (created && generating && generating >= created) {
      waits.push((generating - created) / 1000);
    }
  }

  const hasActiveTool = scope.some(step => step.step_type !== 14 && step.step_type !== 15 && ACTIVE_STEP_STATUSES.has(step.status));
  const hasStreamingPlanner = scope.some(step => step.step_type === 15 && step.status === 8);
  // An older planner is not counted here, but may still be keeping the composer in Working.
  const hasPriorActivePlanner = steps.some(step => isPriorPlanner(step) && ACTIVE_STEP_STATUSES.has(step.status));
  const pendingPlanner = scope.findLast(step => step.step_type === 15 && [1, 2].includes(step.status));
  // Status and timing records can arrive in different snapshots.
  const waitingPendingPlanner = Boolean(pendingPlanner && !coveredSteps.has(pendingPlanner.idx) && !validEpoch(pendingPlanner.generatingAtMs));
  let waitingSinceMs = null;
  if (!turnTerminal && !hasActiveTool && !hasStreamingPlanner) {
    if (pendingPlanner) {
      if (waitingPendingPlanner) {
        waitingSinceMs = validEpoch(pendingPlanner.createdAtMs);
      }
    } else if (!hasPriorActivePlanner) {
      const relevant = scope.filter(step => !(step.step_type === 14 && step.status === 11) && ![101, 17].includes(step.step_type));
      const last = relevant.at(-1);
      if (last) {
        if (last.step_type === 14) {
          waitingSinceMs = validEpoch(last.inputStartedAtMs);
        } else if (last.step_type !== 15 || last.status === 3) {
          waitingSinceMs = validEpoch(last.recordedCompletedAtMs) || validEpoch(last.terminalAtMs);
        }
      }
    }
  }

  return {
    userStepIndex,
    waits,
    waitingSinceMs,
    hasPendingPlanner: waitingPendingPlanner,
    turnTerminal,
  };
}
