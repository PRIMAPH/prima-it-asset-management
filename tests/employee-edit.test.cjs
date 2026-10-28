const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const puppeteer = require('puppeteer');
const source = fs.readFileSync('server.js', 'utf8');
const updateSource = source.slice(source.indexOf("app.put('/api/employees/:id'"), source.indexOf("app.delete('/api/employees/:id'"));
const createSource = source.slice(source.indexOf("app.post('/api/employees',"), source.indexOf('// EMPLOYEES - DELETE'));
const record = { id: 7, employee_id: 'EMP-7', full_name: 'Original Name', email: 'original@example.com', department_id: 2, position_title: 'Engineer', status: 'active' };
function api(options = {}, create = false) {
  const employee = { ...record }, assignments = [{ employee_id: 7, asset_id: 42 }], history = [{ to_employee_id: 7 }];
  const queries = [];
  let handler, middleware, committed = false, rolledBack = false, released = false;
  const connection = {
    async beginTransaction() {}, async commit() { committed = true; }, async rollback() { rolledBack = true; }, release() { released = true; },
    async query(sql, values) {
      queries.push([sql, values]);
      if (sql.includes('information_schema')) return [[{ TABLE_SCHEMA: 'test', TABLE_NAME: 'custom_links', COLUMN_NAME: 'employee_code' }]];
      if (/SELECT 1 FROM/.test(sql)) return [options.dependency ? [{ exists: 1 }] : []];
      if (/FROM users/.test(sql)) return [options.user ? [{ id: 1 }] : []];
      if (/FROM departments/.test(sql)) return [options.badDepartment ? [] : [{ id: 2 }]];
      if (/SELECT \* FROM employees/.test(sql)) return [options.missing ? [] : [{ ...employee }]];
      if (/SELECT id\s+FROM employees/.test(sql)) return [options.duplicate ? [{ id: 8 }] : []];
      if (/UPDATE employees/.test(sql)) {
        if (options.error) throw Object.assign(Error('DB failure'), { code: options.error });
        assert.equal(values[6], 7);
        Object.assign(employee, Object.fromEntries(['employee_id','full_name','email','department_id','position_title','status'].map((key,i)=>[key,values[i]])));
      } else if (/INSERT INTO employees/.test(sql)) return [{ insertId: 9 }];
      else if (!/INSERT INTO audit_logs/.test(sql)) throw Error('Unexpected query: ' + sql);
      return [{ affectedRows: 1 }];
    }
  };
  const context = { app: { put(path, auth, fn) { middleware = auth; handler = fn; }, post(path, auth, fn) { middleware = auth; handler = fn; } }, pool: { async getConnection() { return connection; } }, console: { error() {} }, sendLoginRequired(req,res) { return res.status(401).json({message:'Login required.'}); }, requireLogin(req,res,next) { next(); } };
  vm.runInNewContext(source.slice(source.indexOf('function requireAdmin('), source.indexOf('function requireMaintenanceStaff(')) + (create ? createSource : updateSource), context);
  return { employee, assignments, history, queries, async call(body = record, role = 'admin', id = '7') {
    let status = 200, result;
    const req = { body, params: { id }, session: { user: role ? { id: 1, role } : null } };
    const res = { status(value) { status = value; return this; }, json(value) { result = value; } };
    let allowed = false;
    middleware(req,res,()=>{ allowed=true; });
    if (allowed) await handler(req,res);
    return { status, result, committed, rolledBack, released };
  } };
}
test('update preserves primary key, asset assignments and history, and commits audit', async () => {
  const fixture = api();
  const result = await fixture.call({ ...record, employee_id: 'EMP-NEW', full_name: 'Changed', status: 'inactive' });
  assert.equal(result.status,200); assert.ok(result.committed && result.released);
  assert.equal(fixture.employee.id,7); assert.equal(fixture.employee.full_name,'Changed');
  assert.deepEqual(fixture.assignments,[{employee_id:7,asset_id:42}]); assert.deepEqual(fixture.history,[{to_employee_id:7}]);
  assert.ok(fixture.queries.some(([sql])=>sql.includes('INSERT INTO audit_logs')));
  assert.ok(fixture.queries.every(([sql])=>! /DELETE|REPLACE|UPDATE asset/.test(sql)));
});
test('duplicate, missing employee, invalid department and dependencies are rejected', async () => {
  for (const [options, body, status] of [
    [{duplicate:true},record,409], [{missing:true},record,404], [{badDepartment:true},record,400],
    [{dependency:true},{...record,employee_id:'NEW'},409], [{user:true},{...record,employee_id:'NEW'},409],
    [{error:'ER_DUP_ENTRY'},record,409], [{error:'ER_ROW_IS_REFERENCED_2'},record,409], [{error:'OTHER'},record,500]
  ]) {
    const fixture=api(options), result=await fixture.call(body);
    assert.equal(result.status,status); assert.ok(result.rolledBack && result.released); assert.equal(result.committed,false);
  }
  assert.equal((await api({user:true}).call({...record,full_name:'Allowed'})).status,200);
});
test('required fields, types, status, email and department are validated', async () => {
  for (const change of [{employee_id:' '},{full_name:''},{full_name:{}},{status:'other'},{email:'bad'},{department_id:'bad'},{employee_id:'a'.repeat(51)}]) {
    const fixture=api(); assert.equal((await fixture.call({...record,...change})).status,400); assert.equal(fixture.queries.length,0);
  }
  assert.equal((await api().call(record,'admin','invalid')).status,400);
});
test('non-admin and unauthenticated requests cannot edit', async () => {
  for (const role of ['viewer','it_staff',null]) {
    const fixture=api(); assert.equal((await fixture.call(record,role)).status,role ? 403 : 401); assert.equal(fixture.queries.length,0);
  }
});
test('existing Add API still inserts and commits', async () => {
  const result=await api({},true).call(record); assert.equal(result.status,201); assert.ok(result.committed);
});
test('browser: edit fields, PUT, refresh filters, duplicate submission, errors, Add reset and admin controls', async () => {
  const browser=await puppeteer.launch({headless:true,pipe:true});
  try {
    const page=await browser.newPage();
    await page.setRequestInterception(true); page.on('request',r=>r.abort());
    const html=fs.readFileSync('public/employees.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
    await page.setContent(html, {waitUntil:'domcontentloaded'});
    await page.addScriptTag({content:fs.readFileSync('public/js/employees.js','utf8').replace(/init\(\);\s*$/, '')});
    await page.evaluate(record=>{
      window.testRecord=record; window.calls=[];
      currentUser={role:'admin'};
      employeeModal={show(){window.opened=true;},hide(){window.opened=false;}};
      employeeViewModal={hide(){const v=$('employeeViewModal');v.classList.remove('show');v.dispatchEvent(new Event('hidden.bs.modal'));}};
      $('department').innerHTML='<option value=""></option><option value="2">IT</option>';
      $('departmentFilter').innerHTML='<option value="2">IT</option>';
      $('searchInput').value='Original'; $('statusFilter').value='active';
      window.fetch=async (url,options={})=>{
        calls.push({url,...options});
        if(options.method) {
          if(window.hold) await new Promise(resolve=>window.releaseSave=resolve);
          if(window.failSave) return {ok:false,json:async()=>({message:'Employee ID already exists.'})};
          Object.assign(testRecord,JSON.parse(options.body));
          return {ok:true,json:async()=>({message:'Saved',employee_id:testRecord.employee_id})};
        }
        return {ok:true,json:async()=>url.includes('?')?[testRecord]:testRecord};
      };
    },record);
    const loaded=await page.evaluate(async()=>{
      await editEmployee(7);
      return {title:$('employeeModalTitle').textContent,button:$('saveEmployeeBtn').textContent,fields:Object.fromEntries(new FormData($('employeeForm')))};
    });
    assert.equal(loaded.title,'Edit Employee'); assert.equal(loaded.button,'Save Changes');
    for(const key of ['employee_id','full_name','email','department_id','position_title','status']) assert.equal(loaded.fields[key],String(record[key]));
    await page.evaluate(async()=>{
      $('fullName').value='Changed'; window.hold=true;
      window.savePromise=saveEmployee({preventDefault(){},currentTarget:$('employeeForm')});
      await saveEmployee({preventDefault(){},currentTarget:$('employeeForm')});
    });
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.method).length),1);
    assert.equal(await page.$eval('#saveEmployeeBtn',b=>b.disabled),true);
    await page.evaluate(async()=>{releaseSave(); await savePromise;window.hold=false;});
    const calls=await page.evaluate(()=>window.calls);
    assert.equal(calls.find(c=>c.method).method,'PUT');
    assert.ok(calls.some(c=>c.url.includes('search=Original&department_id=2&status=active')));
    assert.match(await page.$eval('#employeeTableBody',e=>e.textContent),/Changed/);
    await page.evaluate(async()=>{await editEmployee(7);window.failSave=true;await saveEmployee({preventDefault(){},currentTarget:$('employeeForm')});});
    assert.match(await page.$eval('#employeeFormAlert',e=>e.textContent),/already exists/);
    await page.evaluate(async()=>{
      window.failSave=false; prepareEmployeeForm();
      if(editingEmployeeId!==null || $('fullName').value || $('employeeModalTitle').textContent!=='Add Employee') throw Error('Add did not reset');
      $('employeeId').value='ADD';$('fullName').value='New Employee';
      await saveEmployee({preventDefault(){},currentTarget:$('employeeForm')});
    });
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.method).at(-1).method),'POST');
    await page.evaluate(async()=>{
      currentUser={role:'viewer'}; renderEmployees(); const before=calls.length; await editEmployee(7);
      if(calls.length!==before || document.querySelector('.edit-employee-btn')) throw Error('Non-admin edit exposed');
      currentUser={role:'admin'}; $('employeeViewModal').classList.add('show'); await editEmployee(7);
      if(!window.opened || $('employeeViewModal').classList.contains('show')) throw Error('Modal transition failed');
    });
  } finally { await browser.close(); }
});
