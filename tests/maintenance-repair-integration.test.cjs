const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const express = require('express');
const mysql = require('mysql2/promise');

test('local MySQL: real repair POST with isolated disposable assets, assignments and history', async () => {
  const env = require('dotenv').parse(fs.readFileSync('.env'));
  const host = env.DB_HOST || 'localhost';
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host), 'Local database only');
  const originalDatabase = env.DB_NAME || 'prima_asset_management';
  const options = { host, user: env.DB_USER || 'root', password: env.DB_PASSWORD || '' };
  const original = await mysql.createConnection({ ...options, database: originalDatabase });
  const database = 'prima_repair_test_' + crypto.randomBytes(8).toString('hex');
  assert.match(database, /^prima_repair_test_[a-f0-9]{16}$/);
  assert.notEqual(database, originalDatabase);
  let created = false, pool, server;
  const originalTables = ['assets', 'asset_assignments', 'asset_repairs', 'asset_history', 'audit_logs'];
  const before = new Map();
  try {
    // Original application data is read only. All mutations target this uniquely named schema.
    for (const table of originalTables) before.set(table, (await original.query(`SELECT * FROM \`${table}\` ORDER BY id`))[0]);
    await original.query(`CREATE DATABASE \`${database}\``);
    created = true;
    pool = mysql.createPool({ ...options, database, connectionLimit: 4 });
    for (const table of ['departments', 'asset_categories', 'locations', 'employees', 'users', 'assets', 'asset_assignments', 'asset_repairs', 'asset_history', 'audit_logs']) {
      const [rows] = await original.query(`SHOW CREATE TABLE \`${table}\``);
      // Copy structure, including local foreign keys, but no existing records or counters.
      await pool.query(rows[0]['Create Table'].replace(/ AUTO_INCREMENT=\d+/g, ''));
    }
    await pool.query("INSERT INTO employees (id, employee_id, full_name) VALUES (1, 'TEST-EMP', 'Disposable Custodian')");
    await pool.query("INSERT INTO users (id, full_name, username, password_hash, role) VALUES (1, 'Disposable Tester', 'disposable_tester', 'test-only-not-a-password', 'admin')");
    const states = ['Available', 'Assigned', 'Available', 'Disposed', 'Retired', 'For Disposal', 'Available'];
    for (let index = 0; index < states.length; index++) {
      await pool.query('INSERT INTO assets (id, asset_id, asset_name, status) VALUES (?, ?, ?, ?)',
        [index + 1, 'TEST-2026-' + String(index + 1).padStart(6, '0'), 'Disposable asset ' + (index + 1), states[index]]);
    }
    await pool.query('INSERT INTO asset_assignments (asset_id, employee_id, assigned_by) VALUES (2, 1, 1)');
    await pool.query("INSERT INTO asset_repairs (repair_no, asset_id, problem_description, status) VALUES ('TEST-EXISTING-RETURNED', 7, 'Existing fixture repair', 'Returned')");
    const [existingRepairs] = await pool.query('SELECT * FROM asset_repairs ORDER BY id');
    const [assignments] = await pool.query('SELECT * FROM asset_assignments ORDER BY id');

    const source = fs.readFileSync('server.js', 'utf8');
    const app = express();
    const loggedErrors = [];
    app.use(express.json());
    app.use((req, res, next) => { req.session = { user: { id: 1, role: 'admin' } }; next(); });
    const context = { app, pool, console: { error(...args) { loggedErrors.push(args); } }, sendLoginRequired(req, res) { res.sendStatus(401); } };
    const authStart = source.indexOf('function requireMaintenanceStaff(');
    vm.runInNewContext(source.slice(authStart, source.indexOf("app.get('/',", authStart)), context);
    const start = source.indexOf("app.post('/api/repairs',");
    const end = source.indexOf("app.put('/api/repairs/:id',", start);
    assert.ok(start >= 0 && end > start);
    vm.runInNewContext(source.slice(start, end), context);
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    async function submit(assetId, extra = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/repairs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: assetId, problem_description: 'Disposable repair test', status: 'Under Repair', ...extra })
      });
      return { status: response.status, body: await response.json() };
    }
    for (const assetId of [undefined, 'TEST-2026-000001', 0, 99999]) assert.equal((await submit(assetId)).status, 400);
    assert.equal((await submit(1, { problem_description: '' })).status, 400);
    const available = await submit(1);
    const assigned = await submit(2, { parts_cost: 25, labor_cost: 10, vendor: 'Test service center' });
    assert.equal(available.status, 201);
    assert.equal(assigned.status, 201);
    assert.match(available.body.repair_no, /^REP-\d{4}-\d{6}$/);
    assert.notEqual(available.body.repair_no, assigned.body.repair_no);
    assert.equal(loggedErrors.length, 1, 'Only the deliberate missing-asset validation has been logged so far');
    const [saved] = await pool.query('SELECT * FROM asset_repairs WHERE id = ?', [assigned.body.id]);
    assert.equal(saved[0].asset_id, 2);
    assert.equal(saved[0].custodian_id, 1);
    assert.equal(saved[0].asset_previous_status, 'Assigned');
    assert.equal(Number(saved[0].total_cost), 35);
    assert.equal(saved[0].status, 'Under Repair');
    assert.equal((await pool.query('SELECT status FROM assets WHERE id = 2'))[0][0].status, 'Repairing');
    assert.deepEqual((await pool.query('SELECT * FROM asset_assignments ORDER BY id'))[0], assignments);
    const [history] = await pool.query('SELECT * FROM asset_history WHERE asset_id = 2');
    assert.equal(history.length, 1);
    assert.equal(history[0].action, 'Repair Reported');
    assert.equal(history[0].from_employee_id, 1);
    assert.equal(history[0].to_employee_id, 1);
    assert.equal((await pool.query("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'REPAIR_CREATE'"))[0][0].total, 2);
    const duplicate = await submit(1);
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.body.message, /already has an active repair/);
    for (const id of [4, 5, 6]) {
      const denied = await submit(id);
      assert.equal(denied.status, 400);
      assert.match(denied.body.message, /cannot be sent for repair/);
    }
    const concurrent = await Promise.all([submit(3), submit(3)]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 400]);
    assert.equal((await pool.query('SELECT COUNT(*) AS total FROM asset_repairs WHERE asset_id = 3'))[0][0].total, 1);
    assert.deepEqual((await pool.query('SELECT * FROM asset_repairs WHERE repair_no = ?', ['TEST-EXISTING-RETURNED']))[0], existingRepairs);
    assert.deepEqual((await pool.query('SELECT * FROM asset_assignments ORDER BY id'))[0], assignments);
    for (const table of originalTables) {
      assert.deepEqual((await original.query(`SELECT * FROM \`${table}\` ORDER BY id`))[0], before.get(table), `Original ${table} unchanged`);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (created) {
      // Only the exact randomly generated disposable schema may be removed.
      assert.match(database, /^prima_repair_test_[a-f0-9]{16}$/);
      assert.notEqual(database, originalDatabase);
      await original.query(`DROP DATABASE \`${database}\``);
    }
    await original.end();
  }
});
