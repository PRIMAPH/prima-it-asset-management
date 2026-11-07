const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const puppeteer=require('puppeteer');
const {assignAssets}=require('../services/asset-assignment');
const {allocateAssetId}=require('../services/asset-id');

function endpoint({employeeStatus='active', failHistory=false}={}) {
  let handler, snapshot;
  const state={assets:[], assignments:[], history:[], audits:[], requests:{}, counter:0};
  const connection={
    async beginTransaction(){snapshot=structuredClone(state);},
    async commit(){snapshot=null;},
    async rollback(){if(snapshot)Object.assign(state,snapshot); snapshot=null;}, release(){},
    async query(sql,v=[]) {
      if(sql.includes('INSERT INTO asset_creation_requests')) {state.requests[v.join(':')] ||= {id:null};return [{}];}
      if(sql.includes('FROM asset_creation_requests'))return [[state.requests[v.join(':')]]];
      if(sql.includes('UPDATE asset_creation_requests')) {state.requests[v.slice(3).join(':')]={id:v[0],asset_id:v[1],status:v[2]};return [{}];}
      if(sql.includes('SELECT YEAR(CURRENT_DATE())'))return [[{asset_year:2026}]];
      if(sql.includes('INSERT INTO asset_id_counters')) {state.counter++;return [{}];}
      if(sql.includes('FROM asset_id_counters')) return [[{asset_id:'PRIMA-2026-'+String(state.counter).padStart(6,'0')}]];
      if(sql.includes('FROM audit_logs l'))return [state.audits.filter(a=>a.request===v[1]).map(a=>state.assets.find(x=>x.id===a.id))];
      if(sql.includes('INSERT INTO assets')) {const id=state.assets.length+1;state.assets.push({id,asset_id:v[0],asset_name:v[2],status:'Available'});return [{insertId:id}];}
      if(sql.includes('FROM employees'))return [v[0]===999?[]:[{id:Number(v[0]),employee_id:'EMP-7',full_name:'Test Employee',status:employeeStatus}]];
      if(sql.includes('FROM assets'))return [state.assets.filter(a=>a.id===v[0])];
      if(sql.includes('FROM asset_assignments'))return [state.assignments.filter(a=>a.asset_id===v[0])];
      if(sql.includes('INSERT INTO asset_assignments')){state.assignments.push({asset_id:v[0],employee_id:v[1]});return [{}];}
      if(sql.includes('UPDATE assets')){state.assets.find(a=>a.id===v[0]).status='Assigned';return [{}];}
      if(sql.includes('INSERT INTO asset_history')){if(failHistory&&v[1]==='Asset Assigned')throw Error('History unavailable');state.history.push(v);return [{}];}
      if(sql.includes('INSERT INTO audit_logs')){if(v.length===3)state.audits.push({id:Number(v[1]),request:JSON.parse(v[2]).creation_request_id});return [{}];}
      throw Error('Unexpected SQL: '+sql);
    }
  };
  const source=fs.readFileSync('server.js','utf8');
  vm.runInNewContext(source.slice(source.indexOf("app.post('/api/assets',"),source.indexOf("app.get('/api/assets/:id'")),{app:{post(p,g,h){handler=h;}},requireLogin(){},pool:{getConnection:async()=>connection},allocateAssetId,assignAssets,console:{error(){}}});
  return {state,connection,async save(body,role='admin'){let status=200,result;await handler({body,session:{user:{id:1,role}}},{status(n){status=n;return this;},json(r){result=r;}});return {status,result};}};
}

