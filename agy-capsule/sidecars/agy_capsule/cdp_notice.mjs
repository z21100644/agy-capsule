import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_STATE_PATH = join(homedir(), '.gemini', 'config', 'agy-capsule', 'cdp_state.json');

const DEFAULT_SHORTCUT_DIRS_PS = `@(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  [Environment]::GetFolderPath('StartMenu'),
  [Environment]::GetFolderPath('CommonStartMenu'),
  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar')
)`;

const SHORTCUT_SCAN_PS = `
$pattern = '(^|\\s)--remote-debugging-port(=\\S*)?(?=\\s|$)'
$shell = New-Object -ComObject WScript.Shell
$total = 0; $missing = 0
foreach ($f in $files) {
  $l = $null
  try { $l = $shell.CreateShortcut($f.FullName) } catch { continue }
  if (-not $l) { continue }
  if ($l.TargetPath -and (Split-Path -Leaf $l.TargetPath) -eq 'Antigravity.exe') {
    $total++
    if ([string]$l.Arguments -notmatch $pattern) { $missing++ }
  }
}
if ($missing -gt 0) { 'missing' } elseif ($listingErrors.Count) { 'incomplete' } elseif ($total -eq 0) { 'unknown' } else { 'ok' }
`;

const SHORTCUT_FIX_PS = `
$pattern = '(^|\\s)--remote-debugging-port(=\\S*)?(?=\\s|$)'
$shell = New-Object -ComObject WScript.Shell
$total = 0; $updated = 0; $failed = 0; $verificationFailed = $false
foreach ($f in $files) {
  $l = $null
  try { $l = $shell.CreateShortcut($f.FullName) } catch { continue }
  if (-not $l) { continue }
  if ($l.TargetPath -and (Split-Path -Leaf $l.TargetPath) -eq 'Antigravity.exe') {
    $total++
    $arguments = [string]$l.Arguments
    if ($arguments -match $pattern) { continue }
    $expected = "$arguments --remote-debugging-port=0".Trim()
    try {
      $l.Arguments = $expected
      # WScript.Shell can silently truncate long arguments. Keep the original file in that case.
      if ([string]$l.Arguments -cne $expected) {
        $verificationFailed = $true
        $failed++
        continue
      }
      $l.Save()
    } catch {
      $failed++
      continue
    }
    try {
      $saved = $shell.CreateShortcut($f.FullName)
      if ([string]$saved.Arguments -ceq $expected) {
        $updated++
        continue
      }
    } catch {}
    $verificationFailed = $true
    $failed++
  }
}
$status = if ($listingErrors.Count) {
  if ($total -gt 0 -and $failed -eq 0) { 'partial' } else { 'incomplete' }
} elseif ($verificationFailed) { 'unverified' } elseif ($failed -gt 0) { 'missing' } elseif ($total -eq 0) { 'unknown' } else { 'ok' }
Write-Output ("$status,$updated,$failed,$total")
`;

