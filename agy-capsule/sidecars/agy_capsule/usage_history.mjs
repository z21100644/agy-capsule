import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileStamp } from './sqlite_cache.mjs';

const COUNTERS = ['uncached', 'cacheRead', 'cacheWrite', 'output'];
const RECENT_WRITE_MS = 60_000;
const tokensOf = request => COUNTERS.reduce((sum, key) => sum + request[key], 0);
const pad = value => String(value).padStart(2, '0');
const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

// Days follow this computer's time zone, the clock the sidebar shows them on.
function localDay(epochMs) {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Deterministic tie-breaker when the same response_id/message_id appears in more than one file:
// prefer the fullest token record, then dated over undated, earlier start time, named model, and path.
function preferRequest(candidate, known) {
  const diff = tokensOf(candidate) - tokensOf(known);
  if (diff !== 0) return diff > 0;
  const candidateDated = candidate.at !== null;
  const knownDated = known.at !== null;
  if (candidateDated !== knownDated) return candidateDated;
  if (candidateDated && candidate.at !== known.at) return candidate.at < known.at;
  const candidateModel = candidate.model || '';
  const knownModel = known.model || '';
  if (Boolean(candidateModel) !== Boolean(knownModel)) return Boolean(candidateModel);
  if (candidateModel !== knownModel) return candidateModel < knownModel;
  const a = candidate.source || '';
  const b = known.source || '';
  return a !== b ? a < b : false;
}

// Adds requests up per local day and, within a day, per model. A response stored in more than
// one conversation file is one request and keeps its fullest record; a request without a start
// time counts towards no day.
export function summarizeUsage(requests) {
  const identified = new Map();
  const counted = [];
  for (const request of requests) {
    if (!request.id) { counted.push(request); continue; }
    const known = identified.get(request.id);
    if (!known || preferRequest(request, known)) identified.set(request.id, request);
  }
  for (const request of identified.values()) counted.push(request);
  const emptyBucket = () => ({ requests: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
  const add = (bucket, request) => {
    bucket.requests++;
    for (const key of COUNTERS) bucket[key] += request[key];
  };
  const days = new Map();
  const undated = emptyBucket();
  for (const request of counted) {
    if (request.at === null) { add(undated, request); continue; }
    const date = localDay(request.at);
    const day = days.get(date) ?? days.set(date, { total: emptyBucket(), models: new Map() }).get(date);
    add(day.total, request);
    const model = request.model || '';
    add(day.models.get(model) ?? day.models.set(model, emptyBucket()).get(model), request);
  }
  return {
    days: [...days].sort(byKey).map(([date, day]) => ({
      date,
      ...day.total,
      models: [...day.models].sort(byKey).map(([name, bucket]) => ({ name, ...bucket })),
    })),
    undated,
  };
}

function pairStamp(path) {
  const db = fileStamp(path);
  if (!db || db.size === 0n) return null;
  const wal = fileStamp(path + '-wal');
  // Opening a recently closed WAL DB plain read-only can leave an empty 0-byte -wal;
  // only a non-empty -wal holds frames that affect reads or the snapshot fingerprint.
  const activeWal = wal && wal.size > 0n ? wal : null;
  return {
    key: db.key + '|' + (activeWal?.key || 'no-wal'),
    hasWal: Boolean(activeWal),
    mtimeMs: Math.max(db.mtimeMs, activeWal?.mtimeMs || 0),
  };
}

// Usage over every conversation database on disk. A database is read again only after it
// changed, and the event loop gets a turn between reads so polls keep being answered.
export function createUsageHistory({
  directories,
  readRequests,
  getActiveIds = () => [],
  recentMs = RECENT_WRITE_MS,
  now = Date.now,
  pause = () => new Promise(resolve => setImmediate(resolve)),
}) {
  const files = new Map();
  let totals = null;
  let scanning = null;
  async function scan(extraActiveIds = []) {
    const activeIds = new Set([...(getActiveIds() || []), ...extraActiveIds].filter(Boolean));
    const present = new Set();
    let changed = totals === null;
    let unchanged = 0;
    let unread = 0;
    for (const directory of directories) {
      let names = [];
      try { names = readdirSync(directory).sort(); } catch {} // a product that was never used has no folder
      for (const name of names) {
        if (!name.endsWith('.db')) continue;
        const path = join(directory, name);
        const before = pairStamp(path);
        if (!before) continue;
        present.add(path);
        const stale = files.get(path)?.key !== before.key;
        if (stale) {
          const conversationId = name.slice(0, -3);
          const recentlyModified = now() - before.mtimeMs < recentMs;
          // Skip immutable=1 for open WALs, active conversations, or recently modified files.
          const immutable = !before.hasWal && !activeIds.has(conversationId) && !recentlyModified;
          try {
            const requests = readRequests(path, { immutable });
            const after = pairStamp(path);
            if (!after) {
              // Deleted mid-read: drop from present so cleanup removes stale cached rows now.
              present.delete(path);
            } else if (after.key === before.key) {
              // Only cache if .db and non-empty -wal stayed unchanged during the read.
              files.set(path, {
                key: before.key,
                requests: requests.map(req => (req.source ? req : { ...req, source: path })),
              });
              changed = true;
            } else {
              // Changed mid-read: discard this round's rows, keep any prior cache, and report unread.
              unread++;
            }
          } catch {
            unread++; // keeps its last good rows, if any, and is tried again by the next scan
          }
        }
        if (stale || ++unchanged % 64 === 0) await pause();
      }
    }
    for (const path of files.keys()) {
      if (present.has(path)) continue;
      files.delete(path);
      changed = true;
    }
    if (changed) {
      const ordered = [...files.entries()].sort(byKey).flatMap(([, file]) => file.requests);
      totals = summarizeUsage(ordered);
    }
    return { ...totals, unread };
  }
  return {
    // Concurrent callers share one scan.
    read(options = {}) {
      const extra = options?.activeId ? [options.activeId] : [];
      scanning ??= scan(extra).finally(() => { scanning = null; });
      return scanning;
    },
  };
}
