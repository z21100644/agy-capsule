import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

export class UpdateError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const allowedHosts = new Set(['api.github.com', 'github.com', 'codeload.github.com', 'objects.githubusercontent.com']);
const redirects = new Set([301, 302, 303, 307, 308]);
const unzip = promisify(gunzip);
export const ROOT_FILES = ['plugin.json', 'logo.svg', 'README.md', 'THIRD-PARTY-NOTICES.md'];
export const SIDECAR_PATH = 'sidecars/agy_capsule';

export async function downloadArchive(startUrl, {
  fetchImpl = (...args) => fetch(...args), timeoutMs = 30_000, maxBytes = 8 * 1024 * 1024,
} = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  function approvedUrl(value, base) {
    const url = typeof value === 'string' && value && URL.parse(value, base);
    if (!url || url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.port || url.username || url.password) {
      throw new UpdateError('redirect');
    }
    return url.href;
  }
  try {
    let url = approvedUrl(startUrl);
    for (let i = 0; i <= 4; i++) {
      const res = await fetchImpl(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'agy-capsule' } });
      if (res.url) {
        try { approvedUrl(res.url); } catch (error) { void res.body?.cancel().catch(() => {}); throw error; }
      }
      if (redirects.has(res.status)) {
        void res.body?.cancel().catch(() => {});
        url = approvedUrl(res.headers.get('location'), url);
        continue;
      }
      if (!res.ok || !res.body) {
        void res.body?.cancel().catch(() => {});
        throw new UpdateError('download');
      }
      if (Number(res.headers.get('content-length')) > maxBytes) {
        void res.body.cancel().catch(() => {});
        throw new UpdateError('size');
      }
      const chunks = [];
      let size = 0;
      const reader = res.body.getReader();
      try {
        while (true) {
          signal.throwIfAborted();
          const { value, done } = await reader.read();
          if (done) return Buffer.concat(chunks, size);
          size += value.byteLength;
          if (size > maxBytes) throw new UpdateError('size');
          chunks.push(Buffer.from(value));
        }
      } catch (error) {
        void reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
    }
    throw new UpdateError('redirect');
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError(signal.aborted || error?.name === 'TimeoutError' ? 'timeout' : 'download');
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const textField = bytes => {
  const end = bytes.indexOf(0);
  try { return utf8.decode(end < 0 ? bytes : bytes.subarray(0, end)); }
  catch { throw new UpdateError('archive'); }
};
function octal(bytes) {
  const value = bytes.toString('latin1').replace(/[\0 ]+$/g, '').trimStart();
  if (!/^[0-7]+$/.test(value)) throw new UpdateError('archive');
  return Number.parseInt(value, 8);
}
function safePath(path) {
  const parts = path.split('/');
  if (parts.some(part => !part || /[\\:*?"<>|\x00-\x1f\x7f]/.test(part) || /[ .]$/.test(part)
    || /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part))) {
    throw new UpdateError('archive');
  }
  return parts;
}

// GitHub generates a ustar with one pax commit-comment record. Reject links,
// special files and path-overriding extensions, even outside the plugin tree.
export async function readRuntimeArchive(compressed, maxBytes = 32 * 1024 * 1024) {
  let tar;
  try { tar = await unzip(compressed, { maxOutputLength: maxBytes }); }
  catch (error) { throw new UpdateError(error?.code === 'ERR_BUFFER_TOO_LARGE' ? 'size' : 'archive'); }
  const files = new Map();
  const seen = new Set();
  const block = 512;
  let archiveRoot;
  for (let pos = 0; pos + block <= tar.length;) {
    const header = tar.subarray(pos, pos + block);
    if (header.every(byte => byte === 0)) {
      if (tar.length - pos >= 2 * block && tar.length % block === 0 && tar.subarray(pos).every(byte => byte === 0)) return files;
      break;
    }
    if (header.toString('latin1', 257, 263) !== 'ustar\0' || seen.size >= 4096) break;
    let checksum = 0;
    for (let i = 0; i < block; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
    if (checksum !== octal(header.subarray(148, 156))) break;
    const size = octal(header.subarray(124, 136));
    const start = pos + block;
    const end = start + Math.ceil(size / block) * block;
    if (end > tar.length) break;
    const contents = tar.subarray(start, start + size);
    const type = header[156];
    const first = pos === 0;
    pos = end;
    if (type === 103 && first && size === 52 && /^52 comment=[0-9a-f]{40}\n$/.test(contents.toString('latin1'))) continue;
    const isDirectory = type === 53;
    if ((!isDirectory && type !== 0 && type !== 48) || (isDirectory && size)) break;
    const prefix = textField(header.subarray(345, 500));
    const name = textField(header.subarray(0, 100));
    const path = prefix ? prefix + '/' + name : name;
    const parts = safePath(isDirectory ? path.replace(/\/$/, '') : path);
    archiveRoot ??= parts[0];
    if (parts[0] !== archiveRoot || (!isDirectory && parts.length < 2)) break;
    const key = parts.join('/').normalize('NFC').toLowerCase();
    if (seen.has(key)) break;
    seen.add(key);
    if (isDirectory || parts[1] !== 'agy-capsule') continue;
    const relative = parts.slice(2).join('/');
    if (ROOT_FILES.includes(relative) || relative.startsWith(SIDECAR_PATH + '/')) files.set(relative, contents);
  }
  throw new UpdateError('archive');
}
