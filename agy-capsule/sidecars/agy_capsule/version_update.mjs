import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, posix, relative, resolve, win32 } from 'node:path';
import { compareVersions, parseVersion, REPO } from './version_check.mjs';
import { downloadArchive, readRuntimeArchive, ROOT_FILES, SIDECAR_PATH, UpdateError } from './update_archive.mjs';

export const UPDATE_ROUTE = '/api/update';
const markerName = '.update-in-progress';
const sidecarManifest = SIDECAR_PATH + '/sidecar.json';
const required = ['plugin.json', 'logo.svg', sidecarManifest, ...[
  'server.mjs', 'reload.mjs', 'settings.mjs', 'deck_injector.mjs', 'ui.mjs', 'metrics.mjs',
].map(name => SIDECAR_PATH + '/' + name)];
const managed = [...ROOT_FILES.filter(path => path !== 'plugin.json'), SIDECAR_PATH, 'plugin.json'];
const fileErrorReasons = { EACCES: 'permission', EBUSY: 'locked', ETXTBSY: 'locked' };

class InstallError extends UpdateError {
  constructor(error, path, { restored = false, recovery = false } = {}) {
    const code = typeof error?.code === 'string' && /^E[A-Z0-9_]{1,31}$/.test(error.code) ? error.code : undefined;
    const reason = error instanceof UpdateError ? error.reason : fileErrorReasons[code] || 'install';
    super(recovery ? 'recovery' : reason);
    // Only caller-supplied plugin-relative paths are shareable. Node's error
    // message, path and dest can contain absolute paths and account names.
    this.diagnostics = { ...(code && { code }), ...(path && { path }), ...(restored && { restored }) };
  }
}

