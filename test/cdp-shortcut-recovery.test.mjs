import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCdpNoticeManager } from '../agy-capsule/sidecars/agy_capsule/cdp_notice.mjs';

function tempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "agy cdp's "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('a successful CDP connection does not overwrite a missing shortcut scan', async t => {
  let scanResult = 'missing';
  const manager = createCdpNoticeManager({
    platform: 'win32', statePath: join(tempRoot(t), 'state.json'),
    execFileImpl: (_file, _args, _opts, cb) => cb(null, scanResult),
  });
  await manager.checkShortcuts();
  manager.observe('ok');
  manager.observe('unreachable');
  assert.deepEqual(manager.info(), {
    state: 'unreachable', hadBefore: true, shortcutState: 'missing', canFixShortcut: true,
  });
  scanResult = 'ok';
  assert.equal(await manager.checkShortcuts(), 'ok');
  assert.deepEqual(manager.info(), {
    state: 'unreachable', hadBefore: true, shortcutState: 'ok', canFixShortcut: false,
  });
});

const windowsOnly = { skip: process.platform !== 'win32' };

function fixturePowerShell(body, env = {}) {
  const command = "$ProgressPreference = 'SilentlyContinue'\n$ErrorActionPreference = 'Stop'\n" + body;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', env: { ...process.env, ...env } }).replace(/\r?\n$/, '');
}

function windowsFixture(t) {
  const root = tempRoot(t);
  const desktop = join(root, 'Desktop');
  const menu = join(root, 'Start Menu');
  const programs = join(menu, 'Programs');
  mkdirSync(desktop);
  mkdirSync(programs, { recursive: true });
  const exe = join(root, 'Antigravity.exe');
  writeFileSync(exe, '');
  const scriptErrors = [];
  t.after(() => assert.deepEqual(scriptErrors, []));
  const manager = createCdpNoticeManager({
    statePath: join(root, 'state.json'), shortcutDirectories: [desktop, menu],
    getPrefs: () => ({ notifyCdpRestart: false }),
    execFileImpl(file, args, opts, cb) {
      // Fail before spawning if either script ever falls back to real shell folders.
      assert.equal(file, 'powershell.exe');
      assert.doesNotMatch(args.at(-1), /GetFolderPath|\$env:APPDATA/i);
      assert.deepEqual(JSON.parse(opts.env.AGY_CDP_TEST_ROOTS), [desktop, menu]);
      return execFile(file, args, opts, (err, stdout, stderr) => {
        if (err || stderr.trim()) scriptErrors.push(stderr || err.message);
        cb(err, stdout, stderr);
      });
    },
  });
  function link(dir, name, args, target = exe) {
    const file = join(dir, name + '.lnk');
    fixturePowerShell(`$l = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK_FILE)
$l.TargetPath = $env:LINK_TARGET
$l.Arguments = [string]$env:LINK_ARGS
$l.Save()`, { LINK_FILE: file, LINK_TARGET: target, LINK_ARGS: args });
    return file;
  }
  return { root, desktop, programs, manager, link };
}

function readArgs(file) {
  return fixturePowerShell('(New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK_FILE).Arguments', { LINK_FILE: file });
}

test('sidebar scans and repairs only matching links, preserves arguments, and handles an empty match set', windowsOnly, async t => {
  const { root, desktop, programs, manager, link } = windowsFixture(t);
  const flag = '--remote-debugging-port=0';
  const original = '--profile "Work Space"  --disable-gpu';
  const plain = link(desktop, 'Plain', '');
  const quoted = link(programs, 'Quoted args', original);
  const configured = link(programs, 'Configured', flag + ' --disable-gpu');
  const otherExe = join(root, 'Uninstall Antigravity.exe');
  writeFileSync(otherExe, '');
  const unrelated = link(desktop, 'Antigravity', '--keep', otherExe);

  assert.equal(await manager.checkShortcuts(), 'missing');
  assert.deepEqual(await manager.fixShortcuts(), { ok: true, reason: 'ok', updated: 2, failed: 0, total: 3, shortcutState: 'ok' });
  assert.equal(readArgs(plain), flag);
  assert.equal(readArgs(quoted), original + ' ' + flag);
  assert.equal(readArgs(configured), flag + ' --disable-gpu');
  assert.equal(readArgs(unrelated), '--keep');
  assert.equal(await manager.checkShortcuts(), 'ok');
  manager.observe('unreachable');
  assert.deepEqual(manager.info(), { state: 'unreachable', hadBefore: true, shortcutState: 'ok', canFixShortcut: false });
  assert.deepEqual(await manager.fixShortcuts(), { ok: true, reason: 'ok', updated: 0, failed: 0, total: 3, shortcutState: 'ok' });
  assert.equal(readArgs(quoted), original + ' ' + flag);

  for (const file of [plain, quoted, configured]) rmSync(file);
  assert.equal(await manager.checkShortcuts(), 'unknown');
  assert.deepEqual(await manager.fixShortcuts(), { ok: false, reason: 'not_found', updated: 0, failed: 0, total: 0, shortcutState: 'unknown' });
  assert.equal(manager.info().canFixShortcut, false);
  assert.equal(readArgs(unrelated), '--keep');
});

