import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createVersionChecker, compareVersions, CURRENT_VERSION, VERSION_ROUTE } from '../agy-capsule/sidecars/agy_capsule/version_check.mjs';
import { createVersionPanel } from '../agy-capsule/sidecars/agy_capsule/version_ui.mjs';
import { createSettingsStore } from '../agy-capsule/sidecars/agy_capsule/settings.mjs';
import { createPresentation } from '../agy-capsule/sidecars/agy_capsule/ui.mjs';
import { startPanel, UI_HTML } from '../agy-capsule/sidecars/agy_capsule/server.mjs';
import { UPDATE_ROUTE } from '../agy-capsule/sidecars/agy_capsule/version_update.mjs';

const release = tag => Response.json({ tag_name: tag, html_url: 'https://untrusted.example/' });

test('SemVer compares numbers, prereleases and v prefixes, ignoring build metadata', () => {
  const versions = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta',
    '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.10', '1.10.0', '2.0.0'];
  for (let i = 1; i < versions.length; i++) {
    assert.equal(compareVersions(versions[i - 1], versions[i]), -1);
    assert.equal(compareVersions(versions[i], versions[i - 1]), 1);
  }
  assert.equal(compareVersions('v1.4.2+build.01', '1.4.2+other'), 0);
  assert.equal(compareVersions('9007199254740993.0.0', '9007199254740992.0.0'), 1);
  for (const invalid of ['latest', '1.2', '1.02.3', '1.2.3-01', '1.2.3-rc..1', '1.2.3+']) {
    assert.equal(compareVersions(invalid, '1.2.3'), null);
  }
  const manifest = JSON.parse(readFileSync(new URL('../agy-capsule/plugin.json', import.meta.url)));
  assert.equal(CURRENT_VERSION, manifest.version);
});

test('automatic check is gated by saved prefs and shares the in-flight request and TTL', async () => {
  let enabled = false, now = 0, calls = 0, settle;
  const check = createVersionChecker({
    currentVersion: '1.2.3', now: () => now, successTtlMs: 100, failureTtlMs: 10,
    getPrefs: () => ({ notifyUpdates: enabled }),
    fetchImpl: () => { calls++; return new Promise(resolve => { settle = resolve; }); },
  });
  assert.equal((await check('auto')).status, 'disabled');
  assert.equal(calls, 0);
  enabled = true;
  const starting = [check('auto'), check('auto')];
  assert.equal(calls, 1);
  settle(release('v1.2.4'));
  assert.deepEqual((await Promise.all(starting)).map(x => x.status), ['update', 'update']);
  now = 99;
  assert.equal((await check('auto')).latestVersion, '1.2.4');
  assert.equal(calls, 1);
  now = 100;
  const pending = check('auto');
  assert.equal(calls, 2);
  enabled = false;
  settle(release('v1.2.5'));
  assert.equal((await pending).status, 'disabled', 'a response arriving after opt-out cannot prompt');
  now = 1000;
  assert.equal((await check('auto')).status, 'disabled');
  assert.equal(calls, 2);
  const immediate = check('manual');
  assert.equal(calls, 3, 'manual works even while disabled');
  settle(release('v1.2.6'));
  assert.equal((await immediate).latestVersion, '1.2.6');
});

