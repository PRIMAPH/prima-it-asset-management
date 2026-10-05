(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const sessionId = Number(new URLSearchParams(location.search).get('id'));
  const discrepancyOnly = location.pathname.includes('discrepancy');
  let loadedSession = null;

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function display(value, fallback = '—') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function dateTime(value, fallback = '—') {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.assign(`/?session=expired&returnTo=${encodeURIComponent(location.pathname + location.search)}`);
      throw new Error('Login required.');
    }
    if (!response.ok) throw new Error(data.message || 'Unable to load report data.');
    return data;
  }

  function issueList(item) {
    if (item.verification_status === 'Missing') return ['Missing'];
    if (Array.isArray(item.issues)) return item.issues;
    const issues = [];
    if (Number(item.custodian_mismatch)) issues.push('Wrong Custodian');
    if (Number(item.location_mismatch)) issues.push('Wrong Location');
    if (Number(item.condition_mismatch)) issues.push('Condition Changed');
    if (Number(item.label_issue)) issues.push(item.label_condition || 'Label Issue');
    return issues;
  }

  function comparison(expected, actual, missing) {
    return `<div class="comparison"><div><small>Expected</small><br>${esc(display(expected))}</div><div><small>Actual</small><br>${esc(missing ? 'Not Located During Inventory' : display(actual, 'Not recorded'))}</div></div>`;
  }

  function inventoryRows(items) {
    return items.map(item => {
      const missing = item.verification_status === 'Missing';
      return `<tr>
        <td><strong>${esc(item.asset_id)}</strong></td>
        <td class="asset-cell"><strong>${esc(item.asset_name)}</strong><span>${esc([item.brand, item.model].filter(Boolean).join(' ') || '—')}</span></td>
        <td>${comparison(item.expected_custodian_name || 'IT Inventory / Unassigned', item.actual_custodian_name || 'IT Inventory / Unassigned', missing)}</td>
        <td>${comparison(item.expected_location_name, item.actual_location_name, missing)}</td>
        <td>${comparison(item.expected_condition, item.actual_condition, missing)}</td>
        <td>${esc(missing ? 'Not observed' : display(item.label_condition, 'Not checked'))}</td>
        <td>${esc(item.verification_status)}</td>
        <td>${esc(display(item.verification_method, missing ? 'System completion' : '—'))}</td>
        <td>${esc(display(item.verified_by_name, missing ? 'System completion' : '—'))}<br>${esc(dateTime(item.verified_at || item.missing_marked_at))}</td>
        <td>${esc(display(item.remarks))}</td>
      </tr>`;
    }).join('');
  }

  function discrepancyRows(items) {
    return items.map(item => {
      const missing = item.verification_status === 'Missing';
      const issues = issueList(item);
      return `<tr>
        <td><strong>${esc(item.asset_id)}</strong></td>
        <td class="asset-cell"><strong>${esc(item.asset_name)}</strong><span>${esc([item.brand, item.model].filter(Boolean).join(' ') || '—')}</span></td>
        <td><div class="issue-list">${issues.map(issue => `<span class="issue-tag">${esc(issue)}</span>`).join('')}</div></td>
        <td><div><strong>Custodian:</strong> ${esc(display(item.expected_custodian_name, 'IT Inventory / Unassigned'))}</div><div><strong>Location:</strong> ${esc(display(item.expected_location_name))}</div><div><strong>Condition:</strong> ${esc(display(item.expected_condition))}</div></td>
        <td>${missing ? 'Not Located During Inventory' : `<div><strong>Custodian:</strong> ${esc(display(item.actual_custodian_name, 'IT Inventory / Unassigned'))}</div><div><strong>Location:</strong> ${esc(display(item.actual_location_name))}</div><div><strong>Condition:</strong> ${esc(display(item.actual_condition))}</div>`}</td>
        <td>${esc(missing ? 'Not observed' : display(item.label_condition))}</td>
        <td>${esc(item.verification_status)}</td>
        <td>${esc(display(item.remarks))}</td>
        <td>${esc(display(item.verified_by_name, missing ? 'System completion' : '—'))}<br>${esc(dateTime(item.verified_at || item.missing_marked_at))}</td>
        <td><strong>${esc(display(item.review_status, 'Pending Review'))}</strong>${item.reviewed_by_name ? `<br>${esc(item.reviewed_by_name)}<br>${esc(dateTime(item.reviewed_at))}` : ''}${item.review_remarks ? `<br>${esc(item.review_remarks)}` : ''}</td>
      </tr>`;
    }).join('');
  }

  function render(session, items) {
    const title = discrepancyOnly
      ? 'IT ASSET INVENTORY DISCREPANCY REPORT'
      : 'IT ASSET INVENTORY REPORT';
    document.title = `${session.inventory_no} - ${title}`;
    const tableHead = discrepancyOnly
      ? '<tr><th>Asset Tag</th><th>Asset</th><th>Issue(s)</th><th>Expected</th><th>Actual</th><th>Label Condition</th><th>Result</th><th>Remarks</th><th>Verified By / At</th><th>Review Status</th></tr>'
      : '<tr><th>Asset Tag</th><th>Asset</th><th>Custodian</th><th>Location</th><th>Condition</th><th>Label</th><th>Result</th><th>Method</th><th>Verified By / At</th><th>Remarks</th></tr>';
    const rows = discrepancyOnly ? discrepancyRows(items) : inventoryRows(items);

    $('inventoryReport').innerHTML = `
      <header class="report-header">
        <img class="report-logo" src="/images/prima-company-logo.png" alt="Prima Fintech">
        <div class="report-title"><h1>${title}</h1><p>IT Asset Management · Physical Asset Audit</p></div>
        <div class="report-number"><span>Inventory No.</span><strong>${esc(session.inventory_no)}</strong></div>
      </header>
      <section class="report-meta">
        <div><span>Inventory Name</span><strong>${esc(session.name)}</strong></div>
        <div><span>Scope</span><strong>${esc(session.scope_type)} · ${esc(session.scope_description || 'All Assets')}</strong></div>
        <div><span>Status</span><strong>${esc(session.status)}</strong></div>
        <div><span>Performed By</span><strong>${esc(display(session.started_by_name, 'Not started'))}</strong></div>
        <div><span>Started</span><strong>${esc(dateTime(session.started_at, 'Not started'))}</strong></div>
        <div><span>Completed</span><strong>${esc(dateTime(session.completed_at, 'Not completed'))}</strong></div>
        <div><span>Report Type</span><strong>${discrepancyOnly ? 'Discrepancies' : 'Full Inventory'}</strong></div>
        <div><span>Generated</span><strong>${esc(dateTime(new Date()))}</strong></div>
      </section>
      ${session.remarks ? `<div class="report-remarks"><strong>Inventory Remarks</strong>${esc(session.remarks)}</div>` : ''}
      <section class="report-summary">
        <div><span>Expected</span><strong>${Number(session.expected_assets || 0).toLocaleString()}</strong></div>
        <div><span>Checked</span><strong>${Number(session.checked_assets || 0).toLocaleString()}</strong></div>
        <div><span>Verified</span><strong>${Number(session.verified_assets || 0).toLocaleString()}</strong></div>
        <div><span>Discrepancies</span><strong>${Number(session.discrepancies || 0).toLocaleString()}</strong></div>
        <div><span>Missing</span><strong>${Number(session.missing || 0).toLocaleString()}</strong></div>
        <div><span>Wrong Location</span><strong>${Number(session.wrong_location || 0).toLocaleString()}</strong></div>
        <div><span>Wrong Custodian</span><strong>${Number(session.wrong_custodian || 0).toLocaleString()}</strong></div>
        <div><span>Condition Changed</span><strong>${Number(session.condition_changed || 0).toLocaleString()}</strong></div>
        <div><span>Label Issues</span><strong>${Number(session.label_issues || 0).toLocaleString()}</strong></div>
      </section>
      <h2 class="report-section-title">${discrepancyOnly ? 'Discrepancy Review' : 'Frozen Inventory Snapshot'} · ${items.length.toLocaleString()} asset${items.length === 1 ? '' : 's'}</h2>
      <table class="report-table"><thead>${tableHead}</thead><tbody>${rows || `<tr><td colspan="10" class="text-center">No ${discrepancyOnly ? 'discrepancies' : 'assets'} found.</td></tr>`}</tbody></table>
      <footer class="report-footer"><span>Generated by PRIMA IT Asset Management</span><span>Historical expected values come from the frozen inventory snapshot.</span></footer>`;
  }

  async function load() {
    if (!sessionId) throw new Error('A valid inventory session ID is required.');
    const filter = discrepancyOnly ? '?filter=All%20Issues' : '';
    const [sessionData, itemData] = await Promise.all([
      request(`/api/inventory/sessions/${sessionId}`),
      request(`/api/inventory/sessions/${sessionId}/items${filter}`)
    ]);
    loadedSession = sessionData.session;
    $('exportInventoryReportBtn').href = `/api/inventory/sessions/${sessionId}/export`;
    render(loadedSession, Array.isArray(itemData.items) ? itemData.items : []);
  }

  $('printInventoryReportBtn')?.addEventListener('click', async () => {
    if (!loadedSession) return;
    const button = $('printInventoryReportBtn');
    button.disabled = true;
    try {
      await request(`/api/inventory/sessions/${sessionId}/print`, {
        method: 'POST',
        body: JSON.stringify({ report_type: discrepancyOnly ? 'discrepancy' : 'inventory' })
      });
    } catch (error) {
      console.warn('The print audit entry could not be recorded:', error);
    } finally {
      button.disabled = false;
      window.print();
    }
  });

  load().catch(error => {
    $('inventoryReport').innerHTML = `<div class="report-error">${esc(error.message)}</div>`;
  });
})();
