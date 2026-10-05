// ============================================================
// PRIMA IT ASSET MANAGEMENT
// EMPLOYEE CLEARANCE
// ============================================================

let clearances = [];
let clearanceEmployees = [];

let clearanceModal;
let viewClearanceModal;
let processReturnModal;

let selectedClearance = null;
let selectedClearanceItem = null;

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

function showAlert(
  message,
  type = 'success'
) {

  const box =
    $('alertBox');

  if (!box) return;

  if (window.PRIMAAlerts) {

    window.PRIMAAlerts.show(
      box,
      message,
      { type }
    );

    return;

  }

  box.innerHTML = `

    <div
      class="alert alert-${type} alert-dismissible fade show"
      role="alert"
    >

      ${escapeHtml(message)}

      <button
        type="button"
        class="btn-close"
        data-bs-dismiss="alert"
        aria-label="Close"
      ></button>

    </div>

  `;

}


// ============================================================
// FORM ALERT
// ============================================================

function showFormAlert(
  message,
  type = 'danger'
) {

  const box =
    $('clearanceFormAlert');

  if (!box) return;

  box.innerHTML = `

    <div class="alert alert-${type}">

      ${escapeHtml(message)}

    </div>

  `;

}


// ============================================================
// RETURN FORM ALERT
// ============================================================

function showReturnAlert(
  message,
  type = 'danger'
) {

  const box =
    $('processReturnAlert');

  if (!box) return;

  box.innerHTML = `

    <div class="alert alert-${type}">

      ${escapeHtml(message)}

    </div>

  `;

}


// ============================================================
// CLEARANCE STATUS BADGE
// ============================================================

function clearanceStatusBadge(
  status
) {

  const classes = {

    Draft:
      'text-bg-secondary',

    Pending:
      'text-bg-warning',

    Cleared:
      'text-bg-success',

    'On Hold':
      'text-bg-danger',

    Cancelled:
      'text-bg-dark'

  };


  return `

    <span class="badge ${
      classes[status] ||
      'text-bg-secondary'
    }">

      ${escapeHtml(
        status || 'Unknown'
      )}

    </span>

  `;

}


// ============================================================
// RETURN STATUS BADGE
// ============================================================

function returnStatusBadge(
  status
) {

  const classes = {

    Pending:
      'text-bg-warning',

    Returned:
      'text-bg-success',

    Lost:
      'text-bg-danger',

    Damaged:
      'text-bg-danger',

    'For Repair':
      'text-bg-info',

    'Not Found':
      'text-bg-dark',

    Waived:
      'text-bg-secondary'

  };


  return `

    <span class="badge ${
      classes[status] ||
      'text-bg-secondary'
    }">

      ${escapeHtml(
        status || 'Pending'
      )}

    </span>

  `;

}


// ============================================================
// FORMAT DATE/TIME
// ============================================================

function formatDateTime(
  value
) {

  if (!value)
    return '—';


  const date =
    new Date(value);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return '—';

  }


  return escapeHtml(
    date.toLocaleString(
      'en-US',
      {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }
    )
  );

}


// ============================================================
// FORMAT DATE ONLY
// ============================================================

function formatDateOnly(
  value
) {

  if (!value)
    return '—';


  const date =
    new Date(
      `${value}T00:00:00`
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return escapeHtml(
      value
    );

  }


  return escapeHtml(
    date.toLocaleDateString(
      'en-US',
      {
        year: 'numeric',
        month: 'short',
        day: '2-digit'
      }
    )
  );

}


// ============================================================
// LOAD CLEARANCES
// ============================================================

async function loadClearances() {

  const params =
    new URLSearchParams();


  const search =
    $('searchInput')
      .value
      .trim();


  const status =
    $('statusFilter')
      .value;


  if (search) {

    params.set(
      'search',
      search
    );

  }


  if (status) {

    params.set(
      'status',
      status
    );

  }


  const response =
    await fetch(
      `/api/clearances?${params}`
    );


  if (!response.ok) {

    const data =
      await response
        .json()
        .catch(() => ({}));


    throw new Error(
      data.message ||
      'Unable to load clearances.'
    );

  }


  clearances =
    await response.json();


  renderClearances();

}


// ============================================================
// RENDER CLEARANCES
// ============================================================

