// Explicit opt-in; all writes are confined to a newly created local test database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mysql = require('mysql2/promise');
const { allocateAssetId, previewAssetId } = require('../services/asset-id');
const { assignAssets } = require('../services/asset-assignment');

test('local database: previews, concurrent allocation, retries, rollback and preservation', {
  skip: process.env.RUN_ASSET_MYSQL_TEST !== '1'
}, async () => {
  const env = require('dotenv').parse(fs.readFileSync('.env'));
  const host = env.DB_HOST || 'localhost';
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host), 'Local database only');
  const config = { host, user: env.DB_USER || 'root', password: env.DB_PASSWORD || '' };
  const admin = await mysql.createConnection({ ...config, multipleStatements: true });
  const database = 'prima_asset_id_test_' + Date.now();
  let pool, server;
  try {
    await admin.query('CREATE DATABASE ??', [database]);
    await admin.query('USE ??', [database]);
    const schema = fs.readFileSync('database/schema.sql', 'utf8')
      .replace(/CREATE DATABASE[^;]*;/, '').replace(/USE prima_asset_management;/, '');
    await admin.query(schema);
    const [[{ year }]] = await admin.query('SELECT YEAR(CURRENT_DATE()) AS year');
    const tag = n => `PRIMA-${year}-${String(n).padStart(6, '0')}`;
    await admin.query("INSERT INTO assets (asset_id, asset_name) VALUES (?, 'Existing asset'), ('LEGACY-42', 'Legacy asset')", [tag(105)]);
    const [original] = await admin.query('SELECT * FROM assets ORDER BY id');
    const migration = fs.readFileSync('migrations/005_asset_id_allocation.sql', 'utf8');
    await admin.query(migration);
    await admin.query(migration); // Repeatable and never lowers the counter.
    const [user] = await admin.query("INSERT INTO users (full_name,username,password_hash,role) VALUES ('Test','asset-test','unused','admin')");
    pool = mysql.createPool({ ...config, database, connectionLimit: 16 });
    const app = require('express')();
    app.use(require('express').json());
    app.use((req, res, next) => { req.session = { user: { id: user.insertId, role: 'admin' } }; next(); });
    const source = fs.readFileSync('server.js', 'utf8');
    vm.runInNewContext(source.slice(source.indexOf("app.get('/api/assets/next-id',"), source.indexOf("app.get('/api/assets/:id'")), {
      app, requireLogin(req, res, next) { next(); }, pool, allocateAssetId, previewAssetId, assignAssets,
      console: { error() {} }
    });
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = 'http://127.0.0.1:' + server.address().port;
    async function save(body) {
      const response = await fetch(base + '/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, result: await response.json() };
    }
    for (let i = 0; i < 2; i++) {
      const response = await fetch(base + '/api/assets/next-id');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { asset_id: tag(106) });
    }
    const [a, b] = await Promise.all([previewAssetId(pool), previewAssetId(pool)]);
    assert.equal(a, tag(106)); assert.equal(b, a);
    assert.equal((await previewAssetId(pool)), a);
    const first = await save({ asset_name: 'User A', creation_request_id: 'request-user-a-0001' });
    const second = await save({ asset_name: 'User B', creation_request_id: 'request-user-b-0001' });
    assert.equal(first.status, 201); assert.equal(first.result.asset_id, tag(106));
    assert.equal(second.status, 201); assert.equal(second.result.asset_id, tag(107));
    const concurrent = await Promise.all(Array.from({ length: 16 }, (_, i) =>
      save({ asset_name: `Concurrent ${i}`, creation_request_id: `request-concurrent-${i}` })));
    assert.ok(concurrent.every(r => r.status === 201), JSON.stringify(concurrent));
    assert.equal(new Set(concurrent.map(r => r.result.asset_id)).size, 16);
    const retries = await Promise.all(Array.from({ length: 12 }, () =>
      save({ asset_name: 'Retry', creation_request_id: 'request-retry-0001' })));
    assert.equal(retries.filter(r => r.status === 201).length, 1);
    assert.equal(retries.filter(r => r.status === 200).length, 11);
    assert.equal(new Set(retries.map(r => r.result.id)).size, 1);
    const beforeFailure = await previewAssetId(pool);
    assert.equal((await save({ asset_name: '' })).status, 400);
    assert.ok((await save({ asset_name: 'Invalid FK', category_id: 999999, creation_request_id: 'request-invalid-001' })).status >= 400);
    assert.equal(await previewAssetId(pool), beforeFailure);
    assert.equal((await save({ asset_name: 'Corrected', creation_request_id: 'request-invalid-001' })).status, 201);
    // Bulk import uses the same allocator inside its transaction. Race that path with a modal save.
    const importConnection = await pool.getConnection();
    try {
      await importConnection.beginTransaction();
      const importedTag = await allocateAssetId(importConnection);
      await importConnection.query("INSERT INTO assets (asset_id,asset_name) VALUES (?, 'Imported')", [importedTag]);
      const saving = save({ asset_name: 'During import', creation_request_id: 'request-during-import' });
      await importConnection.commit();
      const saved = await saving;
      assert.equal(saved.status, 201); assert.notEqual(saved.result.asset_id, importedTag);
    } finally { importConnection.release(); }
    assert.deepEqual((await pool.query('SELECT * FROM assets WHERE id IN (1,2) ORDER BY id'))[0], original);
    const [[counts]] = await pool.query('SELECT COUNT(*) AS total, COUNT(DISTINCT asset_id) AS unique_ids FROM assets');
    assert.equal(counts.total, 24); assert.equal(counts.unique_ids, counts.total);
    await admin.query(migration);
    assert.equal(await previewAssetId(pool), tag(128));
    // Duplicate IDs are rejected at the database boundary, regardless of writer.
    await assert.rejects(pool.query("INSERT INTO assets (asset_id,asset_name) VALUES (?, 'Duplicate')", [tag(106)]), { code: 'ER_DUP_ENTRY' });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    // Only the scratch database named above is removed; application records are untouched.
    await admin.query('DROP DATABASE IF EXISTS ??', [database]);
    await admin.end();
  }
});
