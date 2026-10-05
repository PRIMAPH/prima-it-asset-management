// ============================================================
// PRIMA IT ASSET MANAGEMENT
// AUDIT-LOGS.JS
// ============================================================

let auditRows = [];

let currentPage = 1;

const pageSize = 25;

let totalPages = 1;

let clearAuditModal = null;


// ============================================================
// ELEMENT HELPER
// ============================================================

const $ = id =>
  document.getElementById(id);


// ============================================================
// ESCAPE HTML
// ============================================================

function esc(value) {

  return String(value ?? '')

    .replaceAll('&', '&amp;')

    .replaceAll('<', '&lt;')

    .replaceAll('>', '&gt;')

    .replaceAll('"', '&quot;')

    .replaceAll("'", '&#039;');

}


// ============================================================
// ALERT
// ============================================================

function showAlert(
  message,
  type = 'danger'
) {

  const box =
    $('alertBox');

  if (!box) return;

  box.innerHTML = `

    <div
      class="alert alert-${type}
             alert-dismissible fade show"
      role="alert"
    >

      ${esc(message)}

      <button
        type="button"
        class="btn-close"
        data-bs-dismiss="alert"
      ></button>

    </div>

  `;

}


// ============================================================
// DATE FORMAT
// ============================================================

function formatDate(value) {

  if (!value) {
    return '—';
  }

  const date =
    new Date(value);

  if (Number.isNaN(date.getTime())) {
    return esc(value);
  }

  return date.toLocaleString(
    'en-PH',
    {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }
  );

}


// ============================================================
// ACTION BADGE
// ============================================================

function actionBadge(action) {

  const value =
    String(action || 'UNKNOWN')
      .toUpperCase();

  let className =
    'bg-light text-dark border';


  if (
    value === 'CREATE'
  ) {

    className =
      'bg-success-subtle text-success border border-success-subtle';

  } else if (
    value === 'UPDATE'
  ) {

    className =
      'bg-info-subtle text-info-emphasis border border-info-subtle';

  } else if (
    value === 'DELETE' ||
    value === 'AUDIT_LOGS_CLEARED'
  ) {

    className =
      'bg-danger-subtle text-danger border border-danger-subtle';

  } else if (
    value === 'ASSIGN'
  ) {

    className =
      'bg-primary-subtle text-primary border border-primary-subtle';

  } else if (
    value === 'RETURN'
  ) {

    className =
      'bg-warning-subtle text-warning-emphasis border border-warning-subtle';

  } else if (
    value === 'IMPORT'
  ) {

    className =
      'bg-secondary-subtle text-secondary border border-secondary-subtle';

  } else if (
    value === 'DATABASE_BACKUP_EXPORTED'
  ) {

    className =
      'bg-primary-subtle text-primary border border-primary-subtle';

  } else if (
    value === 'DATABASE_BACKUP_RESTORED'
  ) {

    className =
      'bg-warning-subtle text-warning-emphasis border border-warning-subtle';

  } else if (
    value === 'REPORT_EMAIL_SETTINGS_UPDATED'
  ) {

    className =
      'bg-info-subtle text-info-emphasis border border-info-subtle';

  } else if (
    value === 'ASSET_REPORT_EMAILED'
  ) {

    className =
      'bg-success-subtle text-success border border-success-subtle';

  } else if (
    value === 'ASSET_REPORT_EMAIL_FAILED'
  ) {

    className =
      'bg-danger-subtle text-danger border border-danger-subtle';

  } else if (
    value === 'INVENTORY_SESSION_CREATED'
  ) {

    className =
      'bg-primary-subtle text-primary border border-primary-subtle';

  } else if (
    value === 'INVENTORY_SESSION_STARTED'
  ) {

    className =
      'bg-info-subtle text-info-emphasis border border-info-subtle';

  } else if (
    value === 'INVENTORY_ASSET_VERIFIED'
  ) {

    className =
      'bg-success-subtle text-success border border-success-subtle';

  } else if (
    value === 'INVENTORY_VERIFICATION_UPDATED'
  ) {

    className =
      'bg-warning-subtle text-warning-emphasis border border-warning-subtle';

  } else if (
    value === 'INVENTORY_SESSION_COMPLETED'
  ) {

    className =
      'bg-success-subtle text-success border border-success-subtle';

  } else if (
    value === 'INVENTORY_DISCREPANCY_REVIEWED'
  ) {

    className =
      'bg-info-subtle text-info-emphasis border border-info-subtle';

  } else if (
    value === 'INVENTORY_DISCREPANCY_RESOLVED'
  ) {

    className =
      'bg-success-subtle text-success border border-success-subtle';

  } else if (
    value === 'INVENTORY_REPORT_PRINTED' ||
    value === 'INVENTORY_EXPORTED' ||
    value === 'INVENTORY_LABEL_REPRINTED'
  ) {

    className =
      'bg-primary-subtle text-primary border border-primary-subtle';

  } else if (
    value.startsWith('REPAIR')
  ) {

    className =
      'bg-info-subtle text-info-emphasis border border-info-subtle';

  }


  return `

    <span
      class="audit-action ${className}"
    >
      ${esc(value)}
    </span>

  `;

}