function renderClearances() {

  $('clearanceCount')
    .textContent =
      `${clearances.length} ${
        clearances.length === 1
          ? 'record'
          : 'records'
      }`;


  if (!clearances.length) {

    $('clearanceTableBody')
      .innerHTML = `

        <tr>

          <td
            colspan="7"
            class="text-center text-muted py-5"
          >

            <i class="bi bi-folder2-open fs-2 d-block mb-2"></i>

            No clearance records found.

          </td>

        </tr>

      `;

    return;

  }


  $('clearanceTableBody')
    .innerHTML =

    clearances.map(
      clearance => {

        const separationDate =
          clearance.separation_date
            ? formatDateOnly(
                clearance.separation_date
              )
            : '—';


        return `

          <tr>

            <td class="fw-semibold">

              ${escapeHtml(
                clearance.clearance_no
              )}

            </td>


            <td>

              <div class="fw-semibold">

                ${escapeHtml(
                  clearance.employee_name
                )}

              </div>

              <div class="small text-muted">

                ${escapeHtml(
                  clearance.employee_code
                )}

              </div>

            </td>


            <td>

              ${escapeHtml(
                clearance.department_name ||
                '—'
              )}

            </td>


            <td>

              ${separationDate}

            </td>


            <td>

              <span class="badge text-bg-light">

                ${
                  Number(
                    clearance.returned_items || 0
                  )
                }
                /
                ${
                  Number(
                    clearance.total_items || 0
                  )
                }
                returned

              </span>

            </td>


            <td>

              ${clearanceStatusBadge(
                clearance.status
              )}

            </td>


            <td class="text-end">

              <button
                type="button"
                class="btn btn-sm btn-outline-primary view-clearance-btn"
                data-id="${clearance.id}"
              >

                <i class="bi bi-eye me-1"></i>

                View

              </button>

            </td>

          </tr>

        `;

      }
    ).join('');


  document
    .querySelectorAll(
      '.view-clearance-btn'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () =>
            viewClearance(
              button.dataset.id
            )
        );

      }
    );

}


// ============================================================
// LOAD EMPLOYEES
// ============================================================

async function loadClearanceEmployees() {

  const response =
    await fetch(
      '/api/clearance-employees'
    );


  if (!response.ok) {

    const data =
      await response
        .json()
        .catch(() => ({}));


    throw new Error(
      data.message ||
      'Unable to load employees.'
    );

  }


  clearanceEmployees =
    await response.json();


  $('clearanceEmployee')
    .innerHTML = `

      <option value="">
        Select Employee
      </option>

      ${
        clearanceEmployees
          .map(
            employee => `

              <option
                value="${employee.id}"
              >

                ${escapeHtml(
                  employee.employee_id
                )}
                -
                ${escapeHtml(
                  employee.full_name
                )}

                ${
                  Number(
                    employee.assigned_asset_count
                  ) > 0
                    ? ` (${employee.assigned_asset_count} asset${
                        Number(employee.assigned_asset_count) === 1
                          ? ''
                          : 's'
                      })`
                    : ''
                }

              </option>

            `
          )
          .join('')
      }

    `;

    setupClearanceEmployeeSearch();

}


// ============================================================
// PREVIEW EMPLOYEE ASSETS
// ============================================================

async function previewEmployeeAssets() {

  const employeeId =
    $('clearanceEmployee')
      .value;


  const preview =
    $('clearanceAssetPreview');


  if (!employeeId) {

    preview.innerHTML = `

      <div class="alert alert-info mb-0">

        Select an employee to view
        currently assigned assets.

      </div>

    `;

    return;

  }


  preview.innerHTML = `

    <div class="text-center text-muted py-3">

      Loading assigned assets...

    </div>

  `;


  try {

    const response =
      await fetch(
        `/api/custodians/${employeeId}`
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.message ||
        'Unable to load assets.'
      );

    }


    const assets =
      Array.isArray(data.assets)
        ? data.assets
        : [];


    if (!assets.length) {

      preview.innerHTML = `

        <div class="alert alert-success mb-0">

          <i class="bi bi-check-circle me-1"></i>

          This employee has no currently
          assigned assets.

        </div>

      `;

      return;

    }


    preview.innerHTML = `

      <div class="alert alert-warning">

        <strong>
          ${assets.length}
          assigned asset${
            assets.length === 1
              ? ''
              : 's'
          }
        </strong>

        must be accounted for during clearance.

      </div>


      <div class="table-responsive">

        <table class="table table-sm table-bordered align-middle">

          <thead class="table-light">

            <tr>

              <th>Asset Tag</th>

              <th>Asset</th>

              <th>Serial Number</th>

              <th>Condition</th>

              <th>Status</th>

            </tr>

          </thead>

          <tbody>

            ${
              assets.map(
                asset => `

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
                        asset.serial_number ||
                        '—'
                      )}

                    </td>

                    <td>

                      ${escapeHtml(
                        asset.condition_status ||
                        '—'
                      )}

                    </td>

                    <td>

                      ${returnStatusBadge(
                        'Pending'
                      )}

                    </td>

                  </tr>

                `
              ).join('')
            }

          </tbody>

        </table>

      </div>

    `;

  } catch (error) {

    preview.innerHTML = `

      <div class="alert alert-danger">

        ${escapeHtml(
          error.message
        )}

      </div>

    `;

  }

}


