import { DatabaseSync } from 'node:sqlite';
import { readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startDeckInjector } from './deck_injector.mjs';
import { createSettingsStore, DEFAULT_SETTINGS } from './settings.mjs';
import { createPresentation, getPresentationScript } from './ui.mjs';
import { summarizeGeneration, summarizeSubagentTurnSpeed, summarizeTurnSpeed, summarizeTurnQueue } from './metrics.mjs';
import { classifyRequestError } from './errors.mjs';
import { createSqliteSnapshotCache } from './sqlite_cache.mjs';
import { startLsWatchdog } from './ls_watchdog.mjs';
import { startSelfReloadWatcher } from './reload.mjs';
import { summarizeSubagentExecution, summarizeSubagentTurnMetrics, summarizeTurnMetrics } from './turn_metrics.mjs';
import { installAsyncHostRoutes, installEpipeGuard } from './host_bridge.mjs';
import { createCdpNoticeManager } from './cdp_notice.mjs';
import { createCloudTelemetryStore } from './cloud_telemetry.mjs';
import { createUsageHistory } from './usage_history.mjs';
import { createUsagePresentation } from './usage_ui.mjs';
import { EFFORT_BAR_CSS, EFFORT_TRACK_MARKUP } from './effort_bar.mjs';
import { createMotionThemes } from './motion_themes.mjs';
import { CURRENT_VERSION, VERSION_ROUTE, createVersionChecker } from './version_check.mjs';
import { createVersionPanel } from './version_ui.mjs';
import { createPluginUpdater, UPDATE_ROUTE } from './version_update.mjs';

const settingsStore = createSettingsStore();
const checkVersion = createVersionChecker({ getPrefs: () => settingsStore.read() });
const updatePlugin = createPluginUpdater({ sidecarDirectory: dirname(fileURLToPath(import.meta.url)), checkVersion });
const cloudTelemetryStore = createCloudTelemetryStore();
const PANEL_VERSION = 155;
const presentation = createPresentation();
export function getNotifyText(shortcutState, prefs) {
  const t = presentation.dictionaries[prefs?.settingsLanguage] || presentation.dictionaries['zh-CN'];
  if (shortcutState === 'S5') return { title: t.healthSidebarTitle, body: t.healthS5 };
  return { title: t.cdpNotifyTitle, body: shortcutState === 'missing' ? t.cdpNotifyBodyMissing : t.cdpNotifyBodyOk };
}
const cdpNotice = createCdpNoticeManager({ getPrefs: () => settingsStore.read(), getNotifyText });

function conversationDirectories(dataDir) {
  if (dataDir) {
    // The host passes <appData>/sidecar_data/<plugin>/<sidecar>/data.
    const root = resolve(dataDir);
    for (let dir = root; dir !== dirname(dir); dir = dirname(dir)) {
      if (basename(dir) === 'sidecar_data') return [join(dirname(dir), 'conversations')];
    }
    return [join(root, 'conversations')]; // An explicitly supplied app data root.
  }
  return ['antigravity', 'antigravity-ide', 'antigravity-cli'].map(product =>
    join(homedir(), '.gemini', product, 'conversations'));
}
const conversationDirs = conversationDirectories(process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR);

const NO_QUOTA = { quotaGroups: [], cloudPaygo: false };
let cachedQuota = null;
let lastQuotaFetchMs = 0;
const QUOTA_TTL_MS = 10000;
let quotaPromise = null;

async function fetchQuota() {
  const now = Date.now();
  if (cachedQuota && now - lastQuotaFetchMs < QUOTA_TTL_MS) {
    return cachedQuota;
  }
  if (quotaPromise) return quotaPromise;
  quotaPromise = loadQuota();
  try { return await quotaPromise; }
  finally { quotaPromise = null; }
}

