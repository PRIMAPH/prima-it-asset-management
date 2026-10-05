// ============================================================
// PRIMA IT ASSET MANAGEMENT
// CUSTODIAN FORMS
// ============================================================

let custodians = [];
let selectedCustodian = null;

const $ = id =>
  document.getElementById(id);


// ============================================================
// ESCAPE HTML
// ============================================================

function escapeHtml(value) {

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

function showAlert(message, type = 'danger') {

  const existing =
    document.getElementById('custodianAlert');

  if (existing) {
    existing.remove();
  }

  const alert =
    document.createElement('div');

  alert.id =
    'custodianAlert';

  alert.className =
    `alert alert-${type} alert-dismissible fade show shadow-sm`;

  alert.style.position = 'fixed';
  alert.style.top = '20px';
  alert.style.right = '20px';
  alert.style.zIndex = '9999';

  alert.innerHTML = `

    ${escapeHtml(message)}

    <button
      type="button"
      class="btn-close"
      data-bs-dismiss="alert"
    ></button>

  `;

  document.body.appendChild(alert);

  window.PRIMAAlerts?.prepare(
    alert
  );

}


// ============================================================
// LOAD CUSTODIANS
// ============================================================

async function loadCustodians(search = '') {

  const params =
    new URLSearchParams();

  if (search) {

    params.set(
      'search',
      search
    );

  }

  const response =
    await fetch(
      `/api/custodians?${params.toString()}`
    );

  const data =
    await response
      .json()
      .catch(() => []);

  if (!response.ok) {

    throw new Error(
      data.message ||
      'Unable to load custodians.'
    );

  }

  custodians =
    Array.isArray(data)
      ? data
      : [];

  renderCustodianList();

}


// ============================================================
// RENDER CUSTODIAN LIST
// ============================================================

function renderCustodianList() {

  const list =
    $('custodianList');

  if (!list) {
    return;
  }

  if ($('custodianCount')) {

    $('custodianCount').textContent =
      custodians.length;

  }


  if (!custodians.length) {

    list.innerHTML = `

      <div class="custodian-empty p-4">

        No active employees found.

      </div>

    `;

    return;

  }


  list.innerHTML =
    custodians
      .map(custodian => {

        const isActive =
          selectedCustodian &&
          Number(selectedCustodian.id) ===
          Number(custodian.id);


        return `

          <div
            class="custodian-option ${isActive ? 'active' : ''}"
            data-id="${custodian.id}"
          >

            <div class="custodian-option-name">

              ${escapeHtml(
                custodian.full_name
              )}

            </div>


            <div class="custodian-option-details">

              ${escapeHtml(
                custodian.employee_id
              )}

              ${
                custodian.department_name
                  ? ` · ${escapeHtml(
                      custodian.department_name
                    )}`
                  : ''
              }

              <br>

              <span class="badge text-bg-primary mt-1">

                ${Number(
                  custodian.assigned_asset_count || 0
                )}

                assigned

              </span>

            </div>

          </div>

        `;

      })
      .join('');


  list
    .querySelectorAll(
      '.custodian-option'
    )
    .forEach(option => {

      option.addEventListener(
        'click',
        () => {

          selectCustodian(
            Number(
              option.dataset.id
            )
          );

        }
      );

    });

}


// ============================================================
// SELECT CUSTODIAN
// ============================================================

async function selectCustodian(id) {

  try {

    const response =
      await fetch(
        `/api/custodians/${id}`
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {

      throw new Error(
        data.message ||
        'Unable to load custodian.'
      );

    }


    selectedCustodian =
      data.employee;


    selectedCustodian.assets =
      Array.isArray(data.assets)
        ? data.assets
        : [];


    renderCustodianList();

    renderCustodianDetails();

  } catch (error) {

    console.error(
      'Custodian load error:',
      error
    );

    showAlert(
      error.message ||
      'Unable to load custodian details.'
    );

  }

}


// ============================================================
// RENDER DETAILS
// ============================================================

function renderCustodianDetails() {

  const emptyState =
    $('custodianEmptyState');

  const details =
    $('custodianDetails');


  if (!selectedCustodian) {

    emptyState
      ?.classList.remove('d-none');

    details
      ?.classList.add('d-none');

    if ($('printCustodianBtn')) {

      $('printCustodianBtn').disabled =
        true;

    }

    return;

  }


  emptyState
    ?.classList.add('d-none');

  details
    ?.classList.remove('d-none');


  if ($('custodianFullName')) {

    $('custodianFullName').textContent =
      selectedCustodian.full_name ||
      '—';

  }


  if ($('custodianEmployeeDetails')) {

    $('custodianEmployeeDetails').textContent =
      [
        selectedCustodian.email,
        selectedCustodian.status
      ]
        .filter(Boolean)
        .join(' · ');

  }


  if ($('custodianEmployeeId')) {

    $('custodianEmployeeId').textContent =
      selectedCustodian.employee_id ||
      '—';

  }


  if ($('custodianDepartment')) {

    $('custodianDepartment').textContent =
      selectedCustodian.department_name ||
      '—';

  }


  if ($('custodianPosition')) {

    $('custodianPosition').textContent =
      selectedCustodian.position_title ||
      '—';

  }


  const assetList =
    Array.isArray(
      selectedCustodian.assets
    )
      ? selectedCustodian.assets
      : [];


  if ($('custodianAssetCount')) {

    $('custodianAssetCount').textContent =
      assetList.length;

  }


  if ($('printCustodianBtn')) {

    $('printCustodianBtn').disabled =
      false;

  }


  const tbody =
    $('custodianAssetTableBody');

  const noAssets =
    $('custodianNoAssets');


  if (!assetList.length) {

    if (tbody) {
      tbody.innerHTML = '';
    }

    noAssets
      ?.classList.remove('d-none');

    return;

  }


  noAssets
    ?.classList.add('d-none');


  if (!tbody) {
    return;
  }


  tbody.innerHTML =
    assetList
      .map(asset => {

        const brandModel =
          [
            asset.brand,
            asset.model
          ]
            .filter(Boolean)
            .join(' ');


        return `

          <tr>

            <td class="fw-semibold">

              ${escapeHtml(
                asset.asset_id
              )}

            </td>

            <td>

              ${escapeHtml(
                asset.asset_name
              )}

            </td>

            <td>

              ${escapeHtml(
                asset.category_name || '—'
              )}

            </td>

            <td>

              ${escapeHtml(
                brandModel || '—'
              )}

            </td>

            <td>

              ${escapeHtml(
                asset.serial_number || '—'
              )}

            </td>

            <td>

              ${escapeHtml(
                asset.condition_status || '—'
              )}

            </td>

            <td>

              ${formatCustodianDate(
                asset.assigned_at
              )}

            </td>

          </tr>

        `;

      })
      .join('');

}


// ============================================================
// FORMAT DATE
// ============================================================

function formatCustodianDate(value) {

  if (!value) {
    return '—';
  }

  const date =
    new Date(
      String(value)
        .replace(' ', 'T')
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return escapeHtml(
      String(value)
    );

  }


  return date.toLocaleDateString(
    'en-PH',
    {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    }
  );

}


// ============================================================
// PRINT CUSTODIAN AGREEMENT
// ============================================================

function printCustodianAgreement() {

  if (!selectedCustodian) {

    showAlert(
      'Please select a custodian first.',
      'warning'
    );

    return;

  }


  const employee =
    selectedCustodian;


  const assetList =
    Array.isArray(
      employee.assets
    )
      ? employee.assets
      : [];


  const today =
    new Date()
      .toLocaleDateString(
        'en-PH',
        {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }
      );


  const rows =
    assetList.length

      ? assetList
          .map((asset, index) => {

            const brandModel =
              [
                asset.brand,
                asset.model
              ]
                .filter(Boolean)
                .join(' ');


            return `

              <tr>

                <td class="center">
                  ${index + 1}
                </td>

                <td>
                  ${escapeHtml(
                    asset.asset_id
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    asset.asset_name
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    asset.category_name || '—'
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    brandModel || '—'
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    asset.serial_number || '—'
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    asset.condition_status || '—'
                  )}
                </td>

              </tr>

            `;

          })
          .join('')

      : `

          <tr>

            <td
              colspan="7"
              class="center"
            >

              No assets currently assigned.

            </td>

          </tr>

        `;


  const printWindow =
    window.open(
      '',
      '_blank',
      'width=1000,height=900'
    );


  if (!printWindow) {

    alert(
      'Please allow pop-ups for this site so the custodian form can be printed.'
    );

    return;

  }
  const custodianName =
  String(
    employee.full_name ||
    'Custodian'
  ).trim();


// Remove characters Windows does not allow in filenames
const safeCustodianName =
  custodianName
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();


const pdfFileName =
  `${safeCustodianName} Asset Acknowledgement Form`;


  printWindow.document.open();


  printWindow.document.write(`

<!doctype html>

<html lang="en">

<head>

<meta charset="utf-8">

<title>${escapeHtml(pdfFileName)}</title>
<style>

* {
  box-sizing: border-box;
}

html,
body {

  margin: 0;
  padding: 0;

  font-family:
    Arial,
    Helvetica,
    sans-serif;

  color: #111;
  background: #fff;

}

body {
  font-size: 11px;
}

.page {

  width: 210mm;
  min-height: 297mm;

  margin: 0 auto;

  padding: 14mm;

  position: relative;
  overflow: hidden;

}

.company-watermark {

  position: absolute;
  top: 52%;
  left: 50%;

  width: 145mm;
  max-width: 74%;
  height: auto;

  transform: translate(-50%, -50%) rotate(-24deg);

  opacity: 0.055;
  filter: grayscale(1);

  pointer-events: none;
  user-select: none;

  z-index: 0;

  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;

}

.page > :not(.company-watermark) {

  position: relative;
  z-index: 1;

}

.header {

  text-align: center;
  margin-bottom: 8mm;

}

.company {

  font-size: 15px;
  font-weight: 700;

}

.document-title {

  font-size: 14px;
  font-weight: 700;

  margin-top: 4px;

  text-transform: uppercase;

}

.subtitle {

  font-size: 10px;

  color: #555;

  margin-top: 3px;

}

.info-table {

  width: 100%;

  border-collapse: collapse;

  margin-bottom: 7mm;

}

.info-table td {

  padding: 4px 6px;

  border: 1px solid #ccc;

}

.info-label {

  width: 22%;

  font-weight: 700;

  background: #f5f5f5;

}

.asset-table {

  width: 100%;

  border-collapse: collapse;

  margin-top: 4mm;

}

.asset-table th,
.asset-table td {

  border: 1px solid #333;

  padding: 5px;

  vertical-align: middle;

}

.asset-table th {

  background: #f1f1f1;

  font-size: 9px;

}

.asset-table td {

  font-size: 9px;

}

.center {

  text-align: center;

}

.statement {

  margin-top: 8mm;

  line-height: 1.55;

  text-align: justify;

}

.signature-area {

  margin-top: 25mm;

  display: grid;

  grid-template-columns: 1fr 1fr;

  gap: 25mm;

}

.signature-box {

  text-align: center;

}

.signature-line {

  border-bottom: 1px solid #111;

  height: 18mm;

  margin-bottom: 3mm;

}

.signature-name {

  font-weight: 700;

}

.signature-role {

  font-size: 10px;

  color: #555;

  margin-top: 2px;

}

.footer-note {

  margin-top: 12mm;

  font-size: 9px;

  color: #666;

  text-align: center;

}

@page {

  size: A4 portrait;
  margin: 0;

}

@media print {

  html,
  body {

    width: 210mm;
    min-height: 297mm;

  }

  .page {
    margin: 0;
  }

}

</style>

</head>

<body>

<div class="page">

  <img
    class="company-watermark"
    src="/images/prima-company-logo.png"
    alt=""
    aria-hidden="true"
  >

  <div class="header">

    <div class="company">
      Prima Fintech (Philippines)
    </div>

    <div class="company">
      Lending Corporation
    </div>

    <div class="document-title">
      IT Asset Custodian Acknowledgement Form
    </div>

    <div class="subtitle">
      Asset assignment and accountability record
    </div>

  </div>


  <table class="info-table">

    <tr>

      <td class="info-label">
        Employee ID
      </td>

      <td>
        ${escapeHtml(
          employee.employee_id || '—'
        )}
      </td>

      <td class="info-label">
        Date
      </td>

      <td>
        ${escapeHtml(today)}
      </td>

    </tr>


    <tr>

      <td class="info-label">
        Custodian
      </td>

      <td colspan="3">
        ${escapeHtml(
          employee.full_name || '—'
        )}
      </td>

    </tr>


    <tr>

      <td class="info-label">
        Department
      </td>

      <td>
        ${escapeHtml(
          employee.department_name || '—'
        )}
      </td>

      <td class="info-label">
        Position
      </td>

      <td>
        ${escapeHtml(
          employee.position_title || '—'
        )}
      </td>

    </tr>

  </table>


  <div>

    <strong>
      Assigned IT Assets
    </strong>

  </div>


  <table class="asset-table">

    <thead>

      <tr>

        <th>#</th>
        <th>Asset Tag</th>
        <th>Asset</th>
        <th>Category</th>
        <th>Brand / Model</th>
        <th>Serial Number</th>
        <th>Condition</th>

      </tr>

    </thead>

    <tbody>

      ${rows}

    </tbody>

  </table>


  <div class="statement">

    I acknowledge that the IT assets listed above have
    been issued to me for authorized company use. I
    understand that I am responsible for the proper
    care, security, and safekeeping of these assets while
    they are assigned to me. I will promptly report any
    loss, theft, damage, malfunction, or other issue to
    the IT Department and will return the assets when
    requested or when my assignment ends.

  </div>


  <div class="signature-area">

    <div class="signature-box">

      <div class="signature-line"></div>

      <div class="signature-name">
        ${escapeHtml(
          employee.full_name || ''
        )}
      </div>

      <div class="signature-role">
        Custodian / Employee
      </div>

    </div>


    <div class="signature-box">

      <div class="signature-line"></div>

      <div class="signature-name">
        IT Department
      </div>

      <div class="signature-role">
        Authorized IT Representative
      </div>

    </div>

  </div>


  <div class="footer-note">

    Generated by PRIMA IT Asset Management

  </div>


</div>


<script>

window.addEventListener(
  'load',
  function() {

    setTimeout(
      function() {

        document.title =
  ${JSON.stringify(pdfFileName)};

window.focus();

window.print();
      },
      500
    );

  }
);


window.onafterprint =
  function() {

    setTimeout(
      function() {

        window.close();

      },
      300
    );

  };

</script>

</body>

</html>

  `);

  printWindow.document.close();
  printWindow.document.title =
  pdfFileName;

}


// ============================================================
// SEARCH
// ============================================================

let searchTimer;

$('custodianSearch')
  ?.addEventListener(
    'input',
    () => {

      clearTimeout(
        searchTimer
      );

      searchTimer =
        setTimeout(
          () => {

            loadCustodians(
              $('custodianSearch')
                ?.value || ''
            )
              .catch(error => {

                console.error(error);

                showAlert(
                  error.message ||
                  'Unable to search custodians.'
                );

              });

          },
          250
        );

    }
  );


// ============================================================
// PRINT BUTTON
// ============================================================

$('printCustodianBtn')
  ?.addEventListener(
    'click',
    printCustodianAgreement
  );


// ============================================================
// INITIALIZE
// ============================================================

async function init() {

  try {

    const response =
      await fetch('/api/auth/me');

    if (!response.ok) {

      window.location.href = '/';

      return;

    }


    await loadCustodians();

  } catch (error) {

    console.error(
      'Custodian Forms initialization error:',
      error
    );

    const list =
      $('custodianList');

    if (list) {

      list.innerHTML = `

        <div class="alert alert-danger m-3">

          Unable to load custodians.

          <br>

          <small>
            ${escapeHtml(
              error.message ||
              'Unknown error'
            )}
          </small>

        </div>

      `;

    }

  }

}


// ============================================================
// START
// ============================================================

document.addEventListener(
  'DOMContentLoaded',
  init
);