// ============================================================
// ENTITY LABEL
// ============================================================

function entityLabel(value) {

  if (!value) {
    return '—';
  }

  const text =
    String(value);

  return text
    .charAt(0)
    .toUpperCase()
    +
    text.slice(1);

}


// ============================================================
// DETAILS FORMAT
// ============================================================

function formatDetails(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {

    return '—';

  }


  let parsed = value;


  if (typeof value === 'string') {

    try {

      parsed =
        JSON.parse(value);

    } catch {

      return esc(value);

    }

  }


  if (
    typeof parsed === 'object' &&
    parsed !== null
  ) {

    const entries =
      Object.entries(parsed);


    if (!entries.length) {
      return '—';
    }


    return `

      <div class="audit-details">

        ${entries.map(
          ([key, val]) => `

            <div>

              <strong>
                ${esc(key)}:
              </strong>

              ${esc(
                typeof val === 'object'
                  ? JSON.stringify(val)
                  : val
              )}

            </div>

          `
        ).join('')}

      </div>

    `;

  }


  return esc(parsed);

}


// ============================================================
// REFERENCE
// ============================================================

function referenceHtml(row) {

  if (
    row.entity_type === 'asset'
  ) {

    if (row.asset_id) {

      return `

        <div class="audit-reference">

          ${esc(row.asset_id)}

          <small>
            ${esc(row.asset_name || 'Asset')}
          </small>

        </div>

      `;

    }

  }


  if (
    row.entity_type === 'employee' ||
    row.entity_type === 'employees'
  ) {

    if (row.employee_code) {

      return `

        <div class="audit-reference">

          ${esc(row.employee_code)}

          <small>
            ${esc(row.employee_name || 'Employee')}
          </small>

        </div>

      `;

    }

  }


  if (row.entity_id !== null &&
      row.entity_id !== undefined &&
      row.entity_id !== '') {

    return `

      <div class="audit-reference">

        ID: ${esc(row.entity_id)}

      </div>

    `;

  }


  return '—';

}


// ============================================================
// LOAD AUDIT LOGS
// ============================================================

