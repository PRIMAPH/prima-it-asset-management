// RUN_EMPLOYEE_MYSQL_TEST=1 node --test tests/employee-delete-mysql.test.cjs
// Uses a uniquely named local test database; never changes application records.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mysql = require('mysql2/promise');
const { archiveEmployee, RETURN_REASON } = require('../services/employee-deletion');
const { returnAssignment } = require('../services/asset-return');
const source = fs.readFileSync('server.js', 'utf8').replace(/\r\n/g, '\n');
function endpoint(start, end, method, pool) {
  let handler;
  vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), {
    app: { [method](...args) { handler = args.at(-1); } }, requireAdmin() {}, requireLogin() {}, pool, returnAssignment, console
  });
  return async (id, body = {}, query = {}) => {
    let status = 200, data;
    await handler({ params: { id }, body, query, session: { user: { id: 1, role: 'admin' } } }, {
      status(n) { status = n; return this; }, json(value) { data = value; }
    });
    return { status, data };
  };
}
test('employee deletion on isolated real MySQL', { skip: process.env.RUN_EMPLOYEE_MYSQL_TEST !== '1' }, async t => {
  const env = require('dotenv').parse(fs.readFileSync('.env'));
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST || 'localhost'));
  const config = { host: env.DB_HOST || 'localhost', user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', multipleStatements: true };
  const setup = await mysql.createConnection(config);
  const database = 'prima_employee_delete_test_' + Date.now();
  let pool, created = false, counter = 0;
  try {
    await setup.query('CREATE DATABASE ??', [database]); created = true;
    await setup.query('USE ??', [database]);
    await setup.query(fs.readFileSync('database/schema.sql', 'utf8').replace(/CREATE DATABASE[^;]*;/, '').replace(/USE prima_asset_management;/, ''));
    const migration = fs.readFileSync('migrations/004_employee_archival.sql', 'utf8').replace(/^\uFEFF/, '');
    await setup.query(migration);
    await setup.query(migration); // Safe to rerun.
    await setup.query("INSERT INTO users (id, full_name, username, password_hash, role) VALUES (1,'Admin','admin','unused','admin')");
    pool = mysql.createPool({ ...config, database, connectionLimit: 5 });
    const employeeList = endpoint("app.get('/api/employees',", "app.get('/api/custodians',", 'get', pool);
    const custodians = endpoint("app.get('/api/custodians',", '// GET ONE CUSTODIAN', 'get', pool);
    const dashboard = endpoint("app.get('/api/dashboard/summary',", "app.get('/dashboard',", 'get', pool);
    const assign = endpoint("app.post(\n  '/api/assets/assign',", '// RETURN ASSET FROM EMPLOYEE', 'post', pool);
    const normalReturn = endpoint("app.post('/api/assets/:id/return',", "app.get('/api/departments',", 'post', pool);
    async function fixture(statuses = [], linked = false) {
      const code = 'DELETE-' + (++counter);
      const [insert] = await pool.query("INSERT INTO employees (employee_id,full_name,status) VALUES (?,?,'active')", [code, 'Employee ' + counter]);
      const id = insert.insertId, assets = [];
      for (const [index, status] of statuses.entries()) {
        const [asset] = await pool.query('INSERT INTO assets (asset_id,asset_name,serial_number,location_id,category_id,status) VALUES (?,?,?,?,?,?)', [code + '-' + index, 'Laptop', 'SERIAL-' + counter + '-' + index, index % 2 + 1, 1, status]);
        assets.push(asset.insertId);
        await pool.query("INSERT INTO asset_assignments (asset_id,employee_id,remarks) VALUES (?,?,'Original assignment notes')", [asset.insertId, id]);
        await pool.query("INSERT INTO asset_history (asset_id,action,to_employee_id) VALUES (?,'Assigned',?)", [asset.insertId, id]);
      }
      if (linked) await pool.query("INSERT INTO users (employee_id,full_name,username,password_hash) VALUES (?,? ,?,'unused')", [code, code, code]);
      await pool.query('INSERT INTO custodian_forms (form_number,employee_id) VALUES (?,?)', [code, id]);
      return { id, code, assets };
    }
    for (const count of [0, 1, 3]) await t.test(`delete with ${count} assets preserves records and updates lists/dashboard`, async () => {
      const f = await fixture(Array(count).fill('Assigned'), true);
      const [beforeAssets] = await pool.query('SELECT * FROM assets WHERE id IN (?)', [f.assets.length ? f.assets : [0]]);
      const before = (await dashboard()).data;
      const result = await archiveEmployee(pool, f.id, 1);
      assert.equal(result.returned_count, count);
      assert.match(result.message, count ? /existing locations/ : /No assigned assets/);
      const [[employee]] = await pool.query('SELECT * FROM employees WHERE id=?', [f.id]);
      assert.ok(employee.deleted_at); assert.equal(employee.status, 'inactive');
      const [assignments] = await pool.query('SELECT * FROM asset_assignments WHERE employee_id=?', [f.id]);
      assert.equal(assignments.length, count);
      for (const assignment of assignments) { assert.ok(assignment.returned_at); assert.equal(assignment.return_remarks, RETURN_REASON); assert.equal(assignment.remarks, 'Original assignment notes'); }
      for (const original of beforeAssets) {
        const [[asset]] = await pool.query('SELECT * FROM assets WHERE id=?', [original.id]);
        for (const key of Object.keys(original).filter(key => !['status', 'updated_at'].includes(key))) assert.deepEqual(asset[key], original[key]);
        assert.equal(asset.status, 'Available');
        const [history] = await pool.query('SELECT * FROM asset_history WHERE asset_id=? ORDER BY id', [asset.id]);
        assert.equal(history.length, 2); assert.equal(history[1].remarks, RETURN_REASON); assert.equal(history[1].from_employee_id, f.id);
      }
      assert.equal((await pool.query('SELECT * FROM custodian_forms WHERE employee_id=?', [f.id]))[0].length, 1);
      assert.equal((await pool.query('SELECT status FROM users WHERE employee_id=?', [f.code]))[0][0].status, 'inactive');
      for (const result of [await employeeList(), await employeeList(null, {}, {status:'inactive'}), await custodians()]) {
        assert.equal(result.status, 200); assert.ok(!result.data.some(e => e.id === f.id));
      }
      const after = (await dashboard()).data;
      assert.equal(Number(after.available), Number(before.available) + count);
      assert.equal(Number(after.assigned), Number(before.assigned) - count);
      assert.equal(after.total_assets, before.total_assets);
      assert.equal((await pool.query("SELECT * FROM audit_logs WHERE action='DELETE' AND entity_id=?", [String(f.id)]))[0].length, 1);
    });
    await t.test('exceptional statuses remain unchanged', async () => {
      const statuses = ['Lost', 'Disposed', 'For Repair', 'Repairing', 'Broken', 'Retired'];
      const f = await fixture(statuses);
      const result = await archiveEmployee(pool, f.id, 1);
      assert.equal(result.returned_count, statuses.length); assert.equal(result.preserved_statuses.length, statuses.length);
      for (let i=0;i<f.assets.length;i++) assert.equal((await pool.query('SELECT status FROM assets WHERE id=?', [f.assets[i]]))[0][0].status, statuses[i]);
    });
    await t.test('failure after returns and archival rolls back every change', async () => {
      const f = await fixture(['Assigned', 'Assigned'], true);
      const wrapped = { async getConnection() {
        const c = await pool.getConnection();
        return { beginTransaction: () => c.beginTransaction(), commit: () => c.commit(), rollback: () => c.rollback(), release: () => c.release(),
          query(sql, args) { if (sql.includes("'DELETE', 'employee'")) throw Error('Injected audit failure'); return c.query(sql,args); } };
      } };
      await assert.rejects(archiveEmployee(wrapped, f.id, 1), /Injected audit failure/);
      assert.equal((await pool.query('SELECT deleted_at FROM employees WHERE id=?', [f.id]))[0][0].deleted_at, null);
      assert.equal((await pool.query('SELECT status FROM users WHERE employee_id=?', [f.code]))[0][0].status, 'active');
      assert.equal((await pool.query('SELECT * FROM asset_assignments WHERE employee_id=? AND returned_at IS NULL', [f.id]))[0].length, 2);
      assert.equal((await pool.query("SELECT * FROM assets WHERE id IN (?) AND status='Assigned'", [f.assets]))[0].length, 2);
      assert.equal((await pool.query("SELECT * FROM asset_history WHERE asset_id IN (?) AND action='Asset Returned'", [f.assets]))[0].length, 0);
    });
    await t.test('concurrent duplicate deletion returns assets only once', async () => {
      const f=await fixture(['Assigned']);
      const results=await Promise.allSettled([archiveEmployee(pool,f.id,1),archiveEmployee(pool,f.id,1)]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal((await pool.query("SELECT * FROM asset_history WHERE asset_id=? AND action='Asset Returned'",[f.assets[0]]))[0].length,1);
    });
    await t.test('conflicting assignments and self deletion are rejected', async () => {
      const f=await fixture(['Assigned']);
      await pool.query('INSERT INTO asset_assignments (asset_id,employee_id) VALUES (?,?)',[f.assets[0],f.id]);
      await assert.rejects(archiveEmployee(pool,f.id,1), /conflicting assignments/);
      await pool.query('UPDATE users SET employee_id=? WHERE id=1',[f.code]);
      await assert.rejects(archiveEmployee(pool,f.id,1), /own account/);
      await pool.query('UPDATE users SET employee_id=NULL WHERE id=1');
    });
    await t.test('assignment started during deletion cannot assign to the archived employee', async () => {
      const f=await fixture([]);
      const [asset]=await pool.query("INSERT INTO assets (asset_id,asset_name,status) VALUES ('RACE-ASSET','Laptop','Available')");
      let locked, release;
      const reachedLock=new Promise(resolve=>{locked=resolve;});
      const resume=new Promise(resolve=>{release=resolve;});
      const wrapped={async getConnection(){
        const c=await pool.getConnection();
        return {beginTransaction:()=>c.beginTransaction(),commit:()=>c.commit(),rollback:()=>c.rollback(),release:()=>c.release(),
          async query(sql,args){const result=await c.query(sql,args);if(sql==='SELECT * FROM employees WHERE id = ? FOR UPDATE'){locked();await resume;}return result;}};
      }};
      const deleting=archiveEmployee(wrapped,f.id,1);
      await reachedLock;
      const assigning=assign(null,{asset_ids:[asset.insertId],employee_id:f.id});
      release();
      await deleting;
      assert.equal((await assigning).status,404);
      assert.equal((await pool.query('SELECT * FROM asset_assignments WHERE employee_id=?',[f.id]))[0].length,0);
      assert.equal((await pool.query('SELECT status FROM assets WHERE id=?',[asset.insertId]))[0][0].status,'Available');
    });
    await t.test('existing normal return still preserves location and closes assignment', async () => {
      const f=await fixture(['Assigned']);
      const result=await normalReturn(f.assets[0],{remarks:'Normal return'});
      assert.equal(result.status,200);
      const [[asset]]=await pool.query('SELECT status,location_id FROM assets WHERE id=?',[f.assets[0]]);
      assert.equal(asset.status,'Available'); assert.equal(asset.location_id,1);
    });
  } finally {
    if (pool) await pool.end();
    if (created) await setup.query('DROP DATABASE ??', [database]);
    await setup.end();
  }
});