test('inventory creation stays Available and retry creates only one record',async()=>{
  const api=endpoint();const body={asset_name:'Laptop',creation_request_id:'12345678-12345678'};
  assert.equal((await api.save(body)).status,201);
  assert.equal((await api.save(body)).status,200);
  assert.equal(api.state.assets.length,1);assert.equal(api.state.assets[0].status,'Available');assert.equal(api.state.assignments.length,0);
});
test('immediate assignment uses shared logic, history, status and deduplicates retries',async()=>{
  const api=endpoint(),body={asset_name:'Laptop',employee_id:7,creation_request_id:'12345678-12345678'};
  assert.equal((await api.save(body)).status,201);await api.save(body);
  assert.equal(api.state.assets.length,1);assert.equal(api.state.assets[0].status,'Assigned');assert.equal(api.state.assignments.length,1);
  assert.equal(api.state.history[1][1],'Asset Assigned');assert.equal(api.state.history[1][5],7);
  await assert.rejects(assignAssets(api.connection,{asset_ids:[1],employee_id:7,userId:1}),/cannot be assigned/);
});
test('invalid employees, permissions and history failures never leave partially created assets',async()=>{
  for(const [options,employee_id,role] of [[{},'typed name','admin'],[{},999,'admin'],[{employeeStatus:'inactive'},7,'admin'],[{failHistory:true},7,'admin'],[{},7,'viewer']]){
    const api=endpoint(options),response=await api.save({asset_name:'Laptop',employee_id},role);
    assert.ok(response.status>=400);assert.equal(api.state.assets.length,0);assert.equal(api.state.assignments.length,0);assert.equal(api.state.history.length,0);
  }
});