const WIN_NOTIFY_PS = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$n.BalloonTipTitle = $env:AGY_NOTIFY_TITLE
$n.BalloonTipText = $env:AGY_NOTIFY_BODY
$n.Visible = $true
$n.ShowBalloonTip(8000)
Start-Sleep -Milliseconds 6000
$n.Dispose()
`;

function runExec(execFileImpl, file, args, options = {}) {
  return new Promise(resolve => {
    execFileImpl(file, args, { encoding: 'utf8', windowsHide: true, timeout: 12000, ...options }, (err, stdout) => {
      resolve({ ok: !err, stdout: String(stdout || '').trim() });
    });
  });
}

export function createCdpNoticeManager(options = {}) {
  const statePath = options.statePath || DEFAULT_STATE_PATH;
  const platform = options.platform || process.platform;
  const sessionId = options.sessionId || process.env.ANTIGRAVITY_LS_ADDRESS || String(process.pid);
  const failThreshold = options.failThreshold ?? 3;
  const getPrefs = options.getPrefs || (() => ({}));
  const getNotifyText = options.getNotifyText || (() => ({ title: '', body: '' }));
  const execFileImpl = options.execFileImpl || execFile;
  const now = options.now || Date.now;
  const shortcutRetryMs = options.shortcutRetryMs ?? 60_000;

  let persisted = loadState();
  let consecutiveFails = 0;
  let shortcutState = 'unknown'; // 'unknown' | 'ok' | 'missing'
  let shortcutChecked = false;
  let shortcutNextRetryAt = 0;
  let shortcutPromise = null;
  let fixPromise = null;
  let shortcutRevision = 0;
  let notified = false;
  let lastStatus = 'unknown';

  function loadState() {
    try {
      const raw = JSON.parse(readFileSync(statePath, 'utf8'));
      return {
        everOk: raw?.everOk === true,
        lastOkAt: Number(raw?.lastOkAt) || 0,
        lastOkSession: String(raw?.lastOkSession || ''),
        lastNotifiedSession: String(raw?.lastNotifiedSession || ''),
        lastPanelNoticeSession: String(raw?.lastPanelNoticeSession || ''),
        lastNotifiedAt: Number(raw?.lastNotifiedAt) || 0,
      };
    } catch {
      return { everOk: false, lastOkAt: 0, lastOkSession: '', lastNotifiedSession: '', lastPanelNoticeSession: '', lastNotifiedAt: 0 };
    }
  }

  function saveState() {
    try {
      mkdirSync(dirname(statePath), { recursive: true });
      const tmp = `${statePath}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(persisted, null, 2) + '\n', 'utf8');
      renameSync(tmp, statePath);
    } catch {}
  }

  function runShortcutScript(script) {
    const roots = options.shortcutDirectories;
    const source = roots === undefined ? DEFAULT_SHORTCUT_DIRS_PS : '(ConvertFrom-Json $env:AGY_CDP_TEST_ROOTS)';
    const command = `$ErrorActionPreference = 'Stop'
$listingErrors = @()
$files = foreach ($d in ${source} | Where-Object { $_ } | Select-Object -Unique) {
  if (Test-Path -LiteralPath $d -PathType Container -ErrorAction SilentlyContinue -ErrorVariable +listingErrors) {
    Get-ChildItem -LiteralPath $d -Recurse -Filter *.lnk -File -ErrorAction SilentlyContinue -ErrorVariable +listingErrors
  }
}
${script}`;
    const env = roots === undefined ? process.env : { ...process.env, AGY_CDP_TEST_ROOTS: JSON.stringify(roots) };
    return runExec(execFileImpl, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { env });
  }

  async function checkShortcuts() {
    if (platform !== 'win32') return 'unknown';
    if (fixPromise) return (await fixPromise).shortcutState;
    if (shortcutPromise) return shortcutPromise;
    const rev = shortcutRevision;
    const pending = (async () => {
      const res = await runShortcutScript(SHORTCUT_SCAN_PS);
      const line = res.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean).at(-1);
      if (rev === shortcutRevision) {
        shortcutChecked = res.ok && (line === 'ok' || line === 'missing' || line === 'unknown');
        if (shortcutChecked) {
          shortcutState = line;
          shortcutNextRetryAt = 0;
        } else {
          shortcutNextRetryAt = now() + shortcutRetryMs;
        }
      }
      return shortcutState;
    })().finally(() => {
      if (shortcutPromise === pending) shortcutPromise = null;
    });
    shortcutPromise = pending;
    return pending;
  }

  async function sendOsNotification(title, body) {
    if (!title || !body) return false;
    if (platform === 'win32') {
      const res = await runExec(execFileImpl, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_NOTIFY_PS], {
        env: { ...process.env, AGY_NOTIFY_TITLE: title, AGY_NOTIFY_BODY: body },
        timeout: 15000,
      });
      return res.ok;
    }
    if (platform === 'darwin') {
      const script = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run';
      const res = await runExec(execFileImpl, 'osascript', ['-e', script, title, body]);
      return res.ok;
    }
    if (platform === 'linux') {
      const res = await runExec(execFileImpl, 'notify-send', [title, body]);
      return res.ok;
    }
    return false;
  }

  async function maybeNotify(cdpState) {
    // This is a startup notice. The debugging port can close before the sidecar does.
    if (notified || persisted.lastOkSession === sessionId) return false;
    const hadBefore = persisted.everOk || cdpState === 'unreachable';
    if (!hadBefore) return false;
    const prefs = getPrefs() || {};
    if (prefs.notifyCdpRestart === false) return false;
    if (persisted.lastNotifiedSession === sessionId) {
      notified = true;
      return false;
    }
    if (platform === 'win32' && !shortcutChecked && now() >= shortcutNextRetryAt) await checkShortcuts();
    if (notified || persisted.lastOkSession === sessionId || !['missing', 'unreachable'].includes(lastStatus)) return false;
    notified = true;
    persisted.lastNotifiedSession = sessionId;
    persisted.lastNotifiedAt = Date.now();
    saveState();
    const { title, body } = getNotifyText(shortcutState, prefs);
    return await sendOsNotification(title, body);
  }

  function observe(cdpState) {
    lastStatus = cdpState;
    if (cdpState === 'ok') {
      consecutiveFails = 0;
      if (persisted.lastOkSession !== sessionId) {
        persisted.everOk = true;
        persisted.lastOkAt = Date.now();
        persisted.lastOkSession = sessionId;
        saveState();
      }
      return;
    }
    if (cdpState !== 'missing' && cdpState !== 'unreachable') { consecutiveFails = 0; return; }
    consecutiveFails++;
    if (platform === 'win32' && !shortcutChecked && now() >= shortcutNextRetryAt) {
      void checkShortcuts();
    }
    if (consecutiveFails >= failThreshold && !notified) {
      void maybeNotify(cdpState);
    }
  }

  async function fixShortcuts() {
    if (platform !== 'win32') {
      return { ok: false, reason: 'unsupported', updated: 0, failed: 0, total: 0, shortcutState };
    }
    if (fixPromise) return fixPromise;
    shortcutRevision++;
    shortcutPromise = null;
    const pending = (async () => {
      const res = await runShortcutScript(SHORTCUT_FIX_PS);
      const line = res.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean).at(-1) || '';
      const [status, updatedStr, failedStr, totalStr] = line.split(',');
      const updated = Number(updatedStr) || 0;
      const failed = Number(failedStr) || 0;
      const total = Number(totalStr) || 0;
      const partial = res.ok && status === 'partial';
      const nextState = status === 'unverified' ? 'missing' : status;
      shortcutChecked = res.ok && (nextState === 'ok' || nextState === 'missing' || nextState === 'unknown');
      if (shortcutChecked) {
        shortcutState = nextState;
        shortcutNextRetryAt = 0;
      } else {
        if (partial) shortcutState = 'unknown';
        shortcutNextRetryAt = now() + shortcutRetryMs;
      }
      const reason = partial ? 'partial'
        : !shortcutChecked || status === 'unverified' ? 'error'
        : nextState === 'ok' ? 'ok'
        : nextState === 'unknown' ? 'not_found'
        : 'permission';
      return { ok: reason === 'ok', reason, updated, failed, total, shortcutState };
    })().finally(() => {
      if (fixPromise === pending) fixPromise = null;
    });
    fixPromise = pending;
    return pending;
  }

  function info(cdpState = lastStatus) {
    const hadBefore = Boolean(persisted.everOk || cdpState === 'unreachable');
    return {
      state: cdpState,
      hadBefore,
      shortcutState,
      canFixShortcut: platform === 'win32' && shortcutState === 'missing',
    };
  }

  async function notifyPanelUnavailable() {
    if (persisted.lastPanelNoticeSession === sessionId || loadState().lastPanelNoticeSession === sessionId) return false;
    persisted.lastPanelNoticeSession = sessionId;
    saveState();
    const { title, body } = getNotifyText('S5', getPrefs());
    return sendOsNotification(title, body);
  }
  return { observe, info, checkShortcuts, fixShortcuts, maybeNotify, notifyPanelUnavailable };
}
