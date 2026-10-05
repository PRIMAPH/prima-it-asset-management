// ============================================================
// PRIMA IT ASSET MANAGEMENT
// REPORTS.JS
// Existing Reports + Selectable Print / Save PDF
// ============================================================

let reportRows = [];
let categories = [];
let locations = [];

const $ = id => document.getElementById(id);

function esc(v) {
  return String(v ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function money(v) {
  return Number(v || 0).toLocaleString('en-PH', {
    style:'currency', currency:'PHP', minimumFractionDigits:2
  });
}

function showAlert(message, type='danger') {
  const box = $('alertBox');
  if (!box) return;
  if (window.PRIMAAlerts) {
    window.PRIMAAlerts.show(box, message, { type });
    return;
  }
  box.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="alert">${esc(message)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
}

function statusBadge(status) {
  const classes = {
    Available: 'text-bg-success',
    Assigned: 'text-bg-primary',
    'For Repair': 'text-bg-warning',
    Repairing: 'text-bg-info',
    Broken: 'text-bg-danger',
    Lost: 'text-bg-dark',
    'For Disposal': 'text-bg-warning',
    Disposed: 'text-bg-secondary',
    Retired: 'text-bg-secondary'
  };

  return `
    <span class="badge ${classes[status] || 'text-bg-light'}">
      ${esc(status || 'Unknown')}
    </span>
  `;
}

function reportTitleFor(type) {
  const titles = {
    all: 'All Assets',
    Available: 'Available Assets',
    Assigned: 'Assigned Assets',
    'For Repair': 'For Repair Assets',
    Repairing: 'Repairing Assets',
    Broken: 'Broken Assets',
    Lost: 'Lost Assets',
    'For Disposal': 'For Disposal Assets',
    Disposed: 'Disposed Assets',
    Retired: 'Retired Assets'
  };

  return titles[type] || 'Asset Report';
}

async function loadOptions() {
  const [catRes, locRes] = await Promise.all([
    fetch('/api/asset-categories', {credentials:'include'}),
    fetch('/api/locations', {credentials:'include'})
  ]);
  if (!catRes.ok || !locRes.ok) throw new Error('Unable to load report filters.');
  categories = await catRes.json();
  locations = await locRes.json();

  $('categoryFilter').innerHTML = '<option value="">All Categories</option>' + categories.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('locationFilter').innerHTML = '<option value="">All Locations</option>' + locations.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
}

async function loadSummary() {
  const response = await fetch('/api/reports/asset-summary', {credentials:'include'});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Unable to load asset summary.');

const map = {
  kpiTotal: data.total_assets,
  kpiAvailable: data.available,
  kpiAssigned: data.assigned,
  kpiForRepair: data.for_repair,
  kpiRepairing: data.repairing,
  kpiLost: data.lost,
  kpiForDisposal: data.for_disposal,
  kpiDisposed: data.disposed
};
  Object.entries(map).forEach(([id,val]) => { if ($(id)) $(id).textContent = Number(val || 0); });
  if ($('kpiValue')) $('kpiValue').textContent = money(data.total_purchase_cost);
}

function getCurrentFilters() {
  return {
    type: $('reportType')?.value || 'all',
    categoryId: $('categoryFilter')?.value || '',
    locationId: $('locationFilter')?.value || '',
    search: $('searchInput')?.value.trim() || ''
  };
}

async function loadReport() {
  const params = new URLSearchParams();
  const filters = getCurrentFilters();
  if (filters.type !== 'all') params.set('status', filters.type);
  if (filters.categoryId) params.set('category_id', filters.categoryId);
  if (filters.locationId) params.set('location_id', filters.locationId);
  if (filters.search) params.set('search', filters.search);

  const response = await fetch('/api/reports/assets?' + params.toString(), {credentials:'include'});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Unable to load report.');

  reportRows = Array.isArray(data.rows) ? data.rows : [];
  renderReport();
}

function renderReport() {
  const body = $('reportTableBody');
  const type = $('reportType').value;
  const title = reportTitleFor(type);

  $('reportTitle').textContent = title;
  const search = $('searchInput')?.value.trim() || '';
  $('reportMeta').textContent = `${reportRows.length} record${reportRows.length === 1 ? '' : 's'}${search ? ` • Search: ${search}` : ''}`;

  if (!reportRows.length) {
    body.innerHTML = '<tr><td colspan="10" class="text-center py-5 text-muted">No assets match the selected report filters.</td></tr>';
    return;
  }

  body.innerHTML = reportRows.map(r => `
    <tr>
      <td class="fw-semibold">${esc(r.asset_id)}</td>
      <td><div class="fw-semibold">${esc(r.asset_name)}</div><div class="small text-muted">${esc(r.category_name || '—')}</div></td>
      <td>${esc(r.category_name || '—')}</td>
      <td>${esc([r.brand,r.model].filter(Boolean).join(' ') || '—')}</td>
      <td>${esc(r.serial_number || '—')}</td>
      <td>${esc(r.custodian_name || 'IT Inventory')}</td>
      <td>${esc(r.department_name || '—')}</td>
      <td>${esc(r.location_name || '—')}</td>
      <td>${statusBadge(r.status)}</td>
      <td class="text-end">${money(r.purchase_cost)}</td>
    </tr>
  `).join('');
}

function printReport() {
  const title = $('reportTitle').textContent || 'Asset Report';
  const filters = getCurrentFilters();
  const date = new Date().toLocaleString('en-PH', {
    year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'
  });

  const categoryName = $('categoryFilter')?.selectedOptions?.[0]?.textContent || 'All Categories';
  const locationName = $('locationFilter')?.selectedOptions?.[0]?.textContent || 'All Locations';
  const searchText = filters.search || 'None';

  const rows = reportRows.length ? reportRows.map(r => `
    <tr>
      <td>${esc(r.asset_id)}</td>
      <td>${esc(r.asset_name)}</td>
      <td>${esc(r.category_name || '—')}</td>
      <td>${esc([r.brand,r.model].filter(Boolean).join(' ') || '—')}</td>
      <td>${esc(r.serial_number || '—')}</td>
      <td>${esc(r.custodian_name || 'IT Inventory')}</td>
      <td>${esc(r.department_name || '—')}</td>
      <td>${esc(r.location_name || '—')}</td>
      <td>${esc(r.status || '—')}</td>
      <td class="amount">${money(r.purchase_cost)}</td>
    </tr>`).join('') : '<tr><td colspan="10" style="text-align:center;padding:18px;">No records.</td></tr>';

  const totalCost = reportRows.reduce((s,r) => s + Number(r.purchase_cost || 0), 0);
  const w = window.open('', '_blank', 'width=1400,height=900');
  if (!w) { showAlert('Please allow pop-ups for printing.', 'warning'); return; }

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} - PRIMA IT Asset Management</title>
  <style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#111;font-size:8.5px;background:#fff}
  .page{width:297mm;min-height:210mm;padding:8mm;margin:0 auto}
  .header{text-align:center;border-bottom:2px solid #111;padding-bottom:3.5mm;margin-bottom:3mm}
  .company{font-size:14px;font-weight:700}.title{font-size:16px;font-weight:700;margin-top:1.5mm;text-transform:uppercase}
  .meta{text-align:center;color:#555;font-size:8px;margin-top:1mm}
  .filters{display:grid;grid-template-columns:repeat(4,1fr);gap:2.5mm;margin-bottom:3mm}
  .filter-box,.summary-box{border:1px solid #999;padding:2.4mm}.label{font-size:7px;color:#666;text-transform:uppercase}.value{font-size:9px;font-weight:700;margin-top:1mm}
  table{width:100%;border-collapse:collapse;margin-top:2.5mm}th,td{border:1px solid #222;padding:1.8mm 1.3mm;vertical-align:top}th{background:#f1f1f1;font-size:7.4px;text-align:left}td{font-size:7.6px}.amount{text-align:right;white-space:nowrap}
  .summary{display:grid;grid-template-columns:1fr 1fr 1fr;gap:2.5mm;margin-top:3mm}.summary-box .value{font-size:11px}
  .footer{margin-top:4mm;padding-top:2mm;border-top:1px solid #999;text-align:center;color:#666;font-size:7px;line-height:1.25}
  @page{size:A4 landscape;margin:0}@media print{.page{margin:0;width:297mm;min-height:auto}}
  </style></head><body><div class="page">
  <div class="header"><div class="company">Prima Fintech (Philippines) Lending Corporation</div><div class="title">${esc(title)}</div><div class="meta">Generated ${esc(date)}</div></div>
  <div class="filters">
    <div class="filter-box"><div class="label">Report Type</div><div class="value">${esc(title)}</div></div>
    <div class="filter-box"><div class="label">Category</div><div class="value">${esc(categoryName)}</div></div>
    <div class="filter-box"><div class="label">Location</div><div class="value">${esc(locationName)}</div></div>
    <div class="filter-box"><div class="label">Search</div><div class="value">${esc(searchText)}</div></div>
  </div>
  <table><thead><tr><th>Asset Tag</th><th>Asset</th><th>Category</th><th>Brand / Model</th><th>Serial Number</th><th>Custodian / Assigned User</th><th>Department</th><th>Location</th><th>Status</th><th>Purchase Cost</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="summary"><div class="summary-box"><div class="label">Records</div><div class="value">${reportRows.length}</div></div><div class="summary-box"><div class="label">Report</div><div class="value">${esc(title)}</div></div><div class="summary-box"><div class="label">Purchase Value</div><div class="value">${money(totalCost)}</div></div></div>
  <div class="footer">PRIMA IT Asset Management • Prima Fintech (Philippines) Lending Corporation</div>
  </div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));window.onafterprint=()=>setTimeout(()=>window.close(),300);<\/script></body></html>`);
  w.document.close();
}

async function refresh() {
  try {
    await Promise.all([loadSummary(), loadReport()]);
  } catch (error) {
    console.error(error);
    showAlert(error.message || 'Unable to load reports.');
  }
}

async function init() {
  try {
    await loadOptions();
    await refresh();
  } catch (error) {
    console.error(error);
    showAlert(error.message || 'Unable to load reports.');
  }


  $('reportType')?.addEventListener('change', loadReport);
  $('categoryFilter')?.addEventListener('change', loadReport);
  $('locationFilter')?.addEventListener('change', loadReport);
  $('refreshBtn')?.addEventListener('click', refresh);
  $('printBtn')?.addEventListener('click', printReport);
  $('sendReportBtn')?.addEventListener('click', openSendReportPrompt);

  let timer;
  $('searchInput')?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(loadReport, 250);
  });

  
}

function openSendReportPrompt() {
  const email = window.prompt('Send this report to (email address):');
  if (!email) return;

  const filters = getCurrentFilters();
  const categoryName = $('categoryFilter')?.selectedOptions?.[0]?.textContent || 'All Categories';
  const locationName = $('locationFilter')?.selectedOptions?.[0]?.textContent || 'All Locations';

  sendReport({
    to: email.trim(),
    status: filters.type,
    category_id: filters.categoryId,
    location_id: filters.locationId,
    search: filters.search,
    category_name: categoryName,
    location_name: locationName
  });
}

async function sendReport(payload) {
  const btn = $('sendReportBtn');
  const originalHTML = btn ? btn.innerHTML : '';

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Sending...';
  }

  try {
    const response = await fetch('/api/reports/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || 'Unable to send report.');
    }

    showAlert(data.message || 'Report sent successfully.', 'success');

  } catch (error) {
    console.error('sendReport error:', error);
    showAlert(error.message || 'Unable to send report.', 'danger');

  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
function goBack() {
  if (document.referrer && document.referrer !== window.location.href) {
    history.back();
  } else {
    window.location.href = '/admin';
  }
}
