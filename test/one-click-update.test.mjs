import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { downloadArchive, readRuntimeArchive, SIDECAR_PATH } from '../agy-capsule/sidecars/agy_capsule/update_archive.mjs';
import { createPluginUpdater } from '../agy-capsule/sidecars/agy_capsule/version_update.mjs';
import { createVersionChecker } from '../agy-capsule/sidecars/agy_capsule/version_check.mjs';
import { startSelfReloadWatcher } from '../agy-capsule/sidecars/agy_capsule/reload.mjs';

const latest = '1.2.0';
const verified = { status: 'update', latestVersion: latest, releaseTag: 'v' + latest, releaseUrl: 'https://irrelevant.example/' };
const archiveUrl = 'https://api.github.com/repos/Lumidarin/agy-capsule/tarball/v' + latest;
const downloadUrl = 'https://codeload.github.com/Lumidarin/agy-capsule/legacy.tar.gz/refs/tags/v' + latest;
const manifest = version => JSON.stringify({ name: 'agy-capsule', version });
const sidecar = JSON.stringify({ command: 'node', args: ['server.mjs'], restart_policy: 'always' });

function packageFiles(version = latest) {
  return new Map([
    ['plugin.json', manifest(version)], ['logo.svg', '<svg id="new" />'], ['README.md', 'new help'],
    ['THIRD-PARTY-NOTICES.md', 'new notices'], [SIDECAR_PATH + '/sidecar.json', sidecar],
    [SIDECAR_PATH + '/server.mjs', "import './program.mjs';\n"],
    ...['program', 'reload', 'settings', 'deck_injector', 'ui', 'metrics'].map(name => [SIDECAR_PATH + '/' + name + '.mjs', '// new runtime']),
  ]);
}

function archive(files = packageFiles(), extra = []) {
  const entries = [
    ['pax_global_header', '52 comment=' + 'a'.repeat(40) + '\n', 'g'],
    ...Array.from(files, ([name, data]) => ['Lumidarin-agy-capsule-abc/agy-capsule/' + name, data, '0']),
    ['Lumidarin-agy-capsule-abc/unrelated.txt', 'not a runtime file', '0'],
    ...extra,
  ];
  const blocks = [];
  for (const [name, data, type, link] of entries) {
    const bytes = Buffer.from(data);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000644\0', 100);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header.fill(32, 148, 156);
    header.write(type, 156);
    if (link) header.write(link, 157, 100);
    header.write('ustar\x0000', 257);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

function fixture(t, version = '1.1.0') {
  const temp = mkdtempSync(join(tmpdir(), 'agy updater '));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const pluginsDirectory = join(temp, '.gemini', 'config', 'plugins');
  const root = join(pluginsDirectory, 'agy-capsule');
  const directory = join(root, SIDECAR_PATH);
  const marker = join(root, '.update-in-progress');
  const settings = join(temp, '.gemini', 'config', 'agy-capsule', 'settings.json');
  const installed = {
    command: 'C:\\开发工具\\Antigravity.exe',
    args: ['--import=file:///C:/fixture/sidecar_sdk/register_loader.js', 'server.mjs'],
    env: { ELECTRON_RUN_AS_NODE: '1' }, ui_config: { old: true },
  };
  mkdirSync(directory, { recursive: true });
  mkdirSync(dirname(settings), { recursive: true });
  writeFileSync(settings, '{"notifyUpdates":false}');
  writeFileSync(join(root, 'plugin.json'), manifest(version));
  writeFileSync(join(root, 'logo.svg'), '<svg id="old" />');
  writeFileSync(join(root, 'README.md'), 'old help');
  writeFileSync(join(root, 'unrelated.txt'), 'local file');
  writeFileSync(join(directory, 'sidecar.json'), JSON.stringify(installed));
  writeFileSync(join(directory, 'server.mjs'), '// old runtime');
  writeFileSync(join(directory, 'stale.mjs'), '// stale runtime');
  const updater = (fetchImpl, options) => createPluginUpdater({
    sidecarDirectory: directory, pluginsDirectory, checkVersion: async () => verified,
    downloadOptions: { fetchImpl }, ...options,
  });
  function unchanged() {
    assert.equal(readFileSync(join(root, 'plugin.json'), 'utf8'), manifest(version));
    assert.equal(readFileSync(join(root, 'logo.svg'), 'utf8'), '<svg id="old" />');
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), 'old help');
    assert.equal(readFileSync(join(directory, 'sidecar.json'), 'utf8'), JSON.stringify(installed));
    assert.equal(readFileSync(join(directory, 'server.mjs'), 'utf8'), '// old runtime');
    assert.equal(readFileSync(join(directory, 'stale.mjs'), 'utf8'), '// stale runtime');
    assert.equal(readFileSync(settings, 'utf8'), '{"notifyUpdates":false}');
    assert.deepEqual(readdirSync(pluginsDirectory), ['agy-capsule']);
    assert.equal(existsSync(marker), false);
  }
  return { temp, pluginsDirectory, root, directory, marker, settings, installed, updater, unchanged };
}

