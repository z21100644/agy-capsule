import { DatabaseSync } from 'node:sqlite';
import { readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDeckInjector } from './deck_injector.mjs';
import { createSettingsStore, DEFAULT_SETTINGS } from './settings.mjs';
import { createPresentation, getPresentationScript } from './ui.mjs';
import { summarizeGeneration, summarizeTurnSpeed, summarizeTurnQueue } from './metrics.mjs';
import { classifyRequestError } from './errors.mjs';
import { createSqliteSnapshotCache } from './sqlite_cache.mjs';
import { startLsWatchdog } from './ls_watchdog.mjs';
import { startSelfReloadWatcher } from './reload.mjs';
import { summarizeTurnMetrics } from './turn_metrics.mjs';
import { installAsyncHostRoutes, installEpipeGuard } from './host_bridge.mjs';
import { createCdpNoticeManager } from './cdp_notice.mjs';

const settingsStore = createSettingsStore();
const PANEL_VERSION = 114;
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

async function inspectConversation(convId, exact = false) {
  if (exact) lastDeckConvId = convId || '';
  const dbPath = resolveConversationDb(lastDeckConvId ?? convId, lastDeckConvId === null);
  if (!dbPath) return await makeEmptyContextResult(conversationDirs.some(dir => statSync(dir, { throwIfNoEntry: false })?.isDirectory()) ? null : { code: 'S3' });

  const prefs = settingsStore.read();
  const snapshot = conversationCache.read(dbPath, prefs.showTurnMetrics);
  const health = conversationCache.health(dbPath);
  if (!snapshot) return await makeEmptyContextResult(health);
  return {
    health,
    uiVersion: PANEL_VERSION,
    ...snapshot,
    prefs,
    ...await fetchQuota(),
  };
}

const conversationCache = createSqliteSnapshotCache(readConversationSnapshot);