async function loadLogs() {

  try {

    const params =
      new URLSearchParams();


    const search =
      $('searchInput').value.trim();

    const action =
      $('actionFilter').value;

    const entity =
      $('entityFilter').value;

    const dateFrom =
      $('dateFrom').value;

    const dateTo =
      $('dateTo').value;


    if (search) {
      params.set(
        'search',
        search
      );
    }

    if (action) {
      params.set(
        'action',
        action
      );
    }

    if (entity) {
      params.set(
        'entity_type',
        entity
      );
    }

    if (dateFrom) {
      params.set(
        'date_from',
        dateFrom
      );
    }

    if (dateTo) {
      params.set(
        'date_to',
        dateTo
      );
    }


    params.set(
      'page',
      currentPage
    );

    params.set(
      'limit',
      pageSize
    );


    const response =
      await fetch(
        '/api/audit-logs?' +
        params.toString(),
        {
          credentials:
            'include'
        }
      );


    const data =
      await response
        .json()
        .catch(() => ({}));


    if (!response.ok) {

      throw new Error(
        data.message ||
        'Unable to load audit logs.'
      );

    }


    auditRows =
      Array.isArray(data.rows)
        ? data.rows
        : [];


    totalPages =
      Number(
        data.pagination?.totalPages || 1
      );


    renderLogs(
      data.pagination
    );


  } catch (error) {

    console.error(
      'Audit logs error:',
      error
    );

    showAlert(
      error.message ||
      'Unable to load audit logs.'
    );

  }

}


// ============================================================
// RENDER
// ============================================================

function renderLogs(
  pagination = {}
) {

  const body =
    $('auditTableBody');


  const total =
    Number(
      pagination.total || 0
    );


  $('logMeta').textContent =
    `${total.toLocaleString()} record${total === 1 ? '' : 's'}`;


  if (!auditRows.length) {

    body.innerHTML = `

      <tr>

        <td
          colspan="6"
          class="text-center py-5 text-muted"
        >

          No audit logs found.

        </td>

      </tr>

    `;

  } else {

    body.innerHTML =
      auditRows.map(row => `

        <tr>

          <td>
            ${formatDate(row.created_at)}
          </td>


          <td>

            <div class="fw-semibold">
              ${esc(
                row.user_name ||
                row.username ||
                'System'
              )}
            </div>

            ${
              row.username
                ? `
                  <div class="small text-muted">
                    ${esc(row.username)}
                  </div>
                `
                : ''
            }

          </td>


          <td>
            ${actionBadge(row.action)}
          </td>


          <td>
            ${esc(
              entityLabel(row.entity_type)
            )}
          </td>


          <td>
            ${referenceHtml(row)}
          </td>


          <td>
            ${formatDetails(row.details)}
          </td>

        </tr>

      `).join('');

  }


  $('pageInfo').textContent =
    `Page ${currentPage} of ${Math.max(totalPages, 1)}`;


  $('prevBtn').disabled =
    currentPage <= 1;


  $('nextBtn').disabled =
    currentPage >= totalPages;

}


// ============================================================
// CLEAR FILTERS
// ============================================================

function clearFilters() {

  $('searchInput').value = '';

  $('actionFilter').value = '';

  $('entityFilter').value = '';

  $('dateFrom').value = '';

  $('dateTo').value = '';

  currentPage = 1;

  loadLogs();

}


// ============================================================
// BACK
// ============================================================

function goBack() {

  if (
    document.referrer &&
    document.referrer !==
      window.location.href
  ) {

    history.back();

  } else {

    window.location.href =
      '/settings';

  }

}


// ============================================================
// CLEAR AUDIT LOGS
// ============================================================

function setClearAuditError(message = '') {

  const errorBox =
    $('clearAuditError');


  if (!errorBox) return;


  errorBox.textContent =
    message;


  errorBox.classList.toggle(
    'd-none',
    !message
  );

}


function openClearAuditLogs() {

  const form =
    $('clearAuditLogsForm');


  form?.reset();

  setClearAuditError();


  if (!clearAuditModal) {

    showAlert(
      'The confirmation window could not be opened.',
      'danger'
    );

    return;

  }


  clearAuditModal.show();

}