test('tarball validates every redirect and the final HTTPS download host', async () => {
  const urls = [];
  const bytes = await downloadArchive(archiveUrl, {
    fetchImpl: async (url, options) => {
      urls.push(url);
      assert.equal(options.redirect, 'manual');
      return url === archiveUrl ? Response.redirect(downloadUrl) : new Response('payload');
    },
  });
  assert.deepEqual(urls, [archiveUrl, downloadUrl]);
  assert.equal(bytes.toString(), 'payload');
  for (const location of [
    'https://codeload.github.com.example.test/a', 'http://codeload.github.com/a',
    'https://user@codeload.github.com/a', 'https://codeload.github.com:8443/a',
  ]) {
    let calls = 0;
    await assert.rejects(downloadArchive(archiveUrl, {
      fetchImpl: async () => { calls++; return Response.redirect(location); },
    }), { reason: 'redirect' });
    assert.equal(calls, 1, 'an unapproved redirect is never followed');
  }
  const redirected = new Response('payload');
  Object.defineProperty(redirected, 'url', { value: 'https://different.example.test/file' });
  await assert.rejects(downloadArchive(archiveUrl, { fetchImpl: async () => redirected }), { reason: 'redirect' });
});

test('one-click update revalidates a recent manual result before downloading', async t => {
  const instance = fixture(t);
  let checks = 0;
  const checkVersion = createVersionChecker({
    currentVersion: '1.1.0', now: () => 1000,
    fetchImpl: async () => Response.json({ tag_name: ++checks === 1 ? 'v' + latest : 'v1.2.1' }),
  });
  const updater = instance.updater(() => assert.fail('a changed release must not download'), { checkVersion });
  assert.equal((await checkVersion('manual')).latestVersion, latest);
  assert.equal((await checkVersion('manual')).latestVersion, latest);
  assert.equal(checks, 1);
  assert.deepEqual(await updater(latest), { status: 'error', reason: 'releaseChanged', diagnostics: { step: 'verify-release' } });
  assert.equal(checks, 2, 'installer skips the short and the long cache');
  instance.unchanged();
});

test('one-click update returns the shared rate limit deadline without downloading', async t => {
  const instance = fixture(t);
  let checks = 0, downloads = 0;
  const checkVersion = createVersionChecker({
    currentVersion: '1.1.0', now: () => 1000,
    fetchImpl: async () => {
      checks++;
      return new Response('', { status: 429, headers: { 'Retry-After': '300' } });
    },
  });
  const updater = instance.updater(() => { downloads++; throw new Error('unexpected download'); }, { checkVersion });
  const limited = await checkVersion('manual');
  assert.deepEqual(await updater(latest), {
    status: 'error', reason: 'rateLimit', retryAt: limited.retryAt, diagnostics: { step: 'verify-release' },
  });
  assert.equal(checks, 1);
  assert.equal(downloads, 0);
  instance.unchanged();
});

test('compressed and extracted size limits and network deadline are enforced', async t => {
  await assert.rejects(downloadArchive(archiveUrl, {
    maxBytes: 3, fetchImpl: async () => new Response('a', { headers: { 'Content-Length': 4 } }),
  }), { reason: 'size' });
  await assert.rejects(downloadArchive(archiveUrl, {
    maxBytes: 3, fetchImpl: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Uint8Array.of(1, 2)); controller.enqueue(Uint8Array.of(3, 4)); controller.close(); },
    })),
  }), { reason: 'size' });
  await assert.rejects(readRuntimeArchive(gzipSync(Buffer.alloc(4096)), 512), { reason: 'size' });
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  await assert.rejects(downloadArchive(archiveUrl, {
    timeoutMs: 10,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  }), { reason: 'timeout' });
});