test('manual checks bypass the normal TTL, identify versions and give safe error reasons', async () => {
  let calls = 0, now = 0, answer = () => release('v1.2.3');
  const check = createVersionChecker({
    currentVersion: '1.2.3', getPrefs: () => ({ notifyUpdates: true }), now: () => now, failureTtlMs: 10,
    fetchImpl: async (url, opts) => {
      assert.equal(url, 'https://api.github.com/repos/Lumidarin/agy-capsule/releases/latest');
      assert.equal(opts.redirect, 'error');
      assert.ok(opts.signal);
      calls++;
      return answer();
    },
  });
  const nextManual = () => { now += 5000; return check('manual'); };
  assert.equal((await check('manual')).status, 'current');
  answer = () => release('v1.10.0');
  assert.deepEqual(await nextManual(), {
    status: 'update', currentVersion: '1.2.3', latestVersion: '1.10.0', releaseTag: 'v1.10.0',
    releaseUrl: 'https://github.com/Lumidarin/agy-capsule/releases/tag/v1.10.0',
  });
  answer = () => { throw new Error('internal network details'); };
  assert.deepEqual(await nextManual(), { status: 'error', currentVersion: '1.2.3', reason: 'network' });
  assert.equal((await check('auto')).status, 'idle');
  assert.equal(calls, 3);
  now += 10;
  answer = () => new Response('', { status: 403, headers: { 'X-RateLimit-Remaining': '0' } });
  assert.equal((await check('auto')).status, 'idle');
  assert.equal(calls, 4);
  assert.equal((await check('manual')).reason, 'rateLimit');
  assert.equal(calls, 4, 'manual checks share the limit cooldown');
  now += 60_000;
  answer = () => new Response('', { status: 404 });
  assert.equal((await check('manual')).reason, 'noRelease');
  answer = () => new Response('', { status: 503 });
  assert.equal((await nextManual()).httpStatus, 503);
  answer = () => release('not-a-version');
  assert.equal((await nextManual()).reason, 'invalidRelease');
  answer = () => release('v2.0.0-rc.1');
  assert.equal((await nextManual()).reason, 'invalidRelease');
  answer = () => { throw new DOMException('test deadline', 'TimeoutError'); };
  assert.equal((await nextManual()).reason, 'timeout');
  assert.equal((await check()).reason, 'invalidMode');
});

test('manual checks reuse a completed check for five seconds without sliding the deadline', async () => {
  let now = 100, calls = 0;
  const check = createVersionChecker({
    currentVersion: '1.2.3', now: () => now, getPrefs: () => ({ notifyUpdates: true }),
    fetchImpl: async () => {
      calls++;
      if (calls === 3) throw new Error('network unavailable');
      return release('v1.2.' + (3 + calls));
    },
  });
  assert.equal((await check('auto')).latestVersion, '1.2.4');
  assert.equal((await check('manual')).latestVersion, '1.2.5', 'a recent background check alone does not suppress a manual check');
  now = 5099;
  assert.equal((await check('manual')).latestVersion, '1.2.5');
  assert.equal(calls, 2);
  now = 5100;
  assert.equal((await check('manual')).reason, 'network');
  now = 5101;
  assert.equal((await check('manual')).reason, 'network', 'immediate retries also reuse ordinary failures');
  assert.equal(calls, 3);
  now = 10100;
  assert.equal((await check('manual')).latestVersion, '1.2.7');
  assert.equal(calls, 4);
});

test('an expired rate limit does not linger in the manual reuse window', async () => {
  let now = 100, calls = 0;
  const check = createVersionChecker({
    currentVersion: '1.2.3', now: () => now,
    fetchImpl: async () => ++calls === 2 ? new Response('', { status: 429, headers: { 'Retry-After': '1' } }) : release('v1.2.4'),
  });
  assert.equal((await check('manual')).status, 'update');
  assert.equal((await check('manual', { fresh: true })).reason, 'rateLimit');
  now = 1099;
  assert.equal((await check('manual')).reason, 'rateLimit');
  assert.equal(calls, 2);
  now = 1100;
  assert.equal((await check('manual')).status, 'update');
  assert.equal(calls, 3);
});

test('manual and automatic checks wait for the later GitHub rate limit deadline', async () => {
  let now = 100_000, calls = 0;
  const check = createVersionChecker({
    currentVersion: '1.2.3', getPrefs: () => ({ notifyUpdates: true }), now: () => now,
    fetchImpl: async () => ++calls === 1 ? new Response('', {
      status: 403, headers: { 'Retry-After': '90', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '220' },
    }) : release('v1.2.4'),
  });
  const limited = { status: 'error', currentVersion: '1.2.3', reason: 'rateLimit', retryAt: 220_000 };
  assert.deepEqual(await check('manual'), limited);
  now = 219_999;
  assert.deepEqual(await check('manual'), limited);
  assert.equal((await check('auto')).status, 'idle');
  assert.equal(calls, 1);
  now++;
  assert.deepEqual((await Promise.all([check('auto'), check('manual')])).map(r => r.status), ['update', 'update']);
  assert.equal(calls, 2);
});

