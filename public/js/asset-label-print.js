/* Dedicated compact labels; does not alter the standard Assets label workflow. */
(() => {
  const $ = id => document.getElementById(id);
  const selected = new Set();
  const labelsPerSheet = 44;
  const sourceParams = new URLSearchParams(location.search);
  let inventoryReprintRecorded = false;
  let visible = [], request = 0, busy = false, previewIds = '';
  const signature = () => [...selected].join(',');
  function message(text, danger = false) {
    $('qrLabelMessage').textContent = text;
    $('qrLabelMessage').className = text ? `alert alert-${danger ? 'danger' : 'info'}` : '';
  }
  function controls() {
    $('qrSelectedCount').textContent = `${selected.size} asset${selected.size === 1 ? '' : 's'} selected`;
    $('qrClear').disabled = busy || !selected.size;
    $('qrPreview').disabled = busy || !selected.size;
    $('qrPrint').disabled = busy || !selected.size || previewIds !== signature();
    const count = visible.filter(a => selected.has(Number(a.id))).length;
    $('qrSelectVisible').checked = !!visible.length && count === visible.length;
    $('qrSelectVisible').indeterminate = count > 0 && count < visible.length;
    $('qrSelectVisible').disabled = busy || !visible.length;
    $('qrAssetRows').querySelectorAll('input').forEach(box => {
      box.checked = selected.has(Number(box.value)); box.disabled = busy;
    });
  }
  function invalidate() {
    previewIds = ''; $('qrPrintSheets').replaceChildren(); controls();
  }
  async function json(url) {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (response.status === 401) { location.href = '/'; throw new Error('Please sign in.'); }
    if (!response.ok) throw new Error('Unable to load asset data. Refresh and try again.');
    return response.json();
  }
  async function load() {
    const token = ++request;
    try {
      const rows = await json('/api/assets?search=' + encodeURIComponent($('qrAssetSearch').value.trim()));
      if (token !== request) return;
      visible = rows;
      $('qrAssetRows').replaceChildren();
      for (const asset of rows) {
        const row = document.createElement('tr');
        const cell = row.insertCell();
        const box = document.createElement('input');
        box.type = 'checkbox'; box.className = 'form-check-input'; box.value = asset.id;
        box.setAttribute('aria-label', 'Select ' + asset.asset_id);
        cell.append(box);
        for (const text of [asset.asset_id, asset.asset_name, asset.status]) row.insertCell().textContent = text;
        $('qrAssetRows').append(row);
      }
      if (!rows.length) {
        const row = $('qrAssetRows').insertRow(); const cell = row.insertCell();
        cell.colSpan = 4; cell.textContent = 'No assets found.';
      }
      controls();
    } catch (error) { if (token === request) message(error.message, true); }
  }
  // QRCode.js encoder with integer modules and a four-module quiet zone.
  function qrImage(value) {
    const encoder = new QRCode(document.createElement('div'), { text: value, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M });
    const matrix = encoder._oQRCode, size = matrix.getModuleCount(), scale = 12, quiet = 4;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = (size + 2 * quiet) * scale;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
      if (matrix.isDark(row, col)) ctx.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
    }
    const image = new Image(); image.src = canvas.toDataURL('image/png'); image.className = 'qr-symbol'; image.alt = 'Asset QR code';
    return image;
  }
  async function preview(print = false) {
    if (busy || !selected.size) return;
    busy = true; controls(); message('Preparing labels…');
    try {
      const ids = [...selected];
      const results = await Promise.all(ids.map(async id => {
        const response = await fetch('/api/assets/' + id, { credentials: 'include', cache: 'no-store' });
        if (response.status === 404) { selected.delete(id); return { error: `Asset #${id} no longer exists and was removed. Preview again.` }; }
        if (!response.ok) return { error: `Unable to verify asset #${id}. No labels were printed.` };
        const data = await response.json(); const asset = data.asset || data;
        if (Number(asset.id) !== id || !/\d{6}$/.test(asset.asset_id || '')) return { error: `Asset #${id} does not have a valid six-digit label suffix.` };
        return { asset };
      }));
      const errors = results.filter(r => r.error);
      if (errors.length) throw new Error(errors.map(r => r.error).join(' '));
      const sheets = document.createDocumentFragment(); let sheet;
      results.forEach(({ asset }, index) => {
        if (index % labelsPerSheet === 0) { sheet = document.createElement('section'); sheet.className = 'qr-sheet'; sheet.setAttribute('aria-label', 'A4 sheet ' + (Math.floor(index / labelsPerSheet) + 1)); sheets.append(sheet); }
        const label = document.createElement('div'); label.className = 'qr-small-label';
        const left = document.createElement('div'); left.className = 'qr-left';
        const right = document.createElement('div'); right.className = 'qr-right';
        const company = document.createElement('div'); company.className = 'qr-company';
        for (const text of ['Prima Fintech', '(Philippines)', 'Lending Corp.']) {
          const line = document.createElement('span'); line.textContent = text; company.append(line);
        }
        const digits = document.createElement('div'); digits.className = 'qr-digits'; digits.textContent = asset.asset_id.slice(-6);
        left.append(qrImage(asset.asset_id));
        right.append(company, digits);
        label.append(left, right); sheet.append(label);
      });
      $('qrPrintSheets').replaceChildren(sheets);
      await Promise.all([...$('qrPrintSheets').querySelectorAll('img')].map(image => image.decode()));
      previewIds = signature(); message(`${results.length} labels on ${Math.ceil(results.length / labelsPerSheet)} A4 sheet(s).`);
      if (print) {
        window.print();
        await recordInventoryReprint(results.map(result => result.asset));
      }
    } catch (error) { invalidate(); message(error.message, true); }
    finally { busy = false; controls(); }
  }
  // Retain the audit behavior of inventory's existing reprint links.
  async function recordInventoryReprint(printedAssets) {
    const sessionId = sourceParams.get('inventory_session_id');
    const itemId = sourceParams.get('inventory_item_id');
    const sourceAssetId = Number((sourceParams.get('ids') || '').split(',')[0]);
    if (inventoryReprintRecorded || !sessionId || !itemId || !printedAssets.some(asset => Number(asset.id) === sourceAssetId)) return;
    try {
      const response = await fetch(`/api/inventory/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}/label-reprint`, {
        method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Unable to record inventory label reprint.');
      inventoryReprintRecorded = true;
    } catch (error) {
      message('Print dialog opened, but the inventory reprint audit could not be recorded. ' + error.message, true);
    }
  }
  $('qrAssetRows').addEventListener('change', event => {
    if (!event.target.matches('input[type="checkbox"]') || busy) return;
    const id = Number(event.target.value);
    if (event.target.checked) selected.add(id); else selected.delete(id);
    invalidate();
  });
  $('qrSelectVisible').onchange = event => { visible.forEach(asset => event.target.checked ? selected.add(Number(asset.id)) : selected.delete(Number(asset.id))); invalidate(); };
  $('qrClear').onclick = () => { selected.clear(); invalidate(); message(''); };
  $('qrPreview').onclick = () => preview(); $('qrPrint').onclick = () => preview(true);
  let timer;
  $('qrAssetSearch').oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  for (const value of (new URLSearchParams(location.search).get('ids') || '').split(',')) {
    const id = Number(value); if (Number.isSafeInteger(id) && id > 0) selected.add(id);
  }
  controls(); load();
  if (selected.size) preview();
})();
