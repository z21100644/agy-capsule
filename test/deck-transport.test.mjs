import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDeckInjector, buildRuntimeBundle, createComposerOriginResolver } from '../agy-capsule/sidecars/agy_capsule/deck_injector.mjs';
import { hostFixture } from './cdp-host-fixture.mjs';

test('composer discovery verifies the sidecar credential with the local LS, caches success and backs off after rejection', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-ls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { env } = hostFixture(dir);
  let now = 100, calls = 0, accepted = false;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    calls++;
    assert.equal(url, 'http://' + env.ANTIGRAVITY_LS_ADDRESS + '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary');
    assert.equal(opts.method, 'POST'); assert.equal(opts.redirect, 'error');
    assert.equal(opts.headers['x-codeium-csrf-token'], 'fixture-session');
    return new Response(null, { status: accepted ? 200 : 403 });
  });
  const resolve = createComposerOriginResolver([join(dir, 'absent'), dir], env, () => now);
  assert.equal(await resolve(), null);
  now += 3999; assert.equal(await resolve(), null); assert.equal(calls, 1);
  now++; assert.equal(await resolve(), null); assert.equal(calls, 2);
  accepted = true; now += 7999; assert.equal(await resolve(), null); assert.equal(calls, 2);
  now++; assert.equal(await resolve(), 'https://127.0.0.1:5351');
  now += 60000; assert.equal(await resolve(), 'https://127.0.0.1:5351'); assert.equal(calls, 3);
  env.ANTIGRAVITY_LS_ADDRESS = '127.0.0.1:5352'; accepted = false;
  assert.equal(await resolve(), null); assert.equal(calls, 4);
  env.ANTIGRAVITY_LS_ADDRESS = 'example.invalid:5352';
  assert.equal(await resolve(), null); assert.equal(calls, 4);
});