// ============================================================
// CREATE CLEARANCE
// ============================================================

async function createClearance(
  event
) {

  event.preventDefault();


  const employeeId =
    $('clearanceEmployee')
      .value;


  if (!employeeId) {

    showFormAlert(
      'Please select an employee.'
    );

    return;

  }


  const payload = {

    employee_id:
      Number(employeeId),

    separation_date:
      $('separationDate').value ||
      null,

    separation_reason:
      $('separationReason').value,

    remarks:
      $('clearanceRemarks')
        .value
        .trim()

  };


  try {

    const response =
      await fetch(
        '/api/clearances',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify(
              payload
            )

        }
      );


    const result =
      await response
        .json()
        .catch(() => ({}));


    if (!response.ok) {

      throw new Error(
        result.message ||
        'Unable to create clearance.'
      );

    }


    clearanceModal.hide();


    showAlert(
      `Clearance ${result.clearance_no} created successfully.`
    );


    await loadClearances();


    await viewClearance(
      result.id
    );


  } catch (error) {

    showFormAlert(
      error.message
    );

  }

}


// ============================================================
// VIEW CLEARANCE
// ============================================================

async function viewClearance(
  id
) {

  try {

    const response =
      await fetch(
        `/api/clearances/${id}`
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.message ||
        'Unable to load clearance.'
      );

    }


    selectedClearance =
      data;


    const clearance =
      data.clearance;


    const items =
      Array.isArray(data.items)
        ? data.items
        : [];


    $('viewClearanceSubtitle')
      .textContent =
        `${clearance.clearance_no} · ${
          clearance.employee_name
        }`;


    $('viewClearanceEmployeeId')
      .textContent =
        clearance.employee_code ||
        '—';


    $('viewClearanceEmployeeName')
      .textContent =
        clearance.employee_name ||
        '—';


    $('viewClearanceDepartment')
      .textContent =
        clearance.department_name ||
        '—';


    $('viewClearancePosition')
      .textContent =
        clearance.position_title ||
        '—';


    $('viewClearanceSeparationDate')
      .textContent =
        formatDateOnly(
          clearance.separation_date
        );


    $('viewClearanceStatus')
      .innerHTML =
        clearanceStatusBadge(
          clearance.status
        );


    // --------------------------------------------------------
    // ASSET TABLE
    // --------------------------------------------------------

    if (!items.length) {

      $('viewClearanceItems')
        .innerHTML = `

          <tr>

            <td
              colspan="8"
              class="text-center text-muted py-4"
            >

              <i class="bi bi-check-circle fs-3 d-block mb-2"></i>

              No assets were assigned
              at the time this clearance
              was created.

            </td>

          </tr>

        `;

    } else {

      $('viewClearanceItems')
        .innerHTML =
          items.map(
            item => {

              const isFinal =
                item.return_status ===
                  'Returned' ||
                item.return_status ===
                  'Waived';


              const actionButton =
                isFinal

                  ? `

                    <span class="text-muted small">

                      <i class="bi bi-check-circle me-1"></i>

                      Processed

                    </span>

                  `

                  : `

                    <button
                      type="button"
                      class="btn btn-sm btn-outline-primary process-return-btn"
                      data-item-id="${item.id}"
                    >

                      <i class="bi bi-box-arrow-in-left me-1"></i>

                      Process Return

                    </button>

                  `;


              return `

                <tr>

                  <td class="fw-semibold">

                    ${escapeHtml(
                      item.asset_tag
                    )}

                  </td>


                  <td>

                    ${escapeHtml(
                      item.asset_name
                    )}

                  </td>


                  <td>

                    ${escapeHtml(
                      item.serial_number ||
                      '—'
                    )}

                  </td>


                  <td>

                    ${escapeHtml(
                      item.condition_at_clearance ||
                      '—'
                    )}

                  </td>


                  <td>

                    ${formatDateTime(
                      item.assignment_date
                    )}

                  </td>


                  <td>

                    ${returnStatusBadge(
                      item.return_status
                    )}

                  </td>


                  <td>

                    ${formatDateTime(
                      item.return_date
                    )}

                  </td>


                  <td class="text-center">

                    ${actionButton}

                  </td>

                </tr>

              `;

            }
          ).join('');


      // ------------------------------------------------------
      // PROCESS BUTTONS
      // ------------------------------------------------------

      document
        .querySelectorAll(
          '.process-return-btn'
        )
        .forEach(
          button => {

            button.addEventListener(
              'click',
              () => {

                openProcessReturn(
                  Number(
                    button.dataset.itemId
                  )
                );

              }
            );

          }
        );

    }


    // --------------------------------------------------------
    // SUMMARY
    // --------------------------------------------------------

    renderClearanceSummary(
      items,
      clearance.status
    );


    viewClearanceModal.show();


  } catch (error) {

    showAlert(
      error.message,
      'danger'
    );

  }

}


