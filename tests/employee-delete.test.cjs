const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const puppeteer = require('puppeteer');
const source = fs.readFileSync('server.js','utf8');

test('delete endpoint enforces admin authorization and validates primary key', async () => {
  let handler, guard, calls=0;
  const context={app:{delete(path,middleware,fn){guard=middleware;handler=fn;}},pool:{},console,
    archiveEmployee:async()=>{calls++;return {ok:true};},sendLoginRequired(req,res){return res.status(401).json({});}};
  vm.runInNewContext(source.slice(source.indexOf('function requireAdmin('),source.indexOf('function requireMaintenanceStaff('))+
    source.slice(source.indexOf("app.delete('/api/employees/:id'"),source.indexOf("app.get('/api/locations'")),context);
  for(const [role,id,expected] of [[null,'1',401],['viewer','1',403],['it_staff','1',403],['admin','bad',400],['admin','1',200]]){
    let status=200,allowed=false;
    const req={params:{id},session:{user:role?{id:2,role}:null}};
    const res={status(n){status=n;return this;},json(){}};
    guard(req,res,()=>{allowed=true;});if(allowed)await handler(req,res);
    assert.equal(status,expected);
  }
  assert.equal(calls,1);
});
test('disabled linked accounts lose existing sessions', async () => {
  let middleware;
  const context={app:{use(fn){middleware=fn;}},pool:{query:async()=>[[{status:'inactive'}]]},console,
    sendLoginRequired(req,res){res.denied=true;}};
  const start=source.indexOf('app.use(async (req, res, next) =>');
  vm.runInNewContext(source.slice(start,source.indexOf('app.use(express.static',start)),context);
  let destroyed=false,next=false;const res={};
  await middleware({session:{user:{id:4},destroy(cb){destroyed=true;cb();}}},res,()=>{next=true;});
  assert.equal(destroyed,true);assert.equal(res.denied,true);assert.equal(next,false);
});
test('browser: Delete confirmation, cancel, success, errors, double-submit and non-admin controls', async () => {
  const browser=await puppeteer.launch({headless:true,pipe:true});
  try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setRequestInterception(true);page.on('request',r=>r.abort());
    await page.setContent(fs.readFileSync('public/employees.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,''),{waitUntil:'domcontentloaded'});
    await page.addStyleTag({content:fs.readFileSync('public/vendor/bootstrap/bootstrap.min.css','utf8')});
    await page.addScriptTag({content:fs.readFileSync('public/vendor/bootstrap/bootstrap.bundle.min.js','utf8')});
    await page.evaluate(()=>{
      window.calls=[];window.testRole='admin';window.testDeleted=false;
      window.testEmployee={id:7,employee_id:'E7',full_name:'Test <Employee>',email:'test@example.com',department_id:2,position_title:'Engineer',status:'active'};
      window.fetch=async(url,options={})=>{
        calls.push({url,...options});let data;
        if(options.method==='DELETE'){
          if(window.holdDelete)await new Promise(resolve=>window.releaseDelete=resolve);
          if(window.deleteError)return {ok:false,json:async()=>({message:'Deletion failed. No changes were saved.'})};
          window.testDeleted=true;
          data={ok:true,returned_count:window.noAssets?0:2,preserved_statuses:[],message:window.noAssets?'Employee Test <Employee> has been deleted successfully. No assigned assets needed to be returned.':'Employee Test <Employee> has been deleted. 2 assigned asset(s) have been automatically returned to Inventory at their existing locations.'};
        }else if(url==='/api/auth/me')data={id:1,full_name:'Admin',role:testRole};
        else if(url==='/api/departments')data=[{id:2,name:'IT'}];
        else if(url.endsWith('/assets'))data=window.noAssets?[]:[{id:1,asset_id:'A1',status:'Assigned'},{id:2,asset_id:'A2',status:'Lost'}];
        else if(url.includes('/api/employees?'))data=testDeleted?[]:[testEmployee];
        else data=testEmployee;
        return {ok:true,json:async()=>data};
      };
    });
    await page.addScriptTag({content:fs.readFileSync('public/js/employees.js','utf8')});
    await page.waitForFunction(()=>document.querySelector('.delete-employee-btn'));
    await page.click('.delete-employee-btn');
    await page.waitForSelector('#employeeDeleteModal.show');
    assert.equal(await page.$eval('#deleteEmployeeName',e=>e.textContent),'Test <Employee>');
    assert.equal(await page.$eval('#deleteEmployeeAssetCount',e=>e.textContent),'2');
    assert.match(await page.$eval('#deleteEmployeeStatusNote',e=>e.textContent),/A2 \(Lost\)/);
    assert.equal(await page.$eval('#deleteEmployeeName',e=>e.children.length),0);
    await new Promise(resolve=>setTimeout(resolve,350));
    await page.click('#employeeDeleteModal .btn-secondary');
    await page.waitForFunction(()=>!document.getElementById('employeeDeleteModal').classList.contains('show'));
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.method==='DELETE').length),0);
    await new Promise(resolve=>setTimeout(resolve,350));
    // Open from Employee Details; real Bootstrap must finish hiding the view before showing confirmation.
    await page.evaluate(async()=>{await viewEmployee(7);});
    await page.waitForSelector('#employeeViewModal.show');
    await new Promise(resolve=>setTimeout(resolve,350));
    await page.click('#deleteEmployeeBtn');
    await page.waitForSelector('#employeeDeleteModal.show');
    await new Promise(resolve=>setTimeout(resolve,350));
    await page.evaluate(()=>{window.deleteError=true;});
    await page.click('#confirmDeleteEmployeeBtn');
    await page.waitForFunction(()=>document.getElementById('employeeDeleteAlert').textContent.includes('failed'));
    assert.equal(await page.$eval('#confirmDeleteEmployeeBtn',e=>e.disabled),false);
    await page.evaluate(()=>{
      $('searchInput').value='Test';$('departmentFilter').value='2';$('statusFilter').value='active';
      window.deleteError=false;window.holdDelete=true;window.deletion=confirmDeleteEmployee();confirmDeleteEmployee();
    });
    assert.equal(await page.$eval('#confirmDeleteEmployeeBtn',e=>e.disabled),true);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.method==='DELETE').length),2);
    await page.evaluate(async()=>{releaseDelete();await deletion;window.holdDelete=false;});
    await page.waitForSelector('#employeeDeleteSuccessModal.show');
    assert.match(await page.$eval('#employeeDeleteSuccessMessage',e=>e.textContent),/2 assigned asset/);
    assert.match(await page.$eval('#employeeTableBody',e=>e.textContent),/No employees/);
    assert.ok(await page.evaluate(()=>calls.some(c=>c.url.includes('search=Test&department_id=2&status=active'))));
    await new Promise(resolve=>setTimeout(resolve,350));
    await page.click('#employeeDeleteSuccessModal .btn-primary');
    await page.waitForFunction(()=>!document.getElementById('employeeDeleteSuccessModal').classList.contains('show'));
    await page.evaluate(async()=>{window.testDeleted=false;window.noAssets=true;await deleteEmployee(7);});
    await page.waitForSelector('#employeeDeleteModal.show');
    await new Promise(resolve=>setTimeout(resolve,350));
    await page.click('#confirmDeleteEmployeeBtn');
    await page.waitForSelector('#employeeDeleteSuccessModal.show');
    assert.match(await page.$eval('#employeeDeleteSuccessMessage',e=>e.textContent),/No assigned assets/);
    await page.evaluate(async()=>{
      currentUser={role:'viewer'};employees=[testEmployee];renderEmployees();
      const before=calls.length;await deleteEmployee(7);await confirmDeleteEmployee();
      if(calls.length!==before||document.querySelector('.delete-employee-btn'))throw Error('Non-admin delete exposed');
    });
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
