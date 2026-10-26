// Run with: node --test tests/asset-edit.test.cjs
// Uses an isolated browser and an in-memory database; never touches live assets.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const puppeteer = require('puppeteer');

function imageEndpoint(record) {
  const source = fs.readFileSync('server.js', 'utf8');
  const start = source.indexOf("app.post(\n  '/api/assets/:id/images',".replace(/\n/g, source.includes('\r\n') ? '\r\n' : '\n'));
  const end = source.indexOf('// REPORTS ROUTES', start);
  let handler;
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, values) {
      if (/SELECT/.test(sql)) return [[{ ...record }]];
      if (/UPDATE assets/.test(sql)) {
        let index = 0;
        for (const match of sql.matchAll(/(asset_image|receipt_image) = (\?|NULL)/g)) {
          record[match[1]] = match[2] === 'NULL' ? null : values[index++];
        }
      }
      return [[]];
    }
  };
  vm.runInNewContext(source.slice(start, end), {
    app: { post(...args) { handler = args.at(-1); } }, requireLogin() {},
    assetImageUpload: { fields() {} }, pool: { async getConnection() { return connection; } },
    console: { log() {}, warn() {}, error() {} }
    // No filesystem is exposed: attempts to delete old files fail this test.
  });
  return async (body, files) => {
    let status = 200, result;
    await handler({ params: { id: 1 }, body, files, session: { user: { id: 1 } } }, {
      status(value) { status = value; return this; }, json(value) { result = value; }
    });
    assert.equal(status, 200, JSON.stringify(result));
    return result;
  };
}

test('edit previews, uploads, removals and save/reopen persistence', async () => {
  const browser = await puppeteer.launch({ headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => request.abort());
    const html = fs.readFileSync('public/assets.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.bootstrap = { Modal: { getInstance: () => ({ hide() {} }), getOrCreateInstance: () => ({ show() { window.modalOpened = true; }, hide() {} }) } };
    });
    await page.addScriptTag({ content: fs.readFileSync('public/js/assets.js', 'utf8') });
    const record = { id: 1, asset_id: 'TEST-1', asset_name: 'Laptop', brand: 'Old brand', model: 'Model', serial_number: '123', condition_status: 'Good', status: 'Assigned', purchase_date: '2026-01-02', notes: 'Keep notes' };
    const updateImages = imageEndpoint(record);
    let imageCalls = 0;
    await page.exposeFunction('testApi', async (method, body, entries) => {
      if (method === 'PUT') Object.assign(record, JSON.parse(body));
      if (method === 'POST') {
        imageCalls++;
        const fields = {}, files = {};
        for (const [key, value] of entries) {
          if (typeof value === 'object') files[key] = [{ filename: value.name }];
          else fields[key] = value;
        }
        return updateImages(fields, files);
      }
      return { asset: { ...record } };
    });
    await page.evaluate(() => {
      window.fetch = async (url, options = {}) => ({ ok: true, json: () => window.testApi(options.method || 'GET', options.body instanceof FormData ? null : options.body, options.body instanceof FormData ? [...options.body].map(([key, value]) => [key, value instanceof File ? { name: value.name } : value]) : []) });
      loadAssets = async () => {};
      showAlert = (message, type) => { if (type === 'danger') throw Error(message); };
      setupAssetImageControls();
      initializeImageButtons(); // Legacy delegated Remove handlers must also remain compatible.
    });
    for (const [asset, receipt] of [[null, null], ['/uploads/assets/a.png', null], [null, '/uploads/assets/r.png'], ['/uploads/assets/a.png', '/uploads/assets/r.png']]) {
      Object.assign(record, { asset_image: asset, receipt_image: receipt });
      const previews = await page.evaluate(async () => {
        window.modalOpened = false;
        await editAssetFromView(1);
        return { opened: window.modalOpened, asset: $('assetImagePreview').dataset.existingImage, receipt: $('receiptImagePreview').dataset.existingImage, brand: document.querySelector('[name="brand"]').value };
      });
      assert.equal(previews.opened, true);
      assert.equal(previews.asset, asset || '');
      assert.equal(previews.receipt, receipt || '');
      assert.equal(previews.brand, record.brand);
      await page.evaluate(async () => {
        document.querySelector('[name="brand"]').value = 'Updated brand';
        await saveAsset({ preventDefault() {} });
        await editAssetFromView(1);
      });
      assert.equal(record.brand, 'Updated brand');
      assert.equal(record.asset_image, asset);
      assert.equal(record.receipt_image, receipt);
      assert.equal(record.status, 'Assigned');
      assert.equal(record.notes, 'Keep notes');
    }
    assert.equal(imageCalls, 0, 'Details-only edits must not send image changes');
    for (const kind of ['asset', 'receipt']) {
      await page.evaluate(async kind => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['image'], 'replacement.png', { type: 'image/png' }));
        const input = $(kind + 'ImageFile');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change'));
        await saveAsset({ preventDefault() {} });
        await editAssetFromView(1);
      }, kind);
      assert.equal(record[kind + '_image'], '/uploads/assets/replacement.png');
      await page.evaluate(async kind => {
        $('remove' + (kind === 'asset' ? 'Asset' : 'Receipt') + 'ImageBtn').click();
        if ($(kind + 'ImagePreview').classList.contains('d-none')) throw Error('Placeholder hidden');
        await saveAsset({ preventDefault() {} });
        await editAssetFromView(1);
      }, kind);
      assert.equal(record[kind + '_image'], null);
    }
    // Exercise the real capture-to-file flow with a synthetic camera frame.
    for (const kind of ['asset', 'receipt']) {
      await page.evaluate(async kind => {
        let video = $('cameraVideo');
        if (!video) {
          video = document.createElement('video');
          video.id = 'cameraVideo';
          document.body.append(video);
        }
        Object.defineProperty(video, 'videoWidth', { value: 2, configurable: true });
        Object.defineProperty(video, 'videoHeight', { value: 2, configurable: true });
        const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function () { this.fillRect(0, 0, 2, 2); };
        activeCameraTarget = kind;
        captureCameraImage();
        CanvasRenderingContext2D.prototype.drawImage = originalDraw;
      }, kind);
      await page.waitForFunction(kind => document.getElementById(kind + 'ImageFile').files.length === 1, {}, kind);
      await page.evaluate(async () => {
        await saveAsset({ preventDefault() {} });
        await editAssetFromView(1);
      });
      assert.ok(record[kind + '_image'].startsWith('/uploads/assets/' + kind + '-'));
      assert.ok(record[kind + '_image'].endsWith('.jpg'));
    }
    await page.evaluate(() => {
      const preview = $('assetImagePreview');
      const retained = preview.dataset.existingImage;
      $('assetImageFile').value = '';
      $('assetImageFile').dispatchEvent(new Event('change'));
      if (preview.dataset.existingImage !== retained || assetImageRemoved) throw Error('Canceled upload changed image state');
    });
    await page.evaluate(async () => {
      showExistingAssetImage('/missing.png', 'assetImagePreview');
      $('assetImagePreview').querySelector('img').dispatchEvent(new Event('error'));
      if (!$('assetImagePreview').textContent.includes('preview unavailable')) throw Error('Missing failure placeholder');
      const original = getAssetImageUrl;
      getAssetImageUrl = () => { throw Error('Preview failure'); };
      await editAssetFromView(1);
      getAssetImageUrl = original;
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
