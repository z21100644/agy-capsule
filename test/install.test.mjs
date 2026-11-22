import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/manage-plugin.ps1', import.meta.url));
const shippedManifest = new URL('../agy-capsule/sidecars/agy_capsule/sidecar.json', import.meta.url);
function runInstaller(action, plugins, profile) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action, '-PluginsDirectory', plugins], {
    env: { ...process.env, USERPROFILE: profile, APPDATA: join(profile, 'AppData', 'Roaming') },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

test('Windows install/update/uninstall syncs plugin files and keeps preferences', { skip: process.platform !== 'win32' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'agy installer '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plugins = join(root, '.gemini', 'config', 'plugins');
  const settingsDirectory = join(root, '.gemini', 'config', 'agy-capsule');
  mkdirSync(settingsDirectory, { recursive: true });
  const settingsFile = join(settingsDirectory, 'settings.json');
  writeFileSync(settingsFile, '{"language":"zh-CN"}');
  const destination = join(plugins, 'agy-capsule');
  const run = action => runInstaller(action, plugins, root);
  run('install');
  assert.ok(existsSync(join(destination, 'plugin.json')));
  assert.ok(existsSync(join(destination, 'sidecars', 'agy_capsule', 'reload.mjs')));
  assert.equal(existsSync(join(destination, '.update-in-progress')), false);
  const serverFile = join(destination, 'sidecars', 'agy_capsule', 'server.mjs');
  writeFileSync(serverFile, '// outdated installed code');
  writeFileSync(join(destination, 'stale-file.txt'), 'left over from an old version');
  run('install');
  assert.equal(readFileSync(serverFile, 'utf8'), readFileSync(new URL('../agy-capsule/sidecars/agy_capsule/server.mjs', import.meta.url), 'utf8'));
  assert.equal(existsSync(join(destination, 'stale-file.txt')), false);
  assert.equal(existsSync(join(destination, '.update-in-progress')), false);
  run('uninstall');
  assert.equal(existsSync(destination), false);
  assert.equal(readFileSync(settingsFile, 'utf8'), '{"language":"zh-CN"}');
  run('uninstall');
});

test('Windows installer bypasses the wrapper only for non-ASCII executable paths', { skip: process.platform !== 'win32' }, t => {
  const profile = mkdtempSync(join(tmpdir(), '小生 Test '));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  const plugins = join(profile, '.gemini', 'config', 'plugins');
  const installed = join(plugins, 'agy-capsule', 'sidecars', 'agy_capsule', 'sidecar.json');
  const bin = join(profile, 'AppData', 'Roaming', 'Antigravity', 'bin');
  const wrapper = join(bin, 'agy-node.cmd');
  const exe = join(profile, 'Antigravity.exe');
  const sdk = join(profile, '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk');
  const loader = join(sdk, 'register_loader.js');
  mkdirSync(bin, { recursive: true });
  writeFileSync(exe, '');
  const original = readFileSync(shippedManifest, 'utf8');
  const install = () => runInstaller('install', plugins, profile);
  const setWrapper = path => writeFileSync(wrapper, '@echo off\nset ELECTRON_RUN_AS_NODE=1\n"' + path + '" %*\n');

  setWrapper(exe);
  assert.match(install(), /SDK loader not found.*register_loader\.js; keeping the default node command/);
  assert.equal(readFileSync(installed, 'utf8'), original);
  mkdirSync(sdk, { recursive: true });
  writeFileSync(loader, '');
  install();
  const manifest = JSON.parse(readFileSync(installed, 'utf8'));
  const defaults = JSON.parse(original);
  assert.equal(manifest.command, exe);
  assert.equal(manifest.env.ELECTRON_RUN_AS_NODE, '1');
  assert.ok(manifest.args[0].startsWith('--import=file:'));
  assert.equal(fileURLToPath(manifest.args[0].slice('--import='.length)), loader);
  assert.deepEqual(manifest.args.slice(1), defaults.args);
  assert.deepEqual(manifest.ui_config, defaults.ui_config);

  // Moving to an ASCII install path must undo the previous override on update.
  setWrapper('C:\\Program Files\\Antigravity\\Antigravity.exe');
  install();
  assert.equal(readFileSync(installed, 'utf8'), original);

  writeFileSync(wrapper, '@echo off\nunknown format\n');
  assert.match(install(), /Could not identify Antigravity\.exe/);
  assert.equal(readFileSync(installed, 'utf8'), original);
  rmSync(wrapper);
  assert.match(install(), /Could not read agy-node\.cmd/);
  assert.equal(readFileSync(installed, 'utf8'), original);
  assert.equal(readFileSync(shippedManifest, 'utf8'), original);
});

test('Windows manual update from 1.4.4 preserves only the custom Node command', { skip: process.platform !== 'win32' }, t => {
  const profile = mkdtempSync(join(tmpdir(), 'agy manual update '));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  const plugins = join(profile, '.gemini', 'config', 'plugins');
  const destination = join(plugins, 'agy-capsule');
  const pluginManifest = join(destination, 'plugin.json');
  const installed = join(destination, 'sidecars', 'agy_capsule', 'sidecar.json');
  const command = 'C:\\Program Files\\本地运行时\\node.exe';
  mkdirSync(join(destination, 'sidecars', 'agy_capsule'), { recursive: true });
  writeFileSync(pluginManifest, JSON.stringify({ name: 'agy-capsule', version: '1.4.4' }));
  writeFileSync(installed, JSON.stringify({ command, args: ['old.mjs'], ui_config: { old: true } }));

  runInstaller('install', plugins, profile);

  assert.deepEqual(JSON.parse(readFileSync(installed, 'utf8')), { ...JSON.parse(readFileSync(shippedManifest, 'utf8')), command });
  assert.equal(readFileSync(pluginManifest, 'utf8'), readFileSync(new URL('../agy-capsule/plugin.json', import.meta.url), 'utf8'));
});