test('browser: both choices, search IDs and names, validation, duplicate save and no post-creation prompt',async()=>{
  const browser=await puppeteer.launch({headless:true,pipe:true});
  try {
    const page=await browser.newPage();
    await page.setRequestInterception(true);page.on('request',r=>r.abort());
    await page.setContent(fs.readFileSync('public/assets.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,''));
    await page.evaluate(()=>{
      const modal=e=>({show(){e.classList.add('show');},hide(){e.classList.remove('show');e.dispatchEvent(new Event('hidden.bs.modal'));}});
      window.bootstrap={Modal:{getInstance:modal,getOrCreateInstance:modal}};
      document.addEventListener('click',e=>{if(e.target.matches('[data-bs-dismiss="modal"]'))modal(e.target.closest('.modal')).hide();});
    });
    await page.addScriptTag({content:fs.readFileSync('public/js/assets.js','utf8')});
    await page.evaluate(()=>{
      window.saved=[];window.opened=[];window.messages=[];window.refreshes=0;
      loadAssets=async()=>{refreshes++;};showAlert=(...args)=>messages.push(args);
      openAssignModal=async ids=>opened.push(ids);
      window.fetch=async(url,options={})=>{
        if(url==='/api/assets/next-id')return {ok:true,json:async()=>({asset_id:'PRIMA-2026-000106'})};
        if(url.startsWith('/api/employees'))return {ok:true,json:async()=>[{id:7,employee_id:'EMP-007',full_name:'Jane Example',department_name:'Finance',status:'active'}]};
        const body=JSON.parse(options.body);saved.push(body);await new Promise(r=>setTimeout(r,20));
        return {ok:true,json:async()=>({id:saved.length,asset_id:'PRIMA-2026-'+String(106+saved.length).padStart(6,'0'),status:body.employee_id?'Assigned':'Available'})};
      };
    });
    await page.evaluate(async()=>{openAddAssetModal();await new Promise(r=>setTimeout(r,0));});
    assert.equal(await page.$eval('#assetIdPreview',e=>e.value),'PRIMA-2026-000106');
    assert.equal(await page.$eval('#assetIdPreview',e=>e.readOnly),true);
    // Opening/reopening only reads the preview. Failure offers a real retry.
    await page.evaluate(async()=>{
      window.previewFetch=fetch;
      window.fetch=async()=>{throw new Error('Network unavailable');};
      openAddAssetModal();
      window.loadingPlaceholder=$('assetIdPreview').placeholder;
      await new Promise(r=>setTimeout(r,0));
    });
    assert.equal(await page.evaluate(()=>loadingPlaceholder),'Loading Asset ID...');
    assert.equal(await page.$eval('#assetIdPreview',e=>e.placeholder),'Unable to load Asset ID');
    assert.equal(await page.$eval('#assetIdPreviewRetry',e=>e.hidden),false);
    assert.equal(await page.evaluate(()=>saved.length),0);
    await page.evaluate(()=>{fetch=previewFetch;});
    await page.evaluate(()=>$('assetIdPreviewRetry').click());
    await page.waitForFunction(()=>document.getElementById('assetIdPreview').value==='PRIMA-2026-000106');
    assert.equal(await page.$eval('#assetIdPreviewRetry',e=>e.hidden),true);
    await page.evaluate(async()=>{openAddAssetModal();await new Promise(r=>setTimeout(r,0));});
    assert.equal(await page.$eval('#assetIdPreview',e=>e.value),'PRIMA-2026-000106');
    assert.equal(await page.evaluate(()=>saved.length),0);

    await page.evaluate(async()=>{document.querySelector('[name="asset_name"]').value='Inventory';await Promise.all([saveAsset({preventDefault(){}}),saveAsset({preventDefault(){}})]);});
    assert.equal(await page.evaluate(()=>saved.length),1);
    assert.equal(await page.$eval('#keepAssetAvailable',e=>e.checked),true);
    assert.equal(await page.$('#newAssetAssignmentPrompt'),null);
    assert.deepEqual(await page.evaluate(()=>opened),[]);
    assert.deepEqual(await page.evaluate(()=>messages.at(-1)),['Asset PRIMA-2026-000107 added successfully!','success']);
    assert.equal(await page.$eval('#addAssetModal',e=>e.classList.contains('show')),false);
    assert.equal(await page.evaluate(()=>refreshes),1);
    await page.evaluate(async()=>{openAddAssetModal();document.querySelector('[name="asset_name"]').value='Assigned';$('assignNewAsset').checked=true;await $('assignNewAsset').onchange();});
    for(const term of ['EMP-007','Jane']){
      await page.evaluate(term=>{const input=$('newEmployeeSearch');input.value=term;input.dispatchEvent(new Event('input'));},term);
      assert.match(await page.$eval('#newEmployeePickerList',e=>e.textContent),/Finance/);
    }
    await page.evaluate(async()=>{await saveAsset({preventDefault(){}});});
    assert.equal(await page.evaluate(()=>saved.length),1);
    await page.evaluate(async()=>{$('newEmployeePickerList').querySelector('.employee-option').click();await Promise.all([saveAsset({preventDefault(){}}),saveAsset({preventDefault(){}})]);});
    assert.equal(await page.evaluate(()=>saved.length),2);
    assert.equal(await page.evaluate(()=>saved[1].employee_id),7);
    assert.equal(await page.$('#newAssetAssignmentPrompt'),null);
    assert.deepEqual(await page.evaluate(()=>opened),[]);
    assert.deepEqual(await page.evaluate(()=>messages.at(-1)),['Asset PRIMA-2026-000108 added successfully! Assigned to Jane Example.','success']);
    assert.equal(await page.$eval('#addAssetModal',e=>e.classList.contains('show')),false);
    assert.equal(await page.evaluate(()=>refreshes),2);
    // Switching back to inventory clears employee identity; a failed save remains retryable.
    await page.evaluate(async()=>{
      openAddAssetModal(); document.querySelector('[name="asset_name"]').value='Retry';
      $('assignNewAsset').checked=true; await $('assignNewAsset').onchange();
      $('newEmployeePickerList').querySelector('.employee-option').click();
      $('keepAssetAvailable').checked=true; await $('keepAssetAvailable').onchange();
      window.normalFetch=fetch;
      window.failedPayload=null;window.messages=[];
      window.fetch=async(url,options)=>{failedPayload=JSON.parse(options.body);return {ok:false,json:async()=>({message:'Please try again.'})};};
      await saveAsset({preventDefault(){}});
    });
    assert.deepEqual(await page.evaluate(()=>messages),[['Please try again.','danger']]);
    assert.equal(await page.$eval('#addAssetModal',e=>e.classList.contains('show')),true);
    assert.equal(await page.evaluate(()=>refreshes),2);
    assert.equal(await page.$('#newAssetAssignmentPrompt'),null);
    assert.equal(await page.$eval('#newAssignEmployee',e=>e.value),'');
    assert.equal(await page.$eval('#assetForm button[type="submit"]',e=>e.disabled),false);
    await page.evaluate(async()=>{fetch=normalFetch;await saveAsset({preventDefault(){}});});
    assert.equal(await page.evaluate(()=>saved.at(-1).creation_request_id===failedPayload.creation_request_id),true);
    assert.equal(await page.evaluate(()=>saved.at(-1).employee_id),undefined);
    // A failed employee load cannot leave a stale employee selectable.
    await page.evaluate(async()=>{
      openAddAssetModal();
      fetch=async()=>({ok:false});$('assignNewAsset').checked=true;await $('assignNewAsset').onchange();
    });
    assert.match(await page.$eval('#newEmployeeError',e=>e.textContent),/Unable to load employees/);
  } finally {await browser.close();}
});
