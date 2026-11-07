const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const puppeteer = require('puppeteer');

test('persistent asset selection across searches, filters, labels and assignment', async () => {
  const browser = await puppeteer.launch({ headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true); page.on('request', r => r.abort());
    await page.setContent(fs.readFileSync('public/assets.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, ''));
    await page.addScriptTag({ content: fs.readFileSync('public/js/assets.js', 'utf8') });
    await page.evaluate(() => {
      window.records = [
        { id: 7, asset_id: 'PRIMA-2026-000133', asset_name: 'Laptop', status: 'Available', category_id: 1, location_id: 2 },
        { id: 12, asset_id: 'PRIMA-2026-000129', asset_name: 'Monitor', status: 'Available', category_id: 2, location_id: 3 },
        { id: 15, asset_id: 'PRIMA-2026-000140', asset_name: 'Keyboard', status: 'Available', category_id: 1, location_id: null }
      ];
      window.userId = 1; currentUser = { id: 1, role: 'admin' };
      window.messages = []; showAlert = (...args) => messages.push(args);
      window.posts = []; window.failAssign = false; window.failDetails = false;
      window.bootstrap = { Modal: { getOrCreateInstance: el => ({ show() { el.classList.add('show'); }, hide() { el.classList.remove('show'); } }) } };
      $('categoryFilter').innerHTML = '<option value="">All</option><option value="1">Computers</option><option value="2">Displays</option>';
      $('locationFilter').innerHTML = '<option value="">All</option><option value="2">Office</option><option value="3">Storage</option><option value="none">No Location</option>';
      fetch = async (url, options = {}) => {
        let data, status = 200;
        if (url === '/api/auth/me') data = { id: userId, role: 'admin' };
        else if (url === '/api/assets/assign') {
          posts.push(JSON.parse(options.body));
          status = failAssign ? 409 : 200;
          data = failAssign ? { message: 'Asset became unavailable; nothing assigned.' } : { assigned: posts.at(-1).asset_ids.length };
        } else if (url.startsWith('/api/assets?')) {
          const q = new URLSearchParams(url.split('?')[1]);
          data = records.filter(a => (!q.get('search') || a.asset_id.includes(q.get('search')))
            && (!q.get('category_id') || String(a.category_id) === q.get('category_id'))
            && (!q.get('location_id') || String(a.location_id) === q.get('location_id'))
            && (!q.get('status') || a.status === q.get('status')));
        } else {
          data = records.find(a => a.id === Number(url.split('/').pop()));
          if (!data) status = 404;
          if (failDetails) status = 500;
        }
        return { ok: status === 200, status, json: async () => data || {} };
      };
      setupSearch(); setupSelectAll();
    });
    const selected = () => page.evaluate(() => selectedIds().sort((a,b) => a-b));
    async function search(text) {
      const previousRequest = await page.evaluate(() => assetListRequest);
      await page.focus('#searchInput');
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      if (text) await page.keyboard.type(text);
      else await page.keyboard.press('Backspace');
      await page.waitForFunction(({ text, previousRequest }) => {
        const expected = records.filter(a => !text || a.asset_id.includes(text)).map(a => a.id);
        const rendered = [...document.querySelectorAll('#assetTableBody .asset-check')].map(box => Number(box.value));
        return assetListRequest > previousRequest && JSON.stringify(rendered) === JSON.stringify(expected);
      }, {}, { text, previousRequest });
    }
    await search('133'); await page.click('.asset-check');
    await search('129'); await page.click('.asset-check');
    assert.deepEqual(await selected(), [7,12]);
    assert.equal(await page.$eval('#assetSelectionCount', e => e.textContent), '2 assets selected');
    await search('133'); assert.equal(await page.$eval('.asset-check', e => e.checked), true);
    await page.select('#statusFilter', 'Assigned');
    await page.waitForFunction(() => document.querySelectorAll('#assetTableBody .asset-check').length === 0);
    assert.deepEqual(await selected(), [7,12]);
    assert.equal(await page.$eval('#assetSelectionCount', e => e.textContent), '2 assets selected');
    await page.select('#statusFilter', '');
    await page.waitForSelector('.asset-check');
    await page.evaluate(async () => {
      await loadAssets();
      assets.reverse(); renderAssets();
    });
    assert.deepEqual(await selected(), [7,12]);
    await page.evaluate(async () => { $('categoryFilter').value = '2'; $('locationFilter').value = '3'; await loadAssets(); });
    assert.deepEqual(await selected(), [7,12]);
    await page.evaluate(() => $('clearFiltersBtn').click());
    await page.waitForFunction(() => document.querySelectorAll('.asset-check').length === 3);
    assert.deepEqual(await selected(), [7,12]);
    assert.equal(await page.$eval('#selectAll', e => e.indeterminate), true);
    await search('129'); await page.click('#selectAll');
    assert.deepEqual(await selected(), [7]);
    await page.click('#selectAll'); assert.deepEqual(await selected(), [7,12]);
    await page.evaluate(async () => { await openLabelModal(); });
    assert.deepEqual(await page.evaluate(() => currentLabelAssets.map(a => a.id)), [7,12]);
    assert.equal(await page.$$eval('.asset-label', rows => rows.length), 2);
    await page.evaluate(async () => {
      window.printOutput = '';
      window.open = () => ({ document: { open() {}, write(html) { window.printOutput = html; }, close() {} }, close() { window.printClosed = true; } });
      await printLabels();
    });
    const printed = await page.evaluate(() => printOutput);
    assert.match(printed, /PRIMA-2026-000133/);
    assert.match(printed, /PRIMA-2026-000129/);
    assert.deepEqual(await selected(), [7,12]);
    await page.evaluate(async () => { printOutput = ''; failDetails = true; await printLabels(); failDetails = false; });
    assert.equal(await page.evaluate(() => printOutput), '');
    assert.equal(await page.evaluate(() => printClosed), true);
    assert.deepEqual(await selected(), [7,12]);
    // A blocked print popup must preserve both selections.
    await page.evaluate(async () => { window.open = () => null; await printLabels(); });
    assert.deepEqual(await selected(), [7,12]);
    await page.evaluate(async () => { failDetails = true; await openLabelModal(); failDetails = false; });
    assert.deepEqual(await selected(), [7,12]);
    await page.evaluate(async () => { await openAssignModal(selectedIds()); });
    assert.deepEqual(await page.evaluate(() => currentAssignAssetIds), [7,12]);
    await page.evaluate(async () => { $('assignEmployee').value = '4'; failAssign = true; await assignAssets({ preventDefault() {} }); });
    assert.deepEqual(await page.evaluate(() => posts.at(-1).asset_ids), [7,12]);
    assert.deepEqual(await selected(), [7,12]);
    await page.evaluate(async () => { failAssign = false; records[1].status = 'Assigned'; await openAssignModal(selectedIds()); });
    assert.deepEqual(await page.evaluate(() => currentAssignAssetIds), []);
    assert.deepEqual(await selected(), [7,12]);
    assert.match(await page.evaluate(() => messages.at(-1)[0]), /Nothing was assigned/);
    await page.evaluate(async () => { records[1].status = 'Available'; await openAssignModal(selectedIds()); $('assignEmployee').value = '4'; await assignAssets({ preventDefault() {} }); });
    assert.deepEqual(await selected(), []);
    await search(''); await page.click('#selectAll'); assert.deepEqual(await selected(), [7,12,15]);
    await page.evaluate(async () => { records = records.filter(a => a.id !== 12); await openLabelModal(); });
    assert.deepEqual(await selected(), [7,15]);
    assert.match(await page.evaluate(() => messages.at(-1)[0]), /no longer exists/);
    await page.click('#clearAssetSelectionBtn'); assert.deepEqual(await selected(), []);
    await search('133'); await page.click('.asset-check');
    await page.evaluate(async () => { userId = 2; await openLabelModal(); });
    assert.deepEqual(await selected(), []);
    await page.click('.asset-check');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.deepEqual(await selected(), []);
  } finally { await browser.close(); }
});