async function clearAuditLogs(event) {

  event.preventDefault();


  const passwordInput =
    $('clearAuditPassword');


  const password =
    passwordInput?.value || '';


  if (!password) {

    setClearAuditError(
      'Enter your admin password.'
    );

    passwordInput?.focus();

    return;

  }


  const button =
    $('confirmClearAuditLogsBtn');


  const originalButtonHtml =
    button?.innerHTML || '';


  setClearAuditError();


  if (button) {
    button.disabled = true;
    button.textContent = 'Clearing...';
  }


  try {

    const response =
      await fetch(
        '/api/audit-logs',
        {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            password
          })
        }
      );


    const data =
      await response
        .json()
        .catch(() => ({}));


    if (
      response.status === 401 &&
      data.message === 'Login required.'
    ) {

      window.location.href =
        '/?session=expired&returnTo=%2Faudit-logs';

      return;

    }


    if (!response.ok) {

      throw new Error(
        data.message ||
        'Unable to clear audit logs.'
      );

    }


    const modalElement =
      $('clearAuditLogsModal');


    if (
      modalElement?.contains(
        document.activeElement
      )
    ) {
      document.activeElement.blur();
    }


    clearAuditModal?.hide();

    currentPage = 1;

    await loadLogs();

    showAlert(
      data.message ||
      'Audit logs cleared successfully.',
      'success'
    );

  } catch (error) {

    setClearAuditError(
      error.message ||
      'Unable to clear audit logs.'
    );

    passwordInput?.select();

  } finally {

    if (button) {
      button.disabled = false;
      button.innerHTML =
        originalButtonHtml;
    }

  }

}


// ============================================================
// PRINT
// ============================================================

function printLogs() {

  const date =
    new Date().toLocaleString(
      'en-PH',
      {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }
    );


  const rows =
    auditRows.length

      ? auditRows.map(row => `

          <tr>

            <td>
              ${esc(
                formatDate(
                  row.created_at
                )
              )}
            </td>

            <td>
              ${esc(
                row.user_name ||
                row.username ||
                'System'
              )}
            </td>

            <td>
              ${esc(
                row.action || '—'
              )}
            </td>

            <td>
              ${esc(
                entityLabel(
                  row.entity_type
                )
              )}
            </td>

            <td>
              ${esc(
                row.asset_id ||
                row.employee_code ||
                row.entity_id ||
                '—'
              )}
            </td>

            <td>
              ${esc(
                plainDetails(
                  row.details
                )
              )}
            </td>

          </tr>

        `).join('')

      : `

        <tr>

          <td colspan="6">
            No records.
          </td>

        </tr>

      `;


  const w =
    window.open(
      '',
      '_blank',
      'width=1400,height=900'
    );


  if (!w) {

    showAlert(
      'Please allow pop-ups for printing.',
      'warning'
    );

    return;

  }


  w.document.write(`

    <!doctype html>

    <html>

    <head>

      <meta charset="utf-8">

      <title>
        Audit Logs - PRIMA IT Asset Management
      </title>

      <style>

        * {
          box-sizing: border-box;
        }

        html,
        body {
          margin: 0;
          padding: 0;
          font-family: Arial, Helvetica, sans-serif;
          color: #111;
          font-size: 9px;
        }

        .page {
          width: 297mm;
          min-height: 210mm;
          padding: 8mm;
          margin: 0 auto;
        }

        .header {
          text-align: center;
          border-bottom: 2px solid #111;
          padding-bottom: 4mm;
          margin-bottom: 4mm;
        }

        .company {
          font-size: 14px;
          font-weight: 700;
        }

        .title {
          font-size: 16px;
          font-weight: 700;
          margin-top: 2mm;
          text-transform: uppercase;
        }

        .meta {
          color: #555;
          font-size: 8px;
          margin-top: 1mm;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 4mm;
        }

        th,
        td {
          border: 1px solid #222;
          padding: 2mm;
          vertical-align: top;
        }

        th {
          background: #f1f1f1;
          font-size: 8px;
          text-align: left;
        }

        td {
          font-size: 8px;
        }

        .footer {
          margin-top: 5mm;
          padding-top: 2mm;
          border-top: 1px solid #999;
          text-align: center;
          color: #666;
          font-size: 7px;
        }

        @page {
          size: A4 landscape;
          margin: 0;
        }

        @media print {

          .page {
            margin: 0;
            width: 297mm;
            min-height: auto;
          }

        }

      </style>

    </head>


    <body>

      <div class="page">

        <div class="header">

          <div class="company">
            Prima Fintech (Philippines) Lending Corporation
          </div>

          <div class="title">
            Audit Logs
          </div>

          <div class="meta">
            Generated ${esc(date)}
          </div>

        </div>


        <table>

          <thead>

            <tr>

              <th>Date / Time</th>

              <th>User</th>

              <th>Action</th>

              <th>Entity</th>

              <th>Reference</th>

              <th>Details</th>

            </tr>

          </thead>

          <tbody>

            ${rows}

          </tbody>

        </table>


        <div class="footer">

          PRIMA IT Asset Management
          •
          Prima Fintech (Philippines) Lending Corporation

        </div>

      </div>


      <script>

        window.addEventListener(
          'load',
          () => setTimeout(
            () => window.print(),
            400
          )
        );

        window.onafterprint =
          () => setTimeout(
            () => window.close(),
            300
          );

      <\/script>

    </body>

    </html>

  `);


  w.document.close();

}


