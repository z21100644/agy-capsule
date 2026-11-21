import { readFileSync } from 'node:fs';

export const REPO = 'Lumidarin/agy-capsule';
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const VERSION_ROUTE = '/api/version';

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
  let inFlight = null;
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
        if (res.status === 429 || (res.status === 403 && (res.headers?.get('retry-after') || res.headers?.get('x-ratelimit-remaining') === '0'))) {
          return error('rateLimit');
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
  return async function check(mode) {
    if (!['manual', 'auto'].includes(mode)) return error('invalidMode');
    const automatic = mode === 'auto';
    const enabled = () => getPrefs?.()?.notifyUpdates === true;
    if (automatic && !enabled()) return result('disabled');
    if (!parseVersion(currentVersion)) return automatic ? result('idle') : error('localVersion');
    if (!inFlight && (!automatic || !cached || now() >= nextAutoAt)) {
      inFlight = load().then(value => {
        cached = value;
        nextAutoAt = now() + (value.status === 'error' ? failureTtlMs : successTtlMs);
        return value;
      }).finally(() => { inFlight = null; });
    }
    const value = await (inFlight || cached);
    if (automatic && !enabled()) return result('disabled');
    return automatic && value.status === 'error' ? result('idle') : value;
  };
}