// ============================================================
// RENDER CLEARANCE SUMMARY
// ============================================================

function renderClearanceSummary(
  items,
  clearanceStatus
) {

  const summary =
    $('viewClearanceSummary');


  if (!items.length) {

    summary.innerHTML = `

      <div class="alert alert-success">

        <i class="bi bi-check-circle me-1"></i>

        No IT assets were assigned
        to this employee.

      </div>

    `;

    return;

  }


  const pending =
    items.filter(
      item =>
        item.return_status ===
        'Pending'
    ).length;


  const returned =
    items.filter(
      item =>
        item.return_status ===
        'Returned'
    ).length;


  const waived =
    items.filter(
      item =>
        item.return_status ===
        'Waived'
    ).length;


  const issues =
    items.filter(
      item =>
        [
          'Lost',
          'Damaged',
          'For Repair',
          'Not Found'
        ].includes(
          item.return_status
        )
    ).length;


  const total =
    items.length;


  if (
    clearanceStatus ===
    'Cleared'
  ) {

    summary.innerHTML = `

      <div class="alert alert-success">

        <div class="fw-bold mb-1">

          <i class="bi bi-check-circle me-1"></i>

          Clearance Cleared

        </div>

        All clearance assets have been
        accounted for.

        <div class="mt-2 small">

          ${returned} returned
          ${waived ? ` · ${waived} waived` : ''}
          · ${total} total

        </div>

      </div>

    `;

    return;

  }


  if (
    clearanceStatus ===
    'On Hold'
  ) {

    summary.innerHTML = `

      <div class="alert alert-danger">

        <div class="fw-bold mb-1">

          <i class="bi bi-exclamation-triangle me-1"></i>

          Clearance On Hold

        </div>

        ${issues}
        asset${
          issues === 1
            ? ''
            : 's'
        }
        require further action.

        <div class="mt-2 small">

          ${returned} returned
          · ${pending} pending
          · ${issues} issue${
            issues === 1
              ? ''
              : 's'
          }

        </div>

      </div>

    `;

    return;

  }


  if (
    clearanceStatus ===
    'Pending'
  ) {

    summary.innerHTML = `

      <div class="alert alert-warning">

        <div class="fw-bold mb-1">

          <i class="bi bi-hourglass-split me-1"></i>

          Clearance Pending

        </div>

        ${pending}
        asset${
          pending === 1
            ? ''
            : 's'
        }
        still require action.

        <div class="mt-2 small">

          ${returned} returned
          ${waived ? ` · ${waived} waived` : ''}
          · ${pending} pending
          · ${total} total

        </div>

      </div>

    `;

    return;

  }


  // ----------------------------------------------------------
  // DRAFT
  // ----------------------------------------------------------

  summary.innerHTML = `

    <div class="alert alert-secondary">

      <div class="fw-bold mb-1">

        <i class="bi bi-file-earmark me-1"></i>

        Clearance Draft

      </div>

      ${total}
      asset${
        total === 1
          ? ''
          : 's'
      }
      require return processing.

    </div>

  `;

}


// ============================================================
// OPEN PROCESS RETURN
// ============================================================

