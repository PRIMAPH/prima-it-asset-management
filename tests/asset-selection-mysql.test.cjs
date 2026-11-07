const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mysql = require('mysql2/promise');
const { assignAssets } = require('../services/asset-assignment');

test('bulk assignment is atomic for missing or unavailable selections', { skip: process.env.RUN_ASSET_MYSQL_TEST !== '1' }, async () => {
  const env = require('dotenv').parse(fs.readFileSync('.env'));
  const host = env.DB_HOST || 'localhost';
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host));
  const config = { host, user: env.DB_USER || 'root', password: env.DB_PASSWORD || '' };
  const admin = await mysql.createConnection({ ...config, multipleStatements: true });
  const database = 'prima_selection_test_' + Date.now();
  let pool;
  try {
    await admin.query('CREATE DATABASE ??', [database]);
    await admin.query('USE ??', [database]);
    await admin.query(fs.readFileSync('database/schema.sql', 'utf8').replace(/CREATE DATABASE[^;]*;/, '').replace(/USE prima_asset_management;/, ''));
    await admin.query(fs.readFileSync('migrations/004_employee_archival.sql', 'utf8'));
    await admin.query("INSERT INTO users (id,full_name,username,password_hash,role) VALUES (1,'Admin','selection-test','unused','admin')");
    await admin.query("INSERT INTO employees (id,employee_id,full_name,status) VALUES (1,'TEST','Test Employee','active')");
    await admin.query("INSERT INTO assets (id,asset_id,asset_name,status) VALUES (7,'PRIMA-2026-000133','Laptop','Available'),(12,'PRIMA-2026-000129','Monitor','Assigned')");
    pool = mysql.createPool({ ...config, database });
    let handler;
    const source = fs.readFileSync('server.js', 'utf8').replace(/\r\n/g, '\n');
    const start = source.indexOf("app.post(\n  '/api/assets/assign',");
    vm.runInNewContext(source.slice(start, source.indexOf('// RETURN ASSET FROM EMPLOYEE', start)), {
      app: { post(path, auth, fn) { handler = fn; } }, requireAdmin() {}, pool, assignAssets, console: { error() {} }
    });
    async function assign(ids) {
      let status = 200, result;
      await handler({ body: { asset_ids: ids, employee_id: 1 }, session: { user: { id: 1, role: 'admin' } } }, {
        status(n) { status = n; return this; }, json(value) { result = value; }
      });
      return { status, result };
    }
    for (const ids of [[7,12], [7,999999]]) {
      assert.ok((await assign(ids)).status >= 400);
      assert.equal((await pool.query('SELECT status FROM assets WHERE id=7'))[0][0].status, 'Available');
      for (const table of ['asset_assignments', 'asset_history', 'audit_logs']) {
        assert.equal((await pool.query('SELECT COUNT(*) AS total FROM ' + table))[0][0].total, 0);
      }
    }
    await pool.query("UPDATE assets SET status='Available' WHERE id=12");
    const successful = await assign([7,12]);
    assert.equal(successful.status, 200);
    assert.equal(successful.result.assigned, 2);
    assert.deepEqual((await pool.query('SELECT asset_id FROM asset_assignments ORDER BY asset_id'))[0].map(a => a.asset_id), [7,12]);
    assert.ok((await assign([7,12])).status >= 400);
    assert.equal((await pool.query('SELECT COUNT(*) AS total FROM asset_assignments'))[0][0].total, 2);
  } finally {
    if (pool) await pool.end();
    await admin.query('DROP DATABASE IF EXISTS ??', [database]);
    await admin.end();
  }
});
