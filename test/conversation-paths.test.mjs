import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function chat(productRoot, id, tokens) {
  const dir = join(productRoot, 'conversations');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, id + '.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE gen_metadata(idx, data); CREATE TABLE steps(idx, step_type, status, metadata)');
    // gen_metadata -> model call -> usage -> uncached input (a one-byte count).
    db.prepare('INSERT INTO gen_metadata VALUES(0, ?)').run(Buffer.from([10, 4, 34, 2, 16, tokens]));
  } finally { db.close(); }
  return path;
}

test('conversation statistics follow the host or the requested chat, never an unrelated recent DB', async t => {
  const home = mkdtempSync(join(tmpdir(), 'agy-paths-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  for (const key of ['HOME', 'USERPROFILE', 'ANTIGRAVITY_LS_ADDRESS', 'ANTIGRAVITY_EXECUTABLE_DATA_DIR']) {
    const old = process.env[key];
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  process.env.HOME = process.env.USERPROFILE = home;
  delete process.env.ANTIGRAVITY_LS_ADDRESS;
  delete process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  const desktop = join(home, '.gemini', 'antigravity');
  const ide = join(home, '.gemini', 'antigravity-ide');
  const cli = join(home, '.gemini', 'antigravity-cli');
  const custom = join(home, 'custom profile');
  const standalone = await import('../agy-capsule/sidecars/agy_capsule/server.mjs?standalone');
  const read = async (server, ...args) => (await server.inspectConversation(...args)).contextTokens;

  chat(cli, 'cli-only', 11);
  assert.equal(await read(standalone), 11, 'CLI alone can supply the startup fallback');
  const old = chat(desktop, 'old', 12);
  utimesSync(old, 1000, 1000);
  chat(desktop, 'same-id', 22);
  chat(ide, 'ide-only', 33);
  assert.equal(await read(standalone), 22, 'latest is scoped to the preferred product');
  assert.equal(await read(standalone, 'missing'), 0);
  assert.equal(await read(standalone, 'ide-only'), 33);
  assert.equal(await read(standalone, 'cli-only', true), 11);
  assert.equal(await read(standalone, 'same-id'), 11, 'sidebar follows the active composer');
  assert.equal(await read(standalone, '', true), 0);
  assert.equal(await read(standalone), 0, 'new chat stays empty');

  process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR = join(custom, 'sidecar_data', 'agy-capsule', 'agy_capsule', 'data');
  const hosted = await import('../agy-capsule/sidecars/agy_capsule/server.mjs?hosted');
  assert.equal(await read(hosted, 'same-id', true), 0, 'an uninitialized profile must not borrow another profile');
  chat(custom, 'same-id', 44);
  assert.equal(await read(hosted), 44, 'a DB created after startup is picked up');
  assert.equal(await read(hosted, 'cli-only', true), 0);
  process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR = custom;
  const direct = await import('../agy-capsule/sidecars/agy_capsule/server.mjs?direct');
  assert.equal(await read(direct, 'same-id'), 44);
});

test('a compacted chat uses the host estimate until a newer measured request is available', async t => {
  const root = mkdtempSync(join(tmpdir(), 'agy-compaction-'));
  const old = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    if (old === undefined) delete process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
    else process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR = old;
  });
  process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR = root;
  const { inspectConversation } = await import('../agy-capsule/sidecars/agy_capsule/server.mjs?compaction');
  const path = chat(root, 'chat', 99);
  const estimate = { tokens: 22, limit: 100, generatorMetadataIndex: 0 };
  const before = await inspectConversation('chat', true, false, estimate);
  assert.equal(before.contextTokens, 99);
  assert.deepEqual(before.contextEstimate, estimate);
  const db = new DatabaseSync(path);
  try { db.prepare('INSERT INTO gen_metadata VALUES(1, ?)').run(Buffer.from([10, 4, 34, 2, 16, 28])); }
  finally { db.close(); }
  const after = await inspectConversation('chat', true, false, estimate);
  assert.equal(after.contextTokens, 28);
  assert.equal(after.contextEstimate, undefined);
});
