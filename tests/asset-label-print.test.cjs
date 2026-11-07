const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const puppeteer = require('puppeteer');

test('local database: printed QR resolves through the existing scan endpoint', { skip: process.env.RUN_LABEL_MYSQL_TEST !== '1' }, async () => {
  const mysql = require('mysql2/promise');
  const env = require('dotenv').parse(fs.readFileSync('.env'));
  const host = env.DB_HOST || 'localhost';
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host));
  const connection = await mysql.createConnection({ host, user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', database: env.DB_NAME || 'prima_asset_management' });
  let browser, server;
  try {
    await connection.query('START TRANSACTION READ ONLY');
    const [original] = await connection.query('SELECT * FROM assets ORDER BY id');
    const asset = original.find(a => /\d{6}$/.test(a.asset_id)); assert.ok(asset);
    const app = express();
    const source = fs.readFileSync('server.js', 'utf8').replace(/\r\n/g, '\n');
    const start = source.indexOf("app.get(\n  '/api/assets/scan/:code',");
    require('node:vm').runInNewContext(source.slice(start, source.indexOf('// INVENTORY MODE', start)), {
      app, requireLogin(req, res, next) { next(); }, console,
      pool: { query(sql, params) { assert.match(sql.trim(), /^SELECT/); return connection.query(sql, params); } }
    });
    app.get('/api/auth/me', (req,res) => res.json({ id: 1, role: 'admin' }));
    app.get('/api/assets', (req,res) => res.json(original));
    app.get('/api/assets/:id', (req,res) => {
      const row = original.find(a => a.id === Number(req.params.id));
      if (!row) return res.sendStatus(404); res.json(row);
    });
    app.use(express.static(path.resolve('public')));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await puppeteer.launch({ headless: true, pipe: true });
    const page = await browser.newPage();
    await page.goto(base + '/asset-label-print.html?ids=' + asset.id, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.getElementById('qrPrint').disabled);
    await page.addScriptTag({ url: base + '/vendor/html5-qrcode/html5-qrcode.min.js' });
    const scanned = await page.evaluate(async () => {
      const element = document.createElement('div'); element.id = 'decoder'; document.body.append(element);
      const blob = await (await fetch(document.querySelector('.qr-symbol').src)).blob();
      const scanner = new Html5Qrcode('decoder');
      const code = await scanner.scanFile(new File([blob], 'qr.png', { type: 'image/png' }), false);
      scanner.clear();
      const response = await fetch('/api/assets/scan/' + encodeURIComponent(code));
      return { code, status: response.status, data: await response.json() };
    });
    assert.equal(scanned.code, asset.asset_id);
    assert.equal(scanned.status, 200);
    assert.equal(scanned.data.asset.id, asset.id);
    assert.equal(await page.$eval('.qr-digits', el => el.textContent), asset.asset_id.slice(-6));
    assert.deepEqual((await connection.query('SELECT * FROM assets ORDER BY id'))[0], original);
    console.log('Printed QR resolved to local asset ' + asset.asset_id + '; database transaction read-only.');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await connection.rollback(); await connection.end();
  }
});