test('GitHub rate limits without a usable deadline back off and eventually wait for a manual check', async () => {
  let now = 0, calls = 0, answer = () => Response.json({ message: 'You have exceeded a secondary rate limit.' }, {
    status: 403, headers: { 'X-RateLimit-Remaining': '37', 'X-RateLimit-Reset': '3600' },
  });
  const check = createVersionChecker({
    currentVersion: '1.2.3', getPrefs: () => ({ notifyUpdates: true }), now: () => now,
    fetchImpl: async () => { calls++; return answer(); },
  });
  for (const minutes of [1, 2, 4, 8]) {
    assert.equal((await check('auto')).status, 'idle');
    const limited = await check('manual');
    assert.equal(limited.reason, 'rateLimit');
    assert.equal(limited.retryAt, now + minutes * 60_000);
    now = limited.retryAt;
  }
  assert.equal((await check('auto')).status, 'idle');
  assert.equal(calls, 4);
  answer = () => new Response('', { status: 429, headers: { 'Retry-After': '5' } });
  assert.equal((await check('manual')).retryAt, now + 5_000);
  now += 5_000;
  answer = () => release('v1.2.3');
  assert.equal((await check('auto')).status, 'current');
  assert.equal(calls, 6);
});

test('the version notification setting defaults on for old settings and persists only booleans', t => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-version-setting-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'settings.json');
  writeFileSync(path, '{"language":"zh-TW"}');
  const store = createSettingsStore(path);
  assert.equal(store.read().notifyUpdates, true);
  assert.equal(store.update({ notifyUpdates: false }).notifyUpdates, false);
  const reopened = createSettingsStore(path);
  assert.equal(reopened.read().notifyUpdates, false);
  assert.equal(reopened.read().language, 'zh-TW');
  assert.equal(reopened.update({ notifyUpdates: 'true' }).notifyUpdates, false);
  assert.equal(reopened.update({ notifyUpdates: true }).notifyUpdates, true);
});