test('sidebar reports partial repair on access denied and can retry after write access returns', windowsOnly, async t => {
  const { desktop, programs, manager, link } = windowsFixture(t);
  const blocked = link(programs, 'Protected', '--keep');
  const writable = link(desktop, 'Writable', '');
  const sid = '*' + fixturePowerShell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
  // Deny writes and replacement of links only inside the disposable Programs directory.
  execFileSync('icacls.exe', [programs, '/deny', sid + ':(OI)(CI)(WD,AD,WEA,WA,DE,DC)']);
  try {
    assert.throws(() => closeSync(openSync(blocked, 'r+')), { code: /^(EACCES|EPERM)$/ });
    assert.deepEqual(await manager.fixShortcuts(), { ok: false, reason: 'permission', updated: 1, failed: 1, total: 2, shortcutState: 'missing' });
    assert.equal(await manager.checkShortcuts(), 'missing');
    assert.equal(manager.info().canFixShortcut, true);
    assert.equal(readArgs(blocked), '--keep');
    assert.equal(readArgs(writable), '--remote-debugging-port=0');
  } finally {
    execFileSync('icacls.exe', [programs, '/remove:d', sid]);
  }
  assert.deepEqual(await manager.fixShortcuts(), { ok: true, reason: 'ok', updated: 1, failed: 0, total: 2, shortcutState: 'ok' });
  assert.equal(readArgs(blocked), '--keep --remote-debugging-port=0');
  assert.equal(readArgs(writable), '--remote-debugging-port=0');
  assert.equal(await manager.checkShortcuts(), 'ok');
});

test('sidebar does not report success when Windows cannot store the appended switch', windowsOnly, async t => {
  const { desktop, manager, link } = windowsFixture(t);
  const original = '--profile=' + 'x'.repeat(1013);
  const file = link(desktop, 'Long arguments', original);
  assert.equal(readArgs(file), original);
  assert.equal(await manager.checkShortcuts(), 'missing');
  assert.deepEqual(await manager.fixShortcuts(), { ok: false, reason: 'error', updated: 0, failed: 1, total: 1, shortcutState: 'missing' });
  assert.equal(readArgs(file), original);
  assert.equal(manager.info().canFixShortcut, true);
});

test('sidebar reports an incomplete directory scan as an error and keeps repair available', windowsOnly, async t => {
  const { programs, manager, link } = windowsFixture(t);
  const file = link(programs, 'Hidden by directory permissions', '');
  assert.equal(await manager.checkShortcuts(), 'missing');
  const sid = '*' + fixturePowerShell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
  execFileSync('icacls.exe', [programs, '/deny', sid + ':(RD)']);
  try {
    assert.equal(fixturePowerShell(`
try { Get-ChildItem -LiteralPath $env:LINK_DIR | Out-Null; 'readable' }
catch { if ($_.CategoryInfo.Category -ne 'PermissionDenied') { throw }; 'denied' }`, { LINK_DIR: programs }), 'denied');
    assert.equal(await manager.checkShortcuts(), 'missing');
    assert.deepEqual(await manager.fixShortcuts(), { ok: false, reason: 'error', updated: 0, failed: 0, total: 0, shortcutState: 'missing' });
    assert.equal(manager.info().canFixShortcut, true);
  } finally {
    execFileSync('icacls.exe', [programs, '/remove:d', sid]);
  }
  assert.equal((await manager.fixShortcuts()).ok, true);
  assert.equal(readArgs(file), '--remote-debugging-port=0');
});

test('sidebar reports repaired shortcuts separately from directories it could not check', windowsOnly, async t => {
  const { desktop, programs, manager, link } = windowsFixture(t);
  const writable = link(desktop, 'Writable', '--keep');
  const sid = '*' + fixturePowerShell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
  execFileSync('icacls.exe', [programs, '/deny', sid + ':(RD)']);
  try {
    assert.equal(await manager.checkShortcuts(), 'missing');
    assert.deepEqual(await manager.fixShortcuts(), { ok: false, reason: 'partial', updated: 1, failed: 0, total: 1, shortcutState: 'unknown' });
    assert.equal(readArgs(writable), '--keep --remote-debugging-port=0');
    assert.equal(manager.info().canFixShortcut, false);
    assert.deepEqual(await manager.fixShortcuts(), { ok: false, reason: 'partial', updated: 0, failed: 0, total: 1, shortcutState: 'unknown' });

    const original = '--profile=' + 'x'.repeat(1013);
    const unwritable = link(desktop, 'Long arguments', original);
    assert.equal(await manager.checkShortcuts(), 'missing');
    assert.deepEqual(await manager.fixShortcuts(), { ok: false, reason: 'error', updated: 0, failed: 1, total: 2, shortcutState: 'missing' });
    assert.equal(readArgs(unwritable), original);
  } finally {
    execFileSync('icacls.exe', [programs, '/remove:d', sid]);
  }
});