test('invalid downloads and invalid archives never touch the live plugin', async t => {
  const instance = fixture(t);
  const noManifest = packageFiles();
  noManifest.delete('plugin.json');
  const noImport = packageFiles();
  noImport.delete(SIDECAR_PATH + '/program.mjs');
  const cases = [
    [() => Response.redirect('https://outside.example.test/archive'), 'redirect'],
    [() => new Response('not gzip'), 'archive'],
    [() => new Response(archive(packageFiles(), [['Lumidarin-agy-capsule-abc/agy-capsule/../traversal.txt', 'invalid', '0']])), 'archive'],
    [() => new Response(archive(packageFiles(), [['Lumidarin-agy-capsule-abc/agy-capsule/sidecars/agy_capsule/link', '', '2', 'server.mjs']])), 'archive'],
    [() => new Response(archive(noManifest)), 'incomplete'],
    [() => new Response(archive(noImport)), 'incomplete'],
    [() => new Response(archive(packageFiles('1.1.0'))), 'version'],
    [() => new Response(archive(packageFiles('1.2.1'))), 'version'],
    [() => new Response(archive(packageFiles('not-versioned'))), 'version'],
  ];
  for (const [fetchImpl, reason] of cases) {
    const result = await instance.updater(fetchImpl)(latest);
    assert.deepEqual(result, { status: 'error', reason, diagnostics: { step: reason === 'redirect' ? 'download' : 'validate-archive' } });
    instance.unchanged();
  }
});

test('declines downgrades, a changed release, a pending marker and a source checkout before downloading', async t => {
  const instance = fixture(t, '2.0.0');
  const neverFetch = async () => assert.fail('must not fetch');
  const update = instance.updater(neverFetch);
  assert.deepEqual(await update(latest), { status: 'error', reason: 'releaseChanged', diagnostics: { step: 'verify-release' } });
  assert.deepEqual(await update('2.5.0'), { status: 'error', reason: 'releaseChanged', diagnostics: { step: 'verify-release' } });
  assert.deepEqual(await update('https://not-a-release.example/'), { status: 'error', reason: 'releaseChanged', diagnostics: { step: 'start' } });
  instance.unchanged();
  writeFileSync(instance.marker, 'other installer');
  assert.deepEqual(await update(latest), { status: 'error', reason: 'busy', diagnostics: { step: 'inspect' } });
  assert.equal(readFileSync(instance.marker, 'utf8'), 'other installer');
  rmSync(instance.marker);
  mkdirSync(join(instance.temp, '.git'));
  assert.deepEqual(await update(latest), { status: 'error', reason: 'notInstalled', diagnostics: { step: 'inspect' } });
  instance.unchanged();
});

test('installs only staged runtime files under the reload marker, rejects concurrent runs, and preserves settings', async t => {
  const instance = fixture(t);
  const { root, directory, marker, settings, installed, pluginsDirectory } = instance;
  let reloads = 0;
  t.after(startSelfReloadWatcher(directory, () => reloads++, { pollMs: 10, settleMs: 30 }));
  let respond, started, moves = 0;
  const downloading = new Promise(resolve => { started = resolve; });
  const update = instance.updater(async url => {
    assert.equal(url, archiveUrl, 'does not use a caller-provided or release response URL');
    started();
    return new Promise(resolve => { respond = resolve; });
  }, {
    move: async (from, to) => {
      assert.equal(existsSync(marker), true);
      if (moves++ === 0) {
        assert.equal(readFileSync(join(root, 'plugin.json'), 'utf8'), manifest('1.1.0'));
        await delay(70);
        assert.equal(reloads, 0, 'watcher must not restart mid-update');
      }
      await rename(from, to);
    },
  });
  const running = update(latest);
  await downloading;
  instance.unchanged();
  assert.deepEqual(await update(latest), { status: 'error', reason: 'busy', diagnostics: { step: 'start' } });
  respond(new Response(archive()));
  assert.deepEqual(await running, { status: 'updated', version: latest });
  assert.equal(readFileSync(join(root, 'plugin.json'), 'utf8'), manifest(latest));
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), 'new help');
  assert.equal(readFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8'), 'new notices');
  assert.equal(readFileSync(join(root, 'unrelated.txt'), 'utf8'), 'local file');
  assert.match(readFileSync(join(directory, 'server.mjs'), 'utf8'), /program\.mjs/);
  assert.equal(existsSync(join(directory, 'stale.mjs')), false);
  assert.equal(existsSync(marker), false);
  assert.deepEqual(readdirSync(pluginsDirectory), ['agy-capsule']);
  assert.equal(readFileSync(settings, 'utf8'), '{"notifyUpdates":false}');
  const target = JSON.parse(readFileSync(join(directory, 'sidecar.json'), 'utf8'));
  assert.deepEqual(target, { ...JSON.parse(sidecar), command: installed.command, env: installed.env, args: installed.args });
  for (let i = 0; i < 40 && !reloads; i++) await delay(10);
  assert.equal(reloads, 1);
});