async function loadQuota() {
  const lsAddr = process.env.ANTIGRAVITY_LS_ADDRESS;
  const csrf = process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (!lsAddr || !csrf) return cachedQuota || NO_QUOTA;
  const request = method => fetch(`http://${lsAddr}/exa.language_server_pb.LanguageServerService/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': csrf },
    body: '{}',
    signal: AbortSignal.timeout(3000),
  });
  try {
    const res = await request('RetrieveUserQuotaSummary');
    if (!res.ok) return cachedQuota || NO_QUOTA;
    const data = await res.json();
    const groups = data?.response?.groups ?? data?.groups;
    const quotaGroups = Array.isArray(groups) ? groups : [];
    let cloudPaygo = false;
    if (quotaGroups.length === 0) {
      // A missing summary alone is not a billing-mode signal. The local user
      // status identifies Cloud pay-as-you-go separately from subscriptions.
      cloudPaygo = cachedQuota?.cloudPaygo ?? false;
      try {
        const status = await request('GetUserStatus');
        if (status.ok) cloudPaygo = (await status.json())?.userStatus?.userTier?.id === 'agy-business-paygo-tier';
      } catch {} // Optional detection must not restart the sidecar.
    }
    cachedQuota = { quotaGroups, cloudPaygo };
    lastQuotaFetchMs = Date.now();
    return cachedQuota;
  } catch {
    return cachedQuota || NO_QUOTA;
  }
}

function readVarint(buf, offset) {
  let val = 0n;
  let shift = 0n;
  let i = offset;
  while (i < buf.length && i - offset < 10) {
    const b = buf[i++];
    if (i - offset === 10 && b > 1) throw new RangeError('Invalid 64-bit protobuf varint');
    val |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return [Number(val), i];
    }
    shift += 7n;
  }
  throw new RangeError('Truncated protobuf varint');
}

function parsePbMap(buf) {
  const fields = new Map();
  let i = 0;
  while (i < buf.length) {
    try {
      const [tag, nextI] = readVarint(buf, i);
      i = nextI;
      const fn = tag >>> 3;
      const wt = tag & 7;
      if (fn === 0) break;
      if (!fields.has(fn)) fields.set(fn, []);
      if (wt === 0) {
        const [val, nI] = readVarint(buf, i);
        i = nI;
        fields.get(fn).push(val);
      } else if (wt === 2) {
        const [len, nI] = readVarint(buf, i);
        i = nI;
        if (len < 0 || i + len > buf.length) break;
        fields.get(fn).push(buf.subarray(i, i + len));
        i += len;
      } else if (wt === 5) {
        fields.get(fn).push(buf.subarray(i, i + 4));
        i += 4;
      } else if (wt === 1) {
        fields.get(fn).push(buf.subarray(i, i + 8));
        i += 8;
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return fields;
}

function recordedTokenUsage(fields, confirmedZero = false) {
  const reported = confirmedZero || [2, 3, 5, 9, 10].some(key => fields.has(key));
  const value = key => fields.get(key)?.[0] || 0;
  const splitMatches = value(3) === value(9) + value(10);
  return {
    read: reported ? value(2) + value(5) : null,
    cachedRead: reported ? value(5) : null,
    uncachedRead: reported ? value(2) : null,
    write: reported && splitMatches ? value(10) : null,
    thinking: reported && splitMatches ? value(9) : null,
  };
}

function parseGenRow(idx, data, includeTurnMetrics = true) {
  if (!data || !Buffer.isBuffer(data)) data = Buffer.from(data || []);
  const top = parsePbMap(data);
  if (!top.has(1)) return null;
  const stepIndices = [];
  for (const value of top.get(2) || []) {
    if (typeof value === 'number') stepIndices.push(value);
    else for (let offset = 0; offset < value.length;) {
      const [idx, next] = readVarint(value, offset);
      stepIndices.push(idx);
      offset = next;
    }
  }
  const m1 = parsePbMap(top.get(1)[0]);
  const usageBuf = m1.has(4) ? m1.get(4)[0] : Buffer.alloc(0);
  const usage = parsePbMap(usageBuf);

  const uncachedIn = usage.has(2) ? usage.get(2)[0] : 0;
  const cachedIn = usage.has(5) ? usage.get(5)[0] : 0;
  const thinkTokens = usage.has(9) ? usage.get(9)[0] : 0;
  const outTokens = usage.has(10) ? usage.get(10)[0] : 0;
  const contextTokens = uncachedIn + cachedIn;
  const duration = field => {
    if (!m1.has(field)) return null;
    const fields = parsePbMap(m1.get(field)[0]);
    return (fields.get(1)?.[0] || 0) + (fields.get(2)?.[0] || 0) / 1e9;
  };
  const ttft = duration(11);
  const streaming = duration(12);
  // Verified against the installed ChatModelMetadata/RetryInfo descriptors and
  // 11 real RPC retry errors: ChatModelMetadata.retry_infos=17, RetryInfo.error=3.
  // Read the FINAL retry only; an earlier failed attempt must not survive success.
  const lastRetry = m1.get(17)?.at(-1);
  const retryError = lastRetry ? parsePbMap(lastRetry).get(3)?.[0] : null;
  const requestError = classifyRequestError(Buffer.isBuffer(retryError) ? retryError.toString('utf8') : '');
  // Proto usage.3 is TOTAL output; usage.9 and .10 are thinking and reply.
  // Missing usage/preflight rows must not become a fake zero-token result.
  const hasOutput = m1.has(4) && (usage.has(3) || (ttft !== null && streaming !== null));
  let attempts = [];
  let missingAttempts = 0;
  let pendingAttempt = false;
  if (includeTurnMetrics) {
    const retries = m1.get(17) || [];
    const count = m1.get(14)?.[0];
    const retryCount = Number.isInteger(count) && count >= 0 && count <= 0x7fffffff ? count : 0;
    const hasAttempt = retries.length > 0 || hasOutput || ttft !== null || streaming !== null || top.has(5) || retryCount > 0;
    attempts = retries.map((value, index) => {
      const info = parsePbMap(value);
      const counters = parsePbMap(info.get(2)?.[0] || Buffer.alloc(0));
      const finalSuccess = index === retries.length - 1 && !info.get(3)?.[0]?.length && hasOutput;
      const reported = [2, 3, 5, 9, 10].some(key => counters.has(key));
      return { usage: recordedTokenUsage(finalSuccess && !reported ? usage : counters, finalSuccess) };
    });
    if (hasAttempt && attempts.length === 0) attempts.push({ usage: recordedTokenUsage(usage, hasOutput) });
    if (hasAttempt) missingAttempts = Math.max(0, retryCount + 1 - attempts.length);
    pendingAttempt = !hasAttempt && stepIndices.length > 0;
  }

  let maxContextTokens = 0;
  if (m1.has(9)) {
    const m9 = parsePbMap(m1.get(9)[0]);
    if (m9.has(10)) {
      const m10 = parsePbMap(m9.get(10)[0]);
      if (m10.has(4)) {
        maxContextTokens = m10.get(4)[0];
      }
    }
  }

  let lastStepIndex = -1;
  if (m1.has(20)) {
    for (const kvBuf of m1.get(20)) {
      const kv = parsePbMap(kvBuf);
      const key = kv.has(1) ? kv.get(1)[0].toString('utf8') : '';
      if (key === 'last_step_index' && kv.has(2)) {
        const n = Number(kv.get(2)[0].toString('utf8'));
        if (Number.isFinite(n)) lastStepIndex = n;
        break;
      }
    }
  }

  return {
    turn: idx,
    uncachedIn,
    cachedIn,
    contextTokens,
    outTokens,
    thinkTokens,
    maxContextTokens,
    lastStepIndex,
    stepIndices,
    requestError,
    attempts,
    missingAttempts,
    pendingAttempt,
    modelDisplayName: Buffer.isBuffer(m1.get(21)?.[0]) ? m1.get(21)[0].toString('utf8').trim() : '',
    generation: {
      requestIndex: idx, ttft, streaming,
      output: hasOutput ? usage.get(3)?.[0] || 0 : null,
      reply: hasOutput ? outTokens : null,
      thinking: hasOutput ? thinkTokens : null,
    },
  };
}

let lastDeckConvId = null; // '' when on New Conversation page, or uuid when on /c/<uuid>

function resolveConversationDb(id, allowLatest) {
  if (id) {
    if (typeof id !== 'string' || !/^[0-9a-zA-Z_-]+$/.test(id)) return null;
    for (const dir of conversationDirs) {
      const path = join(dir, `${id}.db`);
      if (statSync(path, { throwIfNoEntry: false })?.isFile()) return path;
    }
    return null;
  }
  // Before a composer selects a chat, the sidebar may follow the newest DB
  // in one product only. Check at read time: a fresh profile may not exist yet.
  if (!allowLatest) return null;
  const dir = conversationDirs.find(path => statSync(path, { throwIfNoEntry: false })?.isDirectory());
  if (!dir) return null;
  let latest = null, newest = -Infinity;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.db')) continue;
    const path = join(dir, file);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (stat?.isFile() && stat.mtimeMs > newest) { latest = path; newest = stat.mtimeMs; }
  }
  return latest;
}

async function makeEmptyContextResult(health = null) {
  return {
    health,
    uiVersion: PANEL_VERSION,
    turnSpeed: null,
    turnQueue: null,
    turnMetrics: null,
    requestError: classifyRequestError(),
    generation: summarizeGeneration(),
    prefs: settingsStore.read(),
    cachedIn: 0,
    uncachedIn: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    lastStepEpochMs: 0,
    turn0Tokens: 0,
    totalOutputTokens: 0,
    totalThinkingTokens: 0,
    ...await fetchQuota(),
  };
}

const ACTIVE_CONV_TTL_MS = 60_000;
const recentActiveConversations = new Map();
function touchActiveConversation(id) {
  if (typeof id === 'string' && /^[0-9a-zA-Z_-]+$/.test(id)) {
    const now = Date.now();
    recentActiveConversations.set(id, now);
    if (recentActiveConversations.size > 16) {
      const cutoff = now - ACTIVE_CONV_TTL_MS;
      for (const [entryId, seenAt] of recentActiveConversations) {
        if (seenAt < cutoff) recentActiveConversations.delete(entryId);
      }
    }
  }
}
function getActiveConversationIds() {
  const cutoff = Date.now() - ACTIVE_CONV_TTL_MS;
  for (const [id, seenAt] of recentActiveConversations) {
    if (seenAt < cutoff) recentActiveConversations.delete(id);
  }
  const active = new Set(recentActiveConversations.keys());
  if (lastDeckConvId) active.add(lastDeckConvId);
  return [...active];
}

async function inspectConversation(convId, exact = false, subagentOnly = false) {
  if (exact && !subagentOnly) lastDeckConvId = convId || '';
  if (subagentOnly && !convId) return null;
  return readSelectedConversation(subagentOnly ? convId : lastDeckConvId ?? convId,
    !subagentOnly && lastDeckConvId === null, subagentOnly);
}

async function readSelectedConversation(convId, allowLatest, subagentOnly = false) {
  touchActiveConversation(convId);
  const dbPath = resolveConversationDb(convId, allowLatest);
  if (subagentOnly && !dbPath) return null;
  const prefs = settingsStore.read();
  if (!dbPath) {
    const cloudSnapshot = cloudTelemetryStore.read(convId, prefs.showTurnMetrics);
    if (cloudSnapshot) {
      return {
        health: null,
        uiVersion: PANEL_VERSION,
        ...cloudSnapshot,
        prefs,
        ...await fetchQuota(),
      };
    }
    return await makeEmptyContextResult(conversationDirs.some(dir => statSync(dir, { throwIfNoEntry: false })?.isDirectory()) ? null : { code: 'S3' });
  }
  touchActiveConversation(basename(dbPath, '.db'));

  const snapshot = conversationCache.read(dbPath, prefs.showTurnMetrics);
  if (subagentOnly && !snapshot?.subagent) return null;
  const health = conversationCache.health(dbPath);
  if (!snapshot) return await makeEmptyContextResult(health);
  return {
    health,
    uiVersion: PANEL_VERSION,
    ...snapshot,
    prefs,
    ...(subagentOnly ? NO_QUOTA : await fetchQuota()),
  };
}

const conversationCache = createSqliteSnapshotCache(readConversationSnapshot);

function visibleLocalRequestError(request, steps) {
  const error = request?.requestError ?? classifyRequestError();
  if (error.kind === 'none' || !request.stepIndices.length) return error;
  // Steps can show the next response streaming before its gen_metadata row is saved.
  const lastOutputIndex = request.stepIndices.reduce((last, idx) => Math.max(last, idx), -1);
  const lastOutput = steps.find(step => step.idx === lastOutputIndex);
  if (!lastOutput) return error;
  const failedAt = lastOutput.recordedCompletedAtMs || lastOutput.terminalAtMs;
  const resumed = steps.some(step => step.idx > lastOutputIndex && step.step_type === 15 &&
    (step.status === 8 || (step.status === 3 && step.generatingAtMs > 0)) &&
    (!lastOutput.executionId || step.executionId === lastOutput.executionId) &&
    (!failedAt || step.createdAtMs >= failedAt));
  return resumed ? classifyRequestError() : error;
}

function readConversationSnapshot(dbPath, includeTurnMetrics = true) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let rawRows = [];
  let cpRows = [];
  let lastStepEpochMs = 0;
  let userStepIndex = null;
  let turnSteps = [];
  let metricsUserStepIndex = null;
  let executors = [];
  let subagent = false;
  try {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='trajectory_metadata_blob'").get()) {
      const blob = db.prepare("SELECT data FROM trajectory_metadata_blob WHERE id='main'").get()?.data;
      const meta = parsePbMap(Buffer.from(blob || []));
      // CortexTrajectoryMetadata.parent_conversation_id=5, subagent_spec=8.
      subagent = !!(meta.get(5)?.[0]?.length && meta.get(8)?.[0]?.length);
    }
    rawRows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
    cpRows = db.prepare('SELECT idx FROM steps WHERE step_type = 23 ORDER BY idx DESC').all();
    // A queued user input is not a new running turn until AGY consumes it.
    userStepIndex = db.prepare('SELECT idx FROM steps WHERE step_type = 14 AND status != 11 ORDER BY idx DESC LIMIT 1').get()?.idx ?? null;
    if (includeTurnMetrics) metricsUserStepIndex = db.prepare('SELECT idx FROM steps WHERE step_type = 14 ORDER BY idx DESC LIMIT 1').get()?.idx ?? null;
    const firstTurnStep = subagent ? 0 : userStepIndex ?? metricsUserStepIndex;
    if (firstTurnStep !== null) {
      turnSteps = db.prepare('SELECT idx, step_type, status, metadata FROM steps WHERE idx >= ? ORDER BY idx').all(firstTurnStep).map(step => {
        const fields = parsePbMap(Buffer.from(step.metadata || []));
        const stamp = fields.get(7)?.[0] || fields.get(8)?.[0];
        const time = stamp ? parsePbMap(stamp) : new Map();
        const epoch = value => { const parts = parsePbMap(value || Buffer.alloc(0)); return parts.has(1) ? parts.get(1)[0] * 1000 + (parts.get(2)?.[0] || 0) / 1e6 : null; };
        const transitions = (parsePbMap(fields.get(26)?.[0] || Buffer.alloc(0)).get(1) || []).map(value => parsePbMap(value));
        const generating = transitions.filter(item => item.get(1)?.[0] === 8).map(item => epoch(item.get(2)?.[0])).filter(value => value !== null);
        const terminal = transitions.filter(item => [3, 6, 7, 12].includes(item.get(1)?.[0])).map(item => epoch(item.get(2)?.[0])).filter(value => value !== null);
        let inputStartedAtMs = null;
        if (step.step_type === 14) {
          for (const item of transitions) {
            const status = item.get(1)?.[0];
            // Step creation may precede consumption by the entire time spent queued.
            if (status === 11) inputStartedAtMs = null;
            else if (status === 2 || status === 3) inputStartedAtMs ??= epoch(item.get(2)?.[0]);
          }
        }
        return {
          idx: step.idx, step_type: step.step_type, status: step.status,
          completedAtMs: (time.get(1)?.[0] || 0) * 1000 + (time.get(2)?.[0] || 0) / 1e6,
          recordedCompletedAtMs: epoch(fields.get(8)?.[0]),
          createdAtMs: epoch(fields.get(1)?.[0]),
          inputStartedAtMs,
          generatingAtMs: generating.length ? Math.min(...generating) : null,
          terminalAtMs: terminal.length ? Math.max(...terminal) : null,
          executionId: fields.get(12)?.[0]?.toString('utf8') || '',
        };
      });
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='executor_metadata'").get()) {
        executors = db.prepare('SELECT data FROM executor_metadata ORDER BY idx').all().map(row => {
          const fields = parsePbMap(Buffer.from(row.data || []));
          return { reason: fields.get(1)?.[0] || 0, lastStepIndex: fields.size ? (fields.get(3)?.[0] ?? 0) : -1, executionId: fields.get(9)?.[0]?.toString('utf8') || '' };
        });
      }
    }
    const stepRow = db.prepare('SELECT metadata FROM steps ORDER BY idx DESC LIMIT 1').get();
    if (stepRow?.metadata) {
      const sm = parsePbMap(Buffer.from(stepRow.metadata));
      if (sm.has(1)) {
        const tsMap = parsePbMap(sm.get(1)[0]);
        if (tsMap.has(1)) {
          lastStepEpochMs = Number(tsMap.get(1)[0]) * 1000;
        }
      }
    }
  } finally {
    db.close();
  }
  if (!lastStepEpochMs) {
    try {
      lastStepEpochMs = Math.max(statSync(dbPath).mtimeMs, existsSync(dbPath + '-wal') ? statSync(dbPath + '-wal').mtimeMs : 0);
    } catch {}
  }

  const turns = [];
  let maxContextTokens = 0;
  let latestGeneration = null;
  let latestTurnRequest = null;
  const parsedRequests = [];

  for (const row of rawRows) {
    const parsed = parseGenRow(row.idx, row.data, includeTurnMetrics);
    if (!parsed) continue;
    parsedRequests.push(parsed);
    latestGeneration = parsed.generation;
    // Known earlier requests may finish late; they cannot replace the current turn's error.
    const earlierRequest = userStepIndex !== null && parsed.lastStepIndex >= 0 && parsed.lastStepIndex < userStepIndex;
    if (!earlierRequest) latestTurnRequest = parsed;
    if (parsed.maxContextTokens > 0) {
      maxContextTokens = parsed.maxContextTokens;
    }
    if (parsed.contextTokens === 0) continue;
    turns.push(parsed);
  }

  // Start accumulating from the latest compaction checkpoint so pre-compaction
  // output/thinking tokens do not inflate the active context breakdown.
  let epochStart = 0;
  if (turns.length > 0) {
    for (const cp of cpRows) {
      const postIdx = turns.findIndex((t) => t.lastStepIndex >= cp.idx);
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

  const latest = turns[turns.length - 1] || {
    uncachedIn: 0,
    cachedIn: 0,
    contextTokens: 0,
    outTokens: 0,
    thinkTokens: 0,
  };
  if (turns.length === 0 || latest.contextTokens === 0) {
    lastStepEpochMs = 0;
  }

  // latest.contextTokens is the prompt sent *before* latest generated its output/thinking,
  // so only accumulate prior turns within the active compaction epoch.
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

  let turnQueue, requestError, turnSpeed = null, childTurnMetrics = null;
  if (subagent) {
    // Parent messages and task notifications can start fresh executions without
    // a USER_INPUT step. Never roll previous executions into this one's alerts.
    const latestStep = turnSteps.findLast(step => ![17, 23].includes(step.step_type));
    const executionId = latestStep?.executionId;
    const steps = executionId ? turnSteps.filter(step => step.executionId === executionId) : [];
    const executionByStep = new Map(turnSteps.map(step => [step.idx, step.executionId]));
    const requests = executionId ? parsedRequests.filter(request => {
      // The first request can still use the preceding execution's last step
      // as input. Its persisted output steps are stronger attribution.
      if (!request.stepIndices.length) return executionByStep.get(request.lastStepIndex) === executionId;
      const linked = request.stepIndices.map(idx => executionByStep.get(idx)).filter(Boolean);
      return linked.length > 0 && linked.every(id => id === executionId);
    }) : [];
    const childExecutors = executors.filter(item => item.executionId === executionId);
    turnQueue = summarizeTurnQueue(requests, steps, steps[0]?.idx, childExecutors, true);
    requestError = visibleLocalRequestError(requests.at(-1), steps);
    const execution = summarizeSubagentExecution(steps, childExecutors);
    if (execution) {
      let associationIncomplete = false;
      // Turn totals and speed both require unambiguous execution attribution.
      const executionRequests = parsedRequests.filter(request => {
        const fromCurrentInput = executionByStep.get(request.lastStepIndex) === executionId;
        if (!request.stepIndices.length) return fromCurrentInput;
        const linked = request.stepIndices.map(idx => executionByStep.get(idx));
        if (linked.every(id => id === executionId)) return true;
        if (includeTurnMetrics && (linked.includes(executionId) || (linked.includes(undefined) && fromCurrentInput)
          || (linked.every(id => !id) && request.stepIndices.some(idx => idx >= steps[0].idx)))) associationIncomplete = true;
        return false;
      });
      turnSpeed = summarizeSubagentTurnSpeed(executionRequests, steps, execution);
      if (includeTurnMetrics) childTurnMetrics = summarizeSubagentTurnMetrics(executionRequests, execution, associationIncomplete);
    }
  } else {
    turnQueue = summarizeTurnQueue(parsedRequests, turnSteps, userStepIndex, executors);
    turnSpeed = summarizeTurnSpeed(parsedRequests, turnSteps, userStepIndex);
    requestError = visibleLocalRequestError(latestTurnRequest, turnSteps);
  }

  return {
    ...(subagent && { subagent: { model: parsedRequests.at(-1)?.modelDisplayName || '' } }),
    turnSpeed,
    turnQueue,
    turnMetrics: subagent ? childTurnMetrics : includeTurnMetrics
      ? summarizeTurnMetrics(parsedRequests, turnSteps.map(step => ({ ...step, completedAtMs: step.recordedCompletedAtMs })), metricsUserStepIndex, executors) : null,
    requestError,
    generation: summarizeGeneration(latestGeneration),
    cachedIn: latest.cachedIn,
    uncachedIn: latest.uncachedIn,
    contextTokens: latest.contextTokens,
    maxContextTokens: subagent ? latest.maxContextTokens || 0 : maxContextTokens,
    lastStepEpochMs,
    turn0Tokens,
    totalOutputTokens,
    totalThinkingTokens,
  };
}

const MIN_USAGE_EPOCH_S = 1577836800; // 2020-01-01T00:00:00Z
const isValidEpochSec = value => Number.isSafeInteger(value) && value >= MIN_USAGE_EPOCH_S && value < 4e9;

// One model request for the usage history: when it started, which model answered and what it
// consumed. Field numbers follow CortexStepGeneratorMetadata.chat_model (1) -> ChatModelMetadata
// .usage (4) and optional .chat_start_metadata (9).created_at (4); a step's own created_at
// is CortexStepMetadata field 1.
function parseUsageRow(data, stepMetadata) {
  // Views, not copies: a scan walks every stored request.
  const bytes = value => (value instanceof Uint8Array ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : Buffer.alloc(0));
  const top = parsePbMap(bytes(data));
  const chat = parsePbMap(bytes(top.get(1)?.[0]));
  const usage = parsePbMap(bytes(chat.get(4)?.[0]));
  const count = field => (Number.isSafeInteger(usage.get(field)?.[0]) ? usage.get(field)[0] : 0);
  const text = field => bytes(usage.get(field)?.[0]).toString('utf8');
  // input_tokens (2) is the uncached part; cache reads (5) and writes (4) are reported beside it.
  const tokens = { uncached: count(2), cacheRead: count(5), cacheWrite: count(4), output: count(3) };
  // Preflight rows and failed attempts report no consumption.
  if (!Object.values(tokens).some(Boolean)) return null;
  const seconds = stamp => parsePbMap(bytes(stamp)).get(1)?.[0];
  let startedAt = seconds(parsePbMap(bytes(chat.get(9)?.[0])).get(4)?.[0]);
  if (!isValidEpochSec(startedAt)) {
    // Most rows carry no chat_start_metadata.created_at; date them by the first available step.
    startedAt = null;
    for (const entry of top.get(2) || []) {
      if (typeof entry === 'number') {
        const candidate = seconds(parsePbMap(bytes(stepMetadata(entry))).get(1)?.[0]);
        if (isValidEpochSec(candidate)) { startedAt = candidate; break; }
      } else if (entry?.length) {
        let offset = 0;
        while (offset < entry.length) {
          let stepIndex;
          try {
            [stepIndex, offset] = readVarint(entry, offset);
          } catch { break; }
          const candidate = seconds(parsePbMap(bytes(stepMetadata(stepIndex))).get(1)?.[0]);
          if (isValidEpochSec(candidate)) { startedAt = candidate; break; }
        }
        if (startedAt !== null) break;
      }
    }
  }
  // response_id (11), else message_id (7), within api_provider (6).
  const responseId = text(11);
  const messageId = text(7);
  // model_display_name (21), else response_model (19): preserves legacy records without display names.
  const name = field => bytes(chat.get(field)?.[0]).toString('utf8').trim().slice(0, 80);
  return {
    at: isValidEpochSec(startedAt) ? startedAt * 1000 : null,
    id: responseId ? `r${count(6)}:${responseId}` : messageId ? `m${count(6)}:${messageId}` : '',
    model: name(21) || name(19),
    ...tokens,
  };
}

function readConversationUsage(dbPath, { immutable = true } = {}) {
  // Closed, idle conversations without a non-empty WAL are opened immutable so SQLite does not
  // leave stray -wal/-shm files beside them; active or recently modified ones use plain read-only.
  const hasActiveWal = (statSync(dbPath + '-wal', { throwIfNoEntry: false })?.size || 0) > 0;
  const useImmutable = immutable && !hasActiveWal;
  let location = dbPath;
  if (useImmutable) {
    location = pathToFileURL(dbPath);
    location.searchParams.set('immutable', '1');
  }
  const db = new DatabaseSync(location, { readOnly: true, timeout: 150 });
  try {
    if (!useImmutable) db.exec('PRAGMA busy_timeout = 150');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gen_metadata'").get()) return [];
    const hasSteps = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='steps'").get());
    let stepRow = null;
    const stepMetadata = hasSteps
      ? index => (stepRow ??= db.prepare('SELECT metadata FROM steps WHERE idx = ?')).get(index)?.metadata
      : () => undefined;
    return db.prepare('SELECT data FROM gen_metadata ORDER BY idx ASC').all()
      .map(row => parseUsageRow(row.data, stepMetadata))
      .filter(Boolean);
  } finally {
    db.close();
  }
}

const usageHistory = createUsageHistory({
  directories: conversationDirs,
  readRequests: readConversationUsage,
  getActiveIds: getActiveConversationIds,
});

// Conversations are scanned only while a setting shows their history.
async function inspectUsage(prefs = settingsStore.read(), activeConversationId = '') {
  if (prefs.showUsageActivity !== true && prefs.showModelUsage !== true) return { enabled: false };
  return { enabled: true, ...await usageHistory.read({ activeId: activeConversationId }) };
}

const PV_SVG = {
  db: '<svg class="pv-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>',
  clock: '<svg class="pv-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
  cal: '<svg class="pv-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  warn: '<svg class="pv-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><circle cx="12" cy="17" r=".8" fill="currentColor"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="2 6.5 4.8 9.2 10 3"/></svg>',
  ring: '<svg width="13" height="13" viewBox="0 0 18 18" style="transform:rotate(-90deg);flex-shrink:0"><circle cx="9" cy="9" r="6.5" fill="none" stroke="rgba(142,142,147,0.28)" stroke-width="2.4"/><circle cx="9" cy="9" r="6.5" fill="none" stroke="#4ea84e" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="40.84" stroke-dashoffset="6.1"/></svg>',
  // The real hit-rate ring, so the swatches cannot drift from what the panels draw.
  hitRing: presentation.makeCacheRingSvg(.78, 'currentColor', 13),
  // The compact status bar's preview: its real cache ring, and its two icons in the preview's size.
  tbCache: presentation.makeTelemetryCacheRingSvg(.94, 'fresh'),
  tbTimer: '<svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.68"><line x1="5.4" y1="1.3" x2="8.6" y2="1.3"/><circle cx="7" cy="7.8" r="4.6"/><polyline points="7 5.4 7 7.8 8.7 8.9"/></svg>',
  tbZap: '<svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:light-dark(#16a34a, #4ea84e);opacity:.9"><path d="M7.8 1.5L3.2 7.8h3.5L6.2 12.5 10.8 6.2H7.3l.5-4.7z"/></svg>',
};

const PV_CARD_PREVIEW = {
  highlightActiveModel: `<div class="pv-active-model">
    <div class="pv-qm-row pv-qm-active"><span class="pv-qm-name">Gemini<span class="pv-qm-dot"></span></span><span class="pv-qm-bar"><span style="width:85%"></span></span><span class="pv-qm-pct">85%</span></div>
    <div class="pv-qm-row pv-qm-other"><span class="pv-qm-name">Claude</span><span class="pv-qm-bar"><span style="width:60%"></span></span><span class="pv-qm-pct">60%</span></div>
  </div>`,
  hideUnavailableQuota: `<div class="pv-hide-quota">
    <span class="pv-pill pv-hq-pill"><span class="pv-hq-miss">${PV_SVG.clock}<span>--%</span></span><span class="pv-hq-keep">${PV_SVG.cal}<span>85%</span></span></span>
    <span class="pv-pill pv-hq-pill"><span class="pv-hq-zero">${PV_SVG.clock}<span>0%</span></span><span class="pv-hq-keep">${PV_SVG.cal}<span>85%</span></span></span>
  </div>`,
  showQuotaDividers: `<div class="pv-quota-dividers">
    <div class="pv-qm-row"><span class="pv-qm-name">Gemini</span><span class="pv-qm-bar"><span style="width:85%"></span></span><span class="pv-qm-pct">85%</span></div>
    <div class="pv-qm-row"><span class="pv-qm-name">Claude</span><span class="pv-qm-bar"><span style="width:60%"></span></span><span class="pv-qm-pct">60%</span></div>
  </div>`,
  showCacheWarnings: `<div class="pv-cache-warn">
    <span class="pv-pill pv-ca-1">${PV_SVG.db}<span data-cache-pv="fresh">&lt;3m</span></span>
    <span class="pv-pill pv-ca-2">${PV_SVG.db}<span data-cache-pv="warn">3m+</span></span>
    <span class="pv-pill pv-ca-3">${PV_SVG.db}<span data-cache-pv="cold">4m+</span></span>
  </div>`,
  showContextWarnings: `<div class="pv-ctx-warn">
    <span class="pv-pill pv-cw-1">${PV_SVG.db}<span class="pv-cw-val">40%</span></span>
    <span class="pv-pill pv-cw-2">${PV_SVG.db}<span class="pv-cw-val">75%</span></span>
    <span class="pv-pill pv-cw-3">${PV_SVG.db}<span class="pv-cw-val">90%</span></span>
  </div>`,
  highlightContextHover: `<div class="pv-hover-link">
    <span class="pv-hl-track"><i class="pv-hl-rest" style="width:8%;background:#d4940a"></i><i style="width:28%;background:#388bfd"></i><i class="pv-hl-rest" style="width:5%;background:#00b386"></i><i class="pv-hl-rest" style="width:9%;background:#e86a24"></i></span>
    <span class="pv-hl-names"><span class="pv-hl-rest" data-i18n="turn0"></span><span data-i18n="read"></span><span class="pv-hl-rest" data-i18n="think"></span><span class="pv-hl-rest" data-i18n="write"></span></span>
  </div>`,
  showRequestErrors: `<div class="pv-err-strip">
    <span class="pv-pill">${PV_SVG.db}<span>42%</span></span>
    <span class="pv-pill">${PV_SVG.clock}<span>85%</span></span>
    <span class="pv-pill pv-pill-err">${PV_SVG.warn}<span>429</span></span>
  </div>`,
  showQueueWarnings: `<div class="pv-queue-strip">
    <span class="pv-pill">${PV_SVG.db}<span>42%</span></span>
    <span class="pv-pill">${PV_SVG.clock}<span>85%</span></span>
    <span class="pv-pill pv-pill-queue">${PV_SVG.clock}<span data-queue-pv>×2 30s</span></span>
  </div>`,
  showRequestMetrics: `<div class="pv-req-line">
    <div class="pv-pill pv-req-pill"><span>TTFT 1.0s–3.0s</span><span><b>100.0 tok/s</b></span></div>
  </div>`,
  compactTelemetryBar: `<div class="pv-tbar-card">
    <div class="pv-tbar-body"><span class="pv-tbar-track"><i style="width:18%;background:#d4940a"></i><i style="width:24%;background:#388bfd"></i><i style="width:8%;background:#00b386"></i><i style="width:12%;background:#e86a24"></i></span></div>
    <div class="pv-tbar-dock">
      <span class="pv-tbar-cell pv-tbar-cache">${PV_SVG.tbCache}<b>94%</b></span>
      <span class="pv-tbar-cell">${PV_SVG.tbTimer}<span>1.0s</span></span>
      <span class="pv-tbar-cell">${PV_SVG.tbZap}<b>100<i class="pv-tbar-u"> tok/s</i></b></span>
    </div>
  </div>`,
  showUsageActivity: `<div class="pv-usage-heat">${[0, 1, 0, 2, 3, 1, 0, 4, 2, 1, 3, 0, 1, 2, 4, 3, 1, 2].map(level => `<i class="usage-cell" data-level="${level}"></i>`).join('')}</div>`,
  showModelUsage: `<div class="pv-usage-bars">${[[5, 3], [8, 2], [4, 6], [9, 5], [6, 2], [10, 7], [7, 4], [3, 2]].map(([lower, upper]) => `<span><i style="height:${upper}px;background:#e86a24"></i><i style="height:${lower}px;background:#388bfd"></i></span>`).join('')}</div>`,
};

const renderCheckCard = ({ id, helpId = id, key, tip = '', checked = false, preview = PV_CARD_PREVIEW[key] || '' }) => `
  <div class="setting-card${tip ? ' metric-setting' : ''}" data-setting-card="${key}" data-checked="${checked}">
    <div class="setting-head">
      <label class="setting-check">
        <input id="${id}" name="${key}" type="checkbox"${checked ? ' checked' : ''}${tip ? ` aria-describedby="help-${helpId}"` : ''} />
        <span data-i18n="${key}"></span>
      </label>${tip ? `<span class="setting-help-dot" aria-hidden="true">?</span>` : ''}
    </div>
    ${preview ? `<div class="setting-preview" aria-hidden="true">${preview}</div>` : ''}
    ${tip ? `<div class="metric-help" id="help-${helpId}" role="tooltip" data-i18n="${tip}"></div>` : ''}
  </div>`;

const renderPickCard = (key, items, { helpId = key, tip = '' } = {}) => `
  <div class="setting-card${tip ? ' metric-setting' : ''}" data-setting-card="${key}">
    <div class="setting-head"><span class="setting-label" data-i18n="${key}"></span>${tip ? `<span class="setting-help-dot" aria-hidden="true">?</span>` : ''}
      <div class="pv-pick-inline">
        ${items.map(([val, labelKey, iconHtml]) => `<button type="button" class="pv-swatch pv-swatch-icon" data-pick-setting="${key}" data-pick-value="${val}" data-pick-label="${labelKey}"${tip ? ` aria-describedby="help-${helpId}"` : ''}>${iconHtml}</button>`).join('')}
      </div>
    </div>
    ${tip ? `<div class="metric-help" id="help-${helpId}" role="tooltip" data-i18n="${tip}"></div>` : ''}
  </div>`;

const FX_ICON_SVG = {
  prism: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.2 8H4.6"/><path d="M7.6 4.4L10.6 8L7.6 11.6L4.6 8Z"/><path d="M11.6 4.8H14.8"/><path d="M11.9 8H14.8"/><path d="M11.6 11.2H14.8"/></svg>',
  gravity: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.05" fill="currentColor" stroke="none"/><path d="M3.4 4.8A5.6 5.6 0 0 1 11.2 3.4"/><circle cx="11.6" cy="3.8" r="1.15" fill="currentColor" stroke="none"/><path d="M12.6 11.2A5.6 5.6 0 0 1 4.8 12.6"/><circle cx="4.4" cy="12.2" r="1.15" fill="currentColor" stroke="none"/></svg>',
  semicircle: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="8" cy="12.2" r="1.8" fill="currentColor" stroke="none"/><circle cx="2.2" cy="8.7" r="1.12"/><circle cx="4.5" cy="5.8" r="1.12"/><circle cx="8" cy="4.7" r="1.12"/><circle cx="11.5" cy="5.8" r="1.12"/><circle cx="13.8" cy="8.7" r="1.12"/></svg>',
  none: '',
};

const renderFxPickCard = (key, items, { sub = false, grid = false, id = '', hidden = false } = {}) => `
  <div class="setting-card${sub ? ' is-sub' : ''}${grid ? ' is-grid' : ''}"${id ? ` id="${id}"` : ''} data-setting-card="${key}"${hidden ? ' hidden' : ''}>
    <div class="setting-head"><span class="setting-label" data-i18n="${key}"></span>
      <div class="pv-pick-inline fx-pick-wrap">
        ${items.map(([val, labelKey, iconHtml = '']) => `<button type="button" class="pv-swatch fx-swatch" data-pick-setting="${key}" data-pick-value="${val}" data-pick-label="${labelKey}">${iconHtml}<span data-i18n="${labelKey}"></span></button>`).join('')}
      </div>
    </div>
  </div>`;

// Segmented option control styled like the settings switches.
// Icon options are labelled for screen readers via data-pick-label.
const renderSeg = (key, options) => `<div class="setting-seg" role="group">${options.map(([value, labelKey, icon]) => `<button type="button" class="setting-seg-opt" data-pick-setting="${key}" data-pick-value="${value}" data-pick-label="${labelKey}">${icon}</button>`).join('')}</div>`;
const LAYOUT_OPTIONS = [
  ['columns', 'layoutColumns', '<span class="seg-ico seg-ico-cols" aria-hidden="true"><i></i><i></i><i></i></span>'],
  ['rows', 'layoutRows', '<span class="seg-ico seg-ico-rows" aria-hidden="true"><i></i><i></i><i></i></span>'],
];
const MARKER_OPTIONS = [
  ['square', 'markerSquare', '<span class="seg-ico seg-ico-marker" aria-hidden="true"></span>'],
  ['dot', 'markerDot', '<span class="seg-ico seg-ico-marker seg-ico-dot" aria-hidden="true"></span>'],
];
const BAR_POSITION_OPTIONS = [
  ['top', 'barTop', '<span data-i18n="barTop"></span>'],
  ['bottom', 'barBottom', '<span data-i18n="barBottom"></span>'],
];
// Column-field editor shown inside the context preview: one row per field
// (name / value / percent), visible rows first in the saved order, hidden rows
// struck through at the bottom. Shared with the page script via toString().
function renderFieldEditor(prefs, labels) {
  const items = [['turn0', '#d4940a', '14.6K', '3%'], ['read', '#388bfd', '120K', '23%'], ['think', '#00b386', '30.8K', '6%'], ['write', '#e86a24', '16.1K', '3%']];
  const keys = { label: 'columnLabel', value: 'columnValue', percent: 'columnPercent' };
  const names = { label: 'fieldName', value: 'fieldValue', percent: 'fieldPercent' };
  const order = String(prefs.columnOrder || 'label,value,percent').split(',');
  const on = field => prefs[keys[field]] === true;
  const sorted = [...order.filter(on), ...order.filter(field => !on(field))];
  return sorted.map(field => `<div class="pv-field-row" data-field="${field}" data-on="${on(field)}"${on(field) ? ' draggable="true"' : ''} title="${labels.fieldDragTip || ''}">`
    + `<span class="pv-field-grip" aria-hidden="true"></span>`
    + items.map(([key, color, value, pct]) => `<span class="pv-field-cell" style="--pv-c:${color}">${field === 'label' ? (labels[key] || key) : field === 'value' ? value : pct}</span>`).join('')
    + `<button type="button" class="pv-field-toggle" role="switch" aria-checked="${on(field)}" aria-label="${labels[names[field]] || field}" data-toggle-setting="${keys[field]}"></button></div>`).join('');
}
const PV_CONTEXT_ITEMS = [['turn0', '#d4940a', '14.6K', '3%'], ['read', '#388bfd', '120K', '23%'], ['think', '#00b386', '30.8K', '6%'], ['write', '#e86a24', '16.1K', '3%']];
const PV_TURN_ITEMS = [['elapsed', 'turnLabel', '42s'], ['requests', 'turnReqsLabel', '2'], ['thinking', 'turnThinking', '640'], ['write', 'turnWrite', '1.4K']];

const UI_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="referrer" content="no-referrer" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>agy-capsule</title>
  <script src="/preload.js"></script>
  <style>
    * { box-sizing: border-box; }
    html, body { scrollbar-width: none; }
    html::-webkit-scrollbar, body::-webkit-scrollbar { display: none; width: 0; height: 0; }
    body {
      margin: 0;
      padding: 0;
      font-family: "Source Han Sans CN", "思源黑体 CN", "Source Han Sans SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
      font-weight: 400;
      font-variation-settings: normal;
      font-variant-ligatures: normal;
      background: var(--background, #141414);
      color: var(--foreground, #ebebeb);
      font-size: 13.5px;
      line-height: 1.32;
      user-select: none;
      -webkit-font-smoothing: antialiased;
    }
    .panel {
      width: 100%;
      max-width: 1120px;
      margin: 0 auto;
      min-width: 0;
      padding: 4px 2px;
      container-type: inline-size;
      container-name: stats;
    }
    .stats-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
      min-width: 0;
    }
    .stats-context {
      min-width: 0;
    }
    .stats-quota {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: calc(var(--agy-section-gap, 6px) + 4px);
      align-items: start;
      min-width: 0;
    }
    .divider:has(+ #quota-root:empty) {
      display: none;
    }
    .cache-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      font-size: 13.5px;
      line-height: 1.35;
      padding-bottom: var(--agy-section-gap, 6px);
      margin-bottom: var(--agy-section-gap, 6px);
      border-bottom: 1px solid var(--border, rgba(142, 142, 147, 0.24));
    }
    .cache-left {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 500;
      color: var(--foreground, #ebebeb);
      color: color-mix(in srgb, var(--foreground, #ebebeb) 88%, transparent);
      white-space: nowrap;
    }
    .cache-left > .dot {
      width: 10px;
      height: 10px;
      flex-shrink: 0;
    }
    body[data-cache-indicator="ring"] .cache-left > .dot {
      width: 14px;
      height: 14px;
    }
    .cache-left > .dot:empty { display: none !important; }
    .cache-meter {
      flex: 1;
      min-width: 32px;
      height: 4px;
      border-radius: 999px;
      background: rgba(142, 142, 147, 0.24);
      overflow: hidden;
    }
    .cache-meter[hidden] { display: none; }
    .cache-meter > span {
      display: block;
      height: 100%;
      width: 0%;
      border-radius: inherit;
      transition: width 0.35s linear, background-color 0.25s ease;
    }
    .cache-pct {
      margin-left: 0;
      font-variant-numeric: tabular-nums;
      font-size: 13.5px;
      white-space: nowrap;
    }
    /* Optional hit-rate ring: next to the number, or in its place. */
    .cache-hit { display: inline-flex; align-items: center; }
    .cache-hit:empty,
    body[data-cache-hit-format="ring"] .cache-pct { display: none; }
    .cache-k {
      text-align: right;
      color: var(--muted-foreground, #8e8e93);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      font-size: 13.5px;
      font-weight: 400;
    }
    .cache-k:empty { display: none; }
    .summary-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      row-gap: 4px;
      margin-bottom: 6px;
    }
    .used-pct {
      font-size: 13.5px;
      font-weight: 400;
      color: var(--muted-foreground, #8e8e93);
    }
    .used-pct > #used-pct {
      font-weight: 500;
      color: var(--foreground, #ebebeb);
      color: color-mix(in srgb, var(--foreground, #ebebeb) 88%, transparent);
    }
    .used-fraction {
      margin-left: auto;
      white-space: nowrap;
      font-size: 13.5px;
      font-weight: 400;
      color: var(--muted-foreground, #8e8e93);
      font-variant-numeric: tabular-nums;
    }
    .progress-track {
      position: relative;
      width: 100%;
      height: 4px;
      background: rgba(142, 142, 147, 0.24);
      border-radius: 999px;
      display: flex;
      gap: 1.5px;
      overflow: hidden;
      margin-bottom: 8px;
    }
    .seg {
      height: 100%;
      border-radius: 999px;
      transition: width 0.25s ease;
    }
    .list, .turn-bar-list {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      align-items: start;
      gap: 6px;
    }
    .turn-bar-list {
      grid-template-columns: minmax(calc((100% - 18px) / 4), max-content) minmax(0, 1fr) calc((100% - 18px) / 4) calc((100% - 18px) / 4);
    }
    .item-row, .turn-bar-item {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      column-gap: 5px;
      row-gap: 2px;
      min-width: 0;
    }
    .item-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .item-label, .turn-bar-label, .turn-bar-short {
      color: var(--muted-foreground, #8e8e93);
      font-size: 13.5px;
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .turn-bar-item[data-turn-row="requests"] { container-type: inline-size; }
    .turn-bar-short { display: none; }
    @container (max-width: 39px) {
      .turn-bar-item[data-turn-row="requests"] .turn-bar-label { display: none; }
      .turn-bar-item[data-turn-row="requests"] .turn-bar-short { display: block; }
    }
    .item-row > .dot, .turn-bar-line {
      grid-row: 1 / span 2;
      align-self: stretch;
      width: 2.5px;
      margin: 2px 0;
      border-radius: 99px;
      flex-shrink: 0;
      transition: background-color 0.25s ease, opacity 0.25s ease;
    }
    .turn-bar-line {
      background: rgba(142, 142, 147, 0.42);
      background: color-mix(in srgb, var(--muted-foreground, #8e8e93) 55%, transparent);
    }
    .dot-cached { background: #2b7fff; }
    .dot-uncached { background: #f97316; }
    .dot-meta { background: rgba(142, 142, 147, 0.55); }
    .item-row > .dot { grid-row: 1; }
    .item-k, .item-pct, .turn-bar-val {
      grid-column: 2;
      color: var(--muted-foreground, #8e8e93);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      font-size: 13.5px;
      font-weight: 400;
      line-height: 1.25;
    }
    .divider {
      height: 1px;
      background: var(--border, rgba(142, 142, 147, 0.24));
      margin: 8px 0;
    }
    .quota-group {
      margin-bottom: 9px;
    }
    .quota-group:last-child {
      margin-bottom: 0;
    }
    .quota-group-title {
      overflow-wrap: anywhere;
      font-size: 13.5px;
      font-weight: 500;
      color: var(--foreground, #ebebeb);
      color: color-mix(in srgb, var(--foreground, #ebebeb) 88%, transparent);
      margin-bottom: 4px;
    }
    .quota-bucket {
      margin-bottom: 4px;
    }
    .quota-bucket:last-child {
      margin-bottom: 0;
    }
    .quota-line1 {
      display: grid;
      grid-template-columns: 54px minmax(58px, 1fr) minmax(46px, auto);
      align-items: center;
      column-gap: 8px;
      font-size: 13.5px;
      font-variant-numeric: tabular-nums;
    }
    .quota-label {
      color: var(--muted-foreground, #8e8e93);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .quota-mid {
      text-align: right;
      color: var(--muted-foreground, #8e8e93);
      white-space: nowrap;
    }
    .quota-right {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 6px;
      color: var(--muted-foreground, #8e8e93);
      white-space: nowrap;
    }
    .settings { display: flex; flex-direction: column; gap: 0; width: 100%; }
    .sidebar-content { padding: 12px 14px; }
    .version-panel { max-width: 1120px; margin: 0 auto 10px; font-size: 12.5px; color: var(--foreground, #ebebeb); container: version / inline-size; --version-link: color-mix(in srgb, #2b7fff 48%, var(--foreground, #ebebeb)); }
    .sidebar-nav:has(.sidebar-tabs:is([data-view="stats"], [data-view="fx"])) + .version-panel :is(.version-line, #version-status) { display: none; }
    .sidebar-nav:has(.sidebar-tabs:is([data-view="stats"], [data-view="fx"])) + .version-panel:not(:has(#version-notice:not([hidden]))) { display: none; }
    .version-line { display: flex; align-items: center; justify-content: space-between; gap: 5px; }
    #version-number { color: var(--muted-foreground, #a2a2a9); font-variant-numeric: tabular-nums; }
    .version-controls { display: flex; align-items: center; justify-content: flex-end; gap: 5px; }
    .version-controls > .pv-swatch { padding: 4px 7px; white-space: nowrap; font-size: inherit; }
    #version-notify { border-color: transparent; background: transparent; color: var(--muted-foreground, #a2a2a9); font-weight: 400; }
    #version-notify:hover:not(:disabled) { background: var(--secondary, #303034); }
    #version-notify::before {
      content: ""; width: 19px; height: 11px; border-radius: 10px; flex: none;
      background: radial-gradient(circle at var(--version-knob-x, 5.5px) 50%, var(--card, #222225) 3px, transparent 3.7px)
        var(--version-toggle-track, color-mix(in srgb, currentColor 46%, var(--card, #222225)));
    }
    #version-notify[data-active="true"] { --version-knob-x: 13.5px; --version-toggle-track: currentColor; }
    #version-check { color: inherit; }
    .version-panel button:disabled { opacity: .7; cursor: default; }
    .version-panel :is(button, a):focus-visible { outline: 2px solid #388bfd; outline-offset: 1px; }
    .version-feedback { margin: 0; line-height: 1.5; }
    .version-feedback:not(:empty) { margin-top: 5px; }
    #version-status[data-state="current"], .version-notice[data-state="updated"] { background: color-mix(in srgb, #22a574 13%, var(--card, #222225)); }
    #version-status[data-state="current"] { padding: 5px 8px; border-radius: 6px; }
    .version-notice { margin-top: 7px; padding: 8px; border-radius: 8px; border: 1px solid var(--border, #555); background: var(--card, #222225); }
    .version-notice[data-state="error"] { border-color: color-mix(in srgb, #ec854d 36%, var(--border, #555)); }
    .version-actions { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto auto; align-items: center; gap: 5px; min-height: 36px; }
    .version-icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; color: var(--version-link); background: color-mix(in srgb, #2b7fff 14%, var(--card, #222225)); }
    .version-icon svg, #version-dismiss svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; }
    .version-icon svg[data-icon="warning"], .version-notice[data-state="error"] svg[data-icon="download"] { display: none; }
    .version-notice[data-state="error"] svg[data-icon="warning"] { display: block; }
    .version-notice[data-state="error"] .version-icon { color: inherit; background: color-mix(in srgb, #ec854d 18%, var(--card, #222225)); }
    .version-notice[data-state="updated"] .version-actions { display: none; }
    .version-notice[data-state="updated"] .version-feedback { margin: 0; }
    #version-available { display: block; font-size: 13px; font-weight: 650; line-height: 1.3; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    #version-release { color: var(--version-link); font-size: 12px; text-decoration: none; }
    #version-release:hover { text-decoration: underline; text-underline-offset: 2px; }
    #version-update, #version-dismiss { display: grid; place-items: center; border: 0; border-radius: 6px; padding: 0; font: inherit; cursor: pointer; }
    #version-update { padding: 4px 10px; min-height: 29px; color: #fff; background: #2656d1; font-weight: 600; white-space: nowrap; }
    #version-update:hover:not(:disabled) { background: #1d49b9; }
    #version-dismiss { width: 24px; height: 26px; color: var(--muted-foreground, #a2a2a9); background: transparent; }
    #version-dismiss:hover:not(:disabled) { color: inherit; background: var(--secondary, #303034); }
    #version-update-status { color: var(--muted-foreground, #a2a2a9); }
    .version-progress { display: none; height: 3px; overflow: hidden; margin-top: 7px; border-radius: 2px; background: color-mix(in srgb, #2b7fff 18%, transparent); }
    .version-progress::before { content: ""; display: block; width: 35%; height: 100%; border-radius: inherit; background: #2b7fff; animation: version-progress 1.2s ease-in-out infinite alternate; }
    .version-notice[data-state="updating"] .version-progress { display: block; }
    @keyframes version-progress { to { transform: translateX(185%); } }
    @media(prefers-reduced-motion: reduce) { .version-progress::before { animation: none; } }
    @container version (max-width: 278px) {
      .version-actions { grid-template-columns: minmax(0, 1fr) auto auto; }
      .version-icon { display: none; }
      #version-available { font-size: 12.5px; }
      #version-update { padding-inline: 8px; }
    }
    @media(pointer:coarse) { .version-controls > .pv-swatch, #version-update, #version-dismiss { min-height: 44px; } #version-dismiss { width: 44px; } #version-release:not([hidden]) { display: inline-flex; align-items: center; min-height: 24px; } }
    .sidebar-view[hidden] { display: none; }
    .sidebar-nav { position: sticky; top: 0; z-index: 20; margin: -12px -14px 10px; padding: 8px 14px; background: var(--background, #141414); border-bottom: 1px solid color-mix(in srgb, var(--border, rgba(142,142,147,.24)) 65%, transparent); }
    .sidebar-tabs { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: center; max-width: 1120px; margin: 0 auto; padding: 2.5px; border-radius: 7px; background: color-mix(in srgb, var(--foreground, #ebebeb) 6%, var(--background, #141414)); border: 1px solid color-mix(in srgb, var(--foreground, #ebebeb) 10%, transparent); }
    .sidebar-tabs button { position: relative; z-index: 1; min-width: 0; min-height: 26px; padding: 3px 8px; border: 0; border-radius: 5px; background: transparent; color: var(--muted-foreground, #8e8e93); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; transition: color .15s ease; }
    .sidebar-tabs button[aria-selected="true"] { color: var(--foreground, #ebebeb); font-weight: 600; }
    .sidebar-tabs button:hover { color: var(--foreground, #ebebeb); }
    .sidebar-tabs button:focus-visible { outline: 2px solid #388bfd; outline-offset: 1px; }
    .sidebar-toggle-track { position: absolute; inset: 2.5px; border-radius: 5px; pointer-events: none; }
    .sidebar-toggle-thumb { display: block; width: calc(100% / 3); height: 100%; border-radius: 5px; background: color-mix(in srgb, var(--foreground, #ebebeb) 14%, var(--background, #141414)); box-shadow: 0 1px 2.5px rgba(0,0,0,.22), inset 0 0 0 1px color-mix(in srgb, var(--foreground, #ebebeb) 14%, transparent); transform: translateX(0); transition: transform .18s cubic-bezier(.22,1,.36,1); }
    .sidebar-tabs[data-view="settings"] .sidebar-toggle-thumb { transform: translateX(100%); }
    .sidebar-tabs[data-view="fx"] .sidebar-toggle-thumb { transform: translateX(200%); }
    @media(prefers-reduced-motion:reduce) { .sidebar-toggle-thumb { transition: none; } }
    @media(pointer:coarse) { .sidebar-tabs button { min-height: 44px; } }
    .nowrap { white-space: nowrap; }
    .settings-scope { margin-top: 8px; padding: 10px 0 4px; border-top: 1px solid var(--border, rgba(142,142,147,.22)); font-size: 12px; font-weight: 600; color: var(--muted-foreground, #8e8e93); letter-spacing: .01em; }
    .settings-scope.metric-setting { position: relative; }
    .settings-scope.metric-setting > .setting-head:focus-visible { outline: 2px solid #388bfd; outline-offset: 2px; border-radius: 4px; }
    .settings-scope .metric-help { font-weight: 400; font-size: 12px; letter-spacing: normal; }
    .settings-scope-title { font-size: 12px; font-weight: 600; color: var(--muted-foreground, #8e8e93); }
    .setting-card { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 7px 0; border-top: 1px solid color-mix(in srgb, var(--border, rgba(142,142,147,.24)) 55%, transparent); background: transparent; }
    .settings > .setting-card:first-child, .settings-scope + .setting-card { border-top: 0; }
    [data-parent-off="true"], .settings-fx[data-native-capsule="true"] > :not(.fx-native-scope) { opacity: .45; }
    [data-parent-off="true"] .setting-check,
    [data-parent-off="true"] input[type="checkbox"] { cursor: not-allowed; }
    .setting-head.setting-pair-head { justify-content: flex-start; gap: 14px; flex-wrap: nowrap; }
    .setting-pair-item { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .setting-pair-item .setting-check { flex: 0 1 auto; }
    .metric-setting > .setting-head { justify-content: flex-start; }
    .metric-setting > .setting-head > .setting-check { flex: 0 1 auto; }
    .setting-head.setting-pair-head > .setting-help-dot { margin-left: -8px; }
    .setting-option-card.metric-setting > .setting-head { flex-wrap: wrap; row-gap: 6px; }
    .setting-opts-with-help { display: inline-flex; align-items: center; gap: 6px; }
    .pv-detail-pop { overflow: hidden; max-height: 120px; opacity: 1; margin: 2px 0 6px; transition: max-height .2s ease, opacity .18s ease, margin .2s ease; }
    .pv-detail-pop[data-open="false"] { max-height: 0; opacity: 0; margin: 0; pointer-events: none; }
    .pv-detail-card { padding: 7px 9px; border-radius: 7px; border: 1px solid color-mix(in srgb, var(--border, rgba(142,142,147,.28)) 70%, transparent); background: color-mix(in srgb, var(--foreground, #ebebeb) 4%, var(--background, #141414)); font-size: 11.5px; color: var(--muted-foreground, #8e8e93); font-variant-numeric: tabular-nums; }
    .setting-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 22px; }
    .setting-head > label, .setting-label { font-size: 13px; color: var(--foreground, #ebebeb); min-width: 0; }
    .setting-lang-label { display: inline-flex; align-items: center; gap: 5px; }
    .setting-lang-label svg { flex-shrink: 0; color: var(--muted-foreground, #8e8e93); }
    .setting-head select { width: auto; min-width: 0; max-width: 56%; margin-left: auto; padding: 3px 7px; font: inherit; font-size: 12px; color: var(--foreground, #ebebeb); background: var(--card, #222225); border: 1px solid var(--border, #444); border-radius: 5px; }
    .setting-check { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; cursor: pointer; }
    .setting-check input[type="checkbox"] { appearance: none; -webkit-appearance: none; position: relative; margin: 0; flex-shrink: 0; width: 28px; height: 15px; border-radius: 99px; background: color-mix(in srgb, var(--foreground, #ebebeb) 13%, transparent); border: 1px solid color-mix(in srgb, var(--foreground, #ebebeb) 16%, transparent); cursor: pointer; transition: background .18s ease, border-color .18s ease; }
    .setting-check input[type="checkbox"]::after { content: ""; position: absolute; top: 1.5px; left: 1.5px; width: 10px; height: 10px; border-radius: 50%; background: var(--muted-foreground, #8e8e93); transform: translateX(0); transition: transform .18s cubic-bezier(.22,1,.36,1), background .18s ease; }
    .setting-check input[type="checkbox"]:checked { background: rgba(78, 168, 78, .24); border-color: rgba(78, 168, 78, .65); }
    .setting-check input[type="checkbox"]:checked::after { transform: translateX(13px); background: #4ea84e; }
    .setting-check input[type="checkbox"]:focus-visible { outline: 2px solid #388bfd; outline-offset: 1px; }
    .setting-check > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .setting-help-dot { flex-shrink: 0; width: 15px; height: 15px; padding: 0; border-radius: 50%; border: 1px solid var(--border, rgba(142,142,147,.4)); background: transparent; color: var(--muted-foreground, #8e8e93); font: inherit; font-size: 10.5px; line-height: 13px; text-align: center; cursor: help; }
    .metric-help { position: absolute; bottom: calc(100% + 5px); left: 0; z-index: 10; box-sizing: border-box; width: 100%; max-width: 360px; padding: 10px 12px; border: 1px solid var(--border, #444); border-radius: 6px; background: var(--card, #222225); color: var(--foreground, #ebebeb); line-height: 1.5; overflow-wrap: anywhere; box-shadow: 0 3px 12px #0003; visibility: hidden; pointer-events: none; }
    .metric-setting:not([data-help-dismissed]) .setting-head:hover ~ .metric-help,
    .metric-setting:not([data-help-dismissed]):focus-within .metric-help { visibility: visible; }
    .setting-preview { padding: 2px 0 1px; background: transparent; border: 0; font-size: 11.5px; line-height: 1.25; color: var(--muted-foreground, #8e8e93); font-variant-numeric: tabular-nums; overflow: hidden; }
    .pv-svg { width: 11px; height: 11px; flex-shrink: 0; }
    .pv-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 5px; background: var(--secondary, rgba(128,128,128,.16)); color: var(--muted-foreground, #8e8e93); white-space: nowrap; }
    /* Same-row clickable block pickers */
    .setting-opts { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
    .setting-option-card:not([data-layout="columns"]) [data-for-layout="columns"],
    .setting-option-card:not([data-layout="rows"]) [data-for-layout="rows"] { display: none; }
    .setting-option-card[data-checked="false"] .setting-opts { opacity: .45; pointer-events: none; }
    .setting-opts-extra { display: inline-flex; }
    .setting-seg { display: inline-flex; flex-shrink: 0; padding: 2px; gap: 2px; border-radius: 6px; background: color-mix(in srgb, var(--foreground, #ebebeb) 6%, transparent); border: 1px solid color-mix(in srgb, var(--foreground, #ebebeb) 12%, transparent); }
    .setting-seg-opt { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 17px; padding: 0; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--muted-foreground, #8e8e93); font: inherit; cursor: pointer; transition: background .18s ease, color .18s ease, border-color .18s ease; }
    .setting-seg-text .setting-seg-opt { width: auto; padding: 0 7px; font-size: 11.5px; white-space: nowrap; }
    .setting-seg-opt:hover { color: var(--foreground, #ebebeb); }
    .setting-seg-opt[data-active="true"] { background: color-mix(in srgb, var(--foreground, #ebebeb) 14%, var(--card, #222225)); border-color: color-mix(in srgb, var(--foreground, #ebebeb) 18%, transparent); color: #4ea84e; }
    .setting-seg-opt:focus-visible, .pv-field-toggle:focus-visible { outline: 2px solid #388bfd; outline-offset: 1px; }
    .pv-detail-pop[data-layout="rows"] > [data-for-layout="columns"],
    .pv-detail-pop[data-layout="columns"] > [data-for-layout="rows"] { display: none; }
    .pv-fields { display: flex; flex-direction: column; }
    .pv-field-row { display: grid; grid-template-columns: 8px repeat(4, minmax(0, 1fr)) 22px; align-items: center; column-gap: 6px; padding: 1px 0; border-radius: 4px; transition: box-shadow .12s ease; }
    .pv-field-row[draggable="true"] { cursor: grab; }
    .pv-field-row[data-dragging="true"] { opacity: .5; }
    .pv-field-row[data-drop="before"] { box-shadow: inset 0 2px 0 #4ea84e; }
    .pv-field-row[data-drop="after"] { box-shadow: inset 0 -2px 0 #4ea84e; }
    .pv-field-grip { width: 6px; height: 10px; opacity: .55; background-image: radial-gradient(currentColor 1px, transparent 1.2px); background-size: 3px 3.4px; }
    .pv-field-row[data-on="false"] .pv-field-grip { visibility: hidden; }
    .pv-field-cell { min-width: 0; padding-left: 5px; border-left: 2px solid var(--pv-c); line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pv-field-row[data-on="false"] .pv-field-cell { border-left-color: transparent; text-decoration: line-through; opacity: .5; }
    .pv-field-toggle { position: relative; justify-self: end; width: 22px; height: 12px; padding: 0; border-radius: 99px; background: rgba(78, 168, 78, .24); border: 1px solid rgba(78, 168, 78, .65); cursor: pointer; transition: background .18s ease, border-color .18s ease; }
    .pv-field-toggle::after { content: ""; position: absolute; top: 1px; left: 11px; width: 8px; height: 8px; border-radius: 50%; background: #4ea84e; transition: left .18s cubic-bezier(.22,1,.36,1), background .18s ease; }
    .pv-field-toggle[aria-checked="false"] { background: color-mix(in srgb, var(--foreground, #ebebeb) 13%, transparent); border-color: color-mix(in srgb, var(--foreground, #ebebeb) 16%, transparent); }
    .pv-field-toggle[aria-checked="false"]::after { left: 1px; background: var(--muted-foreground, #8e8e93); }
    .seg-ico { display: inline-flex; width: 11px; height: 9px; }
    .seg-ico > i { background: currentColor; border-radius: 1px; }
    .seg-ico-cols { justify-content: space-between; }
    .seg-ico-cols > i { width: 1.5px; height: 100%; }
    .seg-ico-rows { flex-direction: column; justify-content: space-between; }
    .seg-ico-rows > i { width: 100%; height: 1.5px; }
    .seg-ico-marker { width: 7px; height: 7px; border-radius: 1.5px; background: currentColor; }
    .seg-ico-dot { border-radius: 50%; }
    .pv-live .item-label, .pv-live .item-k, .pv-live .item-pct, .pv-live .turn-bar-label, .pv-live .turn-bar-short, .pv-live .turn-bar-val { font-size: 11.5px; }
    .pv-live .list, .pv-live .turn-bar-list { row-gap: 4px; }
    .pv-pick-inline { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; }
    .pv-swatch { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; min-height: 27px; padding: 4px 6px; border-radius: 5px; border: 1px solid var(--border, rgba(142,142,147,.28)); background: var(--card, #222225); color: var(--muted-foreground, #8e8e93); font: inherit; font-size: 11px; cursor: pointer; transition: border-color .12s ease, color .12s ease; }
    .pv-swatch-icon { min-width: 38px; padding: 4px 10px; }
    .pv-swatch:hover { background: var(--secondary, #303034); color: var(--foreground, #ebebeb); }
    .pv-swatch[data-active="true"] { border-color: #2b7fff; color: var(--foreground, #ebebeb); background: color-mix(in srgb, #2b7fff 14%, var(--card, #222225)); font-weight: 500; }
    .pv-ico-layout { display: inline-flex; align-items: flex-end; gap: 2.5px; height: 12px; flex-shrink: 0; }
    .pv-ico-layout i { display: block; width: 5px; border: 1.2px solid currentColor; border-radius: 1.5px; }
    .pv-il-tall { height: 12px; }
    .pv-il-short { height: 7.5px; }
    .pv-ico-density { display: inline-flex; flex-direction: column; justify-content: center; width: 12px; height: 12px; flex-shrink: 0; }
    .pv-ico-density i { display: block; height: 1.5px; width: 100%; background: currentColor; border-radius: 1px; }
    .pv-ico-density i:nth-child(2) { width: 75%; }
    .pv-id-compact { gap: 1.5px; }
    .pv-id-standard { gap: 2.8px; }
    .pv-id-spacious { gap: 4px; }
    .pv-ico-bar { width: 16px; height: 4px; border-radius: 99px; background: rgba(142,142,147,.3); overflow: hidden; flex-shrink: 0; }
    .pv-ico-bar i { display: block; width: 78%; height: 100%; background: #4ea84e; border-radius: inherit; }
    /* Active model highlight: state-driven */
    .pv-active-model { display: flex; flex-direction: column; gap: 4px; }
    .pv-qm-row { display: grid; grid-template-columns: 58px 1fr auto; align-items: center; gap: 6px; transition: opacity .2s ease; }
    .pv-qm-name { display: inline-flex; align-items: center; gap: 4px; color: var(--foreground, #ebebeb); font-weight: 500; }
    .pv-qm-dot { width: 4.5px; height: 4.5px; border-radius: 50%; background: #4ea84e; opacity: 0; transform: scale(.5); transition: opacity .2s ease, transform .2s ease; }
    .pv-qm-bar { height: 4px; border-radius: 99px; background: rgba(142,142,147,.24); overflow: hidden; }
    .pv-qm-bar > span { display: block; height: 100%; background: #4ea84e; border-radius: inherit; }
    .pv-qm-pct { font-size: 10.5px; }
    .pv-qm-other { opacity: 1; transition: opacity .2s ease; }
    [data-setting-card="highlightActiveModel"][data-checked="true"] .pv-qm-other { opacity: .38; }
    [data-setting-card="highlightActiveModel"][data-checked="true"] .pv-qm-dot { opacity: 1; transform: scale(1); }
    /* Hide absent quota windows: unchecked shows --%, checked hides --% while keeping 0% */
    .pv-hide-quota { display: flex; align-items: center; gap: 6px; }
    .pv-hq-pill { flex: 0 0 auto; gap: 0; }
    .pv-hq-miss, .pv-hq-zero, .pv-hq-keep { display: inline-flex; align-items: center; gap: 3px; overflow: hidden; white-space: nowrap; }
    .pv-hq-miss { max-width: 56px; opacity: 1; margin-right: 6px; transition: max-width .22s ease, opacity .18s ease, margin-right .22s ease; }
    .pv-hq-zero { margin-right: 6px; color: #ef4444; font-weight: 600; }
    [data-setting-card="hideUnavailableQuota"][data-checked="true"] .pv-hq-miss { max-width: 0; opacity: 0; margin-right: 0; }
    /* Quota group dividers: checked draws the line between the two pools */
    .pv-quota-dividers .pv-qm-row + .pv-qm-row { margin-top: 4px; padding-top: 4px; border-top: 1px solid transparent; transition: border-color .18s ease; }
    [data-setting-card="showQuotaDividers"][data-checked="true"] .pv-qm-row + .pv-qm-row { border-top-color: var(--border, rgba(142, 142, 147, 0.24)); }
    /* Cache expiry alert: unchecked all neutral, checked 3m+ yellow icon, 4m+ red icon */
    .setting-thresholds { display: inline-flex; align-items: center; gap: 5px; min-width: 0; flex-shrink: 0; transition: opacity .18s ease; }
    .setting-threshold-card[data-checked="false"] .setting-thresholds { opacity: .42; pointer-events: none; }
    .setting-num { display: inline-flex; align-items: center; gap: 3px; height: 21px; padding: 0 5px; border-radius: 5px; background: color-mix(in srgb, var(--foreground, #ebebeb) 6%, transparent); border: 1px solid color-mix(in srgb, var(--foreground, #ebebeb) 12%, transparent); font-size: 11.5px; color: var(--muted-foreground, #8e8e93); font-variant-numeric: tabular-nums; transition: border-color .15s ease, background .15s ease; }
    .setting-num:focus-within { border-color: #388bfd; background: color-mix(in srgb, var(--foreground, #ebebeb) 9%, var(--card, #222225)); }
    .setting-num-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
    .setting-num-warn { background: #d4940a; }
    .setting-num-cold { background: #e06c75; }
    .setting-num input[type="number"] { width: 26px; padding: 0; border: 0; background: transparent; color: var(--foreground, #ebebeb); font: inherit; text-align: right; outline: none; appearance: textfield; -moz-appearance: textfield; }
    .setting-num input[type="number"]::-webkit-inner-spin-button,
    .setting-num input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .setting-num-unit { opacity: .75; }
    .pv-cache-warn { display: flex; align-items: center; gap: 6px; }
    .pv-cache-warn .pv-pill { flex: 0 0 auto; }
    .pv-cache-warn .pv-svg { transition: color .18s ease; }
    [data-setting-card="showCacheWarnings"][data-checked="true"] .pv-ca-2 .pv-svg { color: #d4940a; }
    [data-setting-card="showCacheWarnings"][data-checked="true"] .pv-ca-3 .pv-svg { color: #e06c75; }
    /* Context warning colors: normal stays neutral; only 75% / 90% change color. */
    .pv-ctx-warn { display: flex; align-items: center; gap: 6px; }
    .pv-ctx-warn .pv-pill { flex: 0 0 auto; }
    .pv-cw-val { color: var(--muted-foreground, #8e8e93); font-weight: 400; transition: color .18s ease; }
    [data-setting-card="showContextWarnings"][data-checked="true"] .pv-cw-2 .pv-cw-val { color: #d4940a; font-weight: 600; }
    [data-setting-card="showContextWarnings"][data-checked="true"] .pv-cw-3 .pv-cw-val { color: #e06c75; font-weight: 600; }
    /* Breakdown hover highlight: checked shows one pair picked out, as while it is pointed at */
    .pv-hover-link { display: grid; gap: 5px; }
    .pv-hl-track { display: flex; gap: 1.5px; height: 4px; border-radius: 99px; overflow: hidden; background: rgba(142,142,147,.24); }
    .pv-hl-track > i { border-radius: 99px; }
    .pv-hl-names { display: flex; gap: 10px; }
    .pv-hl-track > i, .pv-hl-names > span { transition: opacity .18s ease, color .18s ease; }
    [data-setting-card="highlightContextHover"][data-checked="true"] .pv-hl-rest { opacity: .35; }
    [data-setting-card="highlightContextHover"][data-checked="true"] .pv-hl-names > :not(.pv-hl-rest) { color: var(--foreground, #ebebeb); }
    /* Request failure capsule: unchecked hides 3rd error pill, checked shows it */
    .pv-err-strip, .pv-queue-strip { display: flex; align-items: center; gap: 6px; }
    .pv-err-strip .pv-pill, .pv-queue-strip .pv-pill { flex: 0 0 auto; }
    .pv-pill-err { color: #e06c75; background: rgba(224,108,117,.14); font-weight: 600; max-width: 120px; opacity: 1; overflow: hidden; transition: max-width .22s ease, opacity .18s ease, padding .22s ease; }
    [data-setting-card="showRequestErrors"][data-checked="false"] .pv-pill-err { max-width: 0; opacity: 0; padding-left: 0; padding-right: 0; }
    .pv-pill-queue { color: light-dark(#d97706, #d4940a); background: rgba(212,148,10,.14); font-weight: 600; max-width: 140px; opacity: 1; overflow: hidden; transition: max-width .22s ease, opacity .18s ease, padding .22s ease; }
    [data-setting-card="showQueueWarnings"][data-checked="false"] .pv-pill-queue { max-width: 0; opacity: 0; padding-left: 0; padding-right: 0; }
    .pv-req-line { display: flex; }
    .pv-req-pill { flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 4px 8px; transition: opacity .18s ease; }
    .pv-req-pill b { font-weight: 500; color: color-mix(in srgb, var(--foreground, #ebebeb) 88%, transparent); }
    [data-setting-card="showRequestMetrics"][data-checked="false"] .pv-req-pill { opacity: .38; }
    /* Compact status bar: a miniature panel with the bar along its lower edge. */
    .pv-tbar-card { display: flex; flex-direction: column; border-radius: 6px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--border, rgba(142,142,147,.28)) 70%, transparent); background: color-mix(in srgb, var(--foreground, #ebebeb) 2.5%, transparent); transition: opacity .18s ease; }
    [data-setting-card="compactTelemetryBar"][data-checked="false"] .pv-tbar-card { opacity: .38; }
    .pv-tbar-body { padding: 6px 8px; }
    .pv-tbar-track { display: flex; gap: 1.5px; height: 3.5px; border-radius: 99px; overflow: hidden; background: rgba(142,142,147,.22); }
    .pv-tbar-track > i { display: block; height: 100%; border-radius: 99px; }
    .pv-tbar-dock { display: grid; grid-template-columns: minmax(0, .84fr) minmax(0, .82fr) minmax(0, 1.44fr); background: color-mix(in srgb, var(--foreground, #ebebeb) 3%, transparent); border-top: 1px solid color-mix(in srgb, var(--border, rgba(142,142,147,.24)) 64%, transparent); }
    .pv-tbar-cell { position: relative; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 4px 3px; white-space: nowrap; }
    .pv-tbar-cell + .pv-tbar-cell::before { content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 1px; height: 10px; background: color-mix(in srgb, var(--border, rgba(142,142,147,.24)) 72%, transparent); }
    .pv-tbar-cache { background: linear-gradient(90deg, color-mix(in srgb, #4ea84e 10%, transparent), transparent); }
    .pv-tbar-cell b { font-weight: 500; color: color-mix(in srgb, var(--foreground, #ebebeb) 92%, transparent); }
    .pv-tbar-u { font-style: normal; font-weight: 400; opacity: .6; }
    /* The miniature follows the chosen position, which the page carries on its body. */
    body[data-telemetry-bar-position="top"] .pv-tbar-dock { order: -1; background: none; border-top: 0; border-bottom: 1px solid color-mix(in srgb, var(--border, rgba(142,142,147,.24)) 64%, transparent); }
    body[data-telemetry-bar-position="top"] .pv-tbar-cache { background: none; }
    /* Speed breathing & cooldown */
    .pv-speed-cap { display: flex; align-items: center; }
    .pv-speed-cap .pv-pill { gap: 5px; }
    .pv-sc-val { display: inline-flex; align-items: center; gap: 4px; max-width: 90px; opacity: 1; overflow: hidden; white-space: nowrap; transition: max-width .22s ease, opacity .18s ease, margin .22s ease; }
    [data-setting-card="showSpeed"][data-checked="false"] .pv-sc-val { max-width: 0; opacity: 0; margin-left: -5px; }
    .pv-sc-val .pv-sa-dot { display: none; }
    [data-setting-card="showSpeed"][data-speed-fx="true"] .pv-sc-val { color: light-dark(#16a34a, #4ea84e); font-weight: 600; }
    [data-setting-card="showSpeed"][data-speed-fx="true"] .pv-sc-val .pv-sa-dot { display: inline-block; }
    .pv-sa-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; animation: dk-speed-breathe 1.2s ease-in-out infinite; }
    [data-setting-card="showSpeed"][data-speed-fx="true"]:hover .pv-sc-val,
    [data-setting-card="showSpeed"][data-speed-fx="true"]:focus-within .pv-sc-val { animation: pv-speed-lifecycle 3.6s ease-in-out infinite; }
    @keyframes dk-speed-breathe { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.78); } }
    @keyframes pv-speed-lifecycle { 0%,60% { color: light-dark(#16a34a, #4ea84e); } 75%,95% { color: var(--muted-foreground, #8e8e93); } 100% { color: light-dark(#16a34a, #4ea84e); } }
    @media (prefers-reduced-motion: reduce) {
      .setting-card *, .setting-card *::before, .setting-card *::after { animation: none !important; transition: none !important; }
    }
    .quota-meter { display: inline-block; flex: 1; min-width: 20px; max-width: none; height: 4px; background: rgba(142,142,147,.24); border-radius: 99px; overflow: hidden; }
    .quota-meter > span { display: block; height: 100%; border-radius: inherit; }
    .generation-block { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border, rgba(142,142,147,.24)); color: var(--muted-foreground, #8e8e93); font-variant-numeric: tabular-nums; }
    .generation-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 10px; align-items: baseline; }
    .generation-row { display: inline-flex; align-items: baseline; gap: 4px; min-width: 0; font-size: 13.5px; font-weight: 400; color: var(--muted-foreground, #8e8e93); }
    [data-generation-row="speed"] { justify-self: end; }
    .generation-row > :first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .generation-row > :last-child { flex-shrink: 0; white-space: nowrap; font-weight: 500; color: var(--foreground, #ebebeb); color: color-mix(in srgb, var(--foreground, #ebebeb) 88%, transparent); }
    [data-generation-row="timing"] > :last-child { font-weight: 400; color: var(--muted-foreground, #8e8e93); }
    .generation-heading { margin-bottom: 8px; font-size: 13.5px; font-weight: 500; color: var(--foreground, #ebebeb); color: color-mix(in srgb, var(--foreground, #ebebeb) 88%, transparent); }
    .generation-row[hidden], [data-generation-group][hidden] { display: none; }
    .panel .list { row-gap: var(--agy-row-gap); }
    .panel .quota-group { margin: 0; min-width: 0; }
    .panel .quota-group-title { margin-bottom: var(--agy-row-gap); }
    .panel .quota-bucket { margin-bottom: var(--agy-row-gap); }
    .panel .quota-bucket:last-child { margin-bottom: 0; }
    .panel .generation-block { margin-top: var(--agy-section-gap); padding-top: var(--agy-section-gap); }
    .panel [data-generation-block]:not([hidden]) + [data-turn-metrics-block] { border-top: 0; padding-top: 0; margin-top: var(--agy-section-gap); }
    .panel .generation-grid { row-gap: var(--agy-row-gap); }
    .panel .generation-heading { margin-bottom: var(--agy-row-gap); }
    body[data-quota-indicator="bar"] .quota-right { min-width: 0; justify-content: flex-start; }
    body[data-quota-indicator="bar"] .quota-right > span:first-child { min-width: 34px; text-align: right; }
    body[data-quota-indicator="bar"] .quota-line1 { grid-template-columns: 54px minmax(0, 1fr) minmax(46px, auto); }
    body[data-language^="zh"] .quota-line1 { grid-template-columns: 42px minmax(58px, 1fr) minmax(46px, auto); }
    body[data-language^="zh"][data-quota-indicator="bar"] .quota-line1 { grid-template-columns: 42px minmax(0, 1fr) minmax(46px, auto); }
    .quota-group:not(:has(.quota-mid:not(:empty))) .quota-line1 { grid-template-columns: 54px minmax(0, 1fr); }
    body[data-language^="zh"] .quota-group:not(:has(.quota-mid:not(:empty))) .quota-line1 { grid-template-columns: 42px minmax(0, 1fr); }
    .quota-group:not(:has(.quota-mid:not(:empty))) .quota-mid { display: none; }
    /* Optional usage history below the statistics: hidden, unread and unfetched while it is off. */
    .stats-usage { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); align-items: start; gap: calc(var(--agy-section-gap, 6px) + 6px); min-width: 0; margin-top: var(--agy-section-gap, 6px); padding-top: calc(var(--agy-section-gap, 6px) + 2px); border-top: 1px solid var(--border, rgba(142, 142, 147, 0.24)); }
    .stats-usage[hidden], .usage-block[hidden] { display: none; }
    .usage-block { display: flex; flex-direction: column; gap: var(--agy-section-gap, 6px); min-width: 0; container-type: inline-size; container-name: usage; font-variant-numeric: tabular-nums; }
    .usage-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .usage-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--foreground, #ebebeb); color: color-mix(in srgb, var(--foreground, #ebebeb) 88%, transparent); }
    .usage-seg { display: inline-flex; flex-shrink: 0; gap: 2px; padding: 2px; border-radius: 6px; background: color-mix(in srgb, var(--foreground, #ebebeb) 6%, transparent); border: 1px solid color-mix(in srgb, var(--foreground, #ebebeb) 12%, transparent); }
    .usage-seg button { padding: 1px 7px; border: 0; border-radius: 4px; background: transparent; color: var(--muted-foreground, #8e8e93); font: inherit; font-size: 11.5px; cursor: pointer; }
    .usage-seg button:hover, .usage-seg button[aria-pressed="true"] { color: var(--foreground, #ebebeb); }
    .usage-seg button[aria-pressed="true"] { background: color-mix(in srgb, var(--foreground, #ebebeb) 14%, var(--card, #222225)); }
    .usage-seg button:focus-visible { outline: 2px solid #388bfd; outline-offset: 1px; }
    .usage-note, .usage-foot, .usage-total > span { font-size: 11.5px; color: var(--muted-foreground, #8e8e93); }
    .usage-totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .usage-total { display: flex; flex-direction: column; min-width: 0; }
    .usage-total > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .usage-total > b { overflow: hidden; text-overflow: ellipsis; font-weight: 500; white-space: nowrap; color: var(--foreground, #ebebeb); color: color-mix(in srgb, var(--foreground, #ebebeb) 88%, transparent); }
    /* One column per week, newest on the right; a block too narrow for a year drops the oldest weeks. */
    .usage-heat { --usage-cell: 10px; display: flex; justify-content: flex-end; gap: 2px; width: fit-content; max-width: 100%; padding-top: 14px; overflow: hidden; }
    .usage-heat-col { position: relative; flex: none; display: flex; flex-direction: column; gap: 2px; }
    .usage-heat-month { position: absolute; left: 0; top: -14px; font-size: 10px; line-height: 12px; white-space: nowrap; color: var(--muted-foreground, #8e8e93); }
    .usage-heat-col:nth-last-child(-n+2) .usage-heat-month { left: auto; right: 0; }
    .usage-cell { display: block; flex: none; width: var(--usage-cell, 8px); height: var(--usage-cell, 8px); border-radius: 2px; background: color-mix(in srgb, var(--foreground, #ebebeb) 9%, transparent); }
    .usage-heat[data-scale="week"] .usage-cell { height: calc(7 * var(--usage-cell) + 12px); }
    .usage-cell[data-level="1"] { background: color-mix(in srgb, #388bfd 30%, transparent); }
    .usage-cell[data-level="2"] { background: color-mix(in srgb, #388bfd 52%, transparent); }
    .usage-cell[data-level="3"] { background: color-mix(in srgb, #388bfd 76%, transparent); }
    .usage-cell[data-level="4"] { background: #388bfd; }
    .usage-cell[data-future] { visibility: hidden; }
    @container usage (width < 634px) { .usage-heat-col:nth-last-child(n+40) { display: none; } }
    @container usage (width < 466px) { .usage-heat-col:nth-last-child(n+27) { display: none; } }
    @container usage (width < 310px) { .usage-heat-col:nth-last-child(n+22) { display: none; } }
    @container usage (width < 250px) { .usage-heat-col:nth-last-child(n+18) { display: none; } }
    @container usage (width < 202px) { .usage-heat-col:nth-last-child(n+14) { display: none; } }
    .usage-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .usage-foot > :first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .usage-legend { display: inline-flex; flex-shrink: 0; align-items: center; gap: 3px; }
    .usage-nav { display: flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--muted-foreground, #8e8e93); }
    .usage-nav button { flex: none; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; font-size: 14px; line-height: 1; cursor: pointer; }
    .usage-nav button:hover:enabled { color: var(--foreground, #ebebeb); background: color-mix(in srgb, var(--foreground, #ebebeb) 8%, transparent); }
    .usage-nav button:disabled { opacity: .35; cursor: default; }
    .usage-nav button:focus-visible { outline: 2px solid #388bfd; outline-offset: 1px; }
    .usage-range { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .usage-nav-total { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; margin-left: auto; white-space: nowrap; color: var(--foreground, #ebebeb); color: color-mix(in srgb, var(--foreground, #ebebeb) 88%, transparent); }
    /* A bar is a column: free space, then the stack, sharing the height by tokens. Its label hangs below. */
    .usage-bars { display: flex; gap: 3px; height: 72px; margin-bottom: 14px; border-bottom: 1px solid var(--border, rgba(142, 142, 147, 0.24)); }
    .usage-bar { position: relative; flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; }
    .usage-bar-stack { display: flex; flex-direction: column-reverse; width: 100%; max-width: 16px; min-height: 2px; border-radius: 2px 2px 0 0; overflow: hidden; }
    .usage-bar-x { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); font-size: 9.5px; line-height: 14px; white-space: nowrap; color: var(--muted-foreground, #8e8e93); }
    .usage-models { display: flex; flex-direction: column; gap: var(--agy-row-gap, 4px); }
    .usage-model { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto; align-items: center; column-gap: 8px; }
    .usage-dot { width: 10px; height: 10px; border-radius: 3px; }
    .usage-model-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .usage-model-share { min-width: 30px; text-align: right; color: var(--muted-foreground, #8e8e93); }
    .usage-model-tokens { min-width: 40px; text-align: right; white-space: nowrap; font-weight: 500; color: var(--foreground, #ebebeb); color: color-mix(in srgb, var(--foreground, #ebebeb) 88%, transparent); }
    @container stats (width < 420px) {
      body[data-show-quota-dividers="true"] .stats-quota .quota-group + .quota-group { padding-top: calc(var(--agy-section-gap, 6px) + 4px); border-top: 1px solid var(--border, rgba(142, 142, 147, 0.24)); }
      .usage-block:not([hidden]) ~ .usage-block:not([hidden]) { padding-top: calc(var(--agy-section-gap, 6px) + 2px); border-top: 1px solid var(--border, rgba(142, 142, 147, 0.24)); }
    }
    @container stats (min-width: 420px) {
      .stats-layout {
        gap: calc(var(--agy-section-gap, 6px) + 6px);
      }
      .stats-context,
      .panel .quota-group,
      .usage-block {
        padding: calc(var(--agy-pad-y, 8px) + 2px) calc(var(--agy-pad-x, 10px) + 2px);
        border-radius: 8px;
        border: 1px solid color-mix(in srgb, var(--border, rgba(142, 142, 147, 0.24)) 72%, transparent);
        background: color-mix(in srgb, var(--foreground, #ebebeb) 3%, transparent);
      }
      .divider {
        display: none;
      }
      .stats-usage {
        margin-top: 0;
        padding-top: 0;
        border-top: 0;
      }
      .stats-quota {
        grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
        gap: calc(var(--agy-section-gap, 6px) + 4px);
      }
    }
    @container stats (min-width: 540px) {
      .stats-layout {
        grid-template-columns: clamp(250px, 36%, 350px) minmax(0, 1fr);
        align-items: start;
      }
      .stats-layout:has(> #quota-root:empty) {
        grid-template-columns: minmax(0, 380px);
        justify-content: center;
      }
      .stats-quota {
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      }
    }
    body:not([data-context-layout="rows"]) .item-pct { display: none; }
    body[data-column-percent="true"]:not([data-context-layout="rows"]) .item-pct { display: block; }
    body[data-column-label="false"]:not([data-context-layout="rows"]) .item-label,
    body[data-column-value="false"]:not([data-context-layout="rows"]) .item-k { display: none; }
    body[data-context-layout="rows"] .list { grid-template-columns: auto minmax(0, 1fr) auto auto; column-gap: 8px; align-items: center; }
    body[data-context-layout="rows"] .item-row,
    body[data-turn-layout="rows"] .turn-bar-item { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; }
    body[data-context-layout="rows"] .item-body { grid-column: 2 / -1; display: grid; grid-template-columns: subgrid; align-items: center; }
    body[data-context-layout="rows"] .item-label { grid-column: 1; grid-row: 1; }
    body[data-context-layout="rows"] .item-pct { grid-column: 2; grid-row: 1; justify-self: end; }
    body[data-context-layout="rows"] .item-k { grid-column: 3; grid-row: 1; justify-self: end; }
    body[data-turn-layout="rows"] .turn-bar-list { grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 8px; row-gap: var(--agy-row-gap); align-items: center; }
    body[data-turn-layout="rows"] .turn-bar-label { grid-column: 2; grid-row: 1; display: block; }
    body[data-turn-layout="rows"] .turn-bar-short { display: none; }
    body[data-turn-layout="rows"] .turn-bar-item[data-turn-row="requests"] { container-type: normal; }
    body[data-context-layout="rows"] .item-pct { margin-right: 4px; }
    body[data-turn-layout="rows"] .turn-bar-val { grid-column: 3; grid-row: 1; justify-self: end; }
    body[data-context-layout="rows"] .item-row > .dot,
    body[data-turn-layout="rows"] .turn-bar-line { grid-column: 1; grid-row: 1; align-self: center; width: 10px; height: 10px; margin: 0; border-radius: 3px; }
    body[data-context-marker="dot"][data-context-layout="rows"] .item-row > .dot,
    body[data-turn-marker="dot"][data-turn-layout="rows"] .turn-bar-line { border-radius: 50%; }
    body[data-show-context-breakdown="false"] .panel .list { display: none; }
    .item-label { order: var(--agy-order-label, 0); }
    .item-k { order: var(--agy-order-value, 1); }
    .item-pct { order: var(--agy-order-percent, 2); }
    /* Optional hover link between the progress bar and the breakdown: pointing at either end of a
       pair keeps that pair lit and dims the rest. CSS only, so nothing runs while it is off. */
    body[data-highlight-context-hover="true"] .stats-context:has([data-cat="turn0"]:hover) [data-cat]:not([data-cat="turn0"]),
    body[data-highlight-context-hover="true"] .stats-context:has([data-cat="read"]:hover) [data-cat]:not([data-cat="read"]),
    body[data-highlight-context-hover="true"] .stats-context:has([data-cat="think"]:hover) [data-cat]:not([data-cat="think"]),
    body[data-highlight-context-hover="true"] .stats-context:has([data-cat="write"]:hover) [data-cat]:not([data-cat="write"]) { opacity: .35; }
    body[data-highlight-context-hover="true"] .stats-context:has([data-cat="turn0"]:hover) [data-cat="turn0"] .item-label,
    body[data-highlight-context-hover="true"] .stats-context:has([data-cat="read"]:hover) [data-cat="read"] .item-label,
    body[data-highlight-context-hover="true"] .stats-context:has([data-cat="think"]:hover) [data-cat="think"] .item-label,
    body[data-highlight-context-hover="true"] .stats-context:has([data-cat="write"]:hover) [data-cat="write"] .item-label { color: var(--foreground, #ebebeb); }
    @media (prefers-reduced-motion: no-preference) {
      body[data-highlight-context-hover="true"] .stats-context .seg { transition: width 0.25s ease, opacity .18s ease; }
      body[data-highlight-context-hover="true"] .stats-context .item-row { transition: opacity .18s ease; }
    }
    /* Optional compact status bar: the cache and the last request as one row below the context
       statistics. It takes the place of those two rows only; the rest stays as it is. */
    .telemetry-dock { display: none; }
    body[data-compact-telemetry-bar="true"] .panel .cache-bar,
    body[data-compact-telemetry-bar="true"] .panel [data-generation-block] { display: none; }
    body[data-compact-telemetry-bar="true"] .panel [data-generation-block] + [data-turn-metrics-block] { border-top: 1px solid var(--border, rgba(142, 142, 147, 0.24)); padding-top: var(--agy-section-gap); }
    body[data-compact-telemetry-bar="true"] .telemetry-dock {
      display: block;
      margin-top: var(--agy-section-gap, 6px);
      border: 1px solid color-mix(in srgb, var(--border, rgba(142, 142, 147, 0.24)) 64%, transparent);
      border-radius: 7px;
      overflow: hidden;
      background: color-mix(in srgb, var(--foreground, #ebebeb) 3%, transparent);
      line-height: 1.35;
      font-variant-numeric: tabular-nums;
    }
    .telemetry-dock[data-mode="cache-only"] .tb-trio,
    .telemetry-dock[data-mode="trio"] .tb-single { display: none; }
    .telemetry-dock .tb-trio { display: grid; grid-template-columns: minmax(0, 0.84fr) minmax(0, 0.82fr) minmax(0, 1.44fr); }
    .telemetry-dock .tb-cell { position: relative; display: flex; align-items: center; justify-content: center; gap: 4.5px; padding: 6px 4px; min-width: 0; white-space: nowrap; }
    .telemetry-dock .tb-cell:hover { background-color: color-mix(in srgb, var(--foreground, #ebebeb) 4.5%, transparent); }
    .telemetry-dock .tb-cell + .tb-cell::before { content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 1px; height: 12px; border-radius: 1px; background: color-mix(in srgb, var(--border, rgba(142, 142, 147, 0.24)) 70%, transparent); }
    .telemetry-dock .tb-single { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; }
    .telemetry-dock .tb-single-left { display: inline-flex; align-items: center; gap: 5px; min-width: 0; white-space: nowrap; }
    .telemetry-dock .tb-single-right { display: inline-flex; align-items: baseline; gap: 7px; flex-shrink: 0; white-space: nowrap; }
    .telemetry-dock .tb-icon { display: inline-flex; align-items: center; flex-shrink: 0; }
    .telemetry-dock .tb-svg { opacity: .7; }
    .telemetry-dock .tb-val { font-weight: 500; color: var(--foreground, #ebebeb); color: color-mix(in srgb, var(--foreground, #ebebeb) 88%, transparent); }
    .telemetry-dock .tb-ttft .tb-val,
    .telemetry-dock .tb-unit { font-weight: 400; color: var(--muted-foreground, #8e8e93); }
    /* The cache state tints the cache's end of the bar and colors its value. */
    .telemetry-dock[data-cache-status="fresh"] .tb-cache { background-image: linear-gradient(90deg, color-mix(in srgb, #4ea84e 9%, transparent), transparent); }
    .telemetry-dock[data-cache-status="warning"] .tb-cache { background-image: linear-gradient(90deg, color-mix(in srgb, #d4940a 11%, transparent), transparent); }
    .telemetry-dock[data-cache-status="cold"] .tb-cache { background-image: linear-gradient(90deg, color-mix(in srgb, #e06c75 10%, transparent), transparent); }
    .telemetry-dock[data-cache-status="fresh"] .tb-single { background-image: linear-gradient(90deg, color-mix(in srgb, #4ea84e 8%, transparent), transparent 42%); }
    .telemetry-dock[data-cache-status="warning"] .tb-single { background-image: linear-gradient(90deg, color-mix(in srgb, #d4940a 9%, transparent), transparent 42%); }
    .telemetry-dock[data-cache-status="cold"] .tb-single { background-image: linear-gradient(90deg, color-mix(in srgb, #e06c75 9%, transparent), transparent 42%); }
    .telemetry-dock[data-cache-status="warning"] .tb-cache .tb-val,
    .telemetry-dock[data-cache-status="warning"] .tb-single .tb-val,
    .telemetry-dock[data-cache-status="warning"] .tb-single-sub { color: #d4940a; }
    .telemetry-dock[data-cache-status="cold"] .tb-cache .tb-val,
    .telemetry-dock[data-cache-status="cold"] .tb-single .tb-val { opacity: .46; }
    .telemetry-dock[data-cache-status="cold"] .tb-single-sub { color: #e06c75; }
    .telemetry-dock[data-cache-status="idle"] .tb-cache .tb-val,
    .telemetry-dock[data-cache-status="idle"] .tb-single .tb-val { font-weight: 400; color: var(--muted-foreground, #8e8e93); }
    /* The bolt takes the speed's color, by the capsule's own thresholds. */
    .telemetry-dock .tb-speed[data-speed-tier="green"] .tb-svg { color: light-dark(#16a34a, #4ea84e); opacity: .9; }
    .telemetry-dock .tb-speed[data-speed-tier="yellow"] .tb-svg { color: light-dark(#d97706, #d4940a); opacity: .9; }
    .telemetry-dock .tb-speed[data-speed-tier="red"] .tb-svg { color: light-dark(#dc2626, #e06c75); opacity: .9; }
    /* Inside the context card the bar runs along the card's lower edge, as in the footer panel. */
    @container stats (min-width: 420px) {
      body[data-compact-telemetry-bar="true"] .stats-context { overflow: hidden; }
      body[data-compact-telemetry-bar="true"] .telemetry-dock {
        margin: var(--agy-section-gap, 6px) calc((var(--agy-pad-x, 10px) + 2px) * -1) calc((var(--agy-pad-y, 8px) + 2px) * -1);
        border-width: 1px 0 0;
        border-radius: 0;
      }
      .telemetry-dock .tb-single { padding: 6px calc(var(--agy-pad-x, 10px) + 2px); }
    }
    /* The bar can sit at the top of the context statistics instead: a flat row over a hairline, like
       the Cache row it stands in for, without the dock's box, tint and hover. */
    body[data-compact-telemetry-bar="true"][data-telemetry-bar-position="top"] .stats-context { display: flex; flex-direction: column; }
    body[data-compact-telemetry-bar="true"][data-telemetry-bar-position="top"] .telemetry-dock {
      order: -1;
      margin: 0 0 var(--agy-section-gap, 6px);
      padding-bottom: var(--agy-section-gap, 6px);
      border: 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border, rgba(142, 142, 147, 0.24)) 64%, transparent);
      border-radius: 0;
      background: none;
    }
    body[data-compact-telemetry-bar="true"][data-telemetry-bar-position="top"] .telemetry-dock .tb-cell { padding: 0 3px; background: none; }
    body[data-compact-telemetry-bar="true"][data-telemetry-bar-position="top"] .telemetry-dock .tb-cell:first-child { justify-content: flex-start; padding-left: 0; }
    body[data-compact-telemetry-bar="true"][data-telemetry-bar-position="top"] .telemetry-dock .tb-cell:last-child { justify-content: flex-end; padding-right: 0; }
    body[data-compact-telemetry-bar="true"][data-telemetry-bar-position="top"] .telemetry-dock .tb-single { padding: 0; background: none; }
    @media (prefers-reduced-motion: no-preference) {
      .telemetry-dock .tb-cell { transition: background-color .14s ease; }
    }
    body[data-label-case="lowercase"] .panel .cache-left,
    body[data-label-case="lowercase"] .panel .used-pct,
    body[data-label-case="lowercase"] .panel .item-label,
    body[data-label-case="lowercase"] .panel .turn-bar-label,
    body[data-label-case="lowercase"] .panel .turn-bar-short,
    body[data-label-case="lowercase"] .panel .tb-single-label,
    body[data-label-case="lowercase"] .panel .usage-title,
    body[data-label-case="lowercase"] .panel .usage-seg button,
    body[data-label-case="lowercase"] .panel .usage-total > span,
    body[data-label-case="lowercase"] .panel .usage-legend,
    body[data-label-case="lowercase"] .panel .quota-label { text-transform: lowercase; }
    .cdp-notice { max-width: 1120px; margin: 0 auto 10px; padding: 8px 10px; border-radius: 7px; border: 1px solid color-mix(in srgb, #e0a030 45%, transparent); background: color-mix(in srgb, #e0a030 8%, var(--background, #141414)); font-size: 12px; color: var(--muted-foreground, #8e8e93); }
    #health-code { text-align: end; font-size: 12px; color: var(--muted-foreground, #8e8e93); }
    #sidebar-stats[data-stale="true"] .stats-layout { opacity: .75; }
    #sidebar-stats[data-context-pending] .stats-layout { visibility: hidden; }
    .cdp-notice[hidden] { display: none; }
    .cdp-notice-title { font-weight: 600; color: var(--foreground, #ebebeb); margin-bottom: 3px; }
    .cdp-notice p { margin: 0 0 4px; }
    .cdp-notice-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 5px 0; }
    .cdp-notice-actions[hidden] { display: none; }
    .cdp-fix-btn { padding: 3px 9px; border-radius: 5px; border: 1px solid color-mix(in srgb, #e0a030 55%, transparent); background: color-mix(in srgb, #e0a030 16%, var(--card, #222225)); color: var(--foreground, #ebebeb); font: inherit; font-size: 11.5px; font-weight: 500; cursor: pointer; }
    .cdp-fix-btn:hover:not(:disabled) { background: color-mix(in srgb, #e0a030 24%, var(--card, #222225)); }
    .cdp-fix-btn:disabled { opacity: .6; cursor: wait; }
    .cdp-fix-status { font-size: 11.5px; color: var(--foreground, #ebebeb); }
    .cdp-fix-status:empty { display: none; }
    .cdp-notice summary { cursor: pointer; color: var(--foreground, #ebebeb); }
    .cdp-notice ol { margin: 5px 0 0; padding-left: 18px; display: grid; gap: 4px; }
    .cdp-notice code, .metric-help code { user-select: text; font-family: ui-monospace, Consolas, monospace; font-size: 11px; padding: 0 3px; border-radius: 3px; background: color-mix(in srgb, var(--foreground, #ebebeb) 8%, transparent); color: var(--foreground, #ebebeb); box-decoration-break: clone; -webkit-box-decoration-break: clone; }
    .cdp-notice code { word-break: break-all; }
    .pv-mp-dot { width: 5px; height: 5px; border-radius: 50%; background: #e14d67; margin-right: 5px; flex-shrink: 0; transition: opacity .16s ease, width .16s ease, margin-right .16s ease; }
    .setting-model-card[data-show-model-dots="false"] .pv-mp-dot { width: 0; opacity: 0; margin-right: 0; }
    .setting-model-card .setting-preview { padding: 4px 2px; }
    .pv-mp { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; width: 100%; max-width: 100%; box-sizing: border-box; font-size: 11.5px; transition: opacity .18s ease; }
    .pv-mp-row { display: inline-flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 6px 2px 7px; border-radius: 6px; border: 1px solid color-mix(in srgb, var(--border, rgba(142,142,147,.28)) 85%, transparent); background: var(--card, color-mix(in srgb, var(--foreground, #ebebeb) 4%, var(--background, #141414))); box-shadow: 0 1px 2.5px rgba(0, 0, 0, .08); color: var(--foreground, #ebebeb); white-space: nowrap; flex: 0 1 auto; min-width: 0; max-width: 100%; box-sizing: border-box; }
    .pv-mp-row-main { display: inline-flex; align-items: center; min-width: 0; }
    .pv-mp-row-name { color: var(--foreground, #ebebeb); overflow: hidden; text-overflow: ellipsis; }
    .pv-mp-row-effort { display: inline-block; overflow: hidden; white-space: nowrap; max-width: 40px; margin-left: 5px; opacity: .75; color: var(--muted-foreground, #8e8e93); transition: max-width .2s ease, opacity .18s ease, margin-left .2s ease; }
    .pv-mp-row-tag { display: inline-flex; align-items: center; overflow: hidden; white-space: nowrap; max-width: 44px; margin-left: 5px; padding: 0 5px; border-radius: 999px; background: var(--secondary, rgba(142,142,147,.16)); color: var(--muted-foreground, #8e8e93); font-size: 10px; line-height: 15px; transition: max-width .2s ease, opacity .18s ease, margin-left .2s ease, padding .2s ease; }
    .pv-mp-row-chev { display: inline-flex; align-items: center; color: var(--muted-foreground, #8e8e93); opacity: .75; flex-shrink: 0; }
    .pv-mp-row-chev svg { width: 12px; height: 12px; display: block; }
    .setting-model-card[data-hide-default-effort="true"] .pv-mp-row-effort { max-width: 0; opacity: 0; margin-left: 0; }
    .setting-model-card[data-hide-model-tags="true"] .pv-mp-row-tag { max-width: 0; opacity: 0; margin-left: 0; padding-left: 0; padding-right: 0; }
    .pv-model-list { display: flex; flex-wrap: wrap; gap: 5px; padding-top: 4px; }
    .pv-model-list[hidden], .pv-model-list:empty { display: none; }
    .pv-model-item { width: auto; max-width: 100%; min-height: 22px; justify-content: center; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pv-model-item[data-active="true"] { border-color: #4ea84e; background: color-mix(in srgb, #4ea84e 14%, var(--card, #222225)); }
    .pv-model-empty { font-size: 11.5px; color: var(--muted-foreground, #8e8e93); padding: 2px 2px 0; }
    .pv-usage-heat { display: flex; gap: 2px; transition: opacity .18s ease; }
    .pv-usage-bars { display: flex; align-items: flex-end; gap: 3px; height: 18px; transition: opacity .18s ease; }
    .pv-usage-bars > span { display: flex; flex-direction: column; width: 6px; border-radius: 1.5px 1.5px 0 0; overflow: hidden; }
    .pv-usage-bars i { display: block; }
    [data-setting-card="showUsageActivity"][data-checked="false"] .pv-usage-heat,
    [data-setting-card="showModelUsage"][data-checked="false"] .pv-usage-bars { opacity: .4; }
    ${EFFORT_BAR_CSS}
    .pv-effort-bar { flex: 1 1 76px; min-width: 68px; max-width: 132px; display: flex; align-items: center; }
    .pv-effort-bar .ces-inline { width: 100%; padding-top: 0; }
    .pv-effort-bar .ces-track { height: 14px; --ces-fill: calc(100% - 7px) !important; box-shadow: 0 0 8px rgba(228, 92, 118, 0.38), inset 0 1px 1.5px rgba(0, 0, 0, 0.24) !important; }
    .pv-effort-bar .ces-fill { border-radius: 7px 0 0 7px; overflow: hidden; }
    .pv-effort-bar .ces-knob { width: 14px; height: 14px; margin: -7px 0 0 -7px; }
    .pv-nebula { position: absolute; inset: 0; pointer-events: none; }
    .pv-nebula::after { content: ""; position: absolute; inset: 0 0 56% 0; background: linear-gradient(180deg, rgba(255,255,255,.18), transparent); }
    .pv-nebula i { position: absolute; height: 1.6px; border-radius: 999px; background: linear-gradient(90deg, transparent, rgba(224,146,108,.48) 65%, rgba(248,198,192,.92)); }
    .pv-nebula i:nth-child(1) { top: 24%; left: 10%; width: 22%; }
    .pv-nebula i:nth-child(2) { top: 52%; left: 28%; width: 28%; height: 1.8px; }
    .pv-nebula i:nth-child(3) { top: 76%; left: 16%; width: 20%; opacity: .78; }
    .pv-nebula i:nth-child(4) { top: 30%; left: 58%; width: 24%; }
    .pv-nebula i:nth-child(5) { top: 68%; left: 64%; width: 22%; height: 1.5px; }
    .setting-model-card:not([data-effort-bar="true"]) .pv-effort-bar { display: none; }
    .setting-pair-item > .setting-head { display: inline-flex; align-items: center; gap: 6px; }
    .settings-fx { container-type: inline-size; container-name: fx-panel; }
    .settings-fx > .settings-scope:first-child { margin-top: 0; padding-top: 2px; border-top: 0; }
    .fx-native-scope > .fx-toggle-head input[type="checkbox"] { margin-inline-start: auto; }
    .settings-fx .fx-toggle-head .setting-label { white-space: normal; flex-shrink: 1; }
    .settings-fx .setting-card[hidden], .settings-fx .setting-head[hidden] { display: none; }
    .settings-fx .setting-card.is-sub { padding-left: 9px; border-top: 0; padding-top: 2px; }
    .settings-fx .setting-card.is-sub::before { content: ""; position: absolute; left: 2px; top: 4px; bottom: 8px; width: 2px; border-radius: 99px; background: color-mix(in srgb, var(--border, rgba(142,142,147,.28)) 90%, transparent); }
    .settings-fx .setting-card.is-sub .setting-label { font-size: 12px; color: var(--muted-foreground, #8e8e93); }
    .settings-fx .setting-label { font-size: 12.5px; white-space: nowrap; flex-shrink: 0; }
    .settings-fx .setting-card.is-grid .setting-head { flex-direction: column; align-items: stretch; gap: 5px; }
    .settings-fx .setting-card.is-grid .fx-pick-wrap { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); width: 100%; margin-left: 0; gap: 4px; }
    .settings-fx .setting-card.is-grid .fx-swatch { width: 100%; padding: 3px 4px; }
    .fx-pick-wrap { flex-wrap: nowrap; justify-content: flex-end; gap: 3px; min-width: 0; }
    .fx-swatch { min-height: 24px; padding: 2px 5.5px; font-size: 11px; gap: 3px; white-space: nowrap; }
    .fx-swatch svg { width: 11.5px; height: 11.5px; flex-shrink: 0; }
    @container fx-panel (max-width: 242px) {
      .settings-fx .setting-head:not(.fx-toggle-head) { flex-direction: column; align-items: stretch; gap: 5px; }
      .fx-pick-wrap { flex-wrap: wrap; justify-content: flex-start; margin-left: 0; }
    }
    .fx-preview-card { margin-top: 4px; padding: 9px 10px; border-radius: 8px; }
    .fx-orch-stage { position: relative; height: 30px; width: 100%; border-radius: 999px; overflow: hidden; border: 0; padding: 0; cursor: pointer; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; background: transparent; transition: transform .14s cubic-bezier(.22,1,.36,1), border-radius .2s ease, margin-bottom .2s ease; }
    .fx-orch-stage[data-shape="claude"] { border-radius: 9px; }
    .fx-orch-stage[data-shape="dock"] { border-radius: 8px 8px 0 0; margin-bottom: 0; }
    .fx-orch-stage:active { transform: scale(.985); }
    .fx-orch-stage:focus-visible { outline: 2px solid #388bfd; outline-offset: 2px; }
    .fx-orch-label { position: relative; z-index: 2; display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; transition: color .2s ease, text-shadow .2s ease; }
    .fx-orch-label svg { width: 13px; height: 13px; flex-shrink: 0; }
    .fx-orch-badge { font-size: 9.5px; line-height: 1; padding: 2px 5px; border-radius: 99px; font-weight: 600; background: rgba(255,255,255,.22); color: #ffffff; transition: background-color .2s ease, color .2s ease; }
    .fx-orch-stage[aria-pressed="false"] .fx-orch-badge { background: rgba(var(--fx-dock-rgb, 139, 92, 246), .16); color: var(--fx-dock-accent, #8b5cf6); }
    .fx-pv-rows { display: flex; flex-direction: column; gap: 4px; transition: padding .2s ease, background-color .2s ease, box-shadow .2s ease, border-radius .2s ease; }
    .fx-preview-card[data-dock="true"] .fx-pv-rows { padding: 6px 6px 5px; border-radius: 0 0 8px 8px; background: rgba(var(--fx-dock-rgb, 139, 92, 246), .06); box-shadow: inset 1px 0 0 rgba(var(--fx-dock-rgb, 139, 92, 246), .42), inset -1px 0 0 rgba(var(--fx-dock-rgb, 139, 92, 246), .42), inset 0 -1px 0 rgba(var(--fx-dock-rgb, 139, 92, 246), .42), 0 6px 14px -4px rgba(var(--fx-dock-rgb, 139, 92, 246), .26); }
    .fx-pv-row { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 8px; width: 100%; padding: 1px 2px; border-radius: 6px; transition: background .12s ease; }
    .fx-preview-card[data-dots="false"] .fx-pv-row { grid-template-columns: 62px 1fr; }
    .fx-pv-row:hover { background: color-mix(in srgb, var(--foreground, #ebebeb) 5%, transparent); }
    .fx-pv-row-name { display: inline-flex; align-items: center; gap: 5px; padding: 0; border: 0; background: transparent; font: inherit; font-size: 11.5px; color: var(--muted-foreground, #8e8e93); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; text-align: left; }
    .fx-pv-row-name:focus-visible { outline: 2px solid #388bfd; outline-offset: 1px; border-radius: 4px; }
    .fx-pv-row[data-selected="true"] .fx-pv-row-name { color: var(--foreground, #ebebeb); font-weight: 600; }
    .fx-pv-row-dot { width: 5.5px; height: 5.5px; border-radius: 50%; flex-shrink: 0; opacity: .72; transition: opacity .14s ease, transform .14s ease; }
    .fx-pv-row[data-selected="true"] .fx-pv-row-dot { opacity: 1; transform: scale(1.22); }
    .fx-preview-card[data-dots="false"] .fx-pv-row-dot { display: none; }
    .fx-toggle-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; cursor: pointer; min-height: 24px; }
    .fx-toggle-head input[type="checkbox"] { appearance: none; -webkit-appearance: none; position: relative; margin: 0; flex-shrink: 0; width: 28px; height: 15px; border-radius: 99px; background: color-mix(in srgb, var(--foreground, #ebebeb) 13%, transparent); border: 1px solid color-mix(in srgb, var(--foreground, #ebebeb) 16%, transparent); cursor: pointer; transition: background .18s ease, border-color .18s ease; }
    .fx-toggle-head input[type="checkbox"]::after { content: ""; position: absolute; top: 1.5px; left: 1.5px; width: 10px; height: 10px; border-radius: 50%; background: var(--muted-foreground, #8e8e93); transform: translateX(0); transition: transform .18s cubic-bezier(.22,1,.36,1), background .18s ease; }
    .fx-toggle-head input[type="checkbox"]:checked { background: rgba(78, 168, 78, .24); border-color: rgba(78, 168, 78, .65); }
    .fx-toggle-head input[type="checkbox"]:checked::after { transform: translateX(13px); background: #4ea84e; }
    .fx-toggle-head input[type="checkbox"]:focus-visible { outline: 2px solid #388bfd; outline-offset: 1px; }
    .settings-fx[data-native-capsule="true"] .fx-toggle-head:has(:disabled),
    .settings-fx[data-native-capsule="true"] :disabled { cursor: not-allowed; }
    .fx-pv-track { position: relative; height: 20px; border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--foreground, #ebebeb) 10%, transparent); box-shadow: inset 0 1px 2px rgba(0,0,0,.22); transition: border-radius .16s ease; cursor: grab; touch-action: none; }
    .fx-pv-track[data-dragging="true"] { cursor: grabbing; }
    .fx-pv-track:focus-visible { outline: 2px solid #388bfd; outline-offset: 1px; }
    .fx-pv-track[data-shape="claude"] { border-radius: 6px; }
    .fx-pv-knob { position: absolute; top: 1px; width: 18px; height: 18px; border-radius: 999px; background: #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,.32); pointer-events: none; transform: translateX(-50%); transition: border-radius .16s ease, width .16s ease; z-index: 3; }
    .fx-pv-track[data-shape="claude"] .fx-pv-knob { width: 16px; border-radius: 5px; }
    .fx-pv-ticks { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
    .fx-pv-tick { position: absolute; top: 50%; width: 3px; height: 3px; border-radius: 50%; transform: translate(-50%, -50%); transition: opacity .16s ease, background-color .16s ease; }
    .fx-pv-track[data-shape="claude"] .fx-pv-tick { width: 2.5px; height: 5px; border-radius: 1px; }
    @media(pointer:coarse) { .pv-swatch { min-height: 40px; } }
  </style>
</head>
<body>
  <p id="panel-auth-notice" class="cdp-notice" style="margin: 12px; padding: 10px 12px" role="alert" hidden></p>
  <main class="sidebar-content">
  <div class="sidebar-nav">
    <div class="sidebar-tabs" role="tablist" aria-label="Sidebar 页面" data-view="stats">
      <span class="sidebar-toggle-track" aria-hidden="true"><span class="sidebar-toggle-thumb"></span></span>
      <button type="button" id="sidebar-tab-stats" role="tab" aria-selected="true" aria-controls="sidebar-stats" tabindex="0">统计</button>
      <button type="button" id="sidebar-tab-settings" role="tab" aria-selected="false" aria-controls="sidebar-settings" tabindex="-1">设置</button>
      <button type="button" id="sidebar-tab-fx" role="tab" aria-selected="false" aria-controls="sidebar-fx" tabindex="-1">模型</button>
    </div>
  </div>
  <div class="version-panel" id="version-panel">
    <div class="version-line">
      <strong id="version-number">${CURRENT_VERSION ? 'v' + CURRENT_VERSION : '—'}</strong>
      <div class="version-controls">
        <button type="button" class="pv-swatch" id="version-notify" aria-pressed="${DEFAULT_SETTINGS.notifyUpdates}" data-active="${DEFAULT_SETTINGS.notifyUpdates}" data-toggle-setting="notifyUpdates"></button>
        <button type="button" class="pv-swatch" id="version-check" aria-describedby="version-status"></button>
      </div>
    </div>
    <p class="version-feedback" id="version-status" role="status"></p>
    <div class="version-notice" id="version-notice" hidden>
      <div class="version-actions">
        <span class="version-icon" aria-hidden="true">
          <svg data-icon="download" viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/></svg>
          <svg data-icon="warning" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.2m0 3.6h.01"/></svg>
        </span>
        <div>
          <strong id="version-available" role="status" aria-atomic="true"></strong>
          <a id="version-release" target="_blank" rel="noopener noreferrer"></a>
        </div>
        <button type="button" id="version-update" aria-describedby="version-update-status"></button>
        <button type="button" id="version-dismiss"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="version-progress" aria-hidden="true"></div>
      <p class="version-feedback" id="version-update-status" role="status" aria-atomic="true"></p>
    </div>
  </div>
  <aside class="cdp-notice" id="cdp-notice" role="status" aria-atomic="true" hidden>
    <div class="cdp-notice-title" id="cdp-notice-title" data-cdp-i18n="cdpTitle">底栏胶囊未启用</div>
    <p id="cdp-notice-body" data-cdp-i18n="cdpBody"></p>
    <div class="cdp-notice-actions" id="cdp-notice-actions" hidden>
      <button type="button" class="cdp-fix-btn" id="cdp-fix-btn" data-cdp-i18n="cdpFixShortcutBtn"></button>
      <span class="cdp-fix-status" id="cdp-fix-status"></span>
    </div>
    <details>
      <summary id="cdp-notice-how" data-cdp-i18n="cdpHow">设置方法</summary>
      <ol>
        <li><span data-cdp-i18n="cdpScript"></span> <code>powershell -ExecutionPolicy Bypass -File scripts\\enable-cdp.ps1</code></li>
        <li><span data-cdp-i18n="cdpManual"></span> <code>--remote-debugging-port=0</code></li>
        <li data-cdp-i18n="cdpRestart"></li>
      </ol>
    </details>
    <div id="health-code"></div>
  </aside>
  <div class="panel sidebar-view" id="sidebar-stats" role="tabpanel" aria-labelledby="sidebar-tab-stats" tabindex="0">
    <div class="stats-layout">
      <section class="stats-context">
        <div class="cache-bar" id="row-cached">
          <div class="cache-left"><span data-i18n="cache">Cache</span><span class="cache-pct" id="val-cache-hit">0%</span><span class="cache-hit" id="cache-hit-ring"></span><span class="dot" id="dot-cached" style="display:inline-flex;align-items:center;justify-content:center;background:transparent"></span></div>
          <span class="cache-meter" id="cache-meter" hidden><span id="cache-meter-fill"></span></span>
          <div class="cache-k" id="val-cache-hit-k"></div>
        </div>

        <div class="summary-row">
          <div class="used-pct" data-context-tip="overview"><span id="used-pct">0%</span> <span data-i18n="used">used</span></div>
          <div class="used-fraction" id="used-fraction" data-context-tip="overview">0 / --</div>
        </div>

        <div class="progress-track" id="progress-track" data-context-tip="overview">
          <div class="seg" id="seg-turn0" data-cat="turn0" style="width: 0%; background: #d4940a"></div>
          <div class="seg" id="seg-read" data-cat="read" style="width: 0%; background: #388bfd"></div>
          <div class="seg" id="seg-think" data-cat="think" style="width: 0%; background: #00b386"></div>
          <div class="seg" id="seg-out" data-cat="write" style="width: 0%; background: #e86a24"></div>
        </div>

        <div class="list">
          <div class="item-row" id="row-turn0" data-cat="turn0" data-context-tip="turn0">
            <span class="dot" style="background:#d4940a"></span>
            <div class="item-body"><span class="item-label" data-i18n="turn0">Turn0</span><span class="item-k" id="val-turn0-k">0</span><span class="item-pct" id="val-turn0-pct">0%</span></div>
          </div>

          <div class="item-row" id="row-read" data-cat="read" data-context-tip="read">
            <span class="dot" style="background:#388bfd"></span>
            <div class="item-body"><span class="item-label" data-i18n="read">Read</span><span class="item-k" id="val-read-k">0</span><span class="item-pct" id="val-read-pct">0%</span></div>
          </div>

          <div class="item-row" id="row-think" data-cat="think" data-context-tip="think">
            <span class="dot" style="background:#00b386"></span>
            <div class="item-body"><span class="item-label" data-i18n="think">Think</span><span class="item-k" id="val-think-k">0</span><span class="item-pct" id="val-think-pct">0%</span></div>
          </div>

          <div class="item-row" id="row-out" data-cat="write" data-context-tip="write">
            <span class="dot" style="background:#e86a24"></span>
            <div class="item-body"><span class="item-label" data-i18n="write">Write</span><span class="item-k" id="val-out-k">0</span><span class="item-pct" id="val-out-pct">0%</span></div>
          </div>
        </div>

        <div class="generation-block" data-generation-block>
          ${presentation.generationMarkup()}
        </div>
        ${presentation.turnMetricsMarkup()}
        ${presentation.telemetryBarMarkup('telemetry-dock')}
      </section>
      <div class="divider"></div>
      <div id="quota-root" class="stats-quota"></div>
      <section class="stats-usage" id="usage-root" hidden>
        <div class="usage-block" id="usage-activity" hidden></div>
        <div class="usage-block" id="usage-models" hidden></div>
      </section>
    </div>
  </div>

  <section class="settings sidebar-view" id="sidebar-settings" role="tabpanel" aria-labelledby="sidebar-tab-settings" tabindex="0" hidden>
    ${renderPickCard('settingsLanguage', [
      ['en', '', 'EN'],
      ['zh-CN', '', '简'],
      ['zh-TW', '', '繁'],
    ])}
    ${renderPickCard('language', [
      ['en', '', 'EN'],
      ['zh-CN', '', '简'],
      ['zh-TW', '', '繁'],
    ], { helpId: 'language-scope', tip: 'languageScopeNote' })}

    <div class="settings-scope" data-i18n="appearanceSection"></div>
    ${renderPickCard('uiSkin', [
      ['native', 'nativeSkin', '<span data-i18n="nativeSkin"></span>'],
      ['frosted', 'frostedSkin', '<span data-i18n="frostedSkin"></span>'],
    ])}
    ${renderPickCard('panelLayout', [
      ['natural', 'naturalLayout', '<span class="pv-ico-layout"><i class="pv-il-tall"></i><i class="pv-il-short"></i></span>'],
      ['matched', 'matchedLayout', '<span class="pv-ico-layout"><i class="pv-il-tall"></i><i class="pv-il-tall"></i></span>'],
    ])}
    ${renderPickCard('density', [
      ['compact', 'compact', '<span class="pv-ico-density pv-id-compact"><i></i><i></i><i></i></span>'],
      ['standard', 'standard', '<span class="pv-ico-density pv-id-standard"><i></i><i></i><i></i></span>'],
      ['spacious', 'spacious', '<span class="pv-ico-density pv-id-spacious"><i></i><i></i><i></i></span>'],
    ])}
    ${renderPickCard('labelCase', [
      ['lowercase', 'lowercase', 'aa'],
      ['titlecase', 'titlecase', 'Aa'],
    ])}
    ${renderPickCard('quotaIndicator', [
      ['ring', 'ring', PV_SVG.ring],
      ['bar', 'bar', '<span class="pv-ico-bar"><i></i></span>'],
    ])}
    ${renderPickCard('cacheIndicator', [
      ['icon', 'cacheIndicatorIcon', PV_SVG.check],
      ['ring', 'ring', PV_SVG.ring],
      ['bar', 'bar', '<span class="pv-ico-bar"><i></i></span>'],
    ])}
    ${renderPickCard('cacheHitFormat', [
      ['percent', 'cacheHitPercent', '78%'],
      ['ring', 'ring', PV_SVG.hitRing],
      ['both', 'cacheHitBoth', '78%' + PV_SVG.hitRing],
    ])}
    ${renderPickCard('resetFormat', [
      ['compact', 'compactTime', '4h 55m'],
      ['localized', 'localizedTime', '<span data-stats-i18n="localizedTimeSample"></span>'],
    ])}
    ${renderCheckCard({ id: 'setting-pop-animation', key: 'popAnimation', checked: DEFAULT_SETTINGS.popAnimation })}

    <div class="settings-scope" data-settings-scope="features" data-i18n="featuresSection"></div>
    ${renderCheckCard({ id: 'setting-highlight-active-model', key: 'highlightActiveModel', checked: false })}
    ${renderCheckCard({ id: 'setting-hide-unavailable-quota', key: 'hideUnavailableQuota', checked: DEFAULT_SETTINGS.hideUnavailableQuota })}
    ${renderCheckCard({ id: 'setting-quota-dividers', key: 'showQuotaDividers', checked: DEFAULT_SETTINGS.showQuotaDividers })}
    <div class="setting-card setting-threshold-card" data-setting-card="showCacheWarnings" data-checked="${DEFAULT_SETTINGS.showCacheWarnings}">
      <div class="setting-head setting-pair-head">
        <div class="setting-pair-item">
          <label class="setting-check">
            <input id="setting-cache-warnings" name="showCacheWarnings" type="checkbox"${DEFAULT_SETTINGS.showCacheWarnings ? ' checked' : ''} />
            <span data-i18n="showCacheWarnings"></span>
          </label>
        </div>
        <div class="setting-thresholds">
          <label class="setting-num" data-input-setting="cacheWarnMin">
            <span class="setting-num-dot setting-num-warn" aria-hidden="true"></span>
            <input id="setting-cache-warn-min" name="cacheWarnMin" type="number" min="1" max="998" step="1" value="${DEFAULT_SETTINGS.cacheWarnMin}" inputmode="numeric" />
            <span class="setting-num-unit">m</span>
          </label>
          <label class="setting-num" data-input-setting="cacheColdMin">
            <span class="setting-num-dot setting-num-cold" aria-hidden="true"></span>
            <input id="setting-cache-cold-min" name="cacheColdMin" type="number" min="2" max="999" step="1" value="${DEFAULT_SETTINGS.cacheColdMin}" inputmode="numeric" />
            <span class="setting-num-unit">m</span>
          </label>
        </div>
      </div>
      <div class="setting-preview" aria-hidden="true">${PV_CARD_PREVIEW.showCacheWarnings}</div>
    </div>
    ${renderCheckCard({ id: 'setting-context-warnings', key: 'showContextWarnings', checked: true })}
    ${renderCheckCard({ id: 'setting-request-errors', key: 'showRequestErrors', checked: true })}
    ${renderCheckCard({ id: 'setting-notify-cdp-restart', helpId: 'notify-cdp-restart', key: 'notifyCdpRestart', tip: 'cdpRestartPreview', checked: DEFAULT_SETTINGS.notifyCdpRestart })}
    <div class="setting-card setting-speed-pair metric-setting" data-setting-card="showSpeed" data-checked="true" data-speed-fx="false">
      <div class="setting-head setting-pair-head">
        <div class="setting-pair-item">
          <label class="setting-check">
            <input id="setting-show-speed" name="showSpeed" type="checkbox" checked aria-describedby="help-speed-pair" />
            <span data-i18n="showSpeed"></span>
          </label>
        </div>
        <div class="setting-pair-item" data-setting-card="speedAnimation" data-checked="false" data-parent-off="false">
          <label class="setting-check">
            <input id="setting-speed-animation" name="speedAnimation" type="checkbox" aria-describedby="help-speed-pair" />
            <span data-i18n="speedAnimation"></span>
          </label>
        </div>
        <span class="setting-help-dot" aria-hidden="true">?</span>
      </div>
      <div class="setting-preview" aria-hidden="true">
        <div class="pv-speed-cap">
          <span class="pv-pill">${PV_SVG.db}<span>42%</span><span class="pv-sc-val"><span class="pv-sa-dot"></span><span>38.4 tok/s</span></span></span>
        </div>
      </div>
      <div class="metric-help" id="help-speed-pair" role="tooltip" data-i18n="speedPairTip"></div>
    </div>
    <div class="setting-card setting-option-card" data-setting-card="showContextBreakdown" data-layout-key="contextLayout" data-checked="true" data-layout="columns">
      <div class="setting-head setting-pair-head">
        <div class="setting-pair-item"><label class="setting-check"><input id="setting-show-context-breakdown" name="showContextBreakdown" type="checkbox" checked /><span data-i18n="showContextBreakdown"></span></label></div>
        <div class="setting-opts">${renderSeg('contextLayout', LAYOUT_OPTIONS)}<span class="setting-opts-extra" data-for-layout="rows">${renderSeg('contextMarker', MARKER_OPTIONS)}</span></div>
      </div>
    </div>
    <div class="pv-detail-pop" data-preview-group="context" data-open="true" data-layout="columns">
      <div class="pv-detail-card pv-fields" data-for-layout="columns" data-field-editor data-order-setting="columnOrder">${renderFieldEditor(DEFAULT_SETTINGS, presentation.dictionaries.en)}</div>
      <div class="pv-detail-card pv-live" data-for-layout="rows" aria-hidden="true"><div class="list">
        ${PV_CONTEXT_ITEMS.map(([key, color, value, pct]) => `<div class="item-row"><span class="dot" style="background:${color}"></span><div class="item-body"><span class="item-label" data-i18n="${key}"></span><span class="item-k">${value}</span><span class="item-pct">${pct}</span></div></div>`).join('')}
      </div></div>
    </div>
    ${renderCheckCard({ id: 'setting-highlight-context-hover', key: 'highlightContextHover', checked: DEFAULT_SETTINGS.highlightContextHover })}
    ${renderCheckCard({ id: 'setting-show-request-metrics', helpId: 'request-metrics', key: 'showRequestMetrics', tip: 'requestSectionTip', checked: true })}
    <div class="setting-card setting-option-card" data-setting-card="compactTelemetryBar" data-checked="${DEFAULT_SETTINGS.compactTelemetryBar}">
      <div class="setting-head setting-pair-head">
        <div class="setting-pair-item"><label class="setting-check"><input id="setting-compact-telemetry-bar" name="compactTelemetryBar" type="checkbox"${DEFAULT_SETTINGS.compactTelemetryBar ? ' checked' : ''} /><span data-i18n="compactTelemetryBar"></span></label></div>
        <div class="setting-opts setting-seg-text">${renderSeg('telemetryBarPosition', BAR_POSITION_OPTIONS)}</div>
      </div>
      <div class="setting-preview" aria-hidden="true">${PV_CARD_PREVIEW.compactTelemetryBar}</div>
    </div>
    <div class="setting-card setting-option-card metric-setting" data-setting-card="showTurnMetrics" data-layout-key="turnLayout" data-checked="${DEFAULT_SETTINGS.showTurnMetrics}" data-layout="columns">
      <div class="setting-head setting-pair-head">
        <div class="setting-pair-item"><label class="setting-check"><input id="setting-show-turn-metrics" name="showTurnMetrics" type="checkbox"${DEFAULT_SETTINGS.showTurnMetrics ? ' checked' : ''} aria-describedby="help-turn-metrics" /><span data-i18n="showTurnMetrics"></span></label></div>
        <div class="setting-opts-with-help">
          <div class="setting-opts">${renderSeg('turnLayout', LAYOUT_OPTIONS)}<span class="setting-opts-extra" data-for-layout="rows">${renderSeg('turnMarker', MARKER_OPTIONS)}</span></div>
          <span class="setting-help-dot" aria-hidden="true">?</span>
        </div>
      </div>
      <div class="metric-help" id="help-turn-metrics" role="tooltip" data-i18n="turnSectionTip"></div>
    </div>
    <div class="pv-detail-pop" data-preview-group="turn" data-open="${DEFAULT_SETTINGS.showTurnMetrics}" aria-hidden="true">
      <div class="pv-detail-card pv-live"><div class="turn-bar-list">
        ${PV_TURN_ITEMS.map(([key, labelKey, value]) => `<div class="turn-bar-item" data-turn-row="${key}"><span class="turn-bar-line"></span><span class="turn-bar-label" data-i18n="${labelKey}"></span>${key === 'requests' ? '<span class="turn-bar-short" data-i18n="turnReqsShort" aria-hidden="true">Re</span>' : ''}<span class="turn-bar-val">${value}</span></div>`).join('')}
      </div></div>
    </div>
    <div class="setting-card setting-threshold-card" data-setting-card="showQueueWarnings" data-checked="${DEFAULT_SETTINGS.showQueueWarnings}">
      <div class="setting-head setting-pair-head">
        <div class="setting-pair-item">
          <label class="setting-check">
            <input id="setting-queue-warnings" name="showQueueWarnings" type="checkbox"${DEFAULT_SETTINGS.showQueueWarnings ? ' checked' : ''} />
            <span data-i18n="showQueueWarnings"></span>
          </label>
        </div>
        <div class="setting-thresholds">
          <label class="setting-num" data-input-setting="queueWarnSec">
            <span class="setting-num-dot setting-num-warn" aria-hidden="true"></span>
            <input id="setting-queue-warn-sec" name="queueWarnSec" type="number" min="1" max="999" step="1" value="${DEFAULT_SETTINGS.queueWarnSec}" inputmode="numeric" />
            <span class="setting-num-unit">s</span>
          </label>
        </div>
      </div>
      <div class="setting-preview" aria-hidden="true">${PV_CARD_PREVIEW.showQueueWarnings}</div>
    </div>

    <div class="settings-scope metric-setting" data-settings-scope="usage">
      <div class="setting-head" tabindex="0" aria-describedby="help-usage-scope">
        <span class="settings-scope-title" data-i18n="usageSection"></span>
        <span class="setting-help-dot" aria-hidden="true">?</span>
      </div>
      <div class="metric-help" id="help-usage-scope" role="tooltip" data-i18n="usageSectionTip"></div>
    </div>
    ${renderCheckCard({ id: 'setting-usage-activity', key: 'showUsageActivity', checked: DEFAULT_SETTINGS.showUsageActivity })}
    ${renderCheckCard({ id: 'setting-model-usage', key: 'showModelUsage', checked: DEFAULT_SETTINGS.showModelUsage })}
  </section>

  <section class="settings settings-fx sidebar-view" id="sidebar-fx" role="tabpanel" aria-labelledby="sidebar-tab-fx" tabindex="0" hidden>
    <div class="settings-scope metric-setting fx-native-scope">
      <label class="setting-head fx-toggle-head" data-setting-card="modelEffortPicker">
        <span class="setting-label" data-i18n="nativeModelCapsule"></span>
        <span class="setting-help-dot" aria-hidden="true">?</span>
        <input id="setting-native-model-capsule" name="modelEffortPicker" type="checkbox" aria-describedby="help-native-model-capsule"${DEFAULT_SETTINGS.modelEffortPicker ? '' : ' checked'} />
      </label>
      <div class="metric-help" id="help-native-model-capsule" role="tooltip" data-i18n="nativeModelCapsuleTip"></div>
    </div>
    <div class="setting-card setting-model-card" data-hide-model-tags="${DEFAULT_SETTINGS.hideModelTags}" data-hide-default-effort="${DEFAULT_SETTINGS.hideDefaultEffort}" data-show-model-dots="${DEFAULT_SETTINGS.showModelDots}">
      <label class="fx-toggle-head" data-setting-card="hideModelTags">
        <span class="setting-label" data-i18n="hideModelTags"></span>
        <input id="setting-hide-model-tags" name="hideModelTags" type="checkbox"${DEFAULT_SETTINGS.hideModelTags ? ' checked' : ''} />
      </label>
      <label class="fx-toggle-head" data-setting-card="hideDefaultEffort">
        <span class="setting-label" data-i18n="hideDefaultEffort"></span>
        <input id="setting-hide-default-effort" name="hideDefaultEffort" type="checkbox"${DEFAULT_SETTINGS.hideDefaultEffort ? ' checked' : ''} />
      </label>
      <label class="fx-toggle-head" data-setting-card="showModelDots">
        <span class="setting-label" data-i18n="showModelDots"></span>
        <input id="setting-show-model-dots" name="showModelDots" type="checkbox"${DEFAULT_SETTINGS.showModelDots ? ' checked' : ''} />
      </label>
      <label class="fx-toggle-head" data-setting-card="customizeModelList">
        <span class="setting-label" data-i18n="customizeModelList"></span>
        <input id="setting-customize-model-list" name="customizeModelList" type="checkbox" aria-controls="setting-model-list"${DEFAULT_SETTINGS.customizeModelList ? ' checked' : ''} />
      </label>
      <div class="pv-model-list" id="setting-model-list" data-toggle-setting="hiddenModels" role="group" hidden></div>
      <label class="fx-toggle-head" data-setting-card="showEffortBar">
        <span class="setting-label" data-i18n="showEffortBar"></span>
        <input name="showEffortBar" type="checkbox"${DEFAULT_SETTINGS.showEffortBar ? ' checked' : ''} />
      </label>
      <div class="setting-preview" aria-hidden="true">
        <div class="pv-mp">
          <span class="pv-mp-row">
            <span class="pv-mp-row-main"><span class="pv-mp-dot"></span><span class="pv-mp-row-name">Gemini 4 Neon</span><span class="pv-mp-row-effort">High</span><span class="pv-mp-row-tag">New</span></span>
            <span class="pv-mp-row-chev"><svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></svg></span>
          </span>
          <div class="pv-effort-bar">${EFFORT_TRACK_MARKUP}</div>
        </div>
      </div>
    </div>

    <div class="settings-scope metric-setting" data-settings-scope="fx-slider">
      <div class="setting-head" tabindex="0" aria-describedby="help-effort-bar">
        <span class="settings-scope-title" data-i18n="fxSliderSection"></span>
        <span class="setting-help-dot" aria-hidden="true">?</span>
      </div>
      <div class="metric-help" id="help-effort-bar" role="tooltip"><span data-i18n="effortBarCredit"></span><code>LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider</code><span data-i18n="effortBarCreditSuffix"></span></div>
    </div>
    ${renderFxPickCard('effortTheme', [
      ['auto', 'themeAuto'],
      ['gemini', 'themeGemini'],
      ['claude', 'themeClaude'],
      ['codex', 'themeCodex'],
    ])}
    <div class="setting-card is-sub" id="fx-slider-themes-card">
      <div class="setting-head" id="fx-gemini-card" data-setting-card="geminiTheme"><span class="setting-label" data-i18n="geminiTheme"></span>
        <div class="pv-pick-inline fx-pick-wrap">
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="geminiTheme" data-pick-value="physical" data-pick-label="geminiPhysical"><span data-i18n="geminiPhysical"></span></button>
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="geminiTheme" data-pick-value="ribbon" data-pick-label="geminiRibbon"><span data-i18n="geminiRibbon"></span></button>
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="geminiTheme" data-pick-value="nebula" data-pick-label="geminiNebula"><span data-i18n="geminiNebula"></span></button>
        </div>
      </div>
      <div class="setting-head" id="fx-claude-card" data-setting-card="claudeTheme"><span class="setting-label" data-i18n="claudeTheme"></span>
        <div class="pv-pick-inline fx-pick-wrap">
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="claudeTheme" data-pick-value="matrix" data-pick-label="claudeMatrix"><span data-i18n="claudeMatrix"></span></button>
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="claudeTheme" data-pick-value="bars" data-pick-label="claudeBars"><span data-i18n="claudeBars"></span></button>
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="claudeTheme" data-pick-value="spark" data-pick-label="claudeSpark"><span data-i18n="claudeSpark"></span></button>
        </div>
      </div>
    </div>
    ${renderFxPickCard('effortMotion', [
      ['fast', 'motionFast'],
      ['full', 'motionFull'],
    ])}
    ${renderFxPickCard('effortTicks', [
      ['highlight', 'ticksHighlight'],
      ['dim', 'ticksDim'],
      ['hidden', 'ticksHidden'],
    ])}

    <div class="settings-scope" data-i18n="fxOrchestratorSection"></div>
    ${renderFxPickCard('orchestratorMode', [
      ['follow', 'orchModeFollow'],
      ['dock', 'orchModeDock'],
      ['custom3d', 'orchModeCustom3d'],
    ])}
    <div class="setting-card is-sub" id="fx-orch-custom3d-card" data-setting-card="orchestrator3dStyle" hidden>
      <div class="setting-head"><span class="setting-label" data-i18n="geminiTheme"></span>
        <div class="pv-pick-inline fx-pick-wrap">
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="orchestrator3dStyle" data-pick-value="chamber" data-pick-label="orch3dChamber"><span data-i18n="orch3dChamber"></span></button>
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="orchestrator3dStyle" data-pick-value="helix" data-pick-label="orch3dHelix"><span data-i18n="orch3dHelix"></span></button>
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="orchestrator3dStyle" data-pick-value="orbital" data-pick-label="orch3dOrbital"><span data-i18n="orch3dOrbital"></span></button>
        </div>
      </div>
      <div class="setting-head"><span class="setting-label" data-i18n="claudeTheme"></span>
        <div class="pv-pick-inline fx-pick-wrap">
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="orchestrator3dStyle" data-pick-value="c-matrix" data-pick-label="orch3dMatrix"><span data-i18n="orch3dMatrix"></span></button>
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="orchestrator3dStyle" data-pick-value="c-louver" data-pick-label="orch3dLouver"><span data-i18n="orch3dLouver"></span></button>
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="orchestrator3dStyle" data-pick-value="c-spark" data-pick-label="orch3dSpark"><span data-i18n="orch3dSpark"></span></button>
        </div>
      </div>
      <div class="setting-head"><span class="setting-label" data-i18n="codexTheme"></span>
        <div class="pv-pick-inline fx-pick-wrap">
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="orchestrator3dStyle" data-pick-value="nebula" data-pick-label="codexNebula"><span data-i18n="codexNebula"></span></button>
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="orchestrator3dStyle" data-pick-value="beam" data-pick-label="codexBeam"><span data-i18n="codexBeam"></span></button>
          <button type="button" class="pv-swatch fx-swatch" data-pick-setting="orchestrator3dStyle" data-pick-value="orb" data-pick-label="codexOrb"><span data-i18n="codexOrb"></span></button>
        </div>
      </div>
    </div>
    ${renderFxPickCard('orchestratorIcon', [
      ['prism', 'orchIconPrism', FX_ICON_SVG.prism],
      ['gravity', 'orchIconGravity', FX_ICON_SVG.gravity],
      ['semicircle', 'orchIconSemicircle', FX_ICON_SVG.semicircle],
      ['none', 'orchIconNone'],
    ])}

    <div class="settings-scope" data-i18n="fxPreviewSection"></div>
    <div class="pv-detail-card fx-preview-card">
      <button type="button" id="fx-orch-stage" class="fx-orch-stage" data-fx-preview="orch" aria-pressed="true" data-shape="pill">
        <canvas id="fx-orch-canvas" style="position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;"></canvas>
        <span id="fx-orch-label" class="fx-orch-label"></span>
      </button>
      <div id="fx-preview-rows" class="fx-pv-rows"></div>
    </div>
  </section>

  </main>
  <script>
    ${getPresentationScript()}
    const presentation = globalThis.__agyCapsulePresentation;
    const usageUi = (${createUsagePresentation.toString()})(presentation.formatTokens, presentation.escapeHtml);
    const motionThemesApi = (${createMotionThemes.toString()})();
    const FX_ICONS = ${JSON.stringify(FX_ICON_SVG)};
    ${renderFieldEditor.toString()}
    let prefs = ${JSON.stringify(DEFAULT_SETTINGS)};
    let prefsSig = JSON.stringify(prefs);
    let labels = presentation.apply(document.body, prefs);
    let settingsLabels = presentation.dictionaries[prefs.settingsLanguage];
    const versionPanel = (${createVersionPanel.toString()})(
      document.getElementById('version-panel'),
      async mode => {
        const res = await postApi('${VERSION_ROUTE}', { mode }, AbortSignal.timeout(6000));
        return res.json();
      },
      saveSettings,
      async version => {
        const res = await postApi('${UPDATE_ROUTE}', { version }, AbortSignal.timeout(60_000));
        return res.json();
      },
    );
    let savingSettings = false;
    let settingsEpoch = 0;
    let lastData = null, refreshing = false, refreshFailures = 0;
    let conversationId = null, conversationEpoch = 0;
    let sampleCode = '', sampleCount = 0, healthCode = '';
    // Usage history: fetched only while a setting shows it, and then about once a minute.
    let usageData = null;
    let usageDueAt = 0;
    let usageBusy = false;
    let usageScale = 'day';
    let usagePeriod = 'day';
    let usageShift = 0;
    const usageKeys = { activity: '', models: '' };
    function usageBlocks() {
      return { activity: prefs.showUsageActivity === true, models: prefs.showModelUsage === true };
    }
    function usageEnabled() {
      const shown = usageBlocks();
      return shown.activity || shown.models;
    }
    function renderUsage() {
      const shown = usageBlocks();
      const root = document.getElementById('usage-root');
      const hidden = !usageEnabled();
      if (root.hidden !== hidden) root.hidden = hidden;
      const common = { today: usageUi.localDay(Date.now()), language: document.body.dataset.language };
      const views = { activity: { ...common, scale: usageScale }, models: { ...common, period: usagePeriod, shift: usageShift, showUnread: !shown.activity } };
      for (const name of ['activity', 'models']) {
        const block = document.getElementById('usage-' + name);
        if (block.hidden === shown[name]) block.hidden = !shown[name];
        if (!shown[name]) continue;
        const key = JSON.stringify([usageData, views[name]]);
        if (key === usageKeys[name]) continue;
        usageKeys[name] = key;
        block.innerHTML = name === 'activity' ? usageUi.activityHtml(usageData, views.activity) : usageUi.modelsHtml(usageData, views.models);
      }
    }
    async function refreshUsage() {
      if (usageBusy || savingSettings || panelLocked || !usageEnabled() || sidebarView !== 'stats' || Date.now() < usageDueAt) return;
      usageBusy = true;
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const convId = window.sidecar?.conversationId ?? urlParams.get('conversationId') ?? '';
        // A first scan of a long history can take a while; give up on a request that hangs.
        const d = await (await postApi('/api/usage', { conversationId: convId }, AbortSignal.timeout(30000))).json();
        if (d?.enabled === false) { usageDueAt = 0; return; }
        if (!Array.isArray(d.days)) throw new Error('usage unavailable');
        usageData = d;
        usageDueAt = Date.now() + 60000;
        renderUsage();
      } catch {
        usageDueAt = Date.now() + 10000;
      } finally {
        usageBusy = false;
      }
    }
    document.getElementById('usage-root').addEventListener('click', event => {
      const control = event.target.closest('[data-usage-scale], [data-usage-period], [data-usage-shift]');
      if (!control || control.disabled) return;
      const { usageScale: scale, usagePeriod: period, usageShift: shift } = control.dataset;
      if (scale) usageScale = scale;
      if (period) { usagePeriod = period; usageShift = 0; }
      if (shift) usageShift = Math.min(0, usageShift + Number(shift));
      renderUsage();
      // The block was redrawn: keep the keyboard on the control that was used, or on the other
      // arrow once paging has run into its end.
      const used = document.querySelector(scale ? '[data-usage-scale="' + scale + '"]' : period ? '[data-usage-period="' + period + '"]' : '[data-usage-shift="' + shift + '"]');
      (used?.disabled ? document.querySelector('[data-usage-shift]:enabled') : used)?.focus();
    });
    const SIDEBAR_VIEWS = ['stats', 'settings', 'fx'];
    const sidebarTabs = document.querySelector('.sidebar-tabs');
    const fxSection = document.getElementById('sidebar-fx');
    const panel = document.querySelector('.panel');
    let statsSig, cacheSig, quotaSig;
    let sidebarView = 'stats';
    const sidebarScroll = { stats: 0, settings: 0, fx: 0 };
    function syncConversation() {
      const id = window.sidecar?.conversationId ?? new URLSearchParams(location.search).get('conversationId') ?? '';
      if (id !== conversationId) {
        const switched = conversationId !== null;
        conversationId = id;
        conversationEpoch++;
        lastData = null;
        refreshFailures = sampleCount = 0;
        healthCode = sampleCode = '';
        if (sidebarView === 'stats') panel.setAttribute('data-context-pending', '');
        if (switched) renderHealthNotice();
      }
      return id;
    }
    function replayStats() {
      panel.toggleAttribute('data-context-pending', !lastData);
      if (lastData) renderData(lastData);
    }
    function selectSidebarView(view, focus = false) {
      if (!SIDEBAR_VIEWS.includes(view)) return;
      if (view !== sidebarView) {
        sidebarScroll[sidebarView] = window.scrollY;
        sidebarView = view;
        sidebarTabs.dataset.view = view;
        for (const name of SIDEBAR_VIEWS) {
          const selected = name === view;
          const tab = document.getElementById('sidebar-tab-' + name);
          tab.setAttribute('aria-selected', String(selected));
          tab.tabIndex = selected ? 0 : -1;
          document.getElementById('sidebar-' + name).hidden = !selected;
        }
        if (view === 'stats') {
          syncConversation();
          replayStats();
        }
        fxPreview.setActive(view === 'fx');
        renderHealthNotice();
        window.scrollTo({ top: sidebarScroll[view], behavior: 'instant' });
      }
      if (focus) document.getElementById('sidebar-tab-' + view).focus({ preventScroll: true });
    }
    for (const view of SIDEBAR_VIEWS) {
      document.getElementById('sidebar-tab-' + view).addEventListener('click', () => selectSidebarView(view));
    }
    sidebarTabs.querySelector('.sidebar-toggle-track').addEventListener('click', () => {
      const next = SIDEBAR_VIEWS[(SIDEBAR_VIEWS.indexOf(sidebarView) + 1) % SIDEBAR_VIEWS.length];
      selectSidebarView(next, true);
    });
    sidebarTabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const idx = SIDEBAR_VIEWS.indexOf(sidebarView);
      const view = event.key === 'Home' ? 'stats'
        : event.key === 'End' ? 'fx'
        : event.key === 'ArrowRight' ? SIDEBAR_VIEWS[(idx + 1) % SIDEBAR_VIEWS.length]
        : SIDEBAR_VIEWS[(idx - 1 + SIDEBAR_VIEWS.length) % SIDEBAR_VIEWS.length];
      selectSidebarView(view, true);
    });

    const fxPreview = (() => {
      const mt = motionThemesApi;
      const stageBtn = document.getElementById('fx-orch-stage');
      const previewCard = stageBtn?.closest('.fx-preview-card');
      const orchCanvas = document.getElementById('fx-orch-canvas');
      const orchLabel = document.getElementById('fx-orch-label');
      const rowsHost = document.getElementById('fx-preview-rows');
      if (!previewCard || !orchCanvas || !rowsHost) return { setActive() {}, syncPrefs() {} };

      const CLAUDE_MODELS = ['Claude Opus 4.6', 'Claude Sonnet 4.6', 'Claude Haiku 4.5'];
      const ROWS = [
        { id: 'neon', label: 'Neon', baseName: 'Gemini 4 Neon' },
        { id: 'argon', label: 'Argon', baseName: 'Gemini 4 Argon' },
        { id: 'hydrogen', label: 'Hydrogen', baseName: 'Gemini 4 Hydrogen' },
        { id: 'carbon', label: 'Carbon', baseName: 'Gemini 4 Carbon' },
        { id: 'flash', label: 'Flash', baseName: 'Gemini 3 Flash' },
        { id: 'claude', label: 'Claude', baseName: CLAUDE_MODELS[0] },
        { id: 'codex', label: 'Codex', baseName: 'GPT-5.4 Codex' },
      ];
      const TICK_STOPS = [0, 1 / 3, 2 / 3, 1];
      const TIER_NAMES = ['Low', 'Medium', 'High', 'Max'];
      const energyForPct = p => 0.14 + 0.86 * mt.clamp01(p);

      let active = false;
      let rafId = 0;
      let lastNow = 0;
      let targetPct = TICK_STOPS[2];
      let smoothPct = targetPct;
      let smoothEnergy = energyForPct(targetPct);
      let dragging = false;
      let selectedId = 'neon';
      let claudeSubIdx = 0;
      let orchOn = true;
      let orchAnimP = 1;
      let orchFrom = 1;
      let orchStart = 0;
      let orchPhase = 0;
      let fxClock = 0;
      let fxPrefsSig = '';
      const flows = {};
      const rowNodes = {};

      const isReduced = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      const isLightSurface = () => {
        try {
          const bg = getComputedStyle(document.body).backgroundColor || '';
          const p = bg.match(/[\\d.]+/g);
          if (!p || p.length < 3 || (p.length > 3 && Number(p[3]) < 0.5)) return false;
          return (0.2126 * Number(p[0]) + 0.7152 * Number(p[1]) + 0.0722 * Number(p[2])) / 255 >= 0.5;
        } catch {
          return false;
        }
      };

      const rowModelName = row => row.id === 'claude' ? CLAUDE_MODELS[claudeSubIdx] : row.baseName;
      const selectedRow = () => ROWS.find(r => r.id === selectedId) || ROWS[0];

      const replayOrch = () => {
        if (!orchOn) return;
        if (isReduced()) {
          orchAnimP = 1;
          orchFrom = 1;
          paintOnce(performance.now());
          return;
        }
        orchFrom = 0.06;
        orchAnimP = 0.06;
        orchStart = performance.now();
      };

      const syncDomMeta = () => {
        const curPrefs = prefs;
        const themePref = curPrefs.effortTheme || 'auto';
        const ticksMode = curPrefs.effortTicks || 'highlight';
        const sel = selectedRow();
        const selBase = rowModelName(sel);
        const eng = mt.resolveOrchestratorEngine(curPrefs, selBase);
        const pal = mt.resolvePalette(selBase);
        const isDock = eng.kind === 'classic' && eng.style === 'dock';
        const stageShape = isDock ? 'dock' : eng.shape;
        const coreRgb = pal.core[0] + ',' + pal.core[1] + ',' + pal.core[2];
        const previewCard = stageBtn.closest('.fx-preview-card');
        if (previewCard) {
          previewCard.dataset.dock = String(isDock);
          previewCard.dataset.dots = String(curPrefs.showModelDots !== false);
          previewCard.style.setProperty('--fx-dock-rgb', coreRgb);
          previewCard.style.setProperty('--fx-dock-accent', pal.accent);
        }
        stageBtn.dataset.shape = stageShape;
        stageBtn.setAttribute('aria-pressed', String(orchOn));
        const iconSvg = FX_ICONS[curPrefs.orchestratorIcon || 'prism'] || '';
        const dockBadge = isDock ? '<span class="fx-orch-badge" aria-hidden="true">' + (orchOn ? 'ON' : 'OFF') + '</span>' : '';
        orchLabel.innerHTML = iconSvg + '<span>Orchestrator</span>' + dockBadge;
        const onTextColor = eng.kind === 'classic' && eng.style === 'beam' ? pal.accent : '#ffffff';
        orchLabel.style.color = orchOn ? onTextColor : 'color-mix(in srgb, var(--foreground, CanvasText) 74%, var(--fx-dock-accent))';
        orchLabel.style.textShadow = orchOn && !(eng.kind === 'classic' && eng.style === 'beam')
          ? '0 1px 6px rgba(0, 0, 0, 0.55)'
          : 'none';
        stageBtn.style.boxShadow = isDock
          ? 'inset 1px 0 0 rgba(' + coreRgb + ',0.42), inset -1px 0 0 rgba(' + coreRgb + ',0.42), inset 0 1px 0 rgba(' + coreRgb + ',0.42), inset 0 -1px 0 rgba(' + coreRgb + ',0.18), 0 -2px 12px -4px rgba(' + coreRgb + ',0.32)'
          : orchOn
            ? '0 2px 12px -2px rgba(' + coreRgb + ',0.45), inset 0 0 0 1px rgba(255,255,255,0.16)'
            : 'inset 0 0 0 1px rgba(' + coreRgb + ',0.24)';

        const syncTicks = pctNow => {
          const mode = prefs.effortTicks || 'highlight';
          const tierIdx = Math.max(0, Math.min(3, Math.round(pctNow * 3)));
          for (const r of ROWS) {
            const node = rowNodes[r.id];
            if (!node) continue;
            node.ticksWrap.hidden = mode === 'hidden';
            node.track.setAttribute('aria-valuenow', String(Math.round(pctNow * 100)));
            node.track.setAttribute('aria-valuetext', TIER_NAMES[tierIdx]);
            node.ticks.forEach((tk, idx) => {
              const reached = pctNow + 0.02 >= TICK_STOPS[idx];
              tk.style.background = mode === 'highlight' && reached
                ? 'rgba(255, 255, 255, 0.92)'
                : 'rgba(255, 255, 255, 0.34)';
              tk.style.opacity = mode === 'highlight' && reached ? '1' : '0.6';
            });
          }
        };

        for (const r of ROWS) {
          const node = rowNodes[r.id];
          if (!node) continue;
          const base = rowModelName(r);
          const fam = mt.resolveThemeFamily(base, themePref);
          node.row.dataset.selected = String(r.id === selectedId);
          node.dot.style.background = mt.dotColorFor(base);
          node.track.dataset.shape = fam === 'claude' ? 'claude' : 'pill';
        }
        syncTicks(smoothPct);
      };

      const updateTicksVisual = pctNow => {
        const mode = prefs.effortTicks || 'highlight';
        const tierIdx = Math.max(0, Math.min(3, Math.round(pctNow * 3)));
        for (const r of ROWS) {
          const node = rowNodes[r.id];
          if (!node) continue;
          node.track.setAttribute('aria-valuenow', String(Math.round(pctNow * 100)));
          node.track.setAttribute('aria-valuetext', TIER_NAMES[tierIdx]);
          if (mode === 'hidden') continue;
          node.ticks.forEach((tk, idx) => {
            const reached = pctNow + 0.02 >= TICK_STOPS[idx];
            tk.style.background = mode === 'highlight' && reached
              ? 'rgba(255, 255, 255, 0.92)'
              : 'rgba(255, 255, 255, 0.34)';
            tk.style.opacity = mode === 'highlight' && reached ? '1' : '0.6';
          });
        }
      };

      const fitCanvas = (cvs, w, h) => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pw = Math.max(1, Math.round(w * dpr));
        const ph = Math.max(1, Math.round(h * dpr));
        if (cvs.width !== pw || cvs.height !== ph) {
          cvs.width = pw;
          cvs.height = ph;
        }
        const ctx = cvs.getContext('2d');
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return ctx;
      };

      const paintOnce = now => {
        const curPrefs = prefs;
        const themePref = curPrefs.effortTheme || 'auto';
        const gTheme = curPrefs.geminiTheme || 'physical';
        const cTheme = curPrefs.claudeTheme || 'matrix';
        const isFull = curPrefs.effortMotion === 'full';
        const isLight = isLightSurface();
        const loopMul = isFull ? 0.74 : 1.25;

        const targetEnergy = energyForPct(targetPct);
        const dt = lastNow ? Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000)) : 0.016;
        lastNow = now;
        if (isReduced()) {
          smoothPct = targetPct;
          smoothEnergy = targetEnergy;
          orchAnimP = orchOn ? 1 : 0;
        } else {
          if (!dragging) {
            const lerpRate = isFull ? 4.2 : 15;
            const k = 1 - Math.exp(-lerpRate * dt);
            smoothPct += (targetPct - smoothPct) * k;
            if (Math.abs(targetPct - smoothPct) < 0.0015) smoothPct = targetPct;
            smoothEnergy += (targetEnergy - smoothEnergy) * k;
          }
          const dur = orchOn ? (isFull ? 720 : 260) : (isFull ? 500 : 185);
          if (orchStart > 0) {
            const u = mt.clamp01((now - orchStart) / dur);
            const eased = mt.easeInOutCubic(u);
            orchAnimP = orchOn ? orchFrom + (1 - orchFrom) * eased : orchFrom * (1 - eased);
            if (u >= 1) {
              orchAnimP = orchOn ? 1 : 0;
              orchStart = 0;
            }
          }
        }
        updateTicksVisual(smoothPct);
        orchPhase += dt * 1.2 * loopMul;
        fxClock += dt * loopMul;
        const clock = fxClock;

        const sel = selectedRow();
        const selBase = rowModelName(sel);
        const eng = mt.resolveOrchestratorEngine(curPrefs, selBase);
        const selPal = mt.resolvePalette(selBase);
        const oRect = stageBtn.getBoundingClientRect();
        const ow = Math.max(120, Math.round(oRect.width || 240));
        const oh = 30;
        const oCtx = fitCanvas(orchCanvas, ow, oh);
        if (oCtx) {
          const reach = mt.easeOutCubic(mt.clamp01(orchAnimP * 1.18));
          const bgReveal = mt.clamp01(orchAnimP * 1.45);
          const impRaw = orchOn && orchAnimP > 0.62 && orchAnimP < 0.995 ? Math.sin(((orchAnimP - 0.62) / 0.375) * Math.PI) : 0;
          const impU = mt.clamp01((orchAnimP - 0.62) / 0.38);
          if (eng.kind === 'classic') {
            mt.paintOrchestratorClassic(oCtx, {
              style: eng.style, primaryPal: selPal, w: ow, h: oh, reach, bgReveal, oPhase: orchPhase, clock, energy: smoothEnergy, isLight, motion: curPrefs.effortMotion,
            });
          } else {
            mt.paintOrchestrator3D(oCtx, {
              engineKey: eng.style,
              primaryPal: selPal,
              elementId: selPal.id,
              w: ow,
              h: oh,
              reach,
              bgReveal,
              impact: impRaw,
              impactU: impU,
              oPhase: orchPhase,
              clock,
              energy: smoothEnergy,
              isLight,
              motion: curPrefs.effortMotion,
            });
          }
        }

        for (const r of ROWS) {
          const node = rowNodes[r.id];
          if (!node) continue;
          const base = rowModelName(r);
          const fam = mt.resolveThemeFamily(base, themePref);
          const pal = mt.resolvePalette(base, themePref);
          const spd = mt.speedForElement(pal, smoothEnergy) * loopMul;
          flows[r.id] = (flows[r.id] || 0) + dt * spd;
          const tRect = node.track.getBoundingClientRect();
          const tw = Math.max(96, Math.round(tRect.width || 180));
          const th = 20;
          const knobW = fam === 'claude' ? 16 : 18;
          const knobX = knobW * 0.5 + 1 + (tw - knobW - 2) * smoothPct;
          const fillW = Math.max(10, Math.min(tw, knobX + knobW * 0.35));
          node.knob.style.left = knobX.toFixed(1) + 'px';
          const rCtx = fitCanvas(node.canvas, tw, th);
          if (rCtx) {
            rCtx.clearRect(0, 0, tw, th);
            rCtx.save();
            mt.roundRectPath(rCtx, 0, 0, fillW, th, fam === 'claude' ? 6 : th * 0.5);
            rCtx.clip();
            if (fam === 'gemini') {
              mt.paintGeminiSlider(rCtx, pal, gTheme, tw, th, flows[r.id], clock, smoothEnergy, { glass: true, glassStrength: 0.56 });
            } else if (fam === 'claude') {
              mt.paintClaudeSlider(rCtx, pal, cTheme, tw, th, flows[r.id] * 0.72, clock, smoothEnergy, { fillBase: true, glass: true, glassStrength: 0.52 });
            } else {
              mt.paintCodexSlider(rCtx, tw, th, flows[r.id], clock, smoothEnergy);
            }
            rCtx.restore();
          }
        }
      };

      const loop = now => {
        if (!active || document.hidden || isReduced()) {
          rafId = 0;
          return;
        }
        paintOnce(now);
        rafId = requestAnimationFrame(loop);
      };

      const start = () => {
        if (!active || document.hidden) return;
        syncDomMeta();
        if (isReduced()) {
          paintOnce(performance.now());
          return;
        }
        if (!rafId) {
          lastNow = performance.now();
          rafId = requestAnimationFrame(loop);
        }
      };

      const stop = () => {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      };

      const pctFromClientX = (trackEl, clientX) => {
        const rect = trackEl.getBoundingClientRect();
        const pad = 10;
        return mt.clamp01((clientX - (rect.left + pad)) / Math.max(1, rect.width - pad * 2));
      };

      const selectRow = (id, allowCycle) => {
        const changed = selectedId !== id;
        if (allowCycle && id === 'claude' && selectedId === 'claude') {
          claudeSubIdx = (claudeSubIdx + 1) % CLAUDE_MODELS.length;
        }
        selectedId = id;
        syncDomMeta();
        if (changed || allowCycle) replayOrch();
        if (isReduced()) paintOnce(performance.now());
      };

      for (const r of ROWS) {
        flows[r.id] = 0;
        const row = document.createElement('div');
        row.className = 'fx-pv-row';
        row.dataset.rowId = r.id;
        row.dataset.selected = String(r.id === selectedId);
        const nameBtn = document.createElement('button');
        nameBtn.type = 'button';
        nameBtn.className = 'fx-pv-row-name';
        nameBtn.dataset.fxPreview = 'row';
        const dot = document.createElement('span');
        dot.className = 'fx-pv-row-dot';
        const lbl = document.createElement('span');
        lbl.textContent = r.label;
        nameBtn.append(dot, lbl);
        nameBtn.addEventListener('click', () => selectRow(r.id, true));

        const track = document.createElement('div');
        track.className = 'fx-pv-track';
        track.setAttribute('role', 'slider');
        track.setAttribute('tabindex', '0');
        track.setAttribute('aria-label', r.label);
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
        const ticksWrap = document.createElement('span');
        ticksWrap.className = 'fx-pv-ticks';
        const ticks = TICK_STOPS.map(pos => {
          const tk = document.createElement('span');
          tk.className = 'fx-pv-tick';
          tk.style.left = 'calc(10px + (100% - 20px) * ' + pos.toFixed(4) + ')';
          ticksWrap.append(tk);
          return tk;
        });
        const knob = document.createElement('span');
        knob.className = 'fx-pv-knob';
        track.append(canvas, ticksWrap, knob);

        let downX = 0;
        let downPct = targetPct;
        let moved = false;
        let activePointer = null;
        track.addEventListener('pointerdown', event => {
          if (event.button !== 0) return;
          event.preventDefault();
          activePointer = event.pointerId;
          track.setPointerCapture?.(event.pointerId);
          dragging = true;
          moved = false;
          downX = event.clientX;
          downPct = pctFromClientX(track, event.clientX);
          track.dataset.dragging = 'true';
          if (selectedId !== r.id) selectRow(r.id, false);
        });
        track.addEventListener('pointermove', event => {
          if (activePointer !== event.pointerId) return;
          if (!moved && Math.abs(event.clientX - downX) > 3) moved = true;
          if (!moved) return;
          const p = pctFromClientX(track, event.clientX);
          targetPct = p;
          smoothPct = p;
          smoothEnergy = energyForPct(p);
          if (isReduced()) paintOnce(performance.now());
        });
        const endDrag = event => {
          if (activePointer !== event.pointerId) return;
          activePointer = null;
          dragging = false;
          delete track.dataset.dragging;
          const rawPct = moved ? smoothPct : downPct;
          if (event.type === 'pointerup') {
            targetPct = Math.round(rawPct * 3) / 3;
          }
          if (isReduced()) {
            smoothPct = targetPct;
            smoothEnergy = energyForPct(targetPct);
            paintOnce(performance.now());
          }
        };
        track.addEventListener('pointerup', endDrag);
        track.addEventListener('pointercancel', endDrag);
        track.addEventListener('keydown', event => {
          const curIdx = Math.max(0, Math.min(3, Math.round(targetPct * 3)));
          let nextIdx = curIdx;
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextIdx = Math.min(3, curIdx + 1);
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextIdx = Math.max(0, curIdx - 1);
          else if (event.key === 'Home') nextIdx = 0;
          else if (event.key === 'End') nextIdx = 3;
          else return;
          event.preventDefault();
          targetPct = TICK_STOPS[nextIdx];
          if (isReduced()) {
            smoothPct = targetPct;
            smoothEnergy = energyForPct(targetPct);
            paintOnce(performance.now());
          }
        });

        row.append(nameBtn, track);
        rowsHost.append(row);
        rowNodes[r.id] = { row, nameBtn, dot, track, canvas, ticksWrap, ticks, knob };
      }

      stageBtn.addEventListener('click', () => {
        orchOn = !orchOn;
        orchFrom = orchAnimP;
        orchStart = performance.now();
        syncDomMeta();
        if (isReduced()) {
          orchAnimP = orchOn ? 1 : 0;
          orchStart = 0;
          paintOnce(performance.now());
        }
      });

      document.addEventListener('visibilitychange', () => {
        if (active && !document.hidden) start();
        else stop();
      });

      return {
        setActive(next) {
          const flag = next && prefs.modelEffortPicker === true;
          previewCard.inert = prefs.modelEffortPicker !== true;
          if (next && !flag && !document.hidden) paintOnce(performance.now());
          if (flag === active) return;
          active = flag;
          if (active) {
            syncDomMeta();
            start();
          } else {
            stop();
          }
        },
        syncPrefs(nextPrefs) {
          const sig = JSON.stringify([
            nextPrefs.effortMotion,
            nextPrefs.effortTheme,
            nextPrefs.geminiTheme,
            nextPrefs.claudeTheme,
            nextPrefs.codexTheme,
            nextPrefs.orchestratorMode,
            nextPrefs.orchestrator3dStyle,
          ]);
          const changed = fxPrefsSig !== '' && fxPrefsSig !== sig;
          fxPrefsSig = sig;
          syncDomMeta();
          if (active && changed) replayOrch();
          if (active && isReduced()) paintOnce(performance.now());
        },
      };
    })();
    document.getElementById('row-cached').addEventListener('mouseenter', () => {
      if (lastData) document.getElementById('row-cached').title = presentation.cacheTooltip(lastData, labels, Date.now(), prefs);
    });
    // The compact status bar is computed only while it is shown. Like the Cache row it repaints
    // when the pointer enters it, because its cache tooltip states an age.
    function paintStatusBar(d) {
      const generation = d.requestTimingAvailable === false ? null : d.generation;
      if (prefs.compactTelemetryBar === true) presentation.renderTelemetryBar(document.querySelector('.panel'), d, generation, labels, prefs);
    }
    document.querySelector('[data-telemetry-bar]').addEventListener('mouseenter', () => {
      if (lastData) paintStatusBar(lastData);
    });
    for (const setting of document.querySelectorAll('.metric-setting')) {
      const resetHelp = () => {
        for (const other of document.querySelectorAll('.metric-setting')) other.dataset.helpDismissed = 'true';
        const help = setting.querySelector('.metric-help');
        if (help) {
          const roomAbove = setting.getBoundingClientRect().top - document.querySelector('.sidebar-nav').getBoundingClientRect().bottom;
          const below = roomAbove < help.getBoundingClientRect().height + 8;
          help.style.top = below ? 'calc(100% + 5px)' : 'auto';
          help.style.bottom = below ? 'auto' : 'calc(100% + 5px)';
        }
        setting.removeAttribute('data-help-dismissed');
      };
      setting.addEventListener('mouseenter', resetHelp);
      setting.addEventListener('focusin', resetHelp);
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') for (const setting of document.querySelectorAll('.metric-setting')) setting.dataset.helpDismissed = 'true';
    });
    function applySettings(next, forceInputs = false) {
      prefs = { ...prefs, ...next };
      prefsSig = JSON.stringify(prefs);
      labels = presentation.apply(document.body, prefs);
      settingsLabels = presentation.dictionaries[prefs.settingsLanguage] || presentation.dictionaries['zh-CN'];
      versionPanel.sync(prefs, settingsLabels);
      sidebarTabs.lang = prefs.settingsLanguage;
      sidebarTabs.setAttribute('aria-label', settingsLabels.sidebarNavigation);
      document.getElementById('sidebar-tab-stats').textContent = settingsLabels.sidebarStats;
      document.getElementById('sidebar-tab-settings').textContent = settingsLabels.sidebarSettings;
      document.getElementById('sidebar-tab-fx').textContent = settingsLabels.sidebarFx;
      document.getElementById('sidebar-stats').lang = document.body.dataset.language;
      document.getElementById('sidebar-settings').lang = prefs.settingsLanguage;
      fxSection.lang = prefs.settingsLanguage;
      fxSection.dataset.nativeCapsule = String(prefs.modelEffortPicker !== true);
      for (const select of document.querySelectorAll('.settings select[name]')) select.value = prefs[select.name];
      for (const checkbox of document.querySelectorAll('.settings input[type="checkbox"][name]')) {
        const checked = (prefs[checkbox.name] === true) !== (checkbox.name === 'modelEffortPicker');
        checkbox.checked = checked;
        const card = checkbox.closest('[data-setting-card]');
        if (card) card.dataset.checked = String(checked);
      }
      for (const numInput of document.querySelectorAll('.settings input[type="number"][name]')) {
        if (forceInputs || document.activeElement !== numInput) numInput.value = String(prefs[numInput.name] ?? '');
        const tip = settingsLabels[numInput.name] || numInput.name;
        numInput.setAttribute('aria-label', tip);
        const wrap = numInput.closest('.setting-num');
        if (wrap) wrap.title = tip;
      }
      const { warnMin, coldMin } = presentation.cacheThresholds(prefs);
      const pvFresh = document.querySelector('[data-cache-pv="fresh"]');
      const pvWarn = document.querySelector('[data-cache-pv="warn"]');
      const pvCold = document.querySelector('[data-cache-pv="cold"]');
      if (pvFresh) pvFresh.textContent = '<' + warnMin + 'm';
      if (pvWarn) pvWarn.textContent = warnMin + 'm+';
      if (pvCold) pvCold.textContent = coldMin + 'm+';
      const pvQueue = document.querySelector('[data-queue-pv]');
      if (pvQueue) pvQueue.textContent = '×2 ' + (prefs.queueWarnSec ?? 30) + 's';
      const speedCard = document.querySelector('[data-setting-card="showSpeed"]');
      if (speedCard) speedCard.dataset.speedFx = String(prefs.showSpeed !== false && prefs.speedAnimation === true);
      const speedAnimCard = document.querySelector('[data-setting-card="speedAnimation"]');
      if (speedAnimCard) speedAnimCard.dataset.parentOff = String(prefs.showSpeed === false);
      const modelPickerCard = fxSection.querySelector('.setting-model-card');
      if (modelPickerCard) {
        modelPickerCard.dataset.hideModelTags = String(prefs.hideModelTags === true);
        modelPickerCard.dataset.hideDefaultEffort = String(prefs.hideDefaultEffort === true);
        modelPickerCard.dataset.showModelDots = String(prefs.showModelDots !== false);
        modelPickerCard.dataset.effortBar = String(prefs.showEffortBar === true);
      }
      renderModelList();
      for (const card of document.querySelectorAll('.setting-option-card[data-layout-key]')) card.dataset.layout = prefs[card.dataset.layoutKey] === 'rows' ? 'rows' : 'columns';
      const contextPreview = document.querySelector('[data-preview-group="context"]');
      if (contextPreview) {
        contextPreview.dataset.open = String(prefs.showContextBreakdown !== false);
        contextPreview.dataset.layout = prefs.contextLayout === 'rows' ? 'rows' : 'columns';
      }
      renderFields();
      const turnPreview = document.querySelector('[data-preview-group="turn"]');
      if (turnPreview) turnPreview.dataset.open = String(prefs.showTurnMetrics !== false);
      const fxGeminiCard = document.getElementById('fx-gemini-card');
      if (fxGeminiCard) fxGeminiCard.hidden = !(prefs.effortTheme === 'auto' || prefs.effortTheme === 'gemini');
      const fxClaudeCard = document.getElementById('fx-claude-card');
      if (fxClaudeCard) fxClaudeCard.hidden = !(prefs.effortTheme === 'auto' || prefs.effortTheme === 'claude');
      const fxSliderThemes = document.getElementById('fx-slider-themes-card');
      if (fxSliderThemes) fxSliderThemes.hidden = prefs.effortTheme === 'codex';
      const fxOrchCustom3dCard = document.getElementById('fx-orch-custom3d-card');
      if (fxOrchCustom3dCard) fxOrchCustom3dCard.hidden = prefs.orchestratorMode !== 'custom3d';
      fxPreview.syncPrefs(prefs);
      fxPreview.setActive(sidebarView === 'fx');
      updateControlState();
      for (const swatch of document.querySelectorAll('[data-pick-setting]')) {
        const active = String(prefs[swatch.dataset.pickSetting] === swatch.dataset.pickValue);
        swatch.dataset.active = active;
        swatch.setAttribute('aria-pressed', active);
        const label = settingsLabels[swatch.dataset.pickLabel] || ({ en: 'English', 'zh-CN': '简体中文', 'zh-TW': '繁體中文' })[swatch.dataset.pickValue] || swatch.dataset.pickValue;
        const name = settingsLabels[swatch.dataset.pickSetting] + ': ' + label;
        swatch.setAttribute('aria-label', name);
        swatch.removeAttribute('title');
      }
      syncConversation();
      renderUsage();
      if (sidebarView === 'stats') replayStats();
      if (lastData) renderHealthNotice();
    }
    applySettings(prefs);
    let panelLocked = false;
    async function postApi(path, data = {}, signal, isCurrent) {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token') || window.sidecar?.token || '';
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['X-Sidecar-Token'] = token;
      const res = await (window.sidecar?.fetch || fetch)(path, { method: 'POST', redirect: 'error', signal, headers, body: JSON.stringify(data) });
      if (isCurrent && !isCurrent()) return null;
      // Version actions report their own errors without locking statistics.
      if (path !== '${VERSION_ROUTE}' && path !== '${UPDATE_ROUTE}' && (res.status === 401 || res.status === 403)) {
        panelLocked = true;
        document.querySelector('.sidebar-content').style.display = 'none';
        const notice = document.getElementById('panel-auth-notice');
        notice.textContent = (sidebarView === 'stats' ? labels : settingsLabels).panelAuthFailed;
        notice.hidden = false;
      }
      if (!res.ok) throw new Error('Panel request failed: HTTP ' + res.status);
      return res;
    }
    let pendingPatch = null;
    let savedUsageTouched = false;
    function touchesUsageSetting(patch) { return patch != null && ('showUsageActivity' in patch || 'showModelUsage' in patch); }
    async function saveSettings(patch) {
        if (touchesUsageSetting(patch)) savedUsageTouched = true;
        if (savingSettings) {
          pendingPatch = { ...(pendingPatch || {}), ...patch };
          settingsEpoch++;
          applySettings(patch);
          return;
        }
        const previous = { ...prefs };
        savingSettings = true;
        settingsEpoch++;
        applySettings(patch);
        updateControlState();
        try {
          let nextPatch = patch;
          while (nextPatch) {
            const res = await postApi('/api/settings', nextPatch);
            const data = await res.json();
            if (!res.ok || data.error) throw new Error('Save failed');
            if (pendingPatch) {
              nextPatch = pendingPatch;
              pendingPatch = null;
              applySettings({ ...data, ...nextPatch }, true);
            } else {
              nextPatch = null;
              applySettings(data, true);
            }
          }
        } catch {
          pendingPatch = null;
          applySettings(previous, true);
          if (!panelLocked) window.alert(settingsLabels.saveFailed);
        } finally {
          const triggerUsage = savedUsageTouched;
          savedUsageTouched = false;
          settingsEpoch++;
          savingSettings = false;
          updateControlState();
          if (triggerUsage && usageEnabled()) {
            usageDueAt = 0;
            void refreshUsage();
          }
        }
    }
    for (const select of document.querySelectorAll('.settings select[name], .settings input[name]')) {
      if (select.type === 'number') {
        select.addEventListener('keydown', event => {
          if (['e', 'E', '+', '-', '.'].includes(event.key)) { event.preventDefault(); return; }
          if (event.key === 'Enter') select.blur();
        });
        select.addEventListener('input', () => {
          const max = Number(select.max) || 999;
          const digits = select.value.replace(/\D/g, '').replace(/^0+/, '');
          if (!digits) {
            if (select.value !== '') select.value = '';
            return;
          }
          const capped = Number(digits) > max ? String(max) : digits;
          if (select.value !== capped) select.value = capped;
        });
      }
      select.addEventListener('change', () => {
        if (select.type === 'number') {
          const parsed = Math.round(Number(select.value));
          const min = Number(select.min);
          const max = Number(select.max);
          if (!Number.isFinite(parsed) || select.value.trim() === '') {
            select.value = String(prefs[select.name]);
            return;
          }
          const clamped = Math.max(Number.isFinite(min) ? min : parsed, Math.min(Number.isFinite(max) ? max : parsed, parsed));
          select.value = String(clamped);
          if (clamped === prefs[select.name]) return;
          void saveSettings({ [select.name]: clamped });
          return;
        }
        const value = select.type === 'checkbox' ? select.checked !== (select.name === 'modelEffortPicker') : select.value;
        const patch = { [select.name]: value };
        if (select.name === 'showSpeed' && !value) patch.speedAnimation = false;
        void saveSettings(patch);
      });
    }
    var modelListSig = '';
    function formatModelListName(name) {
      const short = String(name || '').replace(/^(?:Gemini|Claude)\\s+/i, '').trim();
      return short || String(name || '');
    }
    function renderModelList() {
      const box = document.getElementById('setting-model-list');
      if (!box) return;
      const boxHidden = prefs.customizeModelList !== true;
      if (box.hidden !== boxHidden) box.hidden = boxHidden;
      const hidden = Array.isArray(prefs.hiddenModels) ? prefs.hiddenModels : [];
      const all = [...new Set(lastData?.availableModels || [])];
      const emptyLabel = settingsLabels?.modelPickerEmpty || 'Enable the footer capsule and open an existing conversation to list its models.';
      const sig = JSON.stringify([all, hidden, emptyLabel]);
      if (sig === modelListSig) return;
      modelListSig = sig;
      box.replaceChildren();
      if (!all.length) {
        const note = document.createElement('div');
        note.className = 'pv-model-empty';
        note.textContent = emptyLabel;
        box.append(note);
        return;
      }
      const hiddenSet = new Set(hidden);
      const disabled = savingSettings || prefs.modelEffortPicker !== true || prefs.customizeModelList !== true;
      for (const name of all) {
        const active = !hiddenSet.has(name);
        const short = formatModelListName(name);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.disabled = savingSettings || prefs.modelEffortPicker !== true;
        btn.className = 'pv-swatch pv-model-item';
        btn.dataset.modelToggle = name;
        btn.dataset.active = String(active);
        btn.setAttribute('aria-pressed', String(active));
        btn.textContent = short;
        if (short !== name) btn.title = name;
        box.append(btn);
      }
    }
    const modelListEl = document.getElementById('setting-model-list');
    if (modelListEl) {
      modelListEl.addEventListener('click', event => {
        const btn = event.target.closest('button[data-model-toggle]');
        if (!btn || btn.disabled) return;
        const name = btn.dataset.modelToggle;
        const cur = new Set(Array.isArray(prefs.hiddenModels) ? prefs.hiddenModels : []);
        if (cur.has(name)) cur.delete(name);
        else cur.add(name);
        void saveSettings({ hiddenModels: [...cur] });
      });
    }
    const fieldEditor = document.querySelector('[data-field-editor]');
    const FIELD_KEYS = { label: 'columnLabel', value: 'columnValue', percent: 'columnPercent' };
    var fieldHtml = '';
    let draggedField = '';
    function renderFields() {
      const fieldEditor = document.querySelector('[data-field-editor]');
      if (!fieldEditor) return;
      const html = renderFieldEditor(prefs, settingsLabels);
      if (html === fieldHtml) return;
      // FLIP: animate rows from their old position so a moved row stays traceable.
      const before = new Map([...fieldEditor.children].map(row => [row.dataset.field, row.getBoundingClientRect().top]));
      fieldHtml = html;
      fieldEditor.innerHTML = html;
      for (const row of fieldEditor.children) {
        const delta = (before.get(row.dataset.field) ?? row.getBoundingClientRect().top) - row.getBoundingClientRect().top;
        if (!delta) continue;
        row.animate([{ transform: 'translateY(' + delta + 'px)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
    }
    function fieldOrder() {
      return String(prefs.columnOrder || 'label,value,percent').split(',');
    }
    function visibleOrder(order) {
      return order.filter(field => prefs[FIELD_KEYS[field]] === true);
    }
    if (fieldEditor) {
      fieldEditor.addEventListener('click', event => {
        const toggle = event.target.closest('.pv-field-toggle');
        if (!toggle) return;
        const field = toggle.closest('.pv-field-row').dataset.field;
        const turnOn = prefs[FIELD_KEYS[field]] !== true;
        const order = fieldOrder().filter(f => f !== field);
        // Hidden lines drop to the end; a re-enabled line joins the end of the visible ones.
        order.splice(turnOn ? visibleOrder(order).length : order.length, 0, field);
        void saveSettings({ [FIELD_KEYS[field]]: turnOn, columnOrder: order.join(',') });
      });
      fieldEditor.addEventListener('dragstart', event => {
        const row = event.target.closest('.pv-field-row[draggable="true"]');
        if (!row) return;
        draggedField = row.dataset.field;
        row.dataset.dragging = 'true';
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedField);
      });
      const clearDrop = () => { for (const row of fieldEditor.children) { delete row.dataset.drop; delete row.dataset.dragging; } };
      const dropTarget = event => {
        const row = event.target.closest('.pv-field-row[data-on="true"]');
        if (!row || !draggedField || row.dataset.field === draggedField) return null;
        const rect = row.getBoundingClientRect();
        return { row, place: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' };
      };
      fieldEditor.addEventListener('dragover', event => {
        const target = dropTarget(event);
        for (const row of fieldEditor.children) if (row !== target?.row) delete row.dataset.drop;
        if (!target) return;
        event.preventDefault();
        target.row.dataset.drop = target.place;
      });
      fieldEditor.addEventListener('dragend', () => { clearDrop(); draggedField = ''; });
      fieldEditor.addEventListener('drop', event => {
        const target = dropTarget(event);
        clearDrop();
        if (!target) return;
        event.preventDefault();
        const order = fieldOrder().filter(f => f !== draggedField);
        order.splice(order.indexOf(target.row.dataset.field) + (target.place === 'after' ? 1 : 0), 0, draggedField);
        draggedField = '';
        void saveSettings({ columnOrder: order.join(',') });
      });
    }
    for (const swatch of document.querySelectorAll('[data-pick-setting]')) {
      swatch.addEventListener('click', () => {
        const key = swatch.dataset.pickSetting;
        const value = swatch.dataset.pickValue;
        if (prefs[key] !== value) void saveSettings({ [key]: value });
      });
    }
    function renderQuota(groups, now) {
      const root = document.getElementById('quota-root');
      const quotaGroups = presentation.quotaView(groups, prefs, labels, now);
      const useBar = presentation.appearance(prefs).quotaIndicator === 'bar';
      const sig = JSON.stringify([prefs.language, useBar, quotaGroups]);
      if (sig === quotaSig) return;
      if (quotaGroups.length === 0) {
        root.replaceChildren();
        quotaSig = sig;
        return;
      }
      let html = '';
      for (const g of quotaGroups) {
        html += '<div class="quota-group">';
        html += '<div class="quota-group-title">' + presentation.escapeHtml(g.title) + '</div>';
        for (const b of g.buckets) {
          html += '<div class="quota-bucket">';
          html += '  <div class="quota-line1" data-quota-tooltip="' + presentation.escapeHtml(JSON.stringify(b.tooltip)) + '">';
          const indicator = useBar
            ? '<span class="quota-meter"><span style="width:' + b.barWidth + '%;background:' + b.color + '"></span></span>'
            : presentation.makeRingSvg(b.remainingFraction, 18);
          html += '    <span class="quota-label">' + presentation.escapeHtml(b.label) + '</span>';
          html += '    <span class="quota-right"><span class="notranslate" translate="no">' + b.pctLeft + '%</span>' + indicator + '</span>';
          html += '    <span class="quota-mid notranslate" translate="no">' + presentation.escapeHtml(b.resetShort) + '</span>';
          html += '  </div>';
          html += '</div>';
        }
        html += '</div>';
      }
      root.innerHTML = html;
      presentation.applyQuotaTooltips(root, labels);
      quotaSig = sig;
    }

    async function refresh() {
      if (panelLocked) return;
      const convId = syncConversation();
      if (refreshing) return;
      refreshing = true;
      const requestedSettingsEpoch = settingsEpoch;
      const requestedConversationEpoch = conversationEpoch;
      const isCurrent = () => {
        syncConversation();
        return requestedConversationEpoch === conversationEpoch;
      };
      // The usage history keeps its own, slower pace and never holds up this poll.
      void refreshUsage();
      try {
        const res = await postApi('/api/context', { conversationId: convId }, AbortSignal.timeout(6000), isCurrent);
        if (!res) return;
        const d = await res.json();
        if (!isCurrent() || panelLocked) return;
        if (!d || d.error) throw new Error('Context unavailable');
        if (d.uiVersion && d.uiVersion !== ${PANEL_VERSION}) {
          window.location.reload();
          return;
        }
        refreshFailures = 0;
        lastData = d;
        const footerCode = ['missing', 'unreachable'].includes(lastData?.deckCdp) ? 'F1'
          : ({ unverified: 'F2', 'inject-failed': 'F4', 'no-anchor': 'F3' }[d.deckCdp] || '');
        const code = ['S3', 'S4'].includes(d.health?.code) ? d.health.code : footerCode;
        sampleCount = code === sampleCode ? sampleCount + 1 : 1;
        sampleCode = code;
        // F3/F4 and S4 already have thresholds in the backend.
        healthCode = code === healthCode || sampleCount >= 2 || !['S3', 'F1', 'F2'].includes(code) ? code : '';
        const nextPrefs = { ...prefs, ...d.prefs };
        if (!savingSettings && requestedSettingsEpoch === settingsEpoch && JSON.stringify(nextPrefs) !== prefsSig) {
          applySettings(nextPrefs);
        } else {
          // The settings tab still needs the model catalog and health updates.
          renderModelList();
          if (sidebarView === 'stats') replayStats();
          renderHealthNotice();
        }
        if (!savingSettings && requestedSettingsEpoch === settingsEpoch) void versionPanel.checkAutomatically();
      } catch {
        if (!panelLocked && isCurrent()) {
          refreshFailures++;
          sampleCount = 0;
          renderHealthNotice();
        }
      } finally { refreshing = false; }
    }

    function renderData(d) {
      const now = Date.now();
      const generation = d.requestTimingAvailable === false ? null : d.generation;
      // Time can change what is shown even when the response is identical.
      const alert = presentation.alertView(d, prefs, labels, now);
      const elapsed = prefs.showTurnMetrics && d.turnMetrics
        ? presentation.turnMetricsText(d.turnMetrics, labels, now).elapsed : '';
      const sig = JSON.stringify([prefsSig, d.contextTokens, d.maxContextTokens, d.cachedIn, d.uncachedIn,
        d.turn0Tokens, d.totalOutputTokens, d.totalThinkingTokens, generation, d.turnMetrics,
        alert.contextTone, alert.contextTip, elapsed]);
      const statsChanged = sig !== statsSig;
      if (statsChanged) {
        presentation.renderContextTooltips(panel, d, labels);
        presentation.renderAlerts(document.body, d, prefs, labels, now);
        presentation.renderGeneration(panel, generation, labels, prefs);
        presentation.renderTurnMetrics(panel, d.turnMetrics, labels, prefs, now);
        const ctx = presentation.contextBreakdown(d);

        document.getElementById('used-pct').textContent = ctx.usedPct;
        document.getElementById('used-fraction').textContent = ctx.usedFrac;

        document.getElementById('seg-read').style.width = ctx.segReadW;
        document.getElementById('seg-out').style.width = ctx.segOutW;
        document.getElementById('seg-think').style.width = ctx.segThinkW;
        document.getElementById('seg-turn0').style.width = ctx.segTurn0W;

        document.getElementById('val-turn0-k').textContent = ctx.turn0K;
        document.getElementById('val-read-k').textContent = ctx.readK;
        document.getElementById('val-think-k').textContent = ctx.thinkK;
        document.getElementById('val-out-k').textContent = ctx.outK;
        document.getElementById('val-turn0-pct').textContent = ctx.turn0Pct;
        document.getElementById('val-read-pct').textContent = ctx.readPct;
        document.getElementById('val-think-pct').textContent = ctx.thinkPct;
        document.getElementById('val-out-pct').textContent = ctx.outPct;
        statsSig = sig;
      }
      const cacheChanged = renderCache(d, now);
      if (statsChanged || cacheChanged) paintStatusBar(d);
      renderQuota(d.quotaGroups, now);
    }

    function renderCache(d, now) {
      const cache = presentation.cacheView(d, prefs, now);
      const title = presentation.cacheTooltip(d, labels, now, prefs);
      const dotCachedEl = document.getElementById('dot-cached');
      const cacheMeterEl = document.getElementById('cache-meter');
      const cacheMeterFillEl = document.getElementById('cache-meter-fill');
      if (dotCachedEl && dotCachedEl._svg !== cache.iconSvg) dotCachedEl.innerHTML = dotCachedEl._svg = cache.iconSvg;
      if (cacheMeterEl && cacheMeterFillEl) {
        const hidden = cache.indicator !== 'bar';
        if (cacheMeterEl.hidden !== hidden) cacheMeterEl.hidden = hidden;
        if (!hidden) {
          if (cacheMeterFillEl.style.width !== cache.progressPct) cacheMeterFillEl.style.width = cache.progressPct;
          if (cacheMeterFillEl.style.backgroundColor !== cache.progressColor) cacheMeterFillEl.style.backgroundColor = cache.progressColor;
        }
      }
      const sig = JSON.stringify([cache.indicator, cache.hitRingSvg, cache.valColor, cache.valDeco,
        cache.valOp, cache.text, cache.countdown, title]);
      if (sig === cacheSig) return false;
      const valCacheHitEl = document.getElementById('val-cache-hit');
      const valCacheHitKEl = document.getElementById('val-cache-hit-k');
      valCacheHitEl.style.color = cache.valColor;
      valCacheHitEl.style.textDecoration = cache.valDeco;
      valCacheHitEl.style.opacity = cache.valOp;
      valCacheHitEl.textContent = cache.text;
      if (valCacheHitKEl) {
        valCacheHitKEl.style.color = cache.valColor || 'var(--muted-foreground, #8e8e93)';
        valCacheHitKEl.textContent = cache.countdown;
      }
      // The hit-rate ring stands for the number, so it takes the number's color and dimming.
      const cacheHitRingEl = document.getElementById('cache-hit-ring');
      if (cacheHitRingEl) {
        cacheHitRingEl.innerHTML = cache.hitRingSvg;
        cacheHitRingEl.style.color = cache.valColor;
        cacheHitRingEl.style.opacity = cache.valOp;
      }
      document.getElementById('row-cached').title = title;
      cacheSig = sig;
      return true;
    }

    // Shown on both tabs; text follows the open tab's language.
    let fixingShortcut = false;
    let shortcutFixMessageKey = '';
    const cdpFixBtn = document.getElementById('cdp-fix-btn');
    if (cdpFixBtn) {
      cdpFixBtn.addEventListener('click', async () => {
        if (fixingShortcut) return;
        fixingShortcut = true;
        shortcutFixMessageKey = '';
        renderHealthNotice();
        try {
          const res = await postApi('/api/fix-cdp-shortcut');
          const result = await res.json();
          if (lastData?.deckCdpInfo && result?.shortcutState) {
            lastData.deckCdpInfo.shortcutState = result.shortcutState;
            lastData.deckCdpInfo.canFixShortcut = result.shortcutState === 'missing';
          }
          shortcutFixMessageKey = result?.ok ? 'cdpFixShortcutDone'
            : result?.reason === 'partial' ? 'cdpFixShortcutPartial'
            : result?.reason === 'not_found' ? 'cdpFixShortcutNotFound'
            : result?.reason === 'permission' ? 'cdpFixShortcutAdmin'
            : 'cdpFixShortcutError';
        } catch {
          shortcutFixMessageKey = 'cdpFixShortcutError';
        } finally {
          fixingShortcut = false;
          renderHealthNotice();
        }
      });
    }
    function renderHealthNotice() {
      const notice = document.getElementById('cdp-notice');
      const stale = refreshFailures >= 5;
      const stats = document.getElementById('sidebar-stats');
      if (stats.dataset.stale !== String(stale)) stats.dataset.stale = String(stale);
      const code = stale ? 'S2' : healthCode;
      const hidden = !code || panelLocked;
      if (notice.hidden !== hidden) notice.hidden = hidden;
      if (hidden) return;
      const dict = sidebarView === 'stats' ? labels : settingsLabels;
      notice.lang = sidebarView === 'stats' ? document.body.dataset.language : prefs.settingsLanguage;
      const badge = document.getElementById('health-code');
      const badgeText = dict.healthCode + ' ' + code;
      if (badge.textContent !== badgeText) badge.textContent = badgeText;
      notice.querySelector('details').hidden = code !== 'F1';
      if (code !== 'F1') {
        document.getElementById('cdp-notice-actions').hidden = true;
        const title = code.startsWith('S') ? dict.healthStatsTitle : dict.healthFooterTitle;
        const body = dict['health' + code];
        for (const [id, text] of [['cdp-notice-title', title], ['cdp-notice-body', body]]) {
          const node = document.getElementById(id);
          if (node.textContent === text) continue;
          // Keep hyphenated names such as Lumidarin/agy-capsule on one line.
          node.replaceChildren(...text.split(/((?:Lumidarin\\/)?agy-capsule)/).map((part, i) => {
            if (i % 2 === 0) return part;
            const span = document.createElement('span');
            span.className = 'nowrap';
            span.textContent = part;
            return span;
          }));
        }
        return;
      }
      const info = lastData?.deckCdpInfo || {};
      const hadBefore = info.hadBefore === true || lastData?.deckCdp === 'unreachable';
      const titleEl = document.getElementById('cdp-notice-title');
      const bodyEl = document.getElementById('cdp-notice-body');
      const howEl = document.getElementById('cdp-notice-how');
      if (titleEl) titleEl.dataset.cdpI18n = hadBefore ? 'cdpRestartTitle' : 'cdpTitle';
      if (bodyEl) {
        bodyEl.dataset.cdpI18n = !hadBefore ? 'cdpBody'
          : info.shortcutState === 'ok' ? 'cdpRestartBodyShortcutOk'
          : info.shortcutState === 'missing' ? 'cdpRestartBodyShortcutMissing'
          : 'cdpRestartBodyGeneric';
      }
      if (howEl) howEl.dataset.cdpI18n = hadBefore ? 'cdpRestartHow' : 'cdpHow';
      const actionsEl = document.getElementById('cdp-notice-actions');
      const statusEl = document.getElementById('cdp-fix-status');
      const showBtn = info.canFixShortcut === true;
      if (actionsEl) actionsEl.hidden = !showBtn && !shortcutFixMessageKey;
      if (cdpFixBtn) {
        cdpFixBtn.hidden = !showBtn;
        cdpFixBtn.disabled = fixingShortcut;
        cdpFixBtn.dataset.cdpI18n = fixingShortcut ? 'cdpFixShortcutBusy' : 'cdpFixShortcutBtn';
      }
      if (statusEl) statusEl.textContent = shortcutFixMessageKey ? (dict?.[shortcutFixMessageKey] || '') : '';
      for (const node of notice.querySelectorAll('[data-cdp-i18n]')) {
        const value = dict?.[node.dataset.cdpI18n];
        if (value && node.textContent !== value) node.textContent = value;
      }
    }

    function updateControlState() {
      const busy = savingSettings;
      for (const control of document.querySelectorAll('.settings select, .settings input, .settings button:not(.setting-help-dot):not([data-fx-preview])')) {
        const optionCard = control.closest('.setting-option-card');
        const thresholdCard = control.closest('.setting-threshold-card');
        const detailPop = control.closest('.pv-detail-pop');
        const parentDisabled = (control.name === 'speedAnimation' && prefs.showSpeed === false)
          || (prefs.modelEffortPicker !== true && control.name !== 'modelEffortPicker' && fxSection.contains(control))
          || (!!optionCard && !control.closest('.setting-pair-item') && optionCard.dataset.checked === 'false')
          || (!!thresholdCard && !control.closest('.setting-pair-item') && thresholdCard.dataset.checked === 'false')
          || (!!detailPop && detailPop.dataset.open === 'false');
        control.disabled = busy || parentDisabled;
      }
    }
    refresh();
    setInterval(refresh, 1000);
  </script>
</body>
</html>`;

const rememberCloudTelemetry = cloudTelemetryStore.set;
export { inspectConversation, inspectUsage, UI_HTML, parseGenRow, parseUsageRow, readConversationSnapshot, readConversationUsage, rememberCloudTelemetry };

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) installEpipeGuard();
let deckInjector = null;
export async function startPanel(loadSdk = () => import('sidecar_sdk'), env = process.env, notices = cdpNotice) {
  // The SDK skips authentication for GET, and for every method without a UI token.
  // Do not start its listener (including built-in host routes) in the latter case.
  if (!env.ANTIGRAVITY_SIDECAR_UI_TOKEN?.trim()) {
    console.error('[agy-capsule] sidebar disabled: host did not supply a UI token');
    await notices.notifyPanelUnavailable();
    return;
  }
  const { SidecarApp } = await loadSdk();
  const app = new SidecarApp();
  app.page('/', () => UI_HTML);
  app.page('/ui.html', () => UI_HTML);
  // A panel left open during update reads this version even on HTTP 405, then reloads.
  app.api('/api/context', () => ({ status: 405, headers: { Allow: 'POST' }, contentType: 'application/json',
    body: JSON.stringify({ uiVersion: PANEL_VERSION }) }), 'GET');
  app.api('/api/context', async (data) => {
    const deckCdp = deckInjector?.status?.() ?? 'unknown';
    // Full View changes the sidecar's conversation; opening a child tab
    // beside its parent does not. Neither should depend on the last CDP footer.
    const conversationId = data?.conversationId ?? app.config?.conversationId ?? '';
    return {
      ...await readSelectedConversation(conversationId, false),
      deckCdp,
      deckCdpInfo: cdpNotice.info(deckCdp),
      availableModels: deckInjector?.models?.(conversationId) ?? [],
    };
  }, 'POST');
  app.api('/api/usage', (data) => inspectUsage(settingsStore.read(), data?.conversationId ?? app.config?.conversationId ?? ''), 'POST');
  app.api('/api/settings', (data) => settingsStore.update(data), 'POST');
  app.api(VERSION_ROUTE, data => checkVersion(data?.mode), 'POST');
  app.api(UPDATE_ROUTE, data => updatePlugin(data?.version), 'POST');
  app.api('/api/fix-cdp-shortcut', () => cdpNotice.fixShortcuts(), 'POST');
  const ready = app.run();
  installAsyncHostRoutes(app);
  await ready;
  return app;
}
if (isMain && (process.env.ANTIGRAVITY_LS_ADDRESS || process.env.ANTIGRAVITY_SIDECAR_WEB_PORT)) {
  const injector = deckInjector = startDeckInjector(inspectConversation, {
    productRoots: conversationDirs.map(dir => dirname(dir)),
    needsCloudTelemetry: convId => !resolveConversationDb(convId, false),
    onCloudTelemetry: rememberCloudTelemetry,
    onStatus: state => cdpNotice.observe(state),
    onEffortSettingsPatch: patch => settingsStore.update(patch),
  });
  let stopping = false;
  const shutdown = async (reason) => {
    if (stopping) return;
    stopping = true;
    stopLsWatchdog();
    stopWatching();
    console.log('[agy-capsule] restarting/stopping:', reason);
    try { await injector.stop(); }
    finally { process.exit(0); }
  };
  const stopWatching = startSelfReloadWatcher(dirname(fileURLToPath(import.meta.url)), () => void shutdown('plugin files changed'));
  const stopLsWatchdog = startLsWatchdog(process.env.ANTIGRAVITY_LS_ADDRESS, shutdown);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => void shutdown(signal));
  if (process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) await startPanel();
}