test('stale scan does not overwrite fix result, and transient scan or fix errors are handled safely', async t => {
  const pendingScans = [];
  let fixMode = 'ok';
  const manager = createCdpNoticeManager({
    platform: 'win32', statePath: join(tempRoot(t), 'state.json'),
    execFileImpl: (_file, args, _opts, cb) => {
      const cmd = args.join(' ');
      if (cmd.includes('$l.Save()')) {
        if (fixMode === 'ok') return cb(null, 'ok,1,0,1');
        if (fixMode === 'error') return cb(new Error('timeout'), '');
        return cb(null, 'unexpected-output');
      }
      pendingScans.push(cb);
    },
  });

  const slowScan = manager.checkShortcuts();
  assert.equal(pendingScans.length, 1);
  assert.deepEqual(await manager.fixShortcuts(), { ok: true, reason: 'ok', updated: 1, failed: 0, total: 1, shortcutState: 'ok' });
  pendingScans.shift()(null, 'missing');
  assert.equal(await slowScan, 'ok');
  assert.equal(manager.info().shortcutState, 'ok');
  assert.equal(manager.info().canFixShortcut, false);

  fixMode = 'error';
  assert.deepEqual(await manager.fixShortcuts(), { ok: false, reason: 'error', updated: 0, failed: 0, total: 0, shortcutState: 'ok' });
  fixMode = 'garbled';
  assert.deepEqual(await manager.fixShortcuts(), { ok: false, reason: 'error', updated: 0, failed: 0, total: 0, shortcutState: 'ok' });

  let attempts = 0;
  let clock = 1_000;
  const retryManager = createCdpNoticeManager({
    platform: 'win32', statePath: join(tempRoot(t), 'retry-state.json'),
    now: () => clock,
    getPrefs: () => ({ notifyCdpRestart: false }),
    execFileImpl: (_file, args, _opts, cb) => {
      attempts++;
      if (args.at(-1).includes('$l.Save()')) return cb(null, 'incomplete,0,0,0');
      if (attempts === 1) return cb(new Error('spawn failed'), '');
      if (attempts === 2) return cb(null, 'incomplete');
      return cb(null, 'missing');
    },
  });
  assert.equal(await retryManager.checkShortcuts(), 'unknown');
  // Cooldown suppresses repeated 1-second observe() polls after a failed or incomplete scan.
  retryManager.observe('missing');
  clock += 59_999;
  retryManager.observe('missing');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1);

  clock += 1;
  retryManager.observe('missing');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(retryManager.info().shortcutState, 'unknown');

  retryManager.observe('missing');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2);

  clock += 60_000;
  retryManager.observe('missing');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 3);
  assert.equal(retryManager.info().shortcutState, 'missing');
  assert.equal(retryManager.info().canFixShortcut, true);

  // Incomplete repair also cools down automatic re-scans while keeping manual repair available.
  assert.deepEqual(await retryManager.fixShortcuts(), { ok: false, reason: 'error', updated: 0, failed: 0, total: 0, shortcutState: 'missing' });
  assert.equal(attempts, 4);
  retryManager.observe('missing');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 4);
});

test('a scan requested during repair cannot overwrite the repair result', async t => {
  let finishRepair;
  let finishScan;
  const manager = createCdpNoticeManager({
    platform: 'win32', statePath: join(tempRoot(t), 'state.json'),
    execFileImpl: (_file, argv, _opts, cb) => {
      if (argv.at(-1).includes('$l.Save()')) finishRepair = cb;
      else finishScan = cb;
    },
  });

  const fixing = manager.fixShortcuts();
  const checking = manager.checkShortcuts();
  finishRepair(null, 'ok,1,0,1');
  assert.equal((await fixing).ok, true);
  finishScan?.(null, 'missing');
  assert.equal(await checking, 'ok');
  assert.equal(manager.info().canFixShortcut, false);
});

test('corrupted or unreadable shortcut files do not double-count earlier Antigravity links', windowsOnly, async t => {
  const { desktop, manager, link } = windowsFixture(t);
  const valid = link(desktop, '01-Antigravity', '');
  const corrupt = join(desktop, '02-Corrupt.lnk');
  writeFileSync(corrupt, 'not-a-valid-lnk-payload');
  const unreadable = link(desktop, '03-Unreadable', '');
  const sid = '*' + fixturePowerShell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
  execFileSync('icacls.exe', [unreadable, '/deny', sid + ':(R)']);
  try {
    assert.equal(await manager.checkShortcuts(), 'missing');
    assert.deepEqual(await manager.fixShortcuts(), { ok: true, reason: 'ok', updated: 1, failed: 0, total: 1, shortcutState: 'ok' });
    assert.equal(readArgs(valid), '--remote-debugging-port=0');
  } finally {
    execFileSync('icacls.exe', [unreadable, '/remove:d', sid]);
  }
});
