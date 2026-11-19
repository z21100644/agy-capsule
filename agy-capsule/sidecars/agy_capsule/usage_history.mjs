import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileStamp } from './sqlite_cache.mjs';

const COUNTERS = ['uncached', 'cacheRead', 'cacheWrite', 'output'];
const tokensOf = request => COUNTERS.reduce((sum, key) => sum + request[key], 0);
const pad = value => String(value).padStart(2, '0');

// Days follow this computer's time zone, the clock the sidebar shows them on.
function localDay(epochMs) {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Adds requests up per local day. A response stored in more than one conversation file is one
// request and keeps its fullest record; a request without a start time counts towards no day.
export function summarizeUsage(requests) {
  const identified = new Map();
  const counted = [];
  for (const request of requests) {
    if (!request.id) { counted.push(request); continue; }
    const known = identified.get(request.id);
    if (!known || tokensOf(request) > tokensOf(known)) identified.set(request.id, request);
  }
  for (const request of identified.values()) counted.push(request);
  const emptyBucket = () => ({ requests: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
  const days = new Map();
  const undated = emptyBucket();
  for (const request of counted) {
    const date = request.at === null ? '' : localDay(request.at);
    const bucket = date ? days.get(date) ?? days.set(date, emptyBucket()).get(date) : undated;
    bucket.requests++;
    for (const key of COUNTERS) bucket[key] += request[key];
  }
  return {
    days: [...days].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, bucket]) => ({ date, ...bucket })),
    undated,
  };
}

// Usage over every conversation database on disk. A database is read again only after it
// changed, and the event loop gets a turn between reads so polls keep being answered.
export function createUsageHistory({ directories, readRequests, pause = () => new Promise(resolve => setImmediate(resolve)) }) {
  const files = new Map();
  let totals = null;
  let scanning = null;
  async function scan() {
    const present = new Set();
    let changed = totals === null;
    let unchanged = 0;
    let unread = 0;
    for (const directory of directories) {
      let names = [];
      try { names = readdirSync(directory); } catch {} // a product that was never used has no folder
      for (const name of names) {
        if (!name.endsWith('.db')) continue;
        const path = join(directory, name);
        const stamp = fileStamp(path);
        if (!stamp || stamp.size === 0n) continue;
        present.add(path);
        // Stamped before reading: a write that lands meanwhile is picked up by the next scan.
        const key = stamp.key + '|' + (fileStamp(path + '-wal')?.key || 'no-wal');
        const stale = files.get(path)?.key !== key;
        if (stale) {
          try {
            files.set(path, { key, requests: readRequests(path) });
            changed = true;
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
    if (changed) totals = summarizeUsage([...files.values()].flatMap(file => file.requests));
    return { ...totals, unread };
  }
  return {
    // Concurrent callers share one scan.
    read() {
      scanning ??= scan().finally(() => { scanning = null; });
      return scanning;
    },
  };
}
