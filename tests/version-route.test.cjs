const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { versionInfo } = require('../services/app-version');

test('real server route registration serves version JSON without authentication or database access', async () => {
  const filename = path.resolve('server.js');
  const sourceRequire = createRequire(filename);
  let app;
  let queries = 0;
  // Execute the entire server, with only external infrastructure replaced.
  // No real credentials, certificates, MySQL, socket connections, or scheduled jobs.
  const infrastructure = {
    dotenv: { config() {} },
    fs: {
      ...fs,
      existsSync: () => true,
      readFileSync: () => Buffer.from('test certificate placeholder'),
      mkdirSync() { throw new Error('Unexpected filesystem mutation'); }
    },
    https: { createServer(options, application) { app = application; return { listen() {} }; } },
    'mysql2/promise': { createPool() { return { async query() { queries++; throw new Error('Database disabled in route test'); } }; } },
    'socket.io': { Server: class { engine = { use() {} }; use() {} on() {} } }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => infrastructure[name] || sourceRequire(name),
    __dirname: path.dirname(filename), __filename: filename,
    process: { env: {}, exit() { throw new Error('Unexpected process exit'); } },
    console: { log() {}, warn() {}, error() {} },
    Buffer, URL,
    setInterval() { throw new Error('Unexpected scheduler start'); },
    setTimeout, clearTimeout
  }, { filename });
  // Let the intentionally disabled startup scheduler settle before measuring requests.
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(app, 'The real HTTPS application must have been created');
  const startupQueries = queries;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const headers of [{}, { Cookie: 'connect.sid=invalid-test-cookie' }]) {
      const response = await fetch(origin + '/api/version', { headers });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('set-cookie'), null);
      const body = await response.json();
      assert.deepEqual(body, versionInfo());
      assert.deepEqual(Object.keys(body).sort(), ['releases', 'systemName', 'version']);
      assert.equal(body.version, require('../package.json').version);
      assert.equal(typeof body.systemName, 'string');
      assert.ok(Array.isArray(body.releases));
      assert.ok(body.releases.some(release => release.version === body.version));
      for (const release of body.releases) {
        assert.deepEqual(Object.keys(release).sort(), ['date', 'features', 'fixes', 'improvements', 'version']);
        assert.match(release.version, /^\d+\.\d+\.\d+$/);
        assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
        for (const key of ['features', 'improvements', 'fixes']) {
          assert.ok(Array.isArray(release[key]) && release[key].every(item => typeof item === 'string'));
        }
      }
    }
    assert.equal(queries, startupQueries, 'Version endpoint must not access MySQL');
    const protectedResponse = await fetch(origin + '/api/assets');
    assert.equal(protectedResponse.status, 401, 'Existing asset API must still require login');
    assert.equal((await protectedResponse.json()).message, 'Login required.');
    const script = await fetch(origin + '/js/release-notes.js?v=2');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    console.log('Local real Express app: GET /api/version -> 200 application/json; version ' + versionInfo().version);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