function openProcessReturn(
  itemId
) {

  if (
    !selectedClearance ||
    !Array.isArray(
      selectedClearance.items
    )
  ) {

    showAlert(
      'Clearance data is not available.',
      'danger'
    );

    return;

  }


  const item =
    selectedClearance.items.find(
      current =>
        Number(current.id) ===
        Number(itemId)
    );


  if (!item) {

    showAlert(
      'Clearance item not found.',
      'danger'
    );

    return;

  }


  selectedClearanceItem =
    item;


  $('processReturnItemId')
    .value =
      item.id;


  $('processReturnAssetTag')
    .textContent =
      item.asset_tag ||
      '—';


  $('processReturnAssetName')
    .textContent =
      item.asset_name ||
      '—';


  $('processReturnSerial')
    .textContent =
      item.serial_number ||
      '—';


  $('processReturnStatus')
    .value =
      item.return_status ||
      'Pending';


  $('processReturnRemarks')
    .value =
      item.remarks ||
      '';


  $('processReturnSubtitle')
    .textContent =
      `${selectedClearance.clearance.clearance_no} · ${
        item.asset_tag
      }`;


  $('processReturnAlert')
    .innerHTML = '';


  updateReturnWarning();


  processReturnModal.show();

}


// ============================================================
// RETURN STATUS WARNING
// ============================================================

function updateReturnWarning() {

  const status =
    $('processReturnStatus')
      .value;


  const warning =
    $('processReturnWarning');


  if (!warning)
    return;


  if (
    status ===
    'Returned'
  ) {

    warning.className =
      'alert alert-success small mb-0';


    warning.innerHTML = `

      <i class="bi bi-check-circle me-1"></i>

      The asset will be marked
      <strong>Available</strong> and its
      active employee assignment will be closed.

    `;

  }

  else if (
    status ===
    'For Repair'
  ) {

    warning.className =
      'alert alert-info small mb-0';


    warning.innerHTML = `

      <i class="bi bi-tools me-1"></i>

      The asset will be marked
      <strong>For Repair</strong>.
      The clearance will remain on hold.

    `;

  }

  else if (
    status ===
    'Damaged'
  ) {

    warning.className =
      'alert alert-danger small mb-0';


    warning.innerHTML = `

      <i class="bi bi-exclamation-triangle me-1"></i>

      The asset will be marked
      <strong>Broken</strong>.
      The clearance will remain on hold.

    `;

  }

  else if (
    status ===
      'Lost' ||
    status ===
      'Not Found'
  ) {

    warning.className =
      'alert alert-danger small mb-0';


    warning.innerHTML = `

      <i class="bi bi-exclamation-octagon me-1"></i>

      The asset will be marked
      <strong>Lost</strong> and the clearance
      will remain on hold.

    `;

  }

  else if (
    status ===
    'Waived'
  ) {

    warning.className =
      'alert alert-secondary small mb-0';


    warning.innerHTML = `

      <i class="bi bi-dash-circle me-1"></i>

      This item will be treated as
      <strong>Waived</strong>. The asset's
      current status will not be changed.

    `;

  }

  else {

    warning.className =
      'alert alert-warning small mb-0';


    warning.innerHTML = `

      <i class="bi bi-info-circle me-1"></i>

      The asset remains pending and
      still requires action.

    `;

  }

}


// ============================================================
// SAVE RETURN
// ============================================================

async function saveReturn(
  event
) {

  event.preventDefault();


  const itemId =
    Number(
      $('processReturnItemId')
        .value
    );


  const returnStatus =
    $('processReturnStatus')
      .value;


  const remarks =
    $('processReturnRemarks')
      .value
      .trim();


  if (
    !Number.isInteger(itemId) ||
    itemId <= 0
  ) {

    showReturnAlert(
      'Invalid clearance item.'
    );

    return;

  }


  if (!returnStatus) {

    showReturnAlert(
      'Please select a return status.'
    );

    return;

  }


  const saveButton =
    $('processReturnSaveBtn');


  const originalButton =
    saveButton.innerHTML;


  try {

    saveButton.disabled =
      true;


    saveButton.innerHTML = `

      <span
        class="spinner-border spinner-border-sm me-1"
      ></span>

      Saving...

    `;


    const response =
      await fetch(
        `/api/clearance-items/${itemId}`,
        {
          method: 'PUT',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({

              return_status:
                returnStatus,

              remarks:
                remarks || null

            })

          }
        
      );


    const result =
      await response
        .json()
        .catch(() => ({}));


    if (!response.ok) {

      throw new Error(
        result.message ||
        'Unable to process asset return.'
      );

    }


    processReturnModal.hide();


    showAlert(
      `Asset return updated to "${returnStatus}".`
    );


    // Refresh the main clearance list

    await loadClearances();


    // Refresh the currently opened clearance

    if (
      selectedClearance &&
      selectedClearance.clearance
    ) {

      await viewClearance(
        selectedClearance.clearance.id
      );

    }


  } catch (error) {

    showReturnAlert(
      error.message
    );

  } finally {

    saveButton.disabled =
      false;

    saveButton.innerHTML =
      originalButton;

  }

}


