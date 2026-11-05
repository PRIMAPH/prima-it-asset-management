const { getOthersDepartmentId } = require('../services/employee-department');
// Explicit opt-in: creates and drops only a uniquely named local test database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
test('real local MySQL: Add, Edit, duplicates, FKs and asset/history preservation', {skip:process.env.RUN_EMPLOYEE_MYSQL_TEST !== '1'}, async () => {
  const env=dotenv.parse(fs.readFileSync('.env'));
  assert.ok(['localhost','127.0.0.1','::1'].includes(env.DB_HOST||'localhost'), 'Only local MySQL is permitted');
  const connection=await mysql.createConnection({host:env.DB_HOST||'localhost',user:env.DB_USER||'root',password:env.DB_PASSWORD||'',multipleStatements:true});
  const database='prima_employee_test_'+Date.now();
  let created=false;
  try {
    await connection.query('CREATE DATABASE ??',[database]);created=true;
    await connection.query('USE ??',[database]);
    const schema=fs.readFileSync('database/schema.sql','utf8').replace(/CREATE DATABASE[^;]*;/,'').replace(/USE prima_asset_management;/,'');
    await connection.query(schema);
    await connection.query("INSERT INTO users (full_name,username,password_hash,role) VALUES ('Test Admin','edit-test','unused','admin')");
    const [[admin]]=await connection.query("SELECT id FROM users WHERE username='edit-test'");
    let create, update;
    const source=fs.readFileSync('server.js','utf8');
    const pool={async getConnection(){return {query:connection.query.bind(connection),beginTransaction:connection.beginTransaction.bind(connection),commit:connection.commit.bind(connection),rollback:connection.rollback.bind(connection),release(){}};}};
    const context={getOthersDepartmentId,pool,console,requireLogin(){},requireAdmin(){},app:{post(path,middleware,handler){create=handler;},put(path,middleware,handler){update=handler;}}};
    vm.runInNewContext(source.slice(source.indexOf("app.post('/api/employees',"),source.indexOf("app.put('/api/employees/:id'")),context);
    vm.runInNewContext(source.slice(source.indexOf("app.put('/api/employees/:id'"),source.indexOf("app.delete('/api/employees/:id'")),context);
    async function call(handler,body,id){let status=200,result;await handler({body,params:{id},session:{user:{id:admin.id,role:'admin'}}},{status(n){status=n;return this;},json(value){result=value;}});return {status,result};}
    const body={employee_id:'TEST-EMP',full_name:'Test Employee',email:'test@example.com',department_id:1,position_title:'Engineer',status:'active'};
    const added=await call(create,body);assert.equal(added.status,201);const id=added.result.id;
    await connection.query("INSERT INTO assets (asset_id,asset_name,status) VALUES ('TEST-ASSET','Laptop','Assigned')");
    const [[asset]]=await connection.query("SELECT id FROM assets WHERE asset_id='TEST-ASSET'");
    await connection.query('INSERT INTO asset_assignments (asset_id,employee_id) VALUES (?,?)',[asset.id,id]);
    await connection.query("INSERT INTO asset_history (asset_id,action,to_employee_id) VALUES (?,'ASSIGN',?)",[asset.id,id]);
    const [beforeAssignments]=await connection.query('SELECT * FROM asset_assignments');
    const [beforeHistory]=await connection.query('SELECT * FROM asset_history');
    const updated={...body,employee_id:'RENAMED',full_name:'Edited Employee',status:'inactive'};
    assert.equal((await call(update,updated,id)).status,200);
    const [[saved]]=await connection.query('SELECT * FROM employees WHERE id=?',[id]);
    assert.equal(saved.full_name,'Edited Employee');assert.equal(saved.employee_id,'RENAMED');assert.equal(saved.status,'inactive');
    assert.deepEqual((await connection.query('SELECT * FROM asset_assignments'))[0],beforeAssignments);
    assert.deepEqual((await connection.query('SELECT * FROM asset_history'))[0],beforeHistory);
    assert.equal((await call(create,{...body,employee_id:'DUPLICATE'})).status,201);
    assert.equal((await call(update,{...updated,employee_id:'DUPLICATE'},id)).status,409);
    assert.equal((await call(update,{...updated,department_id:999999},id)).status,400);
    await connection.query('UPDATE users SET employee_id=? WHERE id=?',['RENAMED',admin.id]);
    assert.equal((await call(update,{...updated,employee_id:'BLOCKED'},id)).status,409);
    assert.equal((await call(update,{...updated,position_title:'Manager'},id)).status,200);
    assert.equal((await connection.query("SELECT * FROM audit_logs WHERE action='UPDATE'"))[0].length,2);
    const [existingEmployees] = await connection.query('SELECT * FROM employees ORDER BY id');
    // Exercise missing Others, repeated defaults, explicit selections and real stored foreign keys.
    for (const name of ['Accounting', 'IT']) await connection.query('INSERT INTO departments (name) VALUES (?) ON DUPLICATE KEY UPDATE name = name', [name]);
    const [departmentRows] = await connection.query("SELECT id, name FROM departments WHERE name IN ('Accounting', 'IT')");
    // Simultaneous first-time resolution uses the existing unique-name constraint.
    const peers = await Promise.all([0, 1].map(() => mysql.createConnection({
      host: env.DB_HOST || 'localhost', user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', database
    })));
    try {
      const ids = await Promise.all(peers.map(peer => getOthersDepartmentId(peer)));
      assert.equal(ids[0], ids[1]);
      assert.ok(ids[0] > 0);
    } finally { await Promise.all(peers.map(peer => peer.end())); }
    let sequence = 0;
    for (const value of [undefined, null, '', '   ', ...departmentRows.map(row => row.id)]) {
      const input = { employee_id: 'DEFAULT-' + sequence++, full_name: 'Default Department Test' };
      if (value !== undefined) input.department_id = value;
      const result = await call(create, input);
      assert.equal(result.status, 201, JSON.stringify(result));
      const [[saved]] = await connection.query('SELECT e.department_id, d.name FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.id = ?', [result.result.id]);
      const expected = departmentRows.find(row => row.id === value);
      assert.equal(saved.name, expected ? expected.name : 'Others');
      const [[department]] = await connection.query('SELECT id FROM departments WHERE name = ?', [saved.name]);
      assert.equal(saved.department_id, department.id);
    }
    assert.equal((await connection.query("SELECT id FROM departments WHERE name = 'Others'"))[0].length, 1);
    assert.deepEqual((await connection.query('SELECT * FROM employees WHERE id IN (?) ORDER BY id', [existingEmployees.map(row => row.id)]))[0], existingEmployees);
    await connection.query("INSERT INTO employees (employee_id,full_name) VALUES ('LEGACY-BLANK','Legacy Blank')");
    const [[legacy]] = await connection.query("SELECT * FROM employees WHERE employee_id = 'LEGACY-BLANK'");
    const legacyBody = { employee_id: legacy.employee_id, full_name: legacy.full_name, status: 'active' };
    assert.equal((await call(update, legacyBody, legacy.id)).status, 200);
    assert.equal((await connection.query('SELECT department_id FROM employees WHERE id = ?', [legacy.id]))[0][0].department_id, null);
    assert.equal((await call(update, { ...legacyBody, department_id: '' }, legacy.id)).status, 200);
    assert.equal((await connection.query('SELECT d.name FROM employees e JOIN departments d ON d.id=e.department_id WHERE e.id=?', [legacy.id]))[0][0].name, 'Others');
    assert.deepEqual((await connection.query('SELECT * FROM asset_assignments'))[0], beforeAssignments);
    assert.deepEqual((await connection.query('SELECT * FROM asset_history'))[0], beforeHistory);

  } finally {
    if(created) await connection.query('DROP DATABASE ??',[database]);
    await connection.end();
  }
});