test('Windows can update and roll back while the running sidecar holds its working directory', { skip: process.platform !== 'win32' }, async t => {
  const instance = fixture(t);
  const { directory, marker, root, settings, pluginsDirectory } = instance;
  const child = spawn(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], {
    cwd: directory, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
  });
  const exited = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    await assert.rejects(rename(directory, join(root, 'check-lock')), { code: 'EBUSY' });

    const fetch = async () => new Response(archive());
    const failing = instance.updater(fetch, {
      move: (from, to) => {
        assert.equal(existsSync(marker), true);
        if (to === join(directory, 'server.mjs') && from.includes(join('next', SIDECAR_PATH))) {
          throw Object.assign(new Error('simulated failure installing a staged file'), { code: 'EACCES' });
        }
        return rename(from, to);
      },
    });
    assert.deepEqual(await failing(latest), {
      status: 'error', reason: 'permission', diagnostics: { step: 'replace', code: 'EACCES', path: SIDECAR_PATH, restored: true },
    });
    instance.unchanged();

    assert.deepEqual(await instance.updater(fetch)(latest), { status: 'updated', version: latest });
    assert.equal(child.exitCode, null, 'the running sidecar still holds the directory');
    assert.equal(readFileSync(join(root, 'plugin.json'), 'utf8'), manifest(latest));
    assert.match(readFileSync(join(directory, 'server.mjs'), 'utf8'), /program\.mjs/);
    assert.equal(existsSync(join(directory, 'stale.mjs')), false);
    assert.equal(existsSync(marker), false);
    assert.deepEqual(readdirSync(pluginsDirectory), ['agy-capsule']);
    assert.equal(readFileSync(settings, 'utf8'), '{"notifyUpdates":false}');
  } finally {
    child.kill();
    await exited;
  }
});

test('one-click update preserves a custom Windows Node executable and uses the new manifest', async t => {
  const instance = fixture(t);
  const path = join(instance.directory, 'sidecar.json');
  const command = 'C:\\Program Files\\本地运行时\\node.exe';
  writeFileSync(path, JSON.stringify({ ...JSON.parse(sidecar), command, ui_config: { old: true } }));
  const releaseManifest = { ...JSON.parse(sidecar), ui_config: { release: true } };
  const files = packageFiles();
  files.set(SIDECAR_PATH + '/sidecar.json', JSON.stringify(releaseManifest));

  const update = instance.updater(async () => new Response(archive(files)));

  assert.deepEqual(await update(latest), { status: 'updated', version: latest });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { ...releaseManifest, command });
});

test('a failed swap restores the previous installation and reports only safe diagnostics', async t => {
  for (const [code, reason] of [['EACCES', 'permission'], ['EBUSY', 'locked'], ['EPERM', 'install']]) {
    const instance = fixture(t);
    const update = instance.updater(async () => new Response(archive()), {
      move: (from, to) => {
        if (to === join(instance.root, 'plugin.json') && from.includes(join('next', 'plugin.json'))) {
          throw Object.assign(new Error(`simulated error from ${from} to ${to}`), { code, path: from, dest: to });
        }
        return rename(from, to);
      },
    });
    assert.deepEqual(await update(latest), {
      status: 'error', reason, diagnostics: { step: 'replace', code, path: 'plugin.json', restored: true },
    });
    instance.unchanged();
  }
});

test('a failed rollback preserves the backup and reports the rollback failure', async t => {
  const instance = fixture(t);
  const update = instance.updater(async () => new Response(archive()), {
    move: (from, to) => {
      if (to === join(instance.root, 'plugin.json')) {
        const code = from.includes(join('previous', 'plugin.json')) ? 'EACCES' : 'EBUSY';
        throw Object.assign(new Error(`simulated error from ${from}`), { code });
      }
      return rename(from, to);
    },
  });
  assert.deepEqual(await update(latest), {
    status: 'error', reason: 'recovery', diagnostics: { step: 'rollback', code: 'EACCES', path: 'plugin.json' },
  });
  assert.equal(existsSync(instance.marker), true);
  const backup = readdirSync(instance.pluginsDirectory).find(dir => dir.startsWith('.agy-capsule-update-'));
  assert.equal(readFileSync(join(instance.pluginsDirectory, backup, 'previous', 'plugin.json'), 'utf8'), manifest('1.1.0'));
});

test('a directory occupying an optional runtime file path is left intact', async t => {
  const instance = fixture(t);
  const localFile = join(instance.root, 'THIRD-PARTY-NOTICES.md', 'local.txt');
  mkdirSync(dirname(localFile));
  writeFileSync(localFile, 'keep this file');
  assert.deepEqual(await instance.updater(async () => new Response(archive()))(latest), {
    status: 'error', reason: 'pathConflict', diagnostics: { step: 'replace', path: 'THIRD-PARTY-NOTICES.md', restored: true },
  });
  assert.equal(readFileSync(localFile, 'utf8'), 'keep this file');
  instance.unchanged();
});