// ============================================================
// PRINT CLEARANCE FORM
// ============================================================

function printClearance() {

  if (!selectedClearance)
    return;


  const clearance =
    selectedClearance.clearance;


  const items =
    selectedClearance.items || [];


  const employeeName =
    clearance.employee_name ||
    'Employee';


  const printWindow =
    window.open(
      '',
      '_blank'
    );


  if (!printWindow) {

    alert(
      'Please allow pop-ups to print the clearance form.'
    );

    return;

  }


  const rows =
    items.map(
      (item, index) => `

        <tr>

          <td>
            ${index + 1}
          </td>

          <td>
            ${escapeHtml(
              item.asset_tag
            )}
          </td>

          <td>
            ${escapeHtml(
              item.asset_name
            )}
          </td>

          <td>
            ${escapeHtml(
              item.serial_number ||
              '—'
            )}
          </td>

          <td>
            ${escapeHtml(
              item.condition_at_clearance ||
              '—'
            )}
          </td>

          <td>
            ${escapeHtml(
              item.return_status ||
              'Pending'
            )}
          </td>

          <td>
            ${formatDateTime(
              item.return_date
            )}
          </td>

        </tr>

      `
    ).join('');


  printWindow.document.write(`

<!doctype html>

<html>

<head>

<meta charset="utf-8">

<title>
${escapeHtml(employeeName)} - IT Clearance Form
</title>

<style>

@page {
  size: A4 portrait;
  margin: 0;
}

* {
  box-sizing: border-box;
}

body {

  margin: 0;

  font-family:
    Arial,
    Helvetica,
    sans-serif;

  color: #111;

  font-size: 12px;

  background: #fff;

}

.page {

  position: relative;
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 12mm;
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

  border-bottom:
    2px solid #111;

  padding-bottom: 10px;

  margin-bottom: 15px;

}

.company {

  font-size: 16px;

  font-weight: bold;

}

.title {

  font-size: 18px;

  font-weight: bold;

  margin-top: 6px;

}

.subtitle {

  margin-top: 4px;

  font-size: 11px;

}

.info {

  width: 100%;

  border-collapse: collapse;

  margin-bottom: 15px;

}

.info td {

  border: 1px solid #999;

  padding: 6px;

}

.label {

  background: #f1f1f1;

  font-weight: bold;

  width: 18%;

}

.assets {

  width: 100%;

  border-collapse: collapse;

  margin-top: 8px;

}

.assets th,
.assets td {

  border: 1px solid #777;

  padding: 6px;

  vertical-align: top;

}

.assets th {

  background: #eee;

}

.statement {

  margin-top: 20px;

  border: 1px solid #777;

  padding: 12px;

  line-height: 1.5;

}

.signature {

  display: flex;

  gap: 40px;

  margin-top: 55px;

}

.signature-box {

  width: 45%;

  text-align: center;

}

.signature-line {

  border-top: 1px solid #111;

  margin-bottom: 6px;

}

.small {

  font-size: 10px;

}

</style>

</head>


<body>

<main class="page">

<img
  class="company-watermark"
  src="/images/prima-company-logo.png"
  alt=""
  aria-hidden="true"
>

<div class="header">

  <div class="company">

    Prima Fintech (Philippines)
    Lending Corporation

  </div>

  <div class="title">

    EMPLOYEE CLEARANCE FORM

  </div>

  <div class="subtitle">

    Asset Accountability - IT Department

  </div>

</div>


<table class="info">

<tr>

<td class="label">
Clearance No.
</td>

<td>
${escapeHtml(
  clearance.clearance_no
)}
</td>

<td class="label">
Separation Date
</td>

<td>
${escapeHtml(
  clearance.separation_date ||
  '—'
)}
</td>

</tr>


<tr>

<td class="label">
Employee ID
</td>

<td>
${escapeHtml(
  clearance.employee_code
)}
</td>

<td class="label">
Employee Name
</td>

<td>
${escapeHtml(
  clearance.employee_name
)}
</td>

</tr>


<tr>

<td class="label">
Department
</td>

<td>
${escapeHtml(
  clearance.department_name ||
  '—'
)}
</td>

<td class="label">
Position
</td>

<td>
${escapeHtml(
  clearance.position_title ||
  '—'
)}
</td>

</tr>


<tr>

<td class="label">
Reason
</td>

<td colspan="3">
${escapeHtml(
  clearance.separation_reason
)}
</td>

</tr>

</table>


<h3>
IT Asset Accountability
</h3>


<table class="assets">

<thead>

<tr>

<th>
#
</th>

<th>
Asset Tag
</th>

<th>
Asset
</th>

<th>
Serial Number
</th>

<th>
Condition
</th>

<th>
Return Status
</th>

<th>
Return Date
</th>

</tr>

</thead>


<tbody>

${
  rows ||
  `
    <tr>
      <td colspan="7">
        No assigned IT assets.
      </td>
    </tr>
  `
}

</tbody>

</table>


<div class="statement">

<strong>
IT Clearance Declaration
</strong>

<br><br>

I acknowledge that the IT assets listed above
have been accounted for as part of my employee
clearance. I understand that any company asset
that is lost, damaged, or not returned may be
subject to the applicable company policies and
procedures.

</div>


<div class="signature">

<div class="signature-box">

<div style="height:35px"></div>

<div class="signature-line"></div>

Employee Signature

<br>

${escapeHtml(
  employeeName
)}

</div>


<div class="signature-box">

<div style="height:35px"></div>

<div class="signature-line"></div>

IT Department Representative

<br>

Name / Signature

</div>

</div>


<div style="margin-top:35px">

<strong>
IT Clearance Status:
</strong>

${escapeHtml(
  clearance.status
)}

</div>


<div class="small" style="margin-top:20px">

Generated by PRIMA IT Asset Management

</div>

</main>

</body>

</html>

  `);


  printWindow.document.close();


  printWindow.focus();


  setTimeout(
    () => {

      printWindow.print();

    },
    300
  );

}