function readConversationSnapshot(dbPath, includeTurnMetrics = true) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let rawRows = [];
  let cpRows = [];
  let lastStepEpochMs = 0;
  let userStepIndex = null;
  let turnSteps = [];
  let metricsUserStepIndex = null;
  let executors = [];
  try {
    rawRows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
    cpRows = db.prepare('SELECT idx FROM steps WHERE step_type = 23 ORDER BY idx DESC').all();
    // A queued user input is not a new running turn until AGY consumes it.
    userStepIndex = db.prepare('SELECT idx FROM steps WHERE step_type = 14 AND status != 11 ORDER BY idx DESC LIMIT 1').get()?.idx ?? null;
    if (includeTurnMetrics) metricsUserStepIndex = db.prepare('SELECT idx FROM steps WHERE step_type = 14 ORDER BY idx DESC LIMIT 1').get()?.idx ?? null;
    const firstTurnStep = userStepIndex ?? metricsUserStepIndex;
    if (firstTurnStep !== null) {
      turnSteps = db.prepare('SELECT idx, step_type, status, metadata FROM steps WHERE idx >= ? ORDER BY idx').all(firstTurnStep).map(step => {
        const fields = parsePbMap(Buffer.from(step.metadata || []));
        const stamp = fields.get(7)?.[0] || fields.get(8)?.[0];
        const time = stamp ? parsePbMap(stamp) : new Map();
        const epoch = value => { const parts = parsePbMap(value || Buffer.alloc(0)); return parts.has(1) ? parts.get(1)[0] * 1000 + (parts.get(2)?.[0] || 0) / 1e6 : null; };
        const transitions = (parsePbMap(fields.get(26)?.[0] || Buffer.alloc(0)).get(1) || []).map(value => parsePbMap(value));
        const generating = transitions.filter(item => item.get(1)?.[0] === 8).map(item => epoch(item.get(2)?.[0])).filter(value => value !== null);
        const terminal = transitions.filter(item => [3, 6, 7, 12].includes(item.get(1)?.[0])).map(item => epoch(item.get(2)?.[0])).filter(value => value !== null);
        return {
          idx: step.idx, step_type: step.step_type, status: step.status,
          completedAtMs: (time.get(1)?.[0] || 0) * 1000 + (time.get(2)?.[0] || 0) / 1e6,
          recordedCompletedAtMs: epoch(fields.get(8)?.[0]),
          createdAtMs: epoch(fields.get(1)?.[0]),
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
  let latestRequestError = classifyRequestError();
  const parsedRequests = [];

  for (const row of rawRows) {
    const parsed = parseGenRow(row.idx, row.data, includeTurnMetrics);
    if (!parsed) continue;
    parsedRequests.push(parsed);
    latestGeneration = parsed.generation;
    latestRequestError = parsed.requestError;
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

  return {
    turnSpeed: summarizeTurnSpeed(parsedRequests, turnSteps, userStepIndex),
    turnQueue: summarizeTurnQueue(parsedRequests, turnSteps, userStepIndex, executors),
    turnMetrics: includeTurnMetrics ? summarizeTurnMetrics(parsedRequests, turnSteps.map(step => ({ ...step, completedAtMs: step.recordedCompletedAtMs })), metricsUserStepIndex, executors) : null,
    requestError: latestRequestError,
    generation: summarizeGeneration(latestGeneration),
    cachedIn: latest.cachedIn,
    uncachedIn: latest.uncachedIn,
    contextTokens: latest.contextTokens,
    maxContextTokens,
    lastStepEpochMs,
    turn0Tokens,
    totalOutputTokens,
    totalThinkingTokens,
  };
}

const PV_SVG = {
  db: '<svg class="pv-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>',
  clock: '<svg class="pv-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
  cal: '<svg class="pv-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  warn: '<svg class="pv-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><circle cx="12" cy="17" r=".8" fill="currentColor"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="2 6.5 4.8 9.2 10 3"/></svg>',
  ring: '<svg width="13" height="13" viewBox="0 0 18 18" style="transform:rotate(-90deg);flex-shrink:0"><circle cx="9" cy="9" r="6.5" fill="none" stroke="rgba(142,142,147,0.28)" stroke-width="2.4"/><circle cx="9" cy="9" r="6.5" fill="none" stroke="#4ea84e" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="40.84" stroke-dashoffset="6.1"/></svg>',
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
  showRequestErrors: `<div class="pv-err-strip">
    <span class="pv-pill">${PV_SVG.db}<span>42%</span></span>
    <span class="pv-pill">${PV_SVG.clock}<span>85%</span></span>
    <span class="pv-pill pv-pill-err">${PV_SVG.warn}<span>429</span></span>
  </div>`,
  notifyCdpRestart: `<div class="pv-restart-note"><span data-i18n="cdpRestartPreview"></span></div>`,
  showQueueWarnings: `<div class="pv-queue-strip">
    <span class="pv-pill">${PV_SVG.db}<span>42%</span></span>
    <span class="pv-pill">${PV_SVG.clock}<span>85%</span></span>
    <span class="pv-pill pv-pill-queue">${PV_SVG.clock}<span data-queue-pv>×2 30s</span></span>
  </div>`,
  showRequestMetrics: `<div class="pv-req-line">
    <div class="pv-pill pv-req-pill"><span>TTFT 1.0s–3.0s</span><span><b>100.0 tok/s</b></span></div>
  </div>`,
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
    .sidebar-view[hidden] { display: none; }
    .sidebar-nav { position: sticky; top: 0; z-index: 20; margin: -12px -14px 10px; padding: 8px 14px; background: var(--background, #141414); border-bottom: 1px solid color-mix(in srgb, var(--border, rgba(142,142,147,.24)) 65%, transparent); }
    .sidebar-tabs { position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: center; max-width: 1120px; margin: 0 auto; padding: 2.5px; border-radius: 7px; background: color-mix(in srgb, var(--foreground, #ebebeb) 6%, var(--background, #141414)); border: 1px solid color-mix(in srgb, var(--foreground, #ebebeb) 10%, transparent); }
    .sidebar-tabs button { position: relative; z-index: 1; min-width: 0; min-height: 26px; padding: 3px 8px; border: 0; border-radius: 5px; background: transparent; color: var(--muted-foreground, #8e8e93); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; transition: color .15s ease; }
    .sidebar-tabs button[aria-selected="true"] { color: var(--foreground, #ebebeb); font-weight: 600; }
    .sidebar-tabs button:hover { color: var(--foreground, #ebebeb); }
    .sidebar-tabs button:focus-visible { outline: 2px solid #388bfd; outline-offset: 1px; }
    .sidebar-toggle-track { position: absolute; inset: 2.5px; border-radius: 5px; pointer-events: none; }
    .sidebar-toggle-thumb { display: block; width: 50%; height: 100%; border-radius: 5px; background: color-mix(in srgb, var(--foreground, #ebebeb) 14%, var(--background, #141414)); box-shadow: 0 1px 2.5px rgba(0,0,0,.22), inset 0 0 0 1px color-mix(in srgb, var(--foreground, #ebebeb) 14%, transparent); transform: translateX(0); transition: transform .18s cubic-bezier(.22,1,.36,1); }
    .sidebar-tabs[data-view="settings"] .sidebar-toggle-thumb { transform: translateX(100%); }
    @media(prefers-reduced-motion:reduce) { .sidebar-toggle-thumb { transition: none; } }
    @media(pointer:coarse) { .sidebar-tabs button { min-height: 44px; } }
    .nowrap { white-space: nowrap; }
    .settings-scope { margin-top: 8px; padding: 10px 0 4px; border-top: 1px solid var(--border, rgba(142,142,147,.22)); font-size: 12px; font-weight: 600; color: var(--muted-foreground, #8e8e93); letter-spacing: .01em; }
    .settings-scope.metric-setting { position: relative; }
    .settings-scope-title { font-size: 12px; font-weight: 600; color: var(--muted-foreground, #8e8e93); }
    .setting-card { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 7px 0; border-top: 1px solid color-mix(in srgb, var(--border, rgba(142,142,147,.24)) 55%, transparent); background: transparent; }
    .settings > .setting-card:first-child, .settings-scope + .setting-card { border-top: 0; }
    .setting-card[data-parent-off="true"], [data-parent-off="true"] { opacity: .45; }
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
    @container stats (width < 420px) {
      body[data-show-quota-dividers="true"] .stats-quota .quota-group + .quota-group { padding-top: calc(var(--agy-section-gap, 6px) + 4px); border-top: 1px solid var(--border, rgba(142, 142, 147, 0.24)); }
    }
    @container stats (min-width: 420px) {
      .stats-layout {
        gap: calc(var(--agy-section-gap, 6px) + 6px);
      }
      .stats-context,
      .panel .quota-group {
        padding: calc(var(--agy-pad-y, 8px) + 2px) calc(var(--agy-pad-x, 10px) + 2px);
        border-radius: 8px;
        border: 1px solid color-mix(in srgb, var(--border, rgba(142, 142, 147, 0.24)) 72%, transparent);
        background: color-mix(in srgb, var(--foreground, #ebebeb) 3%, transparent);
      }
      .divider {
        display: none;
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
    body[data-label-case="lowercase"] .panel .cache-left,
    body[data-label-case="lowercase"] .panel .used-pct,
    body[data-label-case="lowercase"] .panel .item-label,
    body[data-label-case="lowercase"] .panel .turn-bar-label,
    body[data-label-case="lowercase"] .panel .turn-bar-short,
    body[data-label-case="lowercase"] .panel .quota-label { text-transform: lowercase; }
    .cdp-notice { max-width: 1120px; margin: 0 auto 10px; padding: 8px 10px; border-radius: 7px; border: 1px solid color-mix(in srgb, #e0a030 45%, transparent); background: color-mix(in srgb, #e0a030 8%, var(--background, #141414)); font-size: 12px; color: var(--muted-foreground, #8e8e93); }
    #health-code { text-align: end; font-size: 12px; color: var(--muted-foreground, #8e8e93); }
    #sidebar-stats[data-stale="true"] .stats-layout { opacity: .75; }
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
    .cdp-notice code { user-select: text; font-family: ui-monospace, Consolas, monospace; font-size: 11px; padding: 0 3px; border-radius: 3px; background: color-mix(in srgb, var(--foreground, #ebebeb) 8%, transparent); color: var(--foreground, #ebebeb); word-break: break-all; }
    .pv-restart-note { font-size: 11.5px; color: var(--muted-foreground, #8e8e93); transition: opacity .18s ease; }
    [data-setting-card="notifyCdpRestart"][data-checked="false"] .pv-restart-note { opacity: .4; }
    @media(pointer:coarse) { .pv-swatch { min-height: 40px; } }
  </style>
</head>
<body>
  <p id="panel-auth-notice" class="cdp-notice" style="margin: 12px; padding: 10px 12px" role="alert" hidden></p>
  <main class="sidebar-content">
  <div class="sidebar-nav">
    <div class="sidebar-tabs" role="tablist" aria-label="Sidebar 页面" data-view="stats">
      <button type="button" id="sidebar-tab-stats" role="tab" aria-selected="true" aria-controls="sidebar-stats" tabindex="0">统计</button>
      <span class="sidebar-toggle-track" aria-hidden="true"><span class="sidebar-toggle-thumb"></span></span>
      <button type="button" id="sidebar-tab-settings" role="tab" aria-selected="false" aria-controls="sidebar-settings" tabindex="-1">设置</button>
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
          <div class="cache-left"><span data-i18n="cache">Cache</span><span class="cache-pct" id="val-cache-hit">0%</span><span class="dot" id="dot-cached" style="display:inline-flex;align-items:center;justify-content:center;background:transparent"></span></div>
          <span class="cache-meter" id="cache-meter" hidden><span id="cache-meter-fill"></span></span>
          <div class="cache-k" id="val-cache-hit-k"></div>
        </div>

        <div class="summary-row">
          <div class="used-pct" data-context-tip="overview"><span id="used-pct">0%</span> <span data-i18n="used">used</span></div>
          <div class="used-fraction" id="used-fraction" data-context-tip="overview">0 / --</div>
        </div>

        <div class="progress-track" id="progress-track" data-context-tip="overview">
          <div class="seg" id="seg-turn0" style="width: 0%; background: #d4940a"></div>
          <div class="seg" id="seg-read" style="width: 0%; background: #388bfd"></div>
          <div class="seg" id="seg-think" style="width: 0%; background: #00b386"></div>
          <div class="seg" id="seg-out" style="width: 0%; background: #e86a24"></div>
        </div>

        <div class="list">
          <div class="item-row" id="row-turn0" data-context-tip="turn0">
            <span class="dot" style="background:#d4940a"></span>
            <div class="item-body"><span class="item-label" data-i18n="turn0">Turn0</span><span class="item-k" id="val-turn0-k">0</span><span class="item-pct" id="val-turn0-pct">0%</span></div>
          </div>

          <div class="item-row" id="row-read" data-context-tip="read">
            <span class="dot" style="background:#388bfd"></span>
            <div class="item-body"><span class="item-label" data-i18n="read">Read</span><span class="item-k" id="val-read-k">0</span><span class="item-pct" id="val-read-pct">0%</span></div>
          </div>

          <div class="item-row" id="row-think" data-context-tip="think">
            <span class="dot" style="background:#00b386"></span>
            <div class="item-body"><span class="item-label" data-i18n="think">Think</span><span class="item-k" id="val-think-k">0</span><span class="item-pct" id="val-think-pct">0%</span></div>
          </div>

          <div class="item-row" id="row-out" data-context-tip="write">
            <span class="dot" style="background:#e86a24"></span>
            <div class="item-body"><span class="item-label" data-i18n="write">Write</span><span class="item-k" id="val-out-k">0</span><span class="item-pct" id="val-out-pct">0%</span></div>
          </div>
        </div>

        <div class="generation-block" data-generation-block>
          ${presentation.generationMarkup()}
        </div>
        ${presentation.turnMetricsMarkup()}
      </section>
      <div class="divider"></div>
      <div id="quota-root" class="stats-quota"></div>
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
    ${renderCheckCard({ id: 'setting-notify-cdp-restart', key: 'notifyCdpRestart', checked: DEFAULT_SETTINGS.notifyCdpRestart })}
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
    ${renderCheckCard({ id: 'setting-show-request-metrics', helpId: 'request-metrics', key: 'showRequestMetrics', tip: 'requestSectionTip', checked: true })}
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
  </section>

  </main>
  <script>
    ${getPresentationScript()}
    const presentation = globalThis.__agyCapsulePresentation;
    ${renderFieldEditor.toString()}
    let prefs = ${JSON.stringify(DEFAULT_SETTINGS)};
    let labels = presentation.apply(document.body, prefs);
    let settingsLabels = presentation.dictionaries[prefs.settingsLanguage];
    let savingSettings = false;
    let settingsEpoch = 0;
    let lastData = null, refreshing = false, refreshFailures = 0;
    let sampleCode = '', sampleCount = 0, healthCode = '';
    let renderedKey = '';
    let cacheIconSvg = null;
    const sidebarTabs = document.querySelector('.sidebar-tabs');
    let sidebarView = 'stats';
    const sidebarScroll = { stats: 0, settings: 0 };
    function selectSidebarView(view, focus = false) {
      if (view !== sidebarView) {
        sidebarScroll[sidebarView] = window.scrollY;
        sidebarView = view;
        sidebarTabs.dataset.view = view;
        for (const name of ['stats', 'settings']) {
          const selected = name === view;
          const tab = document.getElementById('sidebar-tab-' + name);
          tab.setAttribute('aria-selected', String(selected));
          tab.tabIndex = selected ? 0 : -1;
          document.getElementById('sidebar-' + name).hidden = !selected;
        }
        if (view === 'stats' && lastData) renderData(lastData);
        renderHealthNotice();
        window.scrollTo({ top: sidebarScroll[view], behavior: 'instant' });
      }
      if (focus) document.getElementById('sidebar-tab-' + view).focus({ preventScroll: true });
    }
    for (const view of ['stats', 'settings']) {
      document.getElementById('sidebar-tab-' + view).addEventListener('click', () => selectSidebarView(view));
    }
    sidebarTabs.querySelector('.sidebar-toggle-track').addEventListener('click', () => selectSidebarView(sidebarView === 'stats' ? 'settings' : 'stats', true));
    sidebarTabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const view = event.key === 'Home' ? 'stats' : event.key === 'End' ? 'settings' : sidebarView === 'stats' ? 'settings' : 'stats';
      selectSidebarView(view, true);
    });
    document.getElementById('row-cached').addEventListener('mouseenter', () => {
      if (lastData) document.getElementById('row-cached').title = presentation.cacheTooltip(lastData, labels, Date.now(), prefs);
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
      labels = presentation.apply(document.body, prefs);
      settingsLabels = presentation.dictionaries[prefs.settingsLanguage] || presentation.dictionaries['zh-CN'];
      sidebarTabs.lang = prefs.settingsLanguage;
      sidebarTabs.setAttribute('aria-label', settingsLabels.sidebarNavigation);
      document.getElementById('sidebar-tab-stats').textContent = settingsLabels.sidebarStats;
      document.getElementById('sidebar-tab-settings').textContent = settingsLabels.sidebarSettings;
      document.getElementById('sidebar-stats').lang = document.body.dataset.language;
      for (const select of document.querySelectorAll('.settings select[name]')) select.value = prefs[select.name];
      for (const checkbox of document.querySelectorAll('.settings input[type="checkbox"]')) {
        const checked = prefs[checkbox.name] === true;
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
      for (const card of document.querySelectorAll('.setting-option-card')) card.dataset.layout = prefs[card.dataset.layoutKey] === 'rows' ? 'rows' : 'columns';
      const contextPreview = document.querySelector('[data-preview-group="context"]');
      if (contextPreview) {
        contextPreview.dataset.open = String(prefs.showContextBreakdown !== false);
        contextPreview.dataset.layout = prefs.contextLayout === 'rows' ? 'rows' : 'columns';
      }
      renderFields();
      const turnPreview = document.querySelector('[data-preview-group="turn"]');
      if (turnPreview) turnPreview.dataset.open = String(prefs.showTurnMetrics !== false);
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
      if (lastData) renderData(lastData);
    }
    applySettings(prefs);
    let panelLocked = false;
    async function postApi(path, data = {}, signal) {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token') || window.sidecar?.token || '';
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['X-Sidecar-Token'] = token;
      const res = await (window.sidecar?.fetch || fetch)(path, { method: 'POST', redirect: 'error', signal, headers, body: JSON.stringify(data) });
      if (res.status === 401 || res.status === 403) {
        panelLocked = true;
        document.querySelector('.sidebar-content').style.display = 'none';
        const notice = document.getElementById('panel-auth-notice');
        notice.textContent = (sidebarView === 'settings' ? settingsLabels : labels).panelAuthFailed;
        notice.hidden = false;
      }
      if (!res.ok) throw new Error('Panel request failed: HTTP ' + res.status);
      return res;
    }
    async function saveSettings(patch) {
        if (savingSettings) return;
        const previous = { ...prefs };
        savingSettings = true;
        settingsEpoch++;
        applySettings(patch);
        updateControlState();
        try {
          const res = await postApi('/api/settings', patch);
          const data = await res.json();
          if (!res.ok || data.error) throw new Error('Save failed');
          applySettings(data, true);
        } catch {
          applySettings(previous, true);
          if (!panelLocked) window.alert(settingsLabels.saveFailed);
        } finally {
          settingsEpoch++;
          savingSettings = false;
          updateControlState();
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
        const value = select.type === 'checkbox' ? select.checked : select.value;
        const patch = { [select.name]: value };
        if (select.name === 'showSpeed' && !value) patch.speedAnimation = false;
        void saveSettings(patch);
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
    function renderQuota(groups) {
      const root = document.getElementById('quota-root');
      const quotaGroups = presentation.quotaView(groups, prefs, labels);
      if (quotaGroups.length === 0) {
        root.replaceChildren();
        return;
      }
      const useBar = presentation.appearance(prefs).quotaIndicator === 'bar';
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
    }

    async function refresh() {
      if (panelLocked || refreshing) return;
      refreshing = true;
      const requestedSettingsEpoch = settingsEpoch;
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const convId = window.sidecar?.conversationId || urlParams.get('conversationId') || '';
        const res = await postApi('/api/context', { conversationId: convId }, AbortSignal.timeout(6000));
        const d = await res.json();
        if (!d || d.error) throw new Error('Context unavailable');
        if (panelLocked) return;
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
        // Settings are re-applied only when they changed; renderData skips an unchanged snapshot itself.
        const prefsChanged = JSON.stringify({ ...prefs, ...d.prefs }) !== JSON.stringify(prefs);
        if (prefsChanged && !savingSettings && requestedSettingsEpoch === settingsEpoch) applySettings(d.prefs);
        else renderData(d);
      } catch {
        if (!panelLocked) {
          refreshFailures++;
          sampleCount = 0;
          renderHealthNotice();
        }
      } finally { refreshing = false; }
    }

    // The expiry ring or bar advances with the clock, so it is painted on its own. The DOM
    // serializes SVG differently, hence the comparison with the last write.
    function paintCacheIndicator(cache) {
      if (cacheIconSvg !== cache.iconSvg) document.getElementById('dot-cached').innerHTML = cacheIconSvg = cache.iconSvg;
      const cacheMeterEl = document.getElementById('cache-meter');
      const cacheMeterFillEl = document.getElementById('cache-meter-fill');
      if (!cacheMeterEl || !cacheMeterFillEl) return;
      const hidden = cache.indicator !== 'bar';
      if (cacheMeterEl.hidden !== hidden) cacheMeterEl.hidden = hidden;
      if (hidden) return;
      cacheMeterFillEl.style.width = cache.progressPct;
      cacheMeterFillEl.style.backgroundColor = cache.progressColor;
    }

    function renderData(d) {
        // The notice follows the health samples, which can change under an unchanged snapshot.
        renderHealthNotice();
        // Statistics hidden behind the settings tab are not refreshed; they catch up when it is left.
        if (sidebarView !== 'stats') return;
        const cache = presentation.cacheView(d, prefs);
        paintCacheIndicator(cache);
        // Everything else is repainted only when the snapshot, the settings or a clock-driven text
        // changed: the cache state, a reset countdown or a running turn's elapsed time.
        const { iconSvg, progress, progressPct, progressColor, ...cacheState } = cache;
        const key = JSON.stringify([d, prefs, cacheState, presentation.quotaView(d.quotaGroups, prefs, labels), d.turnMetrics && presentation.turnMetricsText(d.turnMetrics).elapsed]);
        if (key === renderedKey) return;
        renderedKey = key;
        presentation.renderContextTooltips(document.querySelector('.panel'), d, labels);
        presentation.renderAlerts(document.body, d, prefs, labels);
        presentation.renderGeneration(document.querySelector('.panel'), d.generation, labels, prefs);
        presentation.renderTurnMetrics(document.querySelector('.panel'), d.turnMetrics, labels, prefs);
        const ctx = presentation.contextBreakdown(d);

        document.getElementById('used-pct').textContent = ctx.usedPct;
        document.getElementById('used-fraction').textContent = ctx.usedFrac;

        document.getElementById('seg-read').style.width = ctx.segReadW;
        document.getElementById('seg-out').style.width = ctx.segOutW;
        document.getElementById('seg-think').style.width = ctx.segThinkW;
        document.getElementById('seg-turn0').style.width = ctx.segTurn0W;

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
        document.getElementById('row-cached').title = presentation.cacheTooltip(d, labels, Date.now(), prefs);

        document.getElementById('val-turn0-k').textContent = ctx.turn0K;
        document.getElementById('val-read-k').textContent = ctx.readK;
        document.getElementById('val-think-k').textContent = ctx.thinkK;
        document.getElementById('val-out-k').textContent = ctx.outK;
        document.getElementById('val-turn0-pct').textContent = ctx.turn0Pct;
        document.getElementById('val-read-pct').textContent = ctx.readPct;
        document.getElementById('val-think-pct').textContent = ctx.thinkPct;
        document.getElementById('val-out-pct').textContent = ctx.outPct;

        renderQuota(d.quotaGroups);
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
          shortcutFixMessageKey = result?.ok ? 'cdpFixShortcutDone' : 'cdpFixShortcutAdmin';
        } catch {
          shortcutFixMessageKey = 'cdpFixShortcutAdmin';
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
      const dict = sidebarView === 'settings' ? settingsLabels : labels;
      notice.lang = sidebarView === 'settings' ? prefs.settingsLanguage : document.body.dataset.language;
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
      for (const control of document.querySelectorAll('.settings select, .settings input, .settings button:not(.setting-help-dot)')) {
        const optionCard = control.closest('.setting-option-card');
        const thresholdCard = control.closest('.setting-threshold-card');
        const detailPop = control.closest('.pv-detail-pop');
        const parentDisabled = (control.name === 'speedAnimation' && prefs.showSpeed === false)
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

export { inspectConversation, UI_HTML, parseGenRow, readConversationSnapshot };

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
    return {
      ...await inspectConversation(data?.conversationId || app.config.conversationId),
      deckCdp,
      deckCdpInfo: cdpNotice.info(deckCdp),
    };
  }, 'POST');
  app.api('/api/settings', (data) => settingsStore.update(data), 'POST');
  app.api('/api/fix-cdp-shortcut', () => cdpNotice.fixShortcuts(), 'POST');
  const ready = app.run();
  installAsyncHostRoutes(app);
  await ready;
  return app;
}
if (isMain && (process.env.ANTIGRAVITY_LS_ADDRESS || process.env.ANTIGRAVITY_SIDECAR_WEB_PORT)) {
  const injector = deckInjector = startDeckInjector(inspectConversation, {
    productRoots: conversationDirs.map(dir => dirname(dir)),
    onStatus: state => cdpNotice.observe(state),
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