test('CDP installs code once, skips unchanged payloads, updates on navigation, and releases closed pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-cdp-'));
  const file = join(dir, 'port'); writeFileSync(file, '12345\n');
  const fixture = hostFixture(dir);
  const originals = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, now: Date.now };
  const owner = Date.now(), hash = buildRuntimeBundle(owner).hash;
  let now = owner, installed = false, path = '/', pageExists = true, hasFooter = true, inspections = 0, injections = 0, pushes = 0, lists = 0, next = { contextTokens: 100 };
  let allowInstall = true, allowApply = true;
  let modelStates = {};
  const connections = [];
  const origin = 'https://127.0.0.1:5351';
  const emitContext = (socket, origin, uniqueId) => socket.onmessage({ data: JSON.stringify({
    method: 'Runtime.executionContextCreated', params: { context: { origin, uniqueId, auxData: { isDefault: true, frameId: 'frame' } } },
  }) });
  class FakeSocket {
    constructor(url) { this.id = new URL(url).pathname.split('/').at(-1); this.readyState = 0; connections.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(raw) {
      const { id, method, params: { expression, uniqueContextId } } = JSON.parse(raw);
      if (method !== 'Runtime.evaluate') {
        const result = method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'frame' } } } : {};
        if (method === 'Runtime.enable') emitContext(this, origin, 'document-1');
        this.onmessage({ data: JSON.stringify({ id, result }) }); return;
      }
      assert.equal(uniqueContextId, 'document-1');
      let value;
      if (expression.includes('function installRuntime')) { injections++; installed = allowInstall; value = installed; }
      else if (expression.includes('.readState(')) value = installed ? { owner, hash, path, hasFooter, ...modelStates[this.id] } : null;
      else if (expression.includes('.apply(')) { pushes++; value = allowApply; }
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id, result: { result: { value } } }) }));
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
  }
  globalThis.WebSocket = FakeSocket;
  Date.now = () => now;
  const target = (id, url, ws = 'ws://127.0.0.1:12345') => ({ id, type: 'page', url, webSocketDebuggerUrl: ws + '/devtools/page/' + id });
  let mixed = false, inspectFails = false;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/RetrieveUserQuotaSummary')) return { ok: options.headers['x-codeium-csrf-token'] === 'fixture-session' };
    lists++; return { ok: true, json: async () => pageExists ? [
    target('page', origin + '/'), target('preview', 'https://127.0.0.1:7777/'), target('other-socket', origin + '/', 'ws://127.0.0.1:7777'),
    ...(mixed ? [target('second-page', origin + '/')] : []),
  ] : [] }; };
  let injector;
  try {
    let navigateWhileReading = false;
    injector = startDeckInjector(async () => {
      inspections++;
      if (inspectFails) throw new Error('data unavailable');
      if (navigateWhileReading) emitContext(connections[0], 'https://127.0.0.1:7777', 'preview-document');
      return next;
    }, { ...fixture, portFile: file, instanceTs: owner });
    await injector.tick(); assert.equal(injections, 1); assert.equal(pushes, 1);
    assert.equal(injector.status(), 'ok', 'distinct hub and sidecar credentials work when the LS accepts the sidecar');
    await injector.tick(); assert.equal(injections, 1); assert.equal(pushes, 1); assert.equal(lists, 1);
    const count = inspections; hasFooter = false; await injector.tick(); assert.equal(inspections, count, 'Non-composer windows must not change the selected conversation'); hasFooter = true;
    next = { contextTokens: 200 }; await injector.tick(); assert.equal(pushes, 2);
    path = '/c/00000000-0000-0000-0000-000000000000'; await injector.tick(); assert.equal(pushes, 3);
    assert.equal(connections.length, 1, 'only the verified composer and its own debugger socket are eligible');
    next = { contextTokens: 300 }; navigateWhileReading = true;
    await injector.tick(); assert.equal(pushes, 3, 'navigation while inspecting must discard the pending payload');
    const beforePreview = inspections; await injector.tick(); assert.equal(inspections, beforePreview);
    navigateWhileReading = false;
    now += 5000; pageExists = false; await injector.tick(); assert.equal(connections[0].readyState, 3);
    pageExists = true; installed = false; now += 5000; await injector.tick(); assert.equal(injections, 2);
    hasFooter = false; await injector.tick();
    now += 59_999; await injector.tick(); assert.equal(injector.status(), 'ok');
    now++; await injector.tick(); assert.equal(injector.status(), 'no-anchor');
    hasFooter = true; await injector.tick(); assert.equal(injector.status(), 'ok');
    const socket = connections.at(-1), originalSend = socket.send;
    socket.send = function(raw) {
      const { id } = JSON.parse(raw);
      this.onmessage({ data: JSON.stringify({ id, error: { message: 'unavailable' } }) });
    };
    await injector.tick(); await injector.tick(); assert.equal(injector.status(), 'ok');
    await injector.tick(); assert.equal(injector.status(), 'inject-failed');
    mixed = true; now += 5000;
    for (let i = 0; i < 3; i++) { await injector.tick(); assert.equal(injector.status(), 'ok', 'one working page clears F4'); }
    mixed = false; now += 5000;
    socket.send = originalSend; await injector.tick(); assert.equal(injector.status(), 'ok');
    inspectFails = true;
    for (let i = 0; i < 3; i++) { await injector.tick(); assert.equal(injector.status(), 'ok', 'data failures are not F4'); }
    inspectFails = false;
    fixture.env.ANTIGRAVITY_CSRF_TOKEN = 'different-session'; now += 5000;
    const readsBefore = inspections; await injector.tick();
    assert.equal(injector.status(), 'unverified'); assert.equal(inspections, readsBefore);
    fixture.env.ANTIGRAVITY_CSRF_TOKEN = 'fixture-session'; now += 5000;
    await injector.tick(); assert.equal(injector.status(), 'ok');
    installed = false; allowInstall = false;
    for (let i = 0; i < 3; i++) await injector.tick();
    assert.equal(injector.status(), 'inject-failed', 'unsuccessful installation counts toward F4');
    allowInstall = true; await injector.tick(); assert.equal(injector.status(), 'ok');
    next = { contextTokens: 400 }; allowApply = false;
    for (let i = 0; i < 3; i++) await injector.tick();
    assert.equal(injector.status(), 'inject-failed', 'unsuccessful data application counts toward F4');
    allowApply = true; await injector.tick(); assert.equal(injector.status(), 'ok');
    // Closing a socket must flush its pending evaluation instead of waiting 3s.
    connections.at(-1).send = function () { this.close(); };
    let timeout;
    try { await Promise.race([injector.tick(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Pending evaluation was not released')), 300); })]); }
    finally { clearTimeout(timeout); }

    // A settings sidebar must use the options from its conversation, not the last composer polled.
    const first = '11111111-1111-1111-1111-111111111111';
    const second = '22222222-2222-2222-2222-222222222222';
    modelStates = {
      page: { path: '/c/' + first, modelConversationId: first, modelFamilies: ['Argon'] },
      'second-page': { path: '/c/' + second, modelConversationId: second, modelFamilies: ['Claude'] },
    };
    mixed = true; now += 5000; await injector.tick();
    assert.deepEqual(injector.models(first), ['Argon']);
    assert.deepEqual(injector.models(second), ['Claude']);
    assert.deepEqual(injector.models(), [], 'a sidebar with no conversation must not inherit another page');

    modelStates['second-page'].modelConversationId = first;
    await injector.tick();
    assert.deepEqual(injector.models(second), [], 'ignore a retained selector from a different conversation');
    assert.deepEqual(injector.models(first), ['Argon']);
    pageExists = false; now += 5000; await injector.tick();
    assert.deepEqual(injector.models(first), [], 'closed composers do not leave a stale model list');
  } finally {
    await injector?.stop();
    globalThis.fetch = originals.fetch; globalThis.WebSocket = originals.WebSocket; Date.now = originals.now;
    rmSync(dir, { recursive: true, force: true });
  }
});
