const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const puppeteer = require('puppeteer');

test('Maintenance picker: default list, filtering, selection, keyboard, errors and repair submission', async () => {
  const browser = await puppeteer.launch({ headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1366, height: 768 });
    await page.setRequestInterception(true);
    page.on('request', request => request.abort());
    await page.setContent(fs.readFileSync('public/maintenance.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, ''));
    for (const file of ['vendor/bootstrap/bootstrap.min.css', 'css/app.css', 'css/search-picker.css', 'css/maintenance.css', 'css/dark-theme.css', 'css/dark-components.css']) {
      await page.addStyleTag({ content: fs.readFileSync('public/' + file, 'utf8') });
    }
    await page.addScriptTag({ content: fs.readFileSync('public/vendor/bootstrap/bootstrap.bundle.min.js', 'utf8') });
    await page.addScriptTag({ content: fs.readFileSync('public/js/maintenance.js', 'utf8') });
    await page.evaluate(async () => {
      window.records = [{ id: 7, asset_id: 'PRIMA-2026-000157', asset_name: 'Test Laptop', serial_number: 'SN157', barcode: 'BC157', status: 'Available', category_name: 'Computers', custodian_name: 'Test Employee', condition_status: 'Good', repair_ineligible_reason: null },
        { id: 8, asset_id: 'PRIMA-2026-000158', asset_name: 'Retired Laptop', status: 'Retired', repair_ineligible_reason: 'Asset is Retired and cannot be sent for repair.' },
        { id: 9, asset_id: 'PRIMA-2026-000159', asset_name: 'Repair Laptop', status: 'Under Repair', repair_ineligible_reason: 'Asset already has an active repair record.' },
        ...Array.from({ length: 20 }, (_, i) => ({ id: 20 + i, asset_id: 'PRIMA-2026-0002' + String(i).padStart(2, '0'), asset_name: 'Mouse ' + i, status: 'Available' }))];
      window.requests = []; window.posts = []; window.failSearch = false; window.failSave = false;
      window.fetch = async (url, options = {}) => {
        requests.push(url);
        if (options.method === 'POST') {
          posts.push(JSON.parse(options.body));
          await new Promise(resolve => setTimeout(resolve, 50));
          return { ok: !failSave, json: async () => failSave ? { message: 'Asset already has an active repair record.' } : { message: 'Repair started successfully.' } };
        }
        if (!url.startsWith('/api/maintenance/assets?')) throw Error('Unexpected request: ' + url);
        const term = new URLSearchParams(url.split('?')[1]).get('search').toLowerCase();
        const rows = records.filter(a => [a.asset_id, a.asset_name, a.serial_number, a.barcode].some(v => String(v || '').toLowerCase().includes(term)));
        if (term === 'slow') await new Promise(resolve => setTimeout(resolve, 350));
        return { ok: !failSearch, status: failSearch || 200, json: async () => { if (failSearch === 404) throw new SyntaxError('HTML error response'); return failSearch ? { message: 'Server error details' } : rows; } };
      };
      me = async () => {}; techs = async () => {}; refresh = async () => {};
      setupRepairAssetPicker(); await init();
    });
    const input = '#repairAssetSearch', list = '#repairAssetResults';
    await page.click('#newRepairBtn');
    await page.waitForFunction(() => document.querySelectorAll('#repairAssetResults .employee-option').length === 23);
    assert.equal(await page.$('#loadAssetBtn'), null);
    assert.equal(await page.evaluate(() => requests.length), 1, 'Opening does not duplicate requests');
    assert.equal(await page.$eval(input, e => e.getAttribute('aria-expanded')), 'true');
    const style = await page.$eval(list, el => ({ scrolls: el.scrollHeight > el.clientHeight, maxHeight: getComputedStyle(el).maxHeight, bg: getComputedStyle(el).backgroundColor, position: getComputedStyle(el).position }));
    assert.equal(style.scrolls, true); assert.equal(style.maxHeight, '250px'); assert.equal(style.position, 'absolute'); assert.equal(style.bg, 'rgb(18, 28, 38)');
    assert.equal(await page.$eval(input, e => getComputedStyle(e).paddingRight), '42px');
    // The panel stays inside the modal at narrow screen widths, too.
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.$eval(list, el => {
      const box = el.getBoundingClientRect(), body = el.closest('.modal-body').getBoundingClientRect();
      return box.left >= body.left && box.right <= body.right && box.bottom <= body.bottom;
    }), true);
    await page.setViewport({ width: 1366, height: 768 });
    assert.equal(await page.$$eval(list + ' [aria-disabled="true"]', els => els.length), 2);
    await page.click(list + ' [aria-disabled="true"]');
    assert.equal(await page.$eval('#repairAssetId', e => e.value), '');
    assert.match(await page.$eval(list, e => e.textContent), /active repair record/);
    async function search(term, expected = 1) {
      await page.$eval(input, (el, term) => { el.value = term; el.dispatchEvent(new Event('input', { bubbles: true })); }, term);
      await page.waitForFunction(expected => document.querySelectorAll('#repairAssetResults .employee-option').length === expected, {}, expected);
    }
    for (const term of ['PRIMA-2026-000157', '000157', 'Test Laptop', 'SN157', 'BC157']) {
      await search(term);
      assert.ok((await page.evaluate(() => requests.at(-1))).endsWith(encodeURIComponent(term)));
    }
    assert.match(await page.$eval(list, e => e.textContent), /Computers.*Serial: SN157.*Available/s);
    assert.match(await page.$eval(list, e => e.textContent), /Custodian: Test Employee/);
    await page.click(list + ' .employee-option');
    await page.waitForFunction(() => document.getElementById('repairAssetId').value === '7');
    assert.equal(await page.$eval(input, e => e.value), 'PRIMA-2026-000157 \u2014 Test Laptop');
    assert.equal(await page.$eval(input, e => e.getAttribute('aria-expanded')), 'false');
    assert.equal(await page.$eval('#saveRepairBtn', e => e.disabled), true);
    await page.type('#repairProblem', 'Broken screen');
    assert.equal(await page.$eval('#saveRepairBtn', e => e.disabled), false);
    // Free text clears the internal ID and cannot submit, even by invoking submit directly.
    await search('Mouse', 20);
    assert.equal(await page.$eval('#repairAssetId', e => e.value), '');
    await page.evaluate(() => save());
    assert.equal(await page.evaluate(() => posts.length), 0);
    await search('nomatches', 0);
    await page.waitForFunction(() => document.getElementById('repairAssetResults').textContent.includes('No matching assets found.'));
    for (const [status, message] of [[401, 'Session expired. Please sign in again.'], [403, 'You do not have permission to search assets.'], [404, 'Asset search service is unavailable.'], [500, 'Unable to retrieve assets due to a server error.']]) {
      await page.evaluate(status => { failSearch = status; }, status);
      await search('failure', 0);
      await page.waitForFunction(message => document.getElementById('repairAssetResults').textContent.trim() === message, {}, message);
    }
    await page.evaluate(() => { failSearch = false; });
    // Stale responses cannot overwrite newer search results.
    await page.evaluate(() => { loadRepairAssetOptions('slow'); });
    await search('SN157');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(await page.$$eval(list + ' .employee-option', els => els.length), 1);
    await page.focus(input); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape'); await page.keyboard.press('Enter');
    assert.equal(await page.$eval('#repairAssetId', e => e.value), '');
    await page.click(input); await page.waitForSelector(list + ' .employee-option');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('repairAssetId').value === '7');
    // A record becoming ineligible after listing is rechecked on selection.
    await page.click(input); await page.waitForSelector(list + ' .employee-option');
    await page.evaluate(() => { records[0].repair_ineligible_reason = 'Asset already has an active repair record.'; });
    await page.click(list + ' .employee-option');
    await page.waitForFunction(() => document.getElementById('repairFormAlert').textContent.includes('active repair record'));
    assert.equal(await page.$eval('#repairAssetId', e => e.value), '');
    await page.evaluate(() => { records[0].repair_ineligible_reason = null; });
    await search('SN157'); await page.click(list + ' .employee-option');
    await page.waitForFunction(() => document.getElementById('repairAssetId').value === '7');
    await page.evaluate(() => { failSave = true; });
    await page.evaluate(async () => { await Promise.all([save(), save()]); });
    assert.equal(await page.evaluate(() => posts.length), 1);
    assert.equal(await page.$eval('#repairAssetId', e => e.value), '7');
    await page.evaluate(() => { failSave = false; });
    await page.click('#saveRepairBtn');
    await page.waitForFunction(() => posts.length === 2 && !saveInProgress);
    assert.equal(await page.evaluate(() => posts[1].asset_id), 7);
    assert.equal(await page.evaluate(() => posts[1].problem_description), 'Broken screen');
    assert.match(await page.$eval('#alertBox', e => e.textContent), /Repair started successfully/);
    // Reopening resets the previous selection. Escape/outside clicks close the panel.
    await page.waitForFunction(() => !document.getElementById('repairModal').classList.contains('show'));
    await page.waitForFunction(() => !document.querySelector('.modal-backdrop'));
    await page.click('#newRepairBtn');
    await page.waitForFunction(() => document.querySelectorAll('#repairAssetResults .employee-option').length === 23);
    assert.equal(await page.$eval('#repairAssetId', e => e.value), '');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.$eval(list + ' .active', e => e.dataset.index), '22');
    await page.click('#repairProblem');
    assert.equal(await page.$eval(input, e => e.getAttribute('aria-expanded')), 'false');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