test('sidebar renders all three languages, dismisses automatic prompts and reports manual results even after opt-out', async () => {
  const ids = ['check', 'notify', 'status', 'notice', 'available', 'release', 'dismiss', 'update',
    'copy-diagnostics', 'copy-prompt', 'copy-status', 'diagnostics'];
  const nodes = Object.fromEntries(ids.map(id => {
    assert.match(UI_HTML, new RegExp('id="version-' + id + '"'));
    return [id, {
      textContent: '', hidden: id === 'notice', dataset: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(_name, fn) { this.click = fn; },
      removeAttribute(name) { delete this[name]; },
      focus() { this.focused = true; },
      select() { this.selected = this.value; },
    }];
  }));
  assert.doesNotMatch(UI_HTML, /setting-notify-updates|data-setting-card="notifyUpdates"|version-setting-help/);
  assert.ok(UI_HTML.includes(`id="version-number">v${CURRENT_VERSION}</strong>`));
  assert.match(UI_HTML, /class="pv-swatch" id="version-notify" aria-pressed="true" data-active="true"/);
  assert.match(UI_HTML, /role="status" aria-atomic="true">\s*<strong id="version-available"><\/strong>\s*<p class="version-feedback" id="version-status">/);
  assert.match(UI_HTML, /id="version-release" target="_blank" rel="noopener noreferrer"/);
  nodes.release.dataset.releasesUrl = 'https://github.com/Lumidarin/agy-capsule/releases';
  assert.doesNotMatch(UI_HTML, /id="version-instructions"/);
  const copied = [];
  const root = {
    querySelector: key => nodes[key.slice('#version-'.length)],
    ownerDocument: { defaultView: { navigator: { clipboard: { writeText: async text => copied.push(text) } } } },
  };
  let now = 0;
  const calls = [];
  const saved = [];
  const installs = [];
  let resolveInstall;
  const update = { status: 'update', currentVersion: '1.0.0', latestVersion: '2.0.0', releaseUrl: 'https://github.com/Lumidarin/agy-capsule/releases/tag/v2.0.0' };
  let reply = update;
  const { dictionaries } = createPresentation();
  let language;
  const setLanguage = (settingsLanguage, notifyUpdates) => {
    language = settingsLanguage;
    panel.sync({ language: 'en', settingsLanguage, notifyUpdates }, dictionaries[settingsLanguage]);
  };
  const panel = createVersionPanel(root, async mode => { calls.push(mode); return reply; }, patch => {
    saved.push(patch);
    setLanguage(language, patch.notifyUpdates);
  }, version => {
    installs.push(version);
    return new Promise(resolve => { resolveInstall = resolve; });
  }, () => now, 'win32 10.0.26100');
  setLanguage('en', true);
  assert.equal(nodes.notify.textContent, 'Update alerts');
  assert.equal(nodes.notify.dataset.active, 'true');
  assert.equal(nodes.notify.attributes['aria-pressed'], 'true');
  await panel.checkAutomatically();
  assert.equal(nodes.available.textContent, 'Update available:\u00a01.0.0 → 2.0.0');
  assert.equal(nodes.release.href, update.releaseUrl);
  assert.deepEqual(installs, [], 'a background version check does not start an install');
  nodes.dismiss.click();
  assert.equal(nodes.notice.hidden, true);
  assert.equal(nodes.check.focused, true);
  await panel.checkAutomatically();
  assert.deepEqual(calls, ['auto']);
  now += 5 * 60_000;
  await panel.checkAutomatically();
  assert.equal(nodes.notice.hidden, true, 'the same automatic release stays dismissed');
  reply = { ...update, latestVersion: '2.0.1' };
  now += 5 * 60_000;
  await panel.checkAutomatically();
  assert.equal(nodes.notice.hidden, false, 'a newer release can prompt again');
  setLanguage('zh-CN', true);
  nodes.notify.click();
  assert.deepEqual(saved, [{ notifyUpdates: false }]);
  assert.equal(nodes.notify.dataset.active, 'false');
  assert.equal(nodes.notify.attributes['aria-pressed'], 'false');
  assert.equal(nodes.notify.textContent, '更新提醒');
  assert.match(nodes.notify.title, /关闭后不再后台检查/);
  assert.equal(nodes.check.textContent, '检查更新');
  assert.equal(nodes.notice.hidden, true);
  await panel.checkAutomatically();
  assert.deepEqual(calls, ['auto', 'auto', 'auto']);
  reply = update;
  const manual = nodes.check.click();
  assert.equal(nodes.check.disabled, true);
  assert.equal(nodes.check.textContent, '检查中…');
  await manual;
  assert.equal(nodes.check.textContent, '检查更新');
  assert.equal(nodes.notice.hidden, false);
  assert.equal(nodes.available.textContent, '发现新版本:\u00a01.0.0 → 2.0.0');
  assert.equal(nodes.update.textContent, '更新');
  setLanguage('zh-TW', false);
  assert.equal(root.lang, 'zh-TW');
  assert.equal(nodes.check.textContent, '檢查更新');
  assert.equal(nodes.notice.hidden, false, 'an explicit result is not an automatic prompt');
  for (const [locale, loading, checkLabel, latest] of [
    ['en', 'Checking…', 'Check updates', 'Up to date'], ['zh-CN', '检查中…', '检查更新', '已是最新版本'], ['zh-TW', '檢查中…', '檢查更新', '已是最新版本'],
  ]) {
    setLanguage(locale, false);
    reply = { status: 'current' };
    const pending = nodes.check.click();
    assert.equal(nodes.check.textContent, loading);
    assert.equal(nodes.notice.dataset.state, 'checking');
    assert.equal(nodes.notice.hidden, false);
    await pending;
    assert.equal(nodes.check.textContent, checkLabel);
    assert.equal(nodes.available.textContent, latest);
    assert.equal(nodes.notice.dataset.state, 'current');
    assert.equal(nodes.update.hidden, true);
    assert.equal(nodes.check.disabled, false);
  }
  for (const reason of ['timeout', 'network', 'sidecar', 'http', 'noRelease', 'invalidRelease', 'localVersion']) {
    reply = { status: 'error', reason, httpStatus: 503 };
    await nodes.check.click();
    assert.equal(nodes.notice.hidden, false);
    assert.equal(nodes.notice.dataset.state, 'check-error');
    assert.equal(nodes.available.textContent, '檢查失敗');
    assert.ok(nodes.status.textContent);
    if (reason === 'timeout') assert.equal(nodes.status.textContent, 'GitHub 回應逾時。');
    assert.equal(nodes.release.hidden, true);
    assert.equal(nodes['copy-diagnostics'].hidden, true);
  }
  reply = { status: 'error', reason: 'rateLimit', retryAt: new Date(2026, 0, 2, 9, 24, 30).getTime() };
  await nodes.check.click();
  assert.match(nodes.status.textContent, /09:24:30 後可重試/);
  assert.equal(nodes.release.hidden, false);
  assert.equal(nodes.release.textContent, '手動更新');
  assert.equal(nodes.release.href, nodes.release.dataset.releasesUrl);
  assert.equal(nodes.update.textContent, '重試');
  reply = { status: 'current' };
  await nodes.update.click();
  assert.equal(nodes.notice.dataset.state, 'current', 'retrying a check does not start an install');
  assert.deepEqual(installs, []);
  nodes.dismiss.click();
  assert.equal(nodes.notice.hidden, true);
  setLanguage('zh-TW', true);
  now += 5 * 60_000;
  reply = { status: 'error', reason: 'rateLimit' };
  await panel.checkAutomatically();
  assert.equal(nodes.notice.hidden, true, 'background failures stay quiet');
  const locked = { status: 'error', reason: 'locked', diagnostics: { step: 'replace', code: 'EBUSY', path: 'plugin.json', restored: true } };
  for (const [locale, label, progress, error, failure, retry, manual] of [
    ['en', 'Update', 'Updating…', { status: 'error', reason: 'size' }, /exceeds the size limit/, 'Retry', 'Manual update'],
    ['zh-CN', '更新', '更新中…', { status: 'error', reason: 'install' }, /^无法完成本地更新。$/, '重试', '手动更新'],
    ['zh-TW', '更新', '更新中…', locked, /使用中.*已還原/, '重試', '手動更新'],
  ]) {
    setLanguage(locale, false);
    reply = update;
    await nodes.check.click();
    assert.equal(nodes.update.textContent, label);
    const pending = nodes.update.click();
    assert.equal(nodes.update.textContent, progress);
    assert.equal(nodes.update.disabled, true);
    assert.equal(nodes.dismiss.disabled, true);
    assert.equal(nodes['copy-diagnostics'].hidden, true);
    const count = installs.length;
    await nodes.update.click();
    assert.equal(installs.length, count, 'duplicate clicks do not launch another install');
    resolveInstall(error);
    await pending;
    assert.match(nodes.status.textContent, failure);
    assert.equal(nodes.notice.dataset.state, 'error');
    assert.equal(nodes.update.disabled, false);
    assert.equal(nodes.update.textContent, retry);
    assert.equal(nodes.release.textContent, manual);
    assert.equal(nodes.release.href, update.releaseUrl);
  }
  assert.equal(nodes['copy-diagnostics'].hidden, false);
  assert.equal(nodes['copy-diagnostics'].textContent, '複製診斷資訊');
  await nodes['copy-diagnostics'].click();
  assert.equal(nodes['copy-status'].textContent, '已複製診斷資訊。');
  assert.equal(nodes.diagnostics.hidden, true);
  assert.equal(copied.length, 1);
  assert.deepEqual(JSON.parse(copied[0].slice(copied[0].indexOf('\n') + 1)), {
    system: 'win32 10.0.26100', currentVersion: '1.0.0', targetVersion: '2.0.0', reason: 'locked', ...locked.diagnostics,
  });
  delete root.ownerDocument.defaultView.navigator.clipboard;
  await nodes['copy-diagnostics'].click();
  assert.equal(nodes.diagnostics.hidden, false);
  assert.equal(nodes.diagnostics.focused, true);
  assert.equal(nodes.diagnostics.selected, copied[0]);
  const retry = nodes.update.click();
  assert.equal(nodes['copy-diagnostics'].hidden, true);
  assert.equal(nodes.diagnostics.hidden, true);
  assert.equal(nodes['copy-status'].textContent, '');
  resolveInstall({ status: 'updated', version: '2.0.0' });
  await retry;
  assert.deepEqual(installs, ['2.0.0', '2.0.0', '2.0.0', '2.0.0']);
  for (const [locale, success] of [
    ['en', 'Update complete. Reloading…'], ['zh-CN', '更新完成，正在重新加载…'], ['zh-TW', '更新完成，正在重新載入…'],
  ]) {
    setLanguage(locale, false);
    assert.equal(nodes.available.textContent, success);
    assert.equal(nodes.notice.dataset.state, 'updated');
    assert.equal(nodes.update.disabled, true);
  }
  const keys = Object.keys(dictionaries.en).filter(k => k.startsWith('version') || k.startsWith('notifyUpdates'));
  for (const lang of ['en', 'zh-CN', 'zh-TW']) for (const key of keys) {
    assert.ok(dictionaries[lang][key], lang + ' ' + key);
  }
});

