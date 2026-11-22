// Used inside the sidebar's inline runtime, with no imports.
export function createVersionPanel(root, check, saveSettings, install, now = Date.now) {
  const get = id => root.querySelector('#version-' + id);
  const button = get('check');
  const toggle = get('notify');
  const message = get('status');
  const notice = get('notice');
  const details = get('available');
  const release = get('release');
  const dismiss = get('dismiss');
  const updateButton = get('update');
  const updateStatus = get('update-status');
  let t = {}, enabled = false, nextAutoAt = 0;
  let autoBusy = false, manualBusy = false, manualResult, update, dismissed;
  let revision = 0, installResult;
  const installing = () => ['updating', 'updated'].includes(installResult?.status);
  const visibleUpdate = () => update && (installing() || update.manual || enabled) && update.latestVersion !== dismissed;
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  function render() {
    const busy = installing();
    const state = installResult?.status || 'available';
    const installFailed = state === 'error';
    button.disabled = manualBusy || busy;
    toggle.disabled = busy;
    dismiss.disabled = busy;
    updateButton.disabled = busy;
    setText(button, t[manualBusy ? 'versionChecking' : 'versionCheck']);
    setText(toggle, t.notifyUpdates);
    toggle.title = t.notifyUpdatesHelp;
    toggle.dataset.active = String(enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    setText(updateButton, state === 'updating' ? t.versionUpdating : installFailed ? t.versionRetry : t.versionUpdate);
    const updateError = {
      busy: t.versionUpdateBusy, timeout: t.versionUpdateTimeout, releaseChanged: t.versionUpdateChanged,
      releaseCheck: t.versionUpdateRelease, download: t.versionUpdateDownload, redirect: t.versionUpdateRedirect,
      size: t.versionUpdateSize, archive: t.versionUpdateArchive, version: t.versionUpdateArchive,
      incomplete: t.versionUpdateArchive, notInstalled: t.versionUpdateNotInstalled,
      recovery: t.versionUpdateRecovery, sidecar: t.versionSidecar,
    }[installResult?.reason] || t.versionUpdateInstall;
    setText(updateStatus, state === 'updated' ? t.versionUpdated : installFailed ? updateError : '');
    setText(release, installFailed ? t.versionUpdateManual : t.versionRelease);
    release.hidden = busy;
    dismiss.setAttribute('aria-label', t.versionDismiss);
    const failed = manualResult?.status === 'error';
    const reason = { timeout: t.versionTimeout, rateLimit: t.versionRateLimit, noRelease: t.versionNoRelease,
      invalidRelease: t.versionInvalidRelease, localVersion: t.versionLocalMissing, sidecar: t.versionSidecar,
      http: t.versionHttp?.replace('{status}', manualResult?.httpStatus) }[manualResult?.reason] || t.versionNetwork;
    const current = manualResult?.status === 'current';
    message.dataset.state = current ? 'current' : failed ? 'error' : '';
    setText(message, current ? t.versionUpToDate : failed ? t.versionFailed.replace('{reason}', reason) : '');
    const shown = visibleUpdate();
    notice.hidden = !shown;
    notice.dataset.state = state;
    const downloadFailed = ['timeout', 'download', 'redirect'].includes(installResult?.reason);
    setText(details, !shown || state === 'updated' ? ''
      : state === 'updating' ? t.versionUpdating
      : installFailed ? (downloadFailed ? t.versionDownloadFailed : t.versionUpdateFailed)
      : t.versionAvailable + ':\u00a0' + update.currentVersion + ' → ' + update.latestVersion);
    if (shown) release.href = update.releaseUrl;
    else release.removeAttribute('href');
  }
  function sync(prefs, labels) {
    t = labels;
    root.lang = prefs.settingsLanguage;
    if (enabled && !prefs.notifyUpdates) {
      revision++;
      nextAutoAt = 0;
      if (!update?.manual && !installing()) update = null;
    }
    enabled = prefs.notifyUpdates === true;
    render();
  }
  async function checkAutomatically() {
    if (!enabled || autoBusy || manualBusy || installing() || now() < nextAutoAt) return;
    const started = revision;
    nextAutoAt = now() + 5 * 60_000;
    autoBusy = true;
    try {
      const data = await check('auto');
      if (started !== revision || !enabled) return;
      if (data.status === 'update') {
        if (update?.latestVersion !== data.latestVersion) installResult = null;
        if (!update?.manual || update.latestVersion !== data.latestVersion) update = data;
        if (manualResult?.status === 'current') manualResult = null;
      } else if (data.status === 'current') update = null;
      render();
    } catch {} // Background checks are optional; leave the sidebar usable.
    finally { autoBusy = false; }
  }
  async function checkManually() {
    if (manualBusy || installing()) return;
    revision++;
    dismissed = null;
    update = null;
    installResult = null;
    manualResult = null;
    manualBusy = true;
    render();
    try {
      const data = await check('manual');
      manualResult = ['current', 'update', 'error'].includes(data?.status) ? data : { status: 'error', reason: 'sidecar' };
      if (manualResult.status === 'update') update = { ...manualResult, manual: true };
    } catch (error) { manualResult = { status: 'error', reason: error?.name === 'TimeoutError' ? 'timeout' : 'sidecar' }; }
    finally { manualBusy = false; render(); }
  }
  async function installUpdate() {
    if (installing() || !visibleUpdate()) return;
    revision++;
    installResult = { status: 'updating' };
    render();
    try {
      const result = await install(update.latestVersion);
      installResult = ['updated', 'error'].includes(result?.status) ? result : { status: 'error', reason: 'sidecar' };
    } catch (error) { installResult = { status: 'error', reason: error?.name === 'TimeoutError' ? 'timeout' : 'sidecar' }; }
    render();
  }
  button.addEventListener('click', checkManually);
  updateButton.addEventListener('click', installUpdate);
  toggle.addEventListener('click', () => saveSettings({ notifyUpdates: !enabled }));
  dismiss.addEventListener('click', () => {
    dismissed = update?.latestVersion;
    render();
    button.focus();
  });
  return { sync, checkAutomatically, checkManually };
}