// ============================================================
// INITIALIZE
// ============================================================

async function init() {

  // ----------------------------------------------------------
  // BOOTSTRAP MODALS
  // ----------------------------------------------------------

  clearanceModal =
    new bootstrap.Modal(
      $('clearanceModal')
    );


  viewClearanceModal =
    new bootstrap.Modal(
      $('viewClearanceModal')
    );


  processReturnModal =
    new bootstrap.Modal(
      $('processReturnModal')
    );


  // ----------------------------------------------------------
  // NEW CLEARANCE
  // ----------------------------------------------------------

  $('newClearanceBtn')
    .addEventListener(
      'click',
      async () => {

        $('clearanceForm')
          .reset();


        $('clearanceFormAlert')
          .innerHTML = '';


        $('clearanceAssetPreview')
          .innerHTML = `

            <div class="alert alert-info mb-0">

              Select an employee to view
              currently assigned assets.

            </div>

          `;


        try {

          await loadClearanceEmployees();

          clearanceModal.show();

        } catch (error) {

          showAlert(
            error.message,
            'danger'
          );

        }

      }
    );


  // ----------------------------------------------------------
  // EMPLOYEE CHANGE
  // ----------------------------------------------------------

  $('clearanceEmployee')
    .addEventListener(
      'change',
      previewEmployeeAssets
    );


  // ----------------------------------------------------------
  // CREATE CLEARANCE
  // ----------------------------------------------------------

  $('clearanceForm')
    .addEventListener(
      'submit',
      createClearance
    );


  // ----------------------------------------------------------
  // PRINT
  // ----------------------------------------------------------

  $('printClearanceBtn')
    .addEventListener(
      'click',
      printClearance
    );


  // ----------------------------------------------------------
  // RETURN STATUS CHANGE
  // ----------------------------------------------------------

  $('processReturnStatus')
    .addEventListener(
      'change',
      updateReturnWarning
    );


  // ----------------------------------------------------------
  // SAVE RETURN
  // ----------------------------------------------------------

  $('processReturnForm')
    .addEventListener(
      'submit',
      saveReturn
    );


  // ----------------------------------------------------------
  // SEARCH
  // ----------------------------------------------------------

  $('searchInput')
    .addEventListener(
      'input',
      () => {

        clearTimeout(
          window.clearanceSearchTimer
        );


        window.clearanceSearchTimer =
          setTimeout(
            loadClearances,
            250
          );

      }
    );


  // ----------------------------------------------------------
  // STATUS FILTER
  // ----------------------------------------------------------

  $('statusFilter')
    .addEventListener(
      'change',
      loadClearances
    );


  // ----------------------------------------------------------
  // INITIAL LOAD
  // ----------------------------------------------------------

  try {

    await loadClearances();

  } catch (error) {

    showAlert(
      error.message,
      'danger'
    );

  }


}

// ============================================================
// SEARCHABLE EMPLOYEE SELECT
// ============================================================

