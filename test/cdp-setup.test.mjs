import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createContext, runInContext } from 'node:vm';
import { startDeckInjector } from '../agy-capsule/sidecars/agy_capsule/deck_injector.mjs';
import { createCdpNoticeManager } from '../agy-capsule/sidecars/agy_capsule/cdp_notice.mjs';
import { UI_HTML } from '../agy-capsule/sidecars/agy_capsule/server.mjs';
import { hostFixture } from './cdp-host-fixture.mjs';
import { createPresentation } from '../agy-capsule/sidecars/agy_capsule/ui.mjs';

test('injector reports whether the debugging port is missing, unreachable or ok', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-cdp-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const portFile = join(dir, 'DevToolsActivePort');
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalLog = console.log;
  console.error = console.log = () => {};
  t.after(() => { globalThis.fetch = originalFetch; console.error = originalError; console.log = originalLog; });

  const fixture = hostFixture(dir);
  const injector = startDeckInjector(async () => ({}), { portFile, ...fixture });
  t.after(() => injector.stop());
  assert.equal(injector.status(), 'unknown');
  await injector.tick();
  assert.equal(injector.status(), 'missing');

  writeFileSync(portFile, '9\n/devtools/browser/x\n');
  globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED'); };
  await injector.tick();
  assert.equal(injector.status(), 'unreachable');

  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  await injector.tick();
  assert.equal(injector.status(), 'ok');
  const unverified = startDeckInjector(async () => assert.fail('unverified origin'), { portFile, productRoots: [], env: fixture.env });
  t.after(() => unverified.stop());
  await unverified.tick();
  assert.equal(unverified.status(), 'unverified', 'a completed, unverified lookup is distinct from startup');
});

test('sidebar ships the CDP notice on both tabs with the script command and translated strings', () => {
  assert.match(UI_HTML, /id="cdp-notice"[^>]*hidden/);
  assert.ok(UI_HTML.includes('-File scripts\\enable-cdp.ps1'), 'backslash must survive the template literal');
  assert.ok(UI_HTML.includes('--remote-debugging-port=0'));
  assert.match(UI_HTML, /\['missing', 'unreachable'\]\.includes\(lastData\?\.deckCdp\)/);
  const notice = UI_HTML.indexOf('id="cdp-notice"');
  assert.ok(notice > 0 && notice < UI_HTML.indexOf('id="sidebar-stats"'), 'notice sits above both tabs, so settings shows it too');
  const { dictionaries } = createPresentation();
  for (const language of ['en', 'zh-CN', 'zh-TW']) {
    for (const key of ['cdpTitle', 'cdpBody', 'cdpHow', 'cdpScript', 'cdpManual', 'cdpRestart', 'cdpRestartTitle', 'cdpRestartBodyShortcutOk', 'cdpRestartBodyShortcutMissing', 'cdpRestartBodyGeneric', 'cdpRestartHow', 'cdpFixShortcutBtn', 'cdpFixShortcutDone', 'cdpFixShortcutAdmin', 'cdpFixShortcutNotFound', 'cdpFixShortcutError', 'cdpNotifyTitle', 'cdpNotifyBodyOk', 'cdpNotifyBodyMissing', 'notifyCdpRestart']) {
      assert.ok(dictionaries[language][key], `${language}.${key}`);
    }
    for (const key of ['healthCode', 'healthS2', 'healthS3', 'healthS4', 'healthS5', 'healthF2', 'healthF3', 'healthF4']) assert.ok(dictionaries[language][key], key);
  }
  assert.ok(UI_HTML.includes('id="cdp-fix-btn"'));
  assert.ok(UI_HTML.includes('/api/fix-cdp-shortcut'));
  assert.ok(UI_HTML.includes('cdpFixShortcutNotFound'));
  assert.ok(UI_HTML.includes('cdpFixShortcutError'));
  assert.ok(UI_HTML.includes('data-setting-card="notifyCdpRestart"'));
});