test('compact QR labels: exact content, decoding, A4 layout, multipage and failures', async () => {
  const app = express();
  const records = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, asset_id: `PRIMA-2026-${String(157 + i).padStart(6, '0')}`, asset_name: 'Accessory ' + i, status: 'Available' }));
  let deleted = false, inventoryAudits = 0;
  app.post('/api/inventory/sessions/3/items/8/label-reprint', (req, res) => {
    inventoryAudits++; res.json({ ok: true });
  });
  app.get('/api/auth/me', (req, res) => res.json({ id: 1, full_name: 'Test', role: 'admin' }));
  app.get('/api/assets', (req, res) => res.json(records.filter(a => a.asset_id.includes(req.query.search || ''))));
  app.get('/api/assets/:id', (req, res) => {
    const record = records.find(a => a.id === Number(req.params.id));
    if (!record || (deleted && record.id === 1)) return res.sendStatus(404);
    res.json(record);
  });
  app.get('/asset-label-print', (req, res) => res.sendFile(path.resolve('public/asset-label-print.html')));
  app.use(express.static(path.resolve('public')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, pipe: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/asset-label-print?ids=1,1&inventory_session_id=3&inventory_item_id=8', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.getElementById('qrPrint').disabled);
    assert.equal(inventoryAudits, 0, 'Preview does not record a reprint');
    assert.equal(await page.$$eval('.qr-small-label', els => els.length), 1);
    assert.equal(await page.$eval('.qr-digits', el => el.textContent), '000157');
    assert.deepEqual(await page.$$eval('.qr-company span', els => els.map(el => el.textContent)), ['Prima Fintech', '(Philippines)', 'Lending Corp.']);
    async function layout() {
      return page.$eval('.qr-small-label', label => {
        const outer = label.getBoundingClientRect();
        const rect = selector => {
          const r = label.querySelector(selector).getBoundingClientRect();
          return { x: r.left - outer.left, y: r.top - outer.top, width: r.width, height: r.height };
        };
        return { qr: rect('.qr-symbol'), digits: rect('.qr-digits'), company: rect('.qr-company'),
          lines: [...label.querySelectorAll('.qr-company span')].map(el => el.getBoundingClientRect().top - outer.top) };
      });
    }
    const screenLayout = await layout();
    assert.ok(Math.abs(screenLayout.qr.width - 17 * 96 / 25.4) < .1);
    assert.ok(Math.abs(screenLayout.qr.height - 17 * 96 / 25.4) < .1);
    assert.ok(screenLayout.qr.x < 8 && screenLayout.qr.y < 6, 'QR is in the upper-left area');
    assert.ok(screenLayout.digits.y >= screenLayout.company.y + screenLayout.company.height, 'Digits below company');
    assert.ok(screenLayout.digits.x > screenLayout.qr.x + screenLayout.qr.width, 'Digits are on right');
    assert.ok(Math.abs(screenLayout.digits.x - screenLayout.company.x) < .1);
    assert.equal(await page.$eval('.qr-digits', el => getComputedStyle(el).fontWeight), '800');
    assert.ok(screenLayout.company.x > screenLayout.qr.x + screenLayout.qr.width, 'Company is on right');
    assert.ok(screenLayout.lines.length === 3 && screenLayout.lines[0] < screenLayout.lines[1] && screenLayout.lines[1] < screenLayout.lines[2]);
    await page.emulateMediaType('print');
    const printLayout = await layout();
    for (const part of ['qr', 'digits', 'company']) for (const dimension of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(screenLayout[part][dimension] - printLayout[part][dimension]) < .1, `Preview/print ${part}.${dimension}`);
    }
    await page.emulateMediaType(null);
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    assert.equal(await page.$eval('.qr-small-label', el => el.textContent.includes('PRIMA-2026')), false);
    assert.equal(await page.$eval('a[href="/asset-label-print"]', el => el.getAttribute('aria-current')), 'page');
    // Decode the actual rasterized label with PRIMA's existing scanner library.
    const raster = await (await page.$('.qr-small-label')).screenshot();
    fs.mkdirSync('tmp', { recursive: true }); fs.writeFileSync('tmp/compact-qr-label.png', raster);
    await page.addScriptTag({ url: base + '/vendor/html5-qrcode/html5-qrcode.min.js' });
    const decoded = await page.evaluate(async data => {
      const div = document.createElement('div'); div.id = 'decodeTest'; div.className = 'screen-only'; document.body.append(div);
      const blob = await (await fetch(data)).blob();
      const scanner = new Html5Qrcode('decodeTest');
      const result = await scanner.scanFile(new File([blob], 'label.png', { type: 'image/png' }), false);
      scanner.clear(); div.remove(); return result;
    }, 'data:image/png;base64,' + Buffer.from(raster).toString('base64'));
    assert.equal(decoded, records[0].asset_id);
    // Check actual PDF page sizes/counts, not only screen preview wrappers.
    const single = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    assert.equal((single.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1);
    await page.click('#qrSelectVisible');
    await page.click('#qrPreview');
    await page.waitForFunction(() => document.querySelectorAll('.qr-small-label').length === 45 && !document.getElementById('qrPrint').disabled);
    assert.deepEqual(await page.$$eval('.qr-sheet', els => els.map(el => el.children.length)), [44,1]);
    const dimensions = await page.$eval('.qr-small-label', el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, fits: [...el.children].every(child => child.scrollWidth <= child.clientWidth + 1) }));
    assert.ok(Math.abs(dimensions.width - 40 * 96 / 25.4) < .1);
    assert.ok(Math.abs(dimensions.height - 18.5 * 96 / 25.4) < .1);
    assert.equal(dimensions.fits, true);
    async function verifyGrid() {
      const valid = await page.$$eval('.qr-sheet', sheets => sheets.every(sheet => {
        const page = sheet.getBoundingClientRect();
        const labels = [...sheet.children].map(label => label.getBoundingClientRect());
        if (labels.length >= 6 && !(labels.slice(0, 5).every(box => Math.abs(box.top - labels[0].top) < .1) && labels[5].top > labels[0].bottom)) return false;
        return [...sheet.children].every((label, index) => {
          const box = labels[index];
          const inside = box.left >= page.left && box.top >= page.top && box.right <= page.right + .1 && box.bottom <= page.bottom + .1;
          const contentFits = [...label.querySelectorAll('.qr-symbol, .qr-digits, .qr-company span')].every(child => {
            const content = child.getBoundingClientRect();
            return content.left >= box.left && content.right <= box.right && child.scrollWidth <= child.clientWidth + 1 && content.top >= box.top && content.bottom <= box.bottom;
          });
          const separate = labels.every((other, i) => i === index || box.right <= other.left + .1 || other.right <= box.left + .1 || box.bottom <= other.top + .1 || other.bottom <= box.top + .1);
          return inside && contentFits && separate && Math.abs(box.width - 40 * 96 / 25.4) < .1 && Math.abs(box.height - 18.5 * 96 / 25.4) < .1;
        });
      }));
      assert.equal(valid, true, 'All labels and their content fit without clipping or overlap');
    }
    await verifyGrid();
    const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 2);
    fs.mkdirSync('tmp', { recursive: true }); fs.writeFileSync('tmp/compact-qr-labels.pdf', pdf);
    await page.emulateMediaType('print');
    await verifyGrid();
    assert.equal(await page.$eval('.screen-only', el => getComputedStyle(el).display), 'none');
    await page.emulateMediaType('screen');
    await page.evaluate(() => { window.printCalls = 0; window.print = () => { printCalls++; }; });
    await page.click('#qrPrint');
    await page.waitForFunction(() => printCalls === 1 && !document.getElementById('qrPrint').disabled);
    assert.equal(inventoryAudits, 1, 'Inventory reprint audit preserved');
    deleted = true;
    await page.click('#qrPrint');
    await page.waitForFunction(() => document.getElementById('qrLabelMessage').textContent.includes('no longer exists'));
    assert.equal(await page.evaluate(() => printCalls), 1);
    assert.equal(inventoryAudits, 1);
    assert.equal(await page.$eval('#qrSelectedCount', el => el.textContent), '44 assets selected');
    assert.equal(await page.$eval('#qrPrint', el => el.disabled), true);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});


