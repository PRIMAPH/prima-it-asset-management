// Read-only verification using the existing local development data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mysql = require('mysql2/promise');
const express = require('express');
const puppeteer = require('puppeteer');

test('location API and browser filters against real local data without writes', {
  skip: process.env.RUN_LOCATION_MYSQL_TEST !== '1'
}, async () => {
  const env = require('dotenv').parse(fs.readFileSync('.env'));
  const host = env.DB_HOST || 'localhost';
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host), 'Local database only');
  const connection = await mysql.createConnection({ host, user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', database: env.DB_NAME || 'prima_asset_management' });
  let server, browser;
  try {
    await connection.query('START TRANSACTION READ ONLY');
    const pool = { query(sql, params) {
      assert.match(sql.trim(), /^SELECT\b/i, 'No database writes permitted');
      return connection.query(sql, params);
    } };
    const [original] = await pool.query('SELECT * FROM assets ORDER BY id');
    const [locations] = await pool.query('SELECT id,name FROM locations ORDER BY name');
    const [categories] = await pool.query('SELECT id,name FROM asset_categories ORDER BY name');
    assert.ok(locations.length > 0);
    const app = express();
    const source = fs.readFileSync('server.js', 'utf8');
    vm.runInNewContext(source.slice(source.indexOf("app.get('/api/locations',"), source.indexOf("app.get('/api/assets/next-id',")), {
      app, pool, requireLogin(req, res, next) { next(); }
    });
    const html = fs.readFileSync('public/assets.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
    app.get('/', (req, res) => res.send(html));
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const ids = rows => rows.map(row => row.id).sort((a, b) => a - b);
    async function get(query = '') {
      const response = await fetch(base + '/api/assets' + query);
      assert.equal(response.status, 200);
      return response.json();
    }
    assert.deepEqual(ids(await get()), ids(original));
    assert.deepEqual(ids(await get('?location_id=none')), ids(original.filter(a => a.location_id === null)));
    for (const location of locations) {
      assert.deepEqual(ids(await get('?location_id=' + location.id)), ids(original.filter(a => a.location_id === location.id)));
    }
    assert.equal((await get('?location_id=2147483647')).length, 0);
    assert.equal((await fetch(base + '/api/assets?location_id=invalid')).status, 400);
    const sample = original.find(a => a.location_id && a.category_id);
    assert.ok(sample, 'Need a real asset with a location and category');
    const combined = new URLSearchParams({ search: sample.asset_id, status: sample.status, category_id: sample.category_id, location_id: sample.location_id });
    assert.deepEqual(ids(await get('?' + combined)), [sample.id]);
    combined.set('location_id', 'none');
    assert.deepEqual(await get('?' + combined), []);

    // Compare each requested case with a direct database query.
    const accounting = locations.find(l => l.name === 'Accounting Room');
    const itRoom = locations.find(l => l.name === 'IT Room');
    assert.ok(accounting && itRoom);
    for (const [name, query, where, params] of [
      ['Accounting Room', { location_id: accounting.id }, 'location_id = ?', [accounting.id]],
      ['IT Room', { location_id: itRoom.id }, 'location_id = ?', [itRoom.id]],
      ['No Location', { location_id: 'none' }, 'location_id IS NULL', []],
      ['All Locations', {}, '1=1', []],
      ['Location + Category', { location_id: sample.location_id, category_id: sample.category_id }, 'location_id = ? AND category_id = ?', [sample.location_id, sample.category_id]],
      ['Location + Status', { location_id: sample.location_id, status: sample.status }, 'location_id = ? AND status = ?', [sample.location_id, sample.status]],
      ['Location + Search', { location_id: sample.location_id, search: sample.asset_id }, 'location_id = ? AND asset_id = ?', [sample.location_id, sample.asset_id]],
      ['No matches', { location_id: 'none', search: sample.asset_id }, 'location_id IS NULL AND asset_id = ?', [sample.asset_id]]
    ]) {
      const [expected] = await pool.query('SELECT id FROM assets WHERE ' + where + ' ORDER BY id DESC', params);
      const actual = await get('?' + new URLSearchParams(query));
      assert.deepEqual(actual.map(a => a.id), expected.map(a => a.id), name);
      console.log(name + ': ' + actual.length + ' assets; API matches SQL');
    }

    browser = await puppeteer.launch({ headless: true, pipe: true });
    const page = await browser.newPage();
    await page.goto(base);
    await page.addScriptTag({ content: fs.readFileSync('public/js/assets.js', 'utf8') });
    await page.evaluate(async categories => {
      document.getElementById('categoryFilter').replaceChildren(new Option('All Categories', ''), ...categories.map(c => new Option(c.name, c.id)));
      await loadLocations();
      setupSearch();
      await loadAssets();
    }, categories);
    assert.deepEqual(await page.$$eval('#locationFilter option', options => options.map(o => o.textContent.trim())), ['All Locations', 'No Location', ...locations.map(l => l.name)]);
    async function expectCount(count) {
      await page.waitForFunction(count => document.getElementById('assetCount').textContent === `${count} asset${count === 1 ? '' : 's'}`, {}, count);
    }
    await expectCount(original.length);
    await page.select('#locationFilter', 'none');
    await expectCount(original.filter(a => a.location_id === null).length);
    await page.select('#locationFilter', String(sample.location_id));
    await expectCount(original.filter(a => a.location_id === sample.location_id).length);
    await page.evaluate(async sample => {
      $('searchInput').value = sample.asset_id;
      $('statusFilter').value = sample.status;
      $('categoryFilter').value = String(sample.category_id);
      await loadAssets();
    }, sample);
    await expectCount(1);
    await page.evaluate(() => $('clearFiltersBtn').click());
    await expectCount(original.length);
    assert.deepEqual(await page.evaluate(() => ['searchInput', 'statusFilter', 'categoryFilter', 'locationFilter'].map(id => $(id).value)), ['', '', '', '']);
    // Exercise actual change events, URL parameters, counts, and rendered IDs.
    for (const location of [accounting, itRoom]) {
      const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/assets' && new URL(r.url()).searchParams.get('location_id') === String(location.id));
      await page.select('#locationFilter', String(location.id));
      const response = await responsePromise;
      assert.equal(response.status(), 200);
      const expected = original.filter(a => a.location_id === location.id).sort((a,b)=>b.id-a.id);
      await expectCount(expected.length);
      assert.deepEqual(await page.$$eval('.asset-check', boxes => boxes.map(b => Number(b.value))), expected.map(a => a.id));
    }
    await page.evaluate(async () => {
      $('locationFilter').value = '2147483647';
      // Use a no-match search with a valid selected location.
      $('searchInput').value = 'NO-MATCH-LOCATION-FILTER-TEST';
      await loadAssets();
    });
    await expectCount(0);
    assert.match(await page.$eval('#assetTableBody', el => el.textContent), /No assets found/);
    await page.evaluate(() => $('clearFiltersBtn').click());
    await expectCount(original.length);
    // Force an old All Locations response to arrive AFTER Accounting Room.
    await page.evaluate(async accountingId => {
      const nativeFetch = window.fetch;
      let release, started;
      const ready = new Promise(resolve => { started = resolve; });
      const hold = new Promise(resolve => { release = resolve; });
      let first = true;
      window.fetch = async (...args) => {
        const response = await nativeFetch(...args);
        if (first) { first = false; started(); await hold; }
        return response;
      };
      try {
        const box = document.querySelector('.asset-check');
        box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
        const oldRequest = loadAssets();
        window.selectionPreservedWhileLoading = selectedIds().includes(Number(box.value));
        await ready;
        $('locationFilter').value = String(accountingId);
        await loadAssets();
        release();
        await oldRequest;
      } finally { window.fetch = nativeFetch; }
    }, accounting.id);
    assert.equal(await page.evaluate(() => selectionPreservedWhileLoading), true);
    await expectCount(original.filter(a => a.location_id === accounting.id).length);
    assert.deepEqual(await page.$$eval('.asset-check', boxes => boxes.map(b => Number(b.value))), original.filter(a => a.location_id === accounting.id).sort((a,b)=>b.id-a.id).map(a=>a.id));
    assert.deepEqual((await pool.query('SELECT * FROM assets ORDER BY id'))[0], original);
    console.log(`Verified ${locations.length} real locations, ${original.length} assets, ${original.filter(a => a.location_id === null).length} unassigned; read-only transaction.`);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await connection.rollback();
    await connection.end();
  }
});