test('sidebar shows distinct repair outcomes and reserves the admin hint for permission errors', async () => {
  const { dictionaries } = createPresentation();
  for (const language of ['en', 'zh-CN', 'zh-TW']) {
    assert.ok(dictionaries[language].cdpFixShortcutPartial, language);
  }
  const dict = dictionaries['zh-CN'];
  const start = UI_HTML.indexOf('    let fixingShortcut = false;');
  const end = UI_HTML.indexOf('    function renderHealthNotice()', start);
  assert.ok(start >= 0 && end > start);
  const context = createContext({
    document: { getElementById: () => ({ addEventListener: (event, fn) => { context.click = fn; } }) },
    postApi: async () => ({ json: async () => context.result }),
    lastData: { deckCdpInfo: { shortcutState: 'missing', canFixShortcut: true } },
    renderHealthNotice() {},
  });
  runInContext(UI_HTML.slice(start, end), context);
  context.result = { ok: false, reason: 'partial', shortcutState: 'unknown' };
  await context.click();
  assert.equal(dict[runInContext('shortcutFixMessageKey', context)], dict.cdpFixShortcutPartial);
  assert.equal(context.lastData.deckCdpInfo.canFixShortcut, false);
  context.result = { ok: false, reason: 'error', shortcutState: 'missing' };
  await context.click();
  assert.equal(dict[runInContext('shortcutFixMessageKey', context)], dict.cdpFixShortcutError);

  for (const [result, expected] of [
    [{ ok: false, reason: 'permission' }, dict.cdpFixShortcutAdmin],
    [{ ok: false, reason: 'unsupported' }, dict.cdpFixShortcutError],
    [{ error: 'Unexpected response' }, dict.cdpFixShortcutError],
  ]) {
    context.result = result;
    await context.click();
    assert.equal(dict[runInContext('shortcutFixMessageKey', context)], expected);
  }
});

test('cdp_notice distinguishes first-time vs post-update restart, notifies once per session, and supports shortcut repair', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-cdp-notice-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const statePath = join(dir, 'cdp_state.json');

  const calls = [];
  let scanResult = 'ok';
  let fixResult = 'ok,1,0,1';
  const execFileImpl = (file, args, opts, cb) => {
    const cmd = args.join(' ');
    calls.push({ file, cmd, env: opts?.env });
    if (cmd.includes('ShowBalloonTip')) return cb(null, '');
    if (cmd.includes('$l.Save()')) return cb(null, fixResult);
    return cb(null, scanResult);
  };

  // First-time user (never succeeded): no OS notification even after repeated missing ticks
  const fresh = createCdpNoticeManager({
    statePath, platform: 'win32', sessionId: 'sess-1', failThreshold: 2,
    getPrefs: () => ({ notifyCdpRestart: true }),
    getNotifyText: () => ({ title: 'T', body: 'B' }),
    execFileImpl,
  });
  fresh.observe('missing');
  fresh.observe('missing');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(fresh.info().hadBefore, false);
  assert.equal(calls.filter(c => c.cmd.includes('ShowBalloonTip')).length, 0);

  // Record successful CDP attach -> persists everOk
  fresh.observe('ok');
  assert.equal(fresh.info().hadBefore, true);

  // Next launch after client update (new sessionId, shortcut wiped -> missing): notifies ONCE
  scanResult = 'missing';
  const postUpdate = createCdpNoticeManager({
    statePath, platform: 'win32', sessionId: 'sess-2', failThreshold: 2,
    getPrefs: () => ({ notifyCdpRestart: true }),
    getNotifyText: (st) => ({ title: 'No update needed', body: 'state=' + st }),
    execFileImpl,
  });
  postUpdate.observe('missing');
  postUpdate.observe('missing');
  await new Promise(r => setTimeout(r, 30));
  const toasts = calls.filter(c => c.cmd.includes('ShowBalloonTip'));
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].env.AGY_NOTIFY_TITLE, 'No update needed');
  assert.equal(toasts[0].env.AGY_NOTIFY_BODY, 'state=missing');
  assert.equal(postUpdate.info().hadBefore, true);
  assert.equal(postUpdate.info().shortcutState, 'missing');
  assert.equal(postUpdate.info().canFixShortcut, true);

  // Sidecar reload within the SAME Antigravity session (sess-2) must NOT notify again
  const sameSession = createCdpNoticeManager({
    statePath, platform: 'win32', sessionId: 'sess-2', failThreshold: 1,
    getPrefs: () => ({ notifyCdpRestart: true }),
    getNotifyText: () => ({ title: 'Dup', body: 'Dup' }),
    execFileImpl,
  });
  sameSession.observe('missing');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls.filter(c => c.cmd.includes('ShowBalloonTip')).length, 1);

  // Disabling notifyCdpRestart suppresses OS notifications in a new session
  const muted = createCdpNoticeManager({
    statePath, platform: 'win32', sessionId: 'sess-3', failThreshold: 1,
    getPrefs: () => ({ notifyCdpRestart: false }),
    getNotifyText: () => ({ title: 'Muted', body: 'Muted' }),
    execFileImpl,
  });
  muted.observe('unreachable');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls.filter(c => c.cmd.includes('ShowBalloonTip')).length, 1);
  assert.equal(muted.info().hadBefore, true);

  // One-click shortcut repair flips shortcutState to 'ok'
  const repaired = await postUpdate.fixShortcuts();
  assert.equal(repaired.ok, true);
  assert.equal(repaired.updated, 1);
  assert.equal(postUpdate.info().shortcutState, 'ok');
  assert.equal(postUpdate.info().canFixShortcut, false);
});

