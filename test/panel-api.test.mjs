import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCdpNoticeManager } from '../agy-capsule/sidecars/agy_capsule/cdp_notice.mjs';
import { startPanel, getNotifyText } from '../agy-capsule/sidecars/agy_capsule/server.mjs';

test('S5 never starts the SDK and notifies once per host session, including across sidecar restarts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-s5-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const notifications = [];
  const manager = sessionId => createCdpNoticeManager({
    sessionId, statePath: join(dir, 'state.json'), platform: 'linux',
    getNotifyText: code => ({ title: 'agy-capsule', body: code }),
    execFileImpl(file, args, opts, done) { notifications.push([file, ...args]); done(null, ''); },
  });
  for (const token of [undefined, '', '   ']) {
    await startPanel(() => assert.fail('SDK must not start'), { ANTIGRAVITY_SIDECAR_UI_TOKEN: token }, manager('session-1'));
  }
  assert.deepEqual(notifications, [['notify-send', 'agy-capsule', 'S5']]);
  await startPanel(() => assert.fail('SDK must not start'), {}, manager('session-2'));
  assert.equal(notifications.length, 2);
});

test('S3 distinguishes missing from empty directories; S4 counts failures per database and clears on success', async t => {
  const root = mkdtempSync(join(tmpdir(), 'agy-health-'));
  let db;
  t.after(() => { db?.close(); rmSync(root, { recursive: true, force: true }); });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({}) }));
  const old = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR = root;
  let inspect;
  try { ({ inspectConversation: inspect } = await import('../agy-capsule/sidecars/agy_capsule/server.mjs?health-test')); }
  finally { if (old === undefined) delete process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR; else process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR = old; }
  assert.deepEqual((await inspect()).health, { code: 'S3' });
  const dir = join(root, 'conversations'); mkdirSync(dir);
  assert.equal((await inspect()).health, null);
  db = new DatabaseSync(join(dir, 'chat.db'));
  db.exec('CREATE TABLE gen_metadata(idx, data)');
  for (let n = 1; n < 10; n++) assert.equal((await inspect('chat')).health, null);
  assert.deepEqual((await inspect('chat')).health, { code: 'S4' });
  assert.equal((await inspect('other')).health, null);
  db.exec('CREATE TABLE steps(idx, step_type, status, metadata)');
  assert.equal((await inspect('chat')).health, null);
});

test('F2 resets the F1 counter without notifying; S5 and F1 each notify once, independently', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-notice-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const create = sessionId => createCdpNoticeManager({
    sessionId, statePath: join(dir, 'state.json'), platform: 'linux', failThreshold: 2,
    getNotifyText, getPrefs: () => ({ settingsLanguage: 'zh-CN' }),
    execFileImpl(file, args, opts, done) { calls.push(args); done(null, ''); },
  });
  for (const first of ['S5', 'F1']) {
    const base = calls.length;
    const mgr = create(first);
    if (first === 'S5') await startPanel(() => assert.fail('must not start'), {}, mgr);
    mgr.observe('unreachable');
    for (let i = 0; i < 3; i++) mgr.observe('unverified');
    mgr.observe('unreachable');
    assert.equal(calls.length - base, Number(first === 'S5'));
    mgr.observe('unreachable');
    if (first === 'F1') await startPanel(() => assert.fail('must not start'), {}, mgr);
    const resumed = create(first);
    resumed.observe('unreachable'); resumed.observe('unreachable');
    await startPanel(() => assert.fail('must not start'), {}, resumed);
    assert.equal(calls.length - base, 2);
    const [title, body] = calls[base + Number(first === 'F1')];
    assert.match(title, /侧栏/); assert.match(body, /没有提供授权信息/); assert.match(body, /S5/);
  }
});

test('protected data and host operations are registered only as POST; legacy GET only signals a panel reload', async () => {
  const routes = new Map();
  class SidecarApp {
    api(path, fn, method = 'POST') { routes.set(method + ' ' + path, fn); }
    page() {}
    run() {}
  }
  await startPanel(() => ({ SidecarApp }), { ANTIGRAVITY_SIDECAR_UI_TOKEN: 'fixture' });
  const get = routes.get('GET /api/context')();
  assert.equal(get.status, 405);
  assert.deepEqual(Object.keys(JSON.parse(get.body)), ['uiVersion']);
  assert.deepEqual([...routes.keys()].filter(k => k.startsWith('GET ')), ['GET /api/context']);
  for (const path of ['/api/context', '/api/settings', '/api/version', '/api/update', '/api/fix-cdp-shortcut', '/_sidecar/new-conversation', '/_sidecar/send-message', '/_sidecar/get-conversation-metadata']) {
    assert.ok(routes.has('POST ' + path), path);
  }
});