async function info(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function installedRoot(sidecarDirectory, pluginsDirectory) {
  const root = resolve(sidecarDirectory, '../..');
  if (relative(root, join(pluginsDirectory, 'agy-capsule')) || relative(sidecarDirectory, join(root, SIDECAR_PATH))) {
    throw new UpdateError('notInstalled');
  }
  for (const path of [root, join(root, 'sidecars'), sidecarDirectory]) {
    if (!(await info(path))?.isDirectory()) throw new UpdateError('notInstalled');
  }
  // Even a configured plugin directory cannot point back into a Git checkout
  // or use the sibling preferences directory as the install target.
  const canonical = await realpath(root);
  const config = await realpath(join(homedir(), '.gemini', 'config')).catch(() => null);
  if (config && !relative(canonical, join(config, 'agy-capsule'))) throw new UpdateError('notInstalled');
  for (let path = canonical;; path = dirname(path)) {
    if (await info(join(path, '.git'))) throw new UpdateError('notInstalled');
    if (path === dirname(path)) break;
  }
  return canonical;
}

async function diskManifest(root, path) {
  const fullPath = join(root, path);
  if (!(await info(fullPath))?.isFile()) throw new UpdateError('notInstalled');
  try { return JSON.parse(await readFile(fullPath, 'utf8')); }
  catch (error) {
    if (error instanceof SyntaxError || error.code === 'ENOENT') throw new UpdateError('notInstalled');
    throw new InstallError(error, path);
  }
}

function prepareRelease(files, version, installedSidecar) {
  if (required.some(path => !files.get(path)?.length)) throw new UpdateError('incomplete');
  let manifest, sidecar;
  try {
    manifest = JSON.parse(files.get('plugin.json'));
    sidecar = JSON.parse(files.get(sidecarManifest));
  } catch { throw new UpdateError('incomplete'); }
  if (manifest?.name !== 'agy-capsule' || parseVersion(manifest.version)?.version !== version) throw new UpdateError('version');
  if (sidecar?.command !== 'node' || sidecar.args?.[0] !== 'server.mjs' || !Array.isArray(sidecar.args) ||
      !sidecar.args.every(arg => typeof arg === 'string') || sidecar.restart_policy !== 'always') throw new UpdateError('incomplete');
  // Check relative static imports used by this repository without executing any archive code.
  for (const [path, bytes] of files) {
    if (!/\.[cm]?js$/.test(path)) continue;
    const imports = /^[ \t]*(?:(?:import|export)[^\r\n]*?\bfrom[ \t]*|import[ \t]*)['"](\.{1,2}\/[^'"\r\n]+)['"]/gm;
    for (const [, target] of bytes.toString('utf8').matchAll(imports)) {
      if (!files.get(posix.normalize(posix.join(posix.dirname(path), target)))?.length) throw new UpdateError('incomplete');
    }
  }
  // Keep the installed Windows launcher when it uses an explicit Node path
  // or the installer's direct Electron bootstrap.
  const { command, args, env } = installedSidecar || {};
  if (typeof command !== 'string' || !win32.isAbsolute(command)) return;
  const executable = win32.basename(command).toLowerCase();
  if (executable === 'node.exe' && win32.parse(command).root.length > 1) {
    sidecar.command = command;
  } else if (executable === 'antigravity.exe'
      && env?.ELECTRON_RUN_AS_NODE === '1' && typeof args?.[0] === 'string' && args[0].startsWith('--import=file:')) {
    sidecar.command = command;
    sidecar.args = [args[0], ...sidecar.args];
    sidecar.env = { ...sidecar.env, ELECTRON_RUN_AS_NODE: '1' };
  } else {
    return;
  }
  files.set(sidecarManifest, Buffer.from(JSON.stringify(sidecar, null, 2) + '\n'));
}

async function replaceRuntime(root, stage, backup, currentVersion, move) {
  await mkdir(backup);
  const marker = join(root, markerName);
  try { await writeFile(marker, 'Updating agy-capsule\n', { flag: 'wx' }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new UpdateError('busy');
    throw new InstallError(error, markerName);
  }
  const changes = [];
  let activePath = 'plugin.json';
  async function moveTracked(from, to) {
    await move(from, to);
    changes.push({ path: activePath, from, to });
  }
  try {
    const local = await diskManifest(root, 'plugin.json');
    if (parseVersion(local?.version)?.version !== currentVersion) throw new UpdateError('releaseChanged');
    activePath = SIDECAR_PATH;
    if (!(await info(join(root, 'sidecars')))?.isDirectory() || !(await info(join(root, SIDECAR_PATH)))?.isDirectory()) {
      throw new UpdateError('notInstalled');
    }
    for (const path of managed) {
      activePath = path;
      const incoming = join(stage, path);
      if (!(await info(incoming))) continue;
      const live = join(root, path);
      const saved = join(backup, basename(path));
      const existing = await info(live);
      if (existing) {
        if (path === SIDECAR_PATH ? !existing.isDirectory() : !existing.isFile()) throw new UpdateError('pathConflict');
        try { await moveTracked(live, saved); }
        catch (error) {
          if (path !== SIDECAR_PATH || process.platform !== 'win32' || fileErrorReasons[error.code] !== 'locked') throw error;
          // Antigravity runs the sidecar with this directory as its CWD.
          // Windows locks the directory itself, not all of its children.
          await mkdir(saved);
          for (const name of await readdir(live)) await moveTracked(join(live, name), join(saved, name));
          for (const name of await readdir(incoming)) await moveTracked(join(incoming, name), join(live, name));
          continue;
        }
      }
      await moveTracked(incoming, live);
    }
    activePath = markerName;
    await unlink(marker);
  } catch (error) {
    const failedPath = activePath;
    const restored = changes.length > 0;
    try {
      // Roll back in reverse; leave the marker and backup in place only if the
      // rollback itself fails, so the watcher won't boot a partial install.
      for (const { path, from, to } of changes.reverse()) {
        activePath = path;
        await move(to, from);
      }
      activePath = markerName;
      await unlink(marker);
    } catch (rollbackError) { throw new InstallError(rollbackError, activePath, { recovery: true }); }
    throw new InstallError(error, failedPath, { restored });
  }
}

export function createPluginUpdater({
  sidecarDirectory, checkVersion,
  pluginsDirectory = process.env.AGY_CAPSULE_PLUGINS_DIR || join(homedir(), '.gemini', 'config', 'plugins'),
  downloadOptions, move = rename,
}) {
  let busy = false;
  const failure = (reason, step, details) => ({ status: 'error', reason, diagnostics: { step, ...details } });
  return async function update(expectedVersion) {
    if (busy) return failure('busy', 'start');
    busy = true;
    let work, stagedFile, keepBackup = false;
    let step = 'start';
    try {
      if (!parseVersion(expectedVersion)) throw new UpdateError('releaseChanged');
      step = 'inspect';
      const root = await installedRoot(sidecarDirectory, pluginsDirectory);
      if (await info(join(root, markerName))) throw new UpdateError('busy');
      const local = await diskManifest(root, 'plugin.json');
      const current = parseVersion(local?.version)?.version;
      if (!current || local.name !== 'agy-capsule') throw new UpdateError('notInstalled');
      const installedSidecar = await diskManifest(root, sidecarManifest);
      step = 'verify-release';
      const release = await checkVersion('manual', { fresh: true });
      if (release?.reason === 'rateLimit') return { ...failure('rateLimit', step), retryAt: release.retryAt };
      if (release?.status === 'error') throw new UpdateError(release.reason === 'timeout' ? 'timeout' : 'releaseCheck');
      const target = parseVersion(release?.releaseTag);
      if (!target || target.pre.length || target.version !== release.latestVersion || target.version !== expectedVersion
          || compareVersions(target.version, current) !== 1 || release.status !== 'update') throw new UpdateError('releaseChanged');
      step = 'download';
      const url = `https://api.github.com/repos/${REPO}/tarball/${encodeURIComponent(release.releaseTag)}`;
      const archive = await downloadArchive(url, downloadOptions);
      step = 'validate-archive';
      const files = await readRuntimeArchive(archive);
      prepareRelease(files, target.version, installedSidecar);
      // Adjacent staging keeps renames on the same volume even if OS Temp is on
      // another drive. Nothing in the live plugin was changed up to this point.
      step = 'stage';
      work = await mkdtemp(join(dirname(root), '.agy-capsule-update-'));
      const stage = join(work, 'next');
      for (const [path, bytes] of files) {
        stagedFile = path;
        const destination = join(stage, path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: 'wx' });
      }
      step = 'replace';
      await replaceRuntime(root, stage, join(work, 'previous'), current, move);
      return { status: 'updated', version: target.version };
    } catch (error) {
      const failureError = error instanceof UpdateError ? error : new InstallError(error, step === 'stage' ? stagedFile : undefined);
      keepBackup = failureError.reason === 'recovery';
      return failure(failureError.reason, keepBackup ? 'rollback' : step, failureError.diagnostics);
    } finally {
      if (work && !keepBackup) await rm(work, { recursive: true, force: true, maxRetries: 2 }).catch(() => {});
      busy = false;
    }
  };
}