test('losing CDP during shutdown does not notify after it worked in the same host session', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-cdp-shutdown-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const toasts = [];
  const options = {
    statePath: join(dir, 'cdp_state.json'), platform: 'linux', sessionId: 'working-session',
    getNotifyText: () => ({ title: 'T', body: 'B' }),
    execFileImpl: (file, args, opts, cb) => { toasts.push(file); cb(null, ''); },
  };
  const manager = createCdpNoticeManager(options);
  manager.observe('ok');
  for (let i = 0; i < 3; i++) manager.observe('unreachable');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(toasts, [], 'port stops answering before the sidecar exits');

  const reloaded = createCdpNoticeManager(options);
  for (let i = 0; i < 3; i++) reloaded.observe('missing');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(toasts, [], 'a sidecar reload must not forget that CDP worked in this host session');
});

test('enable-cdp.ps1 adds and removes the switch only on Antigravity shortcuts', { skip: process.platform !== 'win32' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'agy enable cdp '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appDir = join(root, 'antigravity');
  const startMenu = join(root, 'Start Menu', 'Programs');
  const taskbar = join(root, 'TaskBar');
  mkdirSync(appDir, { recursive: true });
  mkdirSync(startMenu, { recursive: true });
  mkdirSync(taskbar, { recursive: true });
  const exe = join(appDir, 'Antigravity.exe');
  writeFileSync(exe, '');
  writeFileSync(join(appDir, 'Uninstall Antigravity.exe'), '');
  const ps = command => spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
  const q = value => `'${value.replace(/'/g, "''")}'`;
  const make = (file, target, args) => {
    const r = ps(`$l=(New-Object -ComObject WScript.Shell).CreateShortcut(${q(file)});$l.TargetPath=${q(target)};$l.Arguments=${q(args)};$l.Save()`);
    assert.equal(r.status, 0, r.stderr);
  };
  const args = file => ps(`(New-Object -ComObject WScript.Shell).CreateShortcut(${q(file)}).Arguments`).stdout.trim();
  const plain = join(startMenu, 'Antigravity.lnk');
  const withArgs = join(taskbar, 'Antigravity.lnk');
  const other = join(startMenu, 'Uninstall.lnk');
  make(plain, exe, '');
  make(withArgs, exe, '--disable-gpu');
  make(other, join(appDir, 'Uninstall Antigravity.exe'), '');

  const script = fileURLToPath(new URL('../scripts/enable-cdp.ps1', import.meta.url));
  const run = (...extra) => {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `& ${q(script)} -ShortcutDirectories ${q(startMenu)},${q(taskbar)} ${extra.join(' ')}; exit $LASTEXITCODE`], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return r.stdout;
  };
  // install.bat path: without an interactive yes nothing changes, and the install still succeeds.
  assert.match(run('-Ask'), /Not interactive, skipped/);
  assert.equal(args(plain), '');
  run();
  assert.equal(args(plain), '--remote-debugging-port=0');
  assert.equal(run('-Ask').trim(), '', 'no prompt once every shortcut has the switch');
  assert.equal(args(withArgs), '--disable-gpu --remote-debugging-port=0');
  assert.equal(args(other), '');
  assert.match(run(), /Already set/);
  assert.equal(args(plain), '--remote-debugging-port=0', 'running twice must not duplicate the switch');
  run('-Undo');
  assert.equal(args(plain), '');
  assert.equal(args(withArgs), '--disable-gpu');
});