function setupClearanceEmployeeSearch() {

  const searchInput =
    document.getElementById(
      'clearanceEmployeeSearch'
    );

  const resultsBox =
    document.getElementById(
      'clearanceEmployeeSearchResults'
    );

  const employeeSelect =
    document.getElementById(
      'clearanceEmployee'
    );

  const selectedEmployeeText =
    document.getElementById(
      'clearanceSelectedEmployee'
    );


  if (
    !searchInput ||
    !resultsBox ||
    !employeeSelect
  ) {

    return;
    

  }


  // ==========================================================
  // GET EMPLOYEES FROM EXISTING SELECT
  // ==========================================================

  function getEmployees() {

    return Array
      .from(
        employeeSelect.options
      )
      .filter(
        option =>
          option.value
      )
      .map(
        option => ({

          id:
            option.value,

          text:
            option.textContent
              .trim()

        })
      );
      

  }


  // ==========================================================
  // RENDER RESULTS
  // ==========================================================

  function renderResults(
    query = ''
  ) {

    const employees =
      getEmployees();


    const search =
      String(
        query || ''
      )
        .trim()
        .toLowerCase();


    const filtered =
      employees
        .filter(
          employee => {

            if (!search) {

              return true;

            }


            return employee.text
              .toLowerCase()
              .includes(
                search
              );

          }
        )
        .slice(
          0,
          50
        );


    resultsBox.innerHTML =
      '';


    if (
      !filtered.length
    ) {

      resultsBox.innerHTML = `

        <div
          class="
            list-group-item
            text-muted
            small
          "
        >
          No employee found.
        </div>

      `;


      resultsBox.classList.remove(
        'd-none'
      );


      return;

    }


    filtered.forEach(
      employee => {

        const button =
          document.createElement(
            'button'
          );


        button.type =
          'button';


        button.className =
          'list-group-item list-group-item-action';


        button.textContent =
          employee.text;


        button.addEventListener(
          'click',
          () => {

            // ================================================
            // UPDATE ORIGINAL SELECT
            // ================================================

            employeeSelect.value =
              employee.id;


            // ================================================
            // UPDATE SEARCH FIELD
            // ================================================

            searchInput.value =
              employee.text;


            if (
              selectedEmployeeText
            ) {

              selectedEmployeeText.innerHTML = `

                <span
                  class="text-success fw-semibold"
                >
                  ✓ Selected:
                </span>

                ${escapeClearanceEmployeeText(
                  employee.text
                )}

              `;

            }


            resultsBox.classList.add(
              'd-none'
            );


            // ================================================
            // FIRE CHANGE EVENT
            // Existing clearance.js can still react to it.
            // ================================================

            employeeSelect.dispatchEvent(
              new Event(
                'change',
                {
                  bubbles: true
                }
              )
            );

          }
        );


        resultsBox.appendChild(
          button
        );

      }
    );


    resultsBox.classList.remove(
      'd-none'
    );

  }


  // ==========================================================
  // SEARCH
  // ==========================================================

  searchInput.addEventListener(
    'input',
    () => {

      // User changed search.
      // Clear existing selection until another employee
      // is deliberately selected.

      employeeSelect.value =
        '';


      if (
        selectedEmployeeText
      ) {

        selectedEmployeeText.textContent =
          'No employee selected.';

      }


      renderResults(
        searchInput.value
      );

    }
  );


  // ==========================================================
  // OPEN LIST ON FOCUS
  // ==========================================================

  searchInput.addEventListener(
    'focus',
    () => {

      renderResults(
        searchInput.value
      );

    }
  );


  // ==========================================================
  // CLOSE WHEN CLICKING OUTSIDE
  // ==========================================================

  document.addEventListener(
    'click',
    event => {

      if (
        !searchInput.contains(
          event.target
        )
        &&
        !resultsBox.contains(
          event.target
        )
      ) {

        resultsBox.classList.add(
          'd-none'
        );

      }

    }
  );

}


// ============================================================
// ESCAPE TEXT
// ============================================================

function escapeClearanceEmployeeText(
  value
) {

  return String(
    value ?? ''
  )
    .replaceAll(
      '&',
      '&amp;'
    )
    .replaceAll(
      '<',
      '&lt;'
    )
    .replaceAll(
      '>',
      '&gt;'
    )
    .replaceAll(
      '"',
      '&quot;'
    )
    .replaceAll(
      "'",
      '&#039;'
    );

}


// ============================================================
// START
// ============================================================

document.addEventListener(
  'DOMContentLoaded',
  init
);
