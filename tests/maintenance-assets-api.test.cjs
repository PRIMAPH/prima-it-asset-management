const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('server.js', 'utf8');

// Catch a stale Node process serving newer static JS without its backend route.
test('running local server has registered the protected Maintenance asset route', { skip: process.env.RUN_MAINTENANCE_RUNTIME_TEST !== '1' }, async () => {
  const env = require('dotenv').parse(fs.readFileSync('.env'));
  const port = Number(env.PORT || 3001);
  async function get(path) {
    return new Promise((resolve, reject) => {
      const request = require('node:https').get({
        hostname: 'localhost', port, path, rejectUnauthorized: false,
        headers: { Accept: 'application/json' }, timeout: 5000
      }, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'], body }));
      });
      request.on('timeout', () => request.destroy(new Error('Local server timed out')));
      request.on('error', reject);
    });
  }
  const health = await get('/api/health');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).database, 'connected');
  for (const path of ['/api/maintenance/assets?search=', '/api/maintenance/assets?search=0026', '/api/assets?search=0026']) {
    const response = await get(path);
    assert.equal(response.status, 401, path + ' must be registered and require a session');
    assert.match(response.type, /application\/json/);
    assert.equal(JSON.parse(response.body).message, 'Login required.');
  }
});

function endpoint(pool, errors = []) {
  let route;
  const context = {
    pool,
    app: { get(path, auth, handler) { route = { path, auth, handler }; } },
    console: { error(...args) { errors.push(args); } },
    sendLoginRequired(req, res) { res.status(401).json({ message: 'Login required.' }); }
  };
  const authStart = source.indexOf('function requireMaintenanceStaff(');
  vm.runInNewContext(source.slice(authStart, source.indexOf("app.get('/',", authStart)), context);
  const start = source.indexOf("app.get('/api/maintenance/assets',");
  vm.runInNewContext(source.slice(start, source.indexOf("app.get('/api/maintenance/summary',", start)), context);
  return route;
}
async function request(route, search = '', role = 'admin') {
  const result = { status: 200, headers: {} };
  const req = { query: { search }, session: { user: role ? { id: 1, role } : null } };
  const res = {
    set(name, value) { result.headers[name] = value; return this; },
    status(value) { result.status = value; return this; },
    json(value) { result.body = value; return this; }
  };
  let allowed = false;
  route.auth(req, res, () => { allowed = true; });
  if (allowed) await route.handler(req, res);
  return result;
}

test('maintenance asset endpoint preserves permissions, search parameters and visible failures', async () => {
  const queries = [], errors = [];
  const route = endpoint({ async query(sql, params) { queries.push({ sql, params }); return [[{ id: 7, repair_ineligible_reason: null }]]; } }, errors);
  assert.equal(route.path, '/api/maintenance/assets');
  assert.equal((await request(route, '', null)).status, 401);
  assert.equal((await request(route, '', 'viewer')).status, 403);
  assert.equal(queries.length, 0);
  for (const role of ['admin', 'it_staff', 'technician']) {
    const result = await request(route, "000157'", role);
    assert.equal(result.status, 200);
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.deepEqual(Array.from(queries.at(-1).params), Array(4).fill("%000157'%"));
    assert.ok(!queries.at(-1).sql.includes("000157'"));
  }
  await request(route);
  assert.equal(queries.at(-1).params.length, 0);
  assert.match(queries.at(-1).sql, /ORDER BY a.id DESC/);
  const failed = endpoint({ query() { throw new Error('fixture database outage'); } }, errors);
  const result = await request(failed);
  assert.equal(result.status, 500);
  assert.match(result.body.message, /Unable to load assets for repair/);
  assert.equal(errors.length, 1);
});

test('local MySQL: maintenance searches and eligibility match existing data without writes', async () => {
  const env = require('dotenv').parse(fs.readFileSync('.env'));
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST || 'localhost'));
  const db = await require('mysql2/promise').createConnection({
    host: env.DB_HOST || 'localhost', user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '', database: env.DB_NAME || 'prima_asset_management'
  });
  try {
    await db.query('START TRANSACTION READ ONLY');
    const [assets] = await db.query('SELECT * FROM assets ORDER BY id');
    const [repairs] = await db.query('SELECT * FROM asset_repairs ORDER BY id');
    const [assignments] = await db.query('SELECT * FROM asset_assignments ORDER BY id');
    const route = endpoint({ query(sql, params) { assert.match(sql.trim(), /^SELECT/); return db.query(sql, params); } });
    const result = await request(route);
    assert.equal(result.status, 200);
    assert.equal(new Set(result.body.map(a => a.id)).size, assets.length);
    const active = ['For Repair', 'Under Diagnosis', 'Under Repair', 'Waiting for Parts', 'Repaired'];
    for (const asset of result.body) {
      const ineligible = ['Disposed', 'Retired', 'For Disposal'].includes(asset.status) || repairs.some(r => r.asset_id === asset.id && active.includes(r.status));
      assert.equal(Boolean(asset.repair_ineligible_reason), ineligible, asset.asset_id);
      for (const key of ['category_name', 'serial_number', 'barcode', 'custodian_name', 'condition_status']) assert.ok(key in asset);
    }
    const sample = assets.find(a => a.serial_number && a.barcode) || assets.find(a => a.serial_number);
    assert.ok(sample, 'Existing asset with serial number available');
    const terms = [sample.asset_id, sample.asset_id.slice(-6), '0026', sample.asset_name, sample.serial_number];
    const barcodeAsset = assets.find(a => a.barcode);
    if (barcodeAsset) terms.push(barcodeAsset.barcode);
    for (const term of terms) {
      const response = await request(route, term);
      assert.equal(response.status, 200);
      const expected = assets.filter(a => ['asset_id', 'asset_name', 'serial_number', 'barcode'].some(key => String(a[key] || '').toLowerCase().includes(String(term).toLowerCase())));
      assert.deepEqual([...new Set(response.body.map(a => a.id))].sort((a,b) => a-b), expected.map(a => a.id).sort((a,b) => a-b));
    }
    assert.deepEqual((await request(route, 'PRIMA-NO-SUCH-ASSET-TEST-974125')).body, []);
    assert.deepEqual((await db.query('SELECT * FROM assets ORDER BY id'))[0], assets);
    assert.deepEqual((await db.query('SELECT * FROM asset_repairs ORDER BY id'))[0], repairs);
    assert.deepEqual((await db.query('SELECT * FROM asset_assignments ORDER BY id'))[0], assignments);
  } finally {
    await db.rollback(); await db.end();
  }
});