// ============================================================
// PLAIN DETAILS FOR PRINT
// ============================================================

function plainDetails(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {

    return '—';

  }


  let parsed =
    value;


  if (typeof value === 'string') {

    try {

      parsed =
        JSON.parse(value);

    } catch {

      return String(value);

    }

  }


  if (
    typeof parsed === 'object' &&
    parsed !== null
  ) {

    return Object.entries(parsed)
      .map(
        ([key, val]) =>
          `${key}: ${
            typeof val === 'object'
              ? JSON.stringify(val)
              : val
          }`
      )
      .join(' | ');

  }


  return String(parsed);

}


// ============================================================
// EVENTS
// ============================================================

function init() {

  const modalElement =
    $('clearAuditLogsModal');


  if (
    modalElement &&
    typeof bootstrap !== 'undefined'
  ) {

    clearAuditModal =
      bootstrap.Modal
        .getOrCreateInstance(
          modalElement
        );


    modalElement.addEventListener(
      'shown.bs.modal',
      () => {
        $('clearAuditPassword')?.focus();
      }
    );


    modalElement.addEventListener(
      'hidden.bs.modal',
      () => {
        $('clearAuditLogsForm')?.reset();
        setClearAuditError();
      }
    );

  }


  $('clearAuditLogsBtn')
    ?.addEventListener(
      'click',
      openClearAuditLogs
    );


  $('clearAuditLogsForm')
    ?.addEventListener(
      'submit',
      clearAuditLogs
    );

  $('refreshBtn')
    ?.addEventListener(
      'click',
      () => {
        loadLogs();
      }
    );


  $('printBtn')
    ?.addEventListener(
      'click',
      printLogs
    );


  $('clearFiltersBtn')
    ?.addEventListener(
      'click',
      clearFilters
    );


  $('prevBtn')
    ?.addEventListener(
      'click',
      () => {

        if (currentPage > 1) {

          currentPage--;

          loadLogs();

        }

      }
    );


  $('nextBtn')
    ?.addEventListener(
      'click',
      () => {

        if (
          currentPage < totalPages
        ) {

          currentPage++;

          loadLogs();

        }

      }
    );


  $('actionFilter')
    ?.addEventListener(
      'change',
      () => {

        currentPage = 1;

        loadLogs();

      }
    );


  $('entityFilter')
    ?.addEventListener(
      'change',
      () => {

        currentPage = 1;

        loadLogs();

      }
    );


  $('dateFrom')
    ?.addEventListener(
      'change',
      () => {

        currentPage = 1;

        loadLogs();

      }
    );


  $('dateTo')
    ?.addEventListener(
      'change',
      () => {

        currentPage = 1;

        loadLogs();

      }
    );


  let searchTimer;


  $('searchInput')
    ?.addEventListener(
      'input',
      () => {

        clearTimeout(
          searchTimer
        );

        searchTimer =
          setTimeout(
            () => {

              currentPage = 1;

              loadLogs();

            },
            300
          );

      }
    );


  loadLogs();

}


// ============================================================
// START
// ============================================================

document.addEventListener(
  'DOMContentLoaded',
  init
);