const sendVersionRequest = (port, method, headers = {}, path = VERSION_ROUTE, body = { mode: 'manual' }) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, method, path,
    headers: { 'Content-Type': 'application/json', ...headers } }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ code: res.statusCode, headers: res.headers, body }));
  });
  req.on('error', reject);
  req.end(method === 'POST' ? JSON.stringify(body) : undefined);
});

const sdkPath = join(homedir(), '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'index.mjs');
test('installed SDK serves version checks over loopback only and requires an authenticated POST', {
  skip: !existsSync(sdkPath) && 'Antigravity SDK is not installed',
}, async t => {
  const values = { ANTIGRAVITY_SIDECAR_UI_TOKEN: 'fixture', ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:1',
    ANTIGRAVITY_CSRF_TOKEN: 'fixture', ANTIGRAVITY_SIDECAR_WEB_PORT: '0' };
  const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  let app, server, externalRequests = 0;
  t.after(async () => {
    try { await app?.close(); } finally {
      for (const [key, value] of Object.entries(old)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  t.mock.method(globalThis, 'fetch', async () => { externalRequests++; return release('v999.0.0'); });
  const sdk = await import(pathToFileURL(sdkPath));
  class SidecarApp extends sdk.SidecarApp {
    async run() { return server = await super.run(); }
  }
  app = await startPanel(() => ({ SidecarApp }));
  const { address, port } = server.address();
  assert.equal(address, '127.0.0.1');
  const token = { 'X-Sidecar-Token': 'fixture' };
  const send = (method, headers) => sendVersionRequest(port, method, headers);
  const host = `agy-capsule--agy_capsule-${port}`;
  const headerCases = [{}, { Host: host, Origin: `plugin://${host}` }, { Host: host, Origin: 'null' }];
  for (const headers of headerCases) {
    assert.equal((await send('POST', headers)).code, 401);
    assert.equal((await send('POST', { ...headers, 'X-Sidecar-Token': 'wrong' })).code, 401);
  }
  assert.equal((await send('GET', token)).code, 405);
  const install = (method, headers) => sendVersionRequest(port, method, headers, UPDATE_ROUTE, { version: '999.0.0' });
  assert.equal((await install('POST')).code, 401);
  assert.equal((await install('POST', { 'X-Sidecar-Token': 'wrong' })).code, 401);
  assert.equal((await install('GET', token)).code, 405);
  const checkout = await install('POST', token);
  assert.equal(checkout.code, 200);
  assert.deepEqual(JSON.parse(checkout.body), { status: 'error', reason: 'notInstalled', diagnostics: { step: 'inspect' } });
  assert.equal((await send('OPTIONS', { Origin: 'https://example.test' })).headers['access-control-allow-origin'], undefined);
  assert.equal(externalRequests, 0, 'unauthenticated POST and GET never trigger an upstream request');
  for (const headers of headerCases) {
    const response = await send('POST', { ...headers, ...token });
    assert.equal(response.code, 200, JSON.stringify(headers));
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(JSON.parse(response.body).latestVersion, '999.0.0');
  }
  const requestFresh = await sendVersionRequest(port, 'POST', token, VERSION_ROUTE, { mode: 'manual', fresh: true });
  assert.equal(requestFresh.code, 200);
  assert.equal(externalRequests, 1, 'sequential manual requests share the short cache; only the installer can bypass it');
});
