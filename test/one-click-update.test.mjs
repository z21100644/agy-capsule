import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { downloadArchive, readRuntimeArchive, SIDECAR_PATH } from '../agy-capsule/sidecars/agy_capsule/update_archive.mjs';
import { createPluginUpdater } from '../agy-capsule/sidecars/agy_capsule/version_update.mjs';
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
    assert.deepEqual(result, { status: 'error', reason });
    instance.unchanged();
  }
});

test('declines downgrades, a changed release, a pending marker and a source checkout before downloading', async t => {
  const instance = fixture(t, '2.0.0');
  const neverFetch = async () => assert.fail('must not fetch');
  assert.deepEqual(await instance.updater(neverFetch)(latest), { status: 'error', reason: 'releaseChanged' });
  assert.deepEqual(await instance.updater(neverFetch)('2.5.0'), { status: 'error', reason: 'releaseChanged' });
  assert.deepEqual(await instance.updater(neverFetch)('https://not-a-release.example/'), { status: 'error', reason: 'releaseChanged' });
  instance.unchanged();
  writeFileSync(instance.marker, 'other installer');
  assert.deepEqual(await instance.updater(neverFetch)(latest), { status: 'error', reason: 'busy' });
  assert.equal(readFileSync(instance.marker, 'utf8'), 'other installer');
  rmSync(instance.marker);
  mkdirSync(join(instance.temp, '.git'));
  assert.deepEqual(await instance.updater(neverFetch)(latest), { status: 'error', reason: 'notInstalled' });
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
  assert.deepEqual(await update(latest), { status: 'error', reason: 'busy' });
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

test('a failed file swap restores the previous installation before clearing the marker', async t => {
  const instance = fixture(t);
  const update = instance.updater(async () => new Response(archive()), {
    move: (from, to) => {
      if (to === join(instance.root, 'plugin.json') && from.includes(join('next', 'plugin.json'))) throw new Error('simulated denied rename');
      return rename(from, to);
    },
  });
  assert.deepEqual(await update(latest), { status: 'error', reason: 'install' });
  instance.unchanged();
});

test('a directory occupying an optional runtime file path is left intact', async t => {
  const instance = fixture(t);
  const localFile = join(instance.root, 'THIRD-PARTY-NOTICES.md', 'local.txt');
  mkdirSync(dirname(localFile));
  writeFileSync(localFile, 'keep this file');
  assert.deepEqual(await instance.updater(async () => new Response(archive()))(latest), { status: 'error', reason: 'install' });
  assert.equal(readFileSync(localFile, 'utf8'), 'keep this file');
  instance.unchanged();
});
