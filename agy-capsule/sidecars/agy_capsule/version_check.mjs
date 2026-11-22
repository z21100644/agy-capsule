import { readFileSync } from 'node:fs';

export const REPO = 'Lumidarin/agy-capsule';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const VERSION_ROUTE = '/api/version';
const maxUnspecifiedRateLimits = 4;
const manualDedupeMs = 5000;

function getRetryAt(headers, now) {
  const readDeadline = (name, offset = 0) => {
    const seconds = headers.get(name);
    if (!/^\d+$/.test(seconds)) return 0;
    const deadline = offset + Number(seconds) * 1000;
    return deadline > now && Number.isFinite(new Date(deadline).getTime()) ? deadline : 0;
  };
  const retryAt = readDeadline('retry-after', now);
  const resetAt = headers.get('x-ratelimit-remaining') === '0' ? readDeadline('x-ratelimit-reset') : 0;
  return Math.max(retryAt, resetAt) || null;
}

export function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value.trim());
  if (!match) return null;
  const pre = match[4]?.split('.') || [];
  if (pre.some(id => /^0\d+$/.test(id))) return null;
  return { core: match.slice(1, 4), pre, version: match[0].replace(/^v/, '') };
}

const order = (a, b) => a === b ? 0 : a > b ? 1 : -1;
const digits = /^\d+$/;
const numericOrder = (a, b) => order(a.length, b.length) || order(a, b);

export function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    const cmp = numericOrder(left.core[i], right.core[i]);
    if (cmp) return cmp;
  }
  if (!left.pre.length || !right.pre.length) return order(!left.pre.length, !right.pre.length);
  for (let i = 0; i < Math.min(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i];
    const xn = digits.test(x), yn = digits.test(y);
    const cmp = xn && yn ? numericOrder(x, y) : xn !== yn ? order(yn, xn) : order(x, y);
    if (cmp) return cmp;
  }
  return order(left.pre.length, right.pre.length);
}

function readLocalVersion() {
  try { return parseVersion(JSON.parse(readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')).version)?.version || ''; }
  catch { return ''; }
}

export const CURRENT_VERSION = readLocalVersion();

export function createVersionChecker({
  getPrefs, currentVersion = CURRENT_VERSION, fetchImpl = (...args) => fetch(...args), now = Date.now,
  successTtlMs = 6 * 60 * 60_000, failureTtlMs = 30 * 60_000, timeoutMs = 4000,
} = {}) {
  let cached = null;
  let nextAutoAt = 0;
  let manualReuseUntil = 0;
  let inFlight = null;
  let unspecifiedRateLimits = 0;
  const result = (status, fields) => ({ status, currentVersion, ...fields });
  const error = (reason, fields) => result('error', { reason, ...fields });
  async function load() {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const res = await fetchImpl(LATEST_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agy-capsule' },
        redirect: 'error', signal,
      });
      if (!res.ok) {
        if (res.status === 429 || (res.status === 403 && (
          res.headers.get('retry-after') || res.headers.get('x-ratelimit-remaining') === '0'
          || /\bsecondary rate limit\b/i.test((await res.json().catch(() => null))?.message || '')
        ))) {
          return error('rateLimit', { retryAt: getRetryAt(res.headers, now()) });
        }
        if (res.status === 404) return error('noRelease');
        return error('http', { httpStatus: res.status });
      }
      const data = await res.json();
      const latest = parseVersion(data?.tag_name);
      if (!latest || latest.pre.length || data.draft || data.prerelease) return error('invalidRelease');
      const releaseTag = data.tag_name.trim();
      return result(compareVersions(latest.version, currentVersion) > 0 ? 'update' : 'current', {
        latestVersion: latest.version, releaseTag, releaseUrl: RELEASES_URL + '/tag/' + encodeURIComponent(releaseTag),
      });
    } catch (err) {
      return error(signal.aborted || err?.name === 'TimeoutError' ? 'timeout' : err instanceof SyntaxError ? 'invalidRelease' : 'network');
    }
  }
  return async function check(mode, { fresh = false } = {}) {
    if (!['manual', 'auto'].includes(mode)) return error('invalidMode');
    const automatic = mode === 'auto';
    const enabled = () => getPrefs?.()?.notifyUpdates === true;
    if (automatic && !enabled()) return result('disabled');
    if (!parseVersion(currentVersion)) return automatic ? result('idle') : error('localVersion');
    if (cached?.reason === 'rateLimit' && (
      now() < cached.retryAt || (automatic && unspecifiedRateLimits >= maxUnspecifiedRateLimits)
    )) return automatic ? result('idle') : cached;
    const dedupeManual = !automatic && !fresh;
    // Reuse only a recent manual check, not the background cache. An in-flight
    // fetch may contain newer information, so prefer waiting for it.
    if (dedupeManual && !inFlight && cached && cached.reason !== 'rateLimit' && now() < manualReuseUntil) {
      return cached;
    }
    if (!inFlight && (!automatic || !cached || now() >= nextAutoAt)) {
      inFlight = load().then(value => {
        unspecifiedRateLimits = value.reason === 'rateLimit' && value.retryAt === null
          ? Math.min(unspecifiedRateLimits + 1, maxUnspecifiedRateLimits) : 0;
        if (value.reason === 'rateLimit') {
          const retryAt = value.retryAt ?? (now() + 60_000 * 2 ** (unspecifiedRateLimits - 1));
          value = { ...value, retryAt };
        }
        cached = value;
        nextAutoAt = value.retryAt ?? (now() + (value.status === 'error' ? failureTtlMs : successTtlMs));
        return value;
      }).finally(() => { inFlight = null; });
    }
    const value = await (inFlight || cached);
    if (dedupeManual && value.reason !== 'rateLimit') manualReuseUntil = now() + manualDedupeMs;
    if (automatic && !enabled()) return result('disabled');
    return automatic && value.status === 'error' ? result('idle') : value;
  };
}

