// =====================================================
// PRIMA IT ASSET MANAGEMENT
// EMPLOYEES
// =====================================================

let employees = [];
let departments = [];
let currentUser = null;

let employeeModal;
let importEmployeeModal;
let lastEmployeeImportResults = null;


let selectedEmployee = null;
let selectedEmployeeAssets = [];


let employeeViewModal = null;
let selectedEmployeeForView = null;
let viewedEmployeeDbId = null;


const $ = (id) => document.getElementById(id);


// =====================================================
// ESCAPE HTML
// =====================================================

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


// =====================================================
// ALERT
// =====================================================

function showAlert(message, type = 'success') {

  const alertBox = $('alertBox');

  if (!alertBox) return;

  alertBox.innerHTML = `
    <div class="alert alert-${type} alert-dismissible fade show" role="alert">
      ${escapeHtml(message)}
      <button
        type="button"
        class="btn-close"
        data-bs-dismiss="alert">
      </button>
    </div>
  `;
}


// =====================================================
// STATUS BADGE
// =====================================================

function statusBadge(status) {

  const normalized = String(status || '').toLowerCase();

  let cls = 'text-bg-secondary';

  if (normalized === 'active') {
    cls = 'text-bg-success';
  }

  if (normalized === 'inactive') {
    cls = 'text-bg-secondary';
  }

  return `
    <span class="badge ${cls}">
      ${escapeHtml(status || '—')}
    </span>
  `;
}


// =====================================================
// ASSET STATUS BADGE
// =====================================================

function assetStatusBadge(status) {

  const normalized = String(status || '').toLowerCase();

  let cls = 'text-bg-secondary';

  switch (normalized) {

    case 'available':
      cls = 'text-bg-success';
      break;

    case 'assigned':
      cls = 'text-bg-primary';
      break;

    case 'for repair':
      cls = 'text-bg-warning';
      break;

    case 'repairing':
      cls = 'text-bg-info';
      break;

    case 'broken':
      cls = 'text-bg-danger';
      break;

    case 'lost':
      cls = 'text-bg-dark';
      break;

    case 'disposed':
    case 'retired':
      cls = 'text-bg-secondary';
      break;
  }

  return `
    <span class="badge ${cls}">
      ${escapeHtml(status || '—')}
    </span>
  `;
}


// =====================================================
// FORMAT DATE
// =====================================================

function formatDate(value) {

  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  });
}


// =====================================================
// FORMAT DATE/TIME
// =====================================================

function formatDateTime(value) {

  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return date.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}


// =====================================================
// LOAD CURRENT USER
// =====================================================

async function loadMe() {

  const response = await fetch('/api/auth/me');

  if (!response.ok) {

    window.location.href = '/';

    return;
  }

  const user = await response.json();
  currentUser = user;

  if ($('userName')) {

    $('userName').textContent =
      `${user.full_name} · ${user.role}`;
  }

  return user;
}


// =====================================================
// LOAD DEPARTMENTS
// =====================================================

async function loadDepartments() {

  const response = await fetch('/api/departments');

  if (!response.ok) {
    throw new Error('Unable to load departments.');
  }

  departments = await response.json();


  // ---------------------------------------------
  // DEPARTMENT FILTER
  // ---------------------------------------------

  if ($('departmentFilter')) {

    $('departmentFilter').innerHTML =
      '<option value="">All Departments</option>' +

      departments.map(department => `
        <option value="${department.id}">
          ${escapeHtml(department.name)}
        </option>
      `).join('');
  }


  // ---------------------------------------------
  // EMPLOYEE FORM DEPARTMENT
  // ---------------------------------------------

  if ($('department')) {

    $('department').innerHTML =
      '<option value="">Select Department</option>' +

      departments.map(department => `
        <option value="${department.id}">
          ${escapeHtml(department.name)}
        </option>
      `).join('');
  }
}


// =====================================================
// LOAD EMPLOYEES
// =====================================================

async function loadEmployees() {

  const params = new URLSearchParams();

  const search =
    $('searchInput')?.value.trim() || '';

  const departmentId =
    $('departmentFilter')?.value || '';

  const status =
    $('statusFilter')?.value || '';


  if (search) {
    params.set('search', search);
  }

  if (departmentId) {
    params.set('department_id', departmentId);
  }

  if (status) {
    params.set('status', status);
  }


  const response =
    await fetch(`/api/employees?${params.toString()}`);


  if (!response.ok) {

    const data =
      await response.json().catch(() => ({}));

    throw new Error(
      data.message ||
      'Unable to load employees.'
    );
  }


  employees = await response.json();

  renderEmployees();
}


// =====================================================
// RENDER EMPLOYEES
// =====================================================

function renderEmployees() {

  const countElement =
    $('employeeCount');

  if (countElement) {

    countElement.textContent =
      `${employees.length} employee${employees.length === 1 ? '' : 's'}`;
  }


  const tableBody =
    $('employeeTableBody');

  if (!tableBody) return;


  if (!employees.length) {

    tableBody.innerHTML = `
      <tr>
        <td
          colspan="7"
          class="text-center text-muted py-5">

          No employees found.

        </td>
      </tr>
    `;

    return;
  }


  tableBody.innerHTML =

    employees.map(employee => `

      <tr>

        <td class="fw-semibold">
          ${escapeHtml(employee.employee_id)}
        </td>

        <td>
          ${escapeHtml(employee.full_name)}
        </td>

        <td>
          ${escapeHtml(employee.email || '—')}
        </td>

        <td>
          ${escapeHtml(employee.department_name || '—')}
        </td>

        <td>
          ${escapeHtml(employee.position_title || '—')}
        </td>

        <td>
          ${statusBadge(employee.status)}
        </td>

        <td class="text-end">

          <button
            type="button"
            class="btn btn-sm btn-outline-primary view-employee-btn"
            data-id="${employee.id}">

            <i class="bi bi-eye me-1"></i>
            View

          </button>

        </td>

      </tr>

    `).join('');


  document
    .querySelectorAll('.view-employee-btn')
    .forEach(button => {

      button.addEventListener('click', () => {

        viewEmployee(button.dataset.id);

      });

    });
}



// =====================================================
// VIEW EMPLOYEE + ASSIGNED ASSETS
// =====================================================

function showEmployeeViewAlert(message, type = 'danger') {
  const container = $('employeeViewAlert');

  if (!container) return;

  container.innerHTML = message
    ? `<div class="alert alert-${type}" role="alert">${escapeHtml(message)}</div>`
    : '';
}


function openEmployeeAssetReturn(
  asset,
  employee,
  employeeId
) {

  const assetDbId = Number(asset?.id);
  const employeeDbId = Number(employeeId);

  if (!Number.isInteger(assetDbId) || assetDbId <= 0) {
    showEmployeeViewAlert('Invalid asset ID.');
    return;
  }

  if (!window.PRIMAAssetReturn) {
    showEmployeeViewAlert(
      'Return Asset is not available. Please refresh the page.'
    );
    return;
  }

  const openReturnModal = () => {
    window.PRIMAAssetReturn.open({
      assetId: assetDbId,
      asset: {
        ...asset,
        custodian_name: employee.full_name,
        department_name: employee.department_name
      },
      onCancel: async () => {
        await viewEmployee(employeeDbId);
      },
      onSuccess: async data => {
        await viewEmployee(employeeDbId);

        showEmployeeViewAlert(
          `Asset ${data.asset_id || asset.asset_id} returned successfully.`,
          'success'
        );
      }
    });
  };

  const modalElement = $('employeeViewModal');

  if (modalElement?.classList.contains('show')) {
    modalElement.addEventListener(
      'hidden.bs.modal',
      openReturnModal,
      { once: true }
    );

    employeeViewModal.hide();
    return;
  }

  openReturnModal();
}


async function deleteEmployee() {
  const employee = selectedEmployeeForView?.employee;
  const assignedAssets = selectedEmployeeForView?.assets || [];
  const employeeId = Number(employee?.id || viewedEmployeeDbId);

  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    showEmployeeViewAlert('Invalid employee ID.');
    return;
  }

  if (assignedAssets.length) {
    showEmployeeViewAlert(
      `Return all ${assignedAssets.length} assigned asset${assignedAssets.length === 1 ? '' : 's'} before deleting this employee.`,
      'warning'
    );
    return;
  }

  const employeeLabel =
    employee?.employee_id || employee?.full_name || `Employee ${employeeId}`;

  if (!window.confirm(
    `Delete ${employeeLabel}? This permanently removes the employee and their related records.`
  )) {
    return;
  }

  const button = $('deleteEmployeeBtn');
  const originalHtml = button?.innerHTML || '';

  try {
    if (button) {
      button.disabled = true;
      button.innerHTML = `
        <span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
        Deleting...
      `;
    }

    showEmployeeViewAlert('');

    const response = await fetch(`/api/employees/${employeeId}`, {
      method: 'DELETE'
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || 'Unable to delete employee.');
    }

    employeeViewModal?.hide();
    selectedEmployeeForView = null;
    viewedEmployeeDbId = null;

    await loadEmployees();
    showAlert(result.message || 'Employee deleted successfully.', 'success');
  } catch (error) {
    showEmployeeViewAlert(
      error.message || 'Unable to delete employee.',
      'danger'
    );

    if (button) {
      button.disabled = false;
      button.innerHTML = originalHtml;
    }
  }
}



async function viewEmployee(id) {

viewedEmployeeDbId = Number(id);
  try {

    // -------------------------------------------------
    // LOAD EMPLOYEE INFORMATION
    // -------------------------------------------------

    const employeeResponse =
      await fetch(`/api/employees/${id}`);

    if (!employeeResponse.ok) {

      const data =
        await employeeResponse.json().catch(() => ({}));

      throw new Error(
        data.message || 'Unable to load employee.'
      );
    }

    const employee =
      await employeeResponse.json();


    // -------------------------------------------------
    // LOAD CUSTODIAN + ASSIGNED ASSETS
    // -------------------------------------------------

    const assignedAssetsResponse =
      await fetch(`/api/employees/${id}/assets`);

    if (!assignedAssetsResponse.ok) {

      const data =
        await assignedAssetsResponse.json().catch(() => ({}));

      throw new Error(
        data.message ||
        'Unable to load assigned assets.'
      );
    }

    const assignedAssetsData =
      await assignedAssetsResponse.json();

    const assignedAssets =
      Array.isArray(assignedAssetsData)
        ? assignedAssetsData
        : [];


    // -------------------------------------------------
    // SAVE CURRENT EMPLOYEE
    // -------------------------------------------------

    selectedEmployeeForView = {
      employee,
      assets: assignedAssets
    };

    selectedEmployee = employee;
    selectedEmployeeAssets = assignedAssets;

    showEmployeeViewAlert('');

    const deleteButton = $('deleteEmployeeBtn');

    if (deleteButton) {
      const canDelete = currentUser?.role === 'admin';

      deleteButton.classList.toggle('d-none', !canDelete);
      deleteButton.disabled = !canDelete || assignedAssets.length > 0;
      deleteButton.title = assignedAssets.length
        ? 'Return all assigned assets before deleting this employee.'
        : 'Delete this employee permanently.';
    }


    // -------------------------------------------------
    // EMPLOYEE INFORMATION
    // -------------------------------------------------

    $('viewEmployeeId').textContent =
      employee.employee_id || '—';

    $('viewEmployeeName').textContent =
      employee.full_name || '—';

    $('viewEmployeeEmail').textContent =
      employee.email || '—';

    $('viewEmployeeDepartment').textContent =
      employee.department_name || '—';

    $('viewEmployeePosition').textContent =
      employee.position_title || '—';

    $('viewEmployeeStatus').innerHTML =
      statusBadge(employee.status);

    $('viewEmployeeCreated').textContent =
      employee.created_at
        ? new Date(employee.created_at).toLocaleString()
        : '—';


    // -------------------------------------------------
    // SUBTITLE
    // -------------------------------------------------

    $('employeeViewSubtitle').textContent =
      `${employee.employee_id || ''} · ${employee.full_name || ''}`;


    // -------------------------------------------------
    // ASSET COUNT
    // -------------------------------------------------

    $('viewEmployeeAssetCount').textContent =
      `${assignedAssets.length} ${
        assignedAssets.length === 1
          ? 'Asset'
          : 'Assets'
      }`;


    // -------------------------------------------------
    // ASSIGNED ASSETS TABLE
    // -------------------------------------------------

    const tbody =
      $('viewEmployeeAssets');


    if (!assignedAssets.length) {

      tbody.innerHTML = `
        <tr>

          <td
            colspan="7"
            class="text-center text-muted py-5">

            <i class="bi bi-inbox fs-2 d-block mb-2"></i>

            No assets are currently assigned
            to this employee.

          </td>

        </tr>
      `;

    } else {

      tbody.innerHTML =
        assignedAssets.map(asset => {

          const brandModel =
            [
              asset.brand,
              asset.model
            ]
              .filter(value => value)
              .join(' / ') || '—';


          const assignmentDate =
            asset.assigned_at
              ? new Date(
                  asset.assigned_at
                ).toLocaleDateString(
                  'en-US',
                  {
                    year: 'numeric',
                    month: 'short',
                    day: '2-digit'
                  }
                )
              : '—';


          return `
            <tr>

              <!-- ASSET TAG -->

              <td>

                <span class="fw-semibold">
                  ${escapeHtml(
                    asset.asset_id || '—'
                  )}
                </span>

              </td>


              <!-- ASSET NAME -->

              <td>
                ${escapeHtml(
                  asset.asset_name || '—'
                )}
              </td>


              <!-- BRAND / MODEL -->

              <td>
                ${escapeHtml(
                  brandModel
                )}
              </td>


              <!-- SERIAL NUMBER -->

              <td>
                ${escapeHtml(
                  asset.serial_number || '—'
                )}
              </td>


              <!-- STATUS -->

              <td>
                ${assetStatusBadge(
                  asset.status
                )}
              </td>


              <!-- ASSIGNMENT DATE -->

              <td>
                ${escapeHtml(
                  assignmentDate
                )}
              </td>


              <!-- ACTION -->

              <td class="text-end text-nowrap">

                <button
                  type="button"
                  class="btn btn-sm btn-outline-primary employee-asset-view-btn"
                  data-asset-id="${asset.id}">

                  <i class="bi bi-eye me-1"></i>
                  View

                </button>

                ${asset.status === 'Assigned'
                  ? `
                    <button
                      type="button"
                      class="btn btn-sm btn-outline-success employee-asset-return-btn ms-1"
                      data-asset-id="${asset.id}">

                      <i class="bi bi-arrow-return-left me-1"></i>
                      Return

                    </button>
                  `
                  : ''}

              </td>

            </tr>
          `;

        }).join('');
    }


    // -------------------------------------------------
    // OPEN EMPLOYEE VIEW MODAL
    // -------------------------------------------------

    if (!employeeViewModal) {

      employeeViewModal =
        new bootstrap.Modal(
          $('employeeViewModal')
        );

    }

    employeeViewModal.show();


    // -------------------------------------------------
    // ASSET VIEW BUTTONS
    // -------------------------------------------------

    document
      .querySelectorAll(
        '.employee-asset-view-btn'
      )
      .forEach(button => {

        button.addEventListener(
          'click',
          () => {

            const assetId =
              button.dataset.assetId;

            if (!assetId) return;


            // Close employee modal

            employeeViewModal.hide();


            // Open asset management page

            window.location.href =
              `/assets?view=${encodeURIComponent(
                assetId
              )}`;

          }
        );

      });

    document
      .querySelectorAll(
        '.employee-asset-return-btn'
      )
      .forEach(button => {

        button.addEventListener(
          'click',
          () => {
            const assetDbId =
              Number(button.dataset.assetId);

            const asset =
              assignedAssets.find(
                item => Number(item.id) === assetDbId
              );

            if (!asset || asset.status !== 'Assigned') {
              showEmployeeViewAlert(
                'This asset is no longer assigned. Refresh the employee details and try again.',
                'warning'
              );
              return;
            }

            openEmployeeAssetReturn(
              asset,
              employee,
              id
            );
          }
        );

      });


  } catch (error) {

    console.error(
      'View employee error:',
      error
    );

    showAlert(
      error.message ||
      'Unable to open employee.',
      'danger'
    );

  }

}


// =====================================================
// ASSET STATUS BADGE
// =====================================================

function assetStatusBadge(status) {

  const classes = {

    Available:
      'text-bg-success',

    Assigned:
      'text-bg-primary',

    'For Repair':
      'text-bg-warning',

    Repairing:
      'text-bg-info',

    Broken:
      'text-bg-danger',

    Lost:
      'text-bg-dark',

    Disposed:
      'text-bg-secondary',

    Retired:
      'text-bg-secondary'

  };


  const className =
    classes[status] ||
    'text-bg-secondary';


  return `
    <span class="badge ${className}">
      ${escapeHtml(status || '—')}
    </span>
  `;

}



// =====================================================
// ASSET STATUS BADGE
// =====================================================

function assetStatusBadge(status) {

  const classes = {
    Available: 'text-bg-success',
    Assigned: 'text-bg-primary',
    'For Repair': 'text-bg-warning',
    Repairing: 'text-bg-info',
    Broken: 'text-bg-danger',
    Lost: 'text-bg-dark',
    Disposed: 'text-bg-secondary',
    Retired: 'text-bg-secondary'
  };

  const className =
    classes[status] ||
    'text-bg-secondary';

  return `
    <span class="badge ${className}">
      ${escapeHtml(status || '—')}
    </span>
  `;
}



// =====================================================
// RENDER EMPLOYEE VIEW
// =====================================================

function renderEmployeeView() {

  const employee =
    selectedEmployee;

  if (!employee) return;


  // ---------------------------------------------
  // EMPLOYEE HEADER
  // ---------------------------------------------

  if ($('employeeViewSubtitle')) {

    $('employeeViewSubtitle').textContent =
      `${employee.employee_id} · ${employee.full_name}`;
  }


  if ($('viewEmployeeId')) {

    $('viewEmployeeId').textContent =
      employee.employee_id || '—';
  }


  if ($('viewEmployeeName')) {

    $('viewEmployeeName').textContent =
      employee.full_name || '—';
  }


  if ($('viewEmployeeStatus')) {

    $('viewEmployeeStatus').innerHTML =
      statusBadge(employee.status);
  }


  if ($('viewEmployeeEmail')) {

    $('viewEmployeeEmail').textContent =
      employee.email || '—';
  }


  if ($('viewEmployeeDepartment')) {

    $('viewEmployeeDepartment').textContent =
      employee.department_name || '—';
  }


  if ($('viewEmployeePosition')) {

    $('viewEmployeePosition').textContent =
      employee.position_title || '—';
  }


  if ($('viewEmployeeCreated')) {

    $('viewEmployeeCreated').textContent =
      formatDateTime(employee.created_at);
  }


  if ($('viewEmployeeAssetCount')) {

    $('viewEmployeeAssetCount').textContent =
      selectedEmployeeAssets.length;
  }


  renderEmployeeAssets();
}


// =====================================================
// RENDER EMPLOYEE ASSETS
// =====================================================

function renderEmployeeAssets() {

  const tableBody =
    $('viewEmployeeAssets');

  if (!tableBody) return;


  if (!selectedEmployeeAssets.length) {

    tableBody.innerHTML = `
      <tr>

        <td
          colspan="7"
          class="text-center text-muted py-5">

          <div class="mb-2">
            <i class="bi bi-box-seam fs-2"></i>
          </div>

          <div class="fw-semibold">
            No assets currently assigned
          </div>

          <small>
            This employee has no active asset assignments.
          </small>

        </td>

      </tr>
    `;

    return;
  }


  tableBody.innerHTML =

    selectedEmployeeAssets.map(asset => `

      <tr>

        <td class="fw-semibold">

          ${escapeHtml(
            asset.asset_id || '—'
          )}

        </td>

        <td>

          ${escapeHtml(
            asset.asset_name || '—'
          )}

        </td>

        <td>

          ${escapeHtml(
            [
              asset.brand,
              asset.model
            ]
              .filter(Boolean)
              .join(' / ') || '—'
          )}

        </td>

        <td>

          ${escapeHtml(
            asset.serial_number || '—'
          )}

        </td>

        <td>

          ${assetStatusBadge(
            asset.status
          )}

        </td>

        <td>

          ${formatDate(
            asset.assigned_at
          )}

        </td>

        <td class="text-end">

          <button
            type="button"
            class="btn btn-sm btn-outline-primary employee-asset-view-btn"
            data-id="${asset.id}">

            <i class="bi bi-eye me-1"></i>
            View

          </button>

        </td>

      </tr>

    `).join('');


  document
    .querySelectorAll('.employee-asset-view-btn')
    .forEach(button => {

      button.addEventListener('click', () => {

        viewEmployeeAsset(
          button.dataset.id
        );

      });

    });
}


// =====================================================
// VIEW ASSET FROM EMPLOYEE
// =====================================================

function viewEmployeeAsset(assetId) {

  if (!assetId) return;


  /*
   * The main Assets page contains the full Asset Details
   * modal and history/maintenance controls.
   *
   * Navigate there and let assets.js handle the details.
   */

  window.location.href =
    `/assets?view=${encodeURIComponent(assetId)}`;
}


// =====================================================
// SAVE EMPLOYEE
// =====================================================

async function saveEmployee(event) {

  event.preventDefault();


  const form =
    event.currentTarget;


  const data =
    Object.fromEntries(
      new FormData(form).entries()
    );


  if (!data.employee_id.trim()) {

    showAlert(
      'Employee ID is required.',
      'danger'
    );

    return;
  }


  if (!data.full_name.trim()) {

    showAlert(
      'Full Name is required.',
      'danger'
    );

    return;
  }


  try {

    const response =
      await fetch('/api/employees', {

        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify(data)

      });


    const result =
      await response
        .json()
        .catch(() => ({}));


    if (!response.ok) {

      showAlert(
        result.message ||
        'Unable to save employee.',
        'danger'
      );

      return;
    }


    form.reset();

    employeeModal.hide();


    showAlert(
      `Employee ${result.employee_id} created successfully.`
    );


    await loadEmployees();

  } catch (error) {

    console.error(
      'Save employee error:',
      error
    );

    showAlert(
      error.message ||
      'Unable to save employee.',
      'danger'
    );
  }
}


// =====================================================
// IMPORT EMPLOYEES
// =====================================================

function importResultFileDate() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
}


function downloadEmployeeImportResults() {
  if (!lastEmployeeImportResults) {
    return;
  }

  if (typeof XLSX === 'undefined') {
    showAlert('The Excel export library is not available.', 'danger');
    return;
  }

  const data = lastEmployeeImportResults;
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['Import Summary', 'Count'],
    ['Total Rows', data.total],
    ['Successfully Imported', data.imported],
    ['Not Imported', data.skipped],
    ['Warnings', data.warnings.length]
  ]);

  XLSX.utils.book_append_sheet(
    workbook,
    summarySheet,
    'Import Summary'
  );

  if (data.successes.length) {
    const successSheet = XLSX.utils.json_to_sheet(
      data.successes.map(item => ({
        'Excel Row': item.row,
        'Employee ID': item.employee_id,
        'Full Name': item.full_name,
        'Email': item.email,
        'Department': item.department,
        'Position': item.position,
        'Status': item.status
      }))
    );

    XLSX.utils.book_append_sheet(
      workbook,
      successSheet,
      'Successfully Imported'
    );
  }

  if (data.errors.length) {
    const errorSheet = XLSX.utils.json_to_sheet(
      data.errors.map(item => ({
        'Excel Row': item.row,
        'Employee ID': item.employee_id,
        'Full Name': item.full_name,
        'Reason': item.reason
      }))
    );

    XLSX.utils.book_append_sheet(
      workbook,
      errorSheet,
      'Not Imported'
    );
  }

  if (data.warnings.length) {
    const warningSheet = XLSX.utils.json_to_sheet(
      data.warnings.map(item => ({
        'Excel Row': item.row,
        'Record': item.employee_id || item.full_name,
        'Warning': item.message
      }))
    );

    XLSX.utils.book_append_sheet(
      workbook,
      warningSheet,
      'Warnings'
    );
  }

  XLSX.writeFile(
    workbook,
    `employee-import-results-${importResultFileDate()}.xlsx`
  );
}


function renderEmployeeImportResults(rawData) {
  const data = {
    total: Number(rawData.total || 0),
    imported: Number(rawData.imported || 0),
    skipped: Number(rawData.skipped || 0),
    successes: Array.isArray(rawData.successes)
      ? rawData.successes
      : [],
    errors: Array.isArray(rawData.errors)
      ? rawData.errors
      : [],
    warnings: Array.isArray(rawData.warnings)
      ? rawData.warnings
      : []
  };

  lastEmployeeImportResults = data;

  let alertType = 'success';
  let heading = '✅ Import Completed';

  if (data.imported > 0 && data.skipped > 0) {
    alertType = 'warning';
    heading = '⚠️ Import Completed with Issues';
  } else if (data.imported === 0 && data.skipped > 0) {
    alertType = 'danger';
    heading = '❌ No Rows Imported';
  }

  let html = `
    <div class="alert alert-${alertType} mb-3">
      <h6 class="fw-bold mb-3">${heading}</h6>
      <div class="row g-2">
        <div class="col-6 col-lg-3">
          <div class="border rounded p-2 h-100">
            <div class="small">Total Rows</div>
            <strong>${escapeHtml(data.total)}</strong>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="border rounded p-2 h-100">
            <div class="small">Successfully Imported</div>
            <strong>${escapeHtml(data.imported)}</strong>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="border rounded p-2 h-100">
            <div class="small">Not Imported</div>
            <strong>${escapeHtml(data.skipped)}</strong>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="border rounded p-2 h-100">
            <div class="small">Warnings</div>
            <strong>${escapeHtml(data.warnings.length)}</strong>
          </div>
        </div>
      </div>
    </div>
  `;

  if (data.successes.length) {
    html += `
      <div class="card border-success mb-3">
        <div class="card-header text-bg-success fw-semibold">
          ✅ Successfully Imported (${escapeHtml(data.successes.length)})
        </div>
        <div class="table-responsive" style="max-height: 320px; overflow: auto;">
          <table class="table table-sm table-striped align-middle mb-0">
            <thead class="sticky-top">
              <tr>
                <th>Excel Row</th>
                <th>Employee ID</th>
                <th>Full Name</th>
                <th>Department</th>
                <th>Position</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${data.successes.map(item => `
                <tr>
                  <td>${escapeHtml(item.row)}</td>
                  <td>${escapeHtml(item.employee_id)}</td>
                  <td>${escapeHtml(item.full_name)}</td>
                  <td>${escapeHtml(item.department || '—')}</td>
                  <td>${escapeHtml(item.position || '—')}</td>
                  <td>${escapeHtml(item.status)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  if (data.errors.length) {
    html += `
      <div class="card border-danger mb-3">
        <div class="card-header text-bg-danger fw-semibold">
          ❌ Not Imported (${escapeHtml(data.errors.length)})
        </div>
        <div class="table-responsive" style="max-height: 320px; overflow: auto;">
          <table class="table table-sm table-striped align-middle mb-0">
            <thead class="sticky-top">
              <tr>
                <th>Excel Row</th>
                <th>Employee ID</th>
                <th>Full Name</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              ${data.errors.map(item => `
                <tr>
                  <td>${escapeHtml(item.row)}</td>
                  <td>${escapeHtml(item.employee_id || '—')}</td>
                  <td>${escapeHtml(item.full_name || '—')}</td>
                  <td>${escapeHtml(item.reason)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  if (data.warnings.length) {
    html += `
      <div class="card border-warning mb-3">
        <div class="card-header text-bg-warning fw-semibold">
          ⚠️ Warnings (${escapeHtml(data.warnings.length)})
        </div>
        <div class="table-responsive" style="max-height: 260px; overflow: auto;">
          <table class="table table-sm table-striped align-middle mb-0">
            <thead class="sticky-top">
              <tr>
                <th>Excel Row</th>
                <th>Record</th>
                <th>Warning</th>
              </tr>
            </thead>
            <tbody>
              ${data.warnings.map(item => `
                <tr>
                  <td>${escapeHtml(item.row)}</td>
                  <td>${escapeHtml(item.employee_id || item.full_name || '—')}</td>
                  <td>${escapeHtml(item.message)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  html += `
    <button
      type="button"
      id="downloadEmployeeImportResultsBtn"
      class="btn btn-outline-primary"
    >
      ⬇ Download Import Results
    </button>
  `;

  const resultBox = $('importResult');

  if (resultBox) {
    resultBox.innerHTML = html;
    $('downloadEmployeeImportResultsBtn')?.addEventListener(
      'click',
      downloadEmployeeImportResults
    );
  }

  return data;
}


async function importEmployees(event) {

  event.preventDefault();


  const fileInput =
    $('employeeExcelFile');


  if (!fileInput.files.length) {

    showAlert(
      'Please select an Excel file.',
      'danger'
    );

    return;
  }


  const formData =
    new FormData();


  formData.append(
    'file',
    fileInput.files[0]
  );


  const importButton =
    event.submitter;


  if (importButton) {

    importButton.disabled = true;

    importButton.innerHTML =
      '⏳ Importing...';
  }


  $('importResult').innerHTML = '';


  try {

    const response =
      await fetch(
        '/api/employees/import',
        {
          method: 'POST',
          body: formData
        }
      );


    const result =
      await response
        .json()
        .catch(() => ({}));


    if (!response.ok) {

      throw new Error(
        result.message ||
        'Employee import failed.'
      );
    }


    const data =
      result.results || {};


    const normalizedResults =
      renderEmployeeImportResults(data);


    fileInput.value = '';


    if (normalizedResults.imported > 0) {
      await loadEmployees();
    }


    showAlert(
      'Employee import completed. ' +
        normalizedResults.imported +
        ' employee(s) imported.',
      normalizedResults.skipped > 0
        ? 'warning'
        : 'success'
    );

  } catch (error) {

    console.error(
      'Employee import error:',
      error
    );


    $('importResult').innerHTML = `

      <div class="alert alert-danger">

        ${escapeHtml(
          error.message ||
          'Employee import failed.'
        )}

      </div>

    `;

  } finally {

    if (importButton) {

      importButton.disabled = false;

      importButton.innerHTML =
        '📥 Import';
    }
  }
}


// =====================================================
// DOWNLOAD EMPLOYEE TEMPLATE
// =====================================================

function downloadEmployeeTemplate() {

  const headers = [
    'Employee ID',
    'Full Name',
    'Email',
    'Department',
    'Position',
    'Status'
  ];


  const example = [
    'EMP-0001',
    'Juan Dela Cruz',
    'juan@example.com',
    'IT Department',
    'IT Staff',
    'active'
  ];


  const csv =

    headers.join(',') +
    '\n' +

    example.map(value => {

      const text =
        String(value)
          .replaceAll('"', '""');

      return `"${text}"`;

    }).join(',');


  const blob =
    new Blob(
      [csv],
      {
        type:
          'text/csv;charset=utf-8;'
      }
    );


  const url =
    URL.createObjectURL(blob);


  const link =
    document.createElement('a');


  link.href = url;

  link.download =
    'employee_import_template.csv';


  document.body.appendChild(link);

  link.click();

  link.remove();


  URL.revokeObjectURL(url);
}


// =====================================================
// PRINT CUSTODIAN FORM
// =====================================================

function printEmployeeCustodianForm() {

  if (!selectedEmployee) {

    showAlert(
      'Please open an employee first.',
      'danger'
    );

    return;
  }


  const employee =
    selectedEmployee;


  const assets =
    selectedEmployeeAssets || [];


  const employeeName =
    employee.full_name ||
    employee.employee_id ||
    'Employee';


  const fileTitle =
    `${employeeName} - Custodian Form`;


  const assetRows =

    assets.length

      ? assets.map((asset, index) => `

          <tr>

            <td class="center">
              ${index + 1}
            </td>

            <td>
              ${escapeHtml(
                asset.asset_id || '—'
              )}
            </td>

            <td>
              ${escapeHtml(
                asset.asset_name || '—'
              )}
            </td>

            <td>
              ${escapeHtml(
                asset.category_name || '—'
              )}
            </td>

            <td>
              ${escapeHtml(
                [
                  asset.brand,
                  asset.model
                ]
                  .filter(Boolean)
                  .join(' / ') || '—'
              )}
            </td>

            <td>
              ${escapeHtml(
                asset.serial_number || '—'
              )}
            </td>

            <td>
              ${escapeHtml(
                asset.status || '—'
              )}
            </td>

          </tr>

        `).join('')

      : `

          <tr>

            <td
              colspan="7"
              class="center">

              No assets currently assigned.

            </td>

          </tr>

        `;


  const printWindow =
    window.open(
      '',
      '_blank',
      'width=1000,height=800'
    );


  if (!printWindow) {

    showAlert(
      'Please allow pop-ups to print the Custodian Form.',
      'danger'
    );

    return;
  }


  printWindow.document.open();


  printWindow.document.write(`

<!doctype html>

<html>

<head>

  <meta charset="utf-8">

  <title>
    ${escapeHtml(fileTitle)}
  </title>

  <style>

    @page {
      size: A4 portrait;
      margin: 15mm;
    }

    * {
      box-sizing: border-box;
    }

    body {

      font-family:
        Arial,
        Helvetica,
        sans-serif;

      color: #111;

      font-size: 11px;

      margin: 0;

      line-height: 1.4;
    }


    .header {

      text-align: center;

      border-bottom:
        2px solid #111;

      padding-bottom: 10px;

      margin-bottom: 15px;
    }


    .company {

      font-size: 17px;

      font-weight: bold;

      text-transform: uppercase;

      margin-bottom: 4px;
    }


    .document-title {

      font-size: 16px;

      font-weight: bold;

      margin-top: 8px;
    }


    .document-subtitle {

      font-size: 10px;

      color: #555;

      margin-top: 3px;
    }


    .section-title {

      font-weight: bold;

      font-size: 12px;

      background: #f1f1f1;

      border:
        1px solid #999;

      padding: 6px 8px;

      margin-top: 12px;

      margin-bottom: 0;
    }


    .employee-info {

      width: 100%;

      border-collapse:
        collapse;

      margin-bottom: 10px;
    }


    .employee-info td {

      border:
        1px solid #aaa;

      padding: 6px 8px;

      vertical-align: top;
    }


    .label {

      width: 18%;

      font-weight: bold;

      background: #f8f8f8;
    }


    .assets-table {

      width: 100%;

      border-collapse:
        collapse;

      margin-top: 0;
    }


    .assets-table th,
    .assets-table td {

      border:
        1px solid #888;

      padding: 5px 4px;

      vertical-align: middle;
    }


    .assets-table th {

      background: #e9ecef;

      font-weight: bold;

      text-align: center;
    }


    .center {
      text-align: center;
    }


    .statement {

      margin-top: 18px;

      font-size: 11px;

      text-align: justify;

      line-height: 1.6;
    }


    .signature-table {

      width: 100%;

      border-collapse:
        collapse;

      margin-top: 55px;
    }


    .signature-table td {

      width: 50%;

      text-align: center;

      vertical-align: bottom;

      padding: 0 25px;
    }


    .signature-line {

      border-top:
        1px solid #111;

      padding-top: 6px;

      margin-top: 35px;
    }


    .footer {

      margin-top: 35px;

      font-size: 9px;

      color: #666;

      text-align: center;
    }


    .no-print {
      display: none;
    }


    @media print {

      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

    }

  </style>

</head>


<body>


  <div class="header">

    <div class="company">
      Prima Fintech (Philippines) Lending Corporation
    </div>

    <div class="document-title">
      ASSET CUSTODIAN FORM
    </div>

    <div class="document-subtitle">
      IT Asset Management
    </div>

  </div>


  <div class="section-title">
    EMPLOYEE INFORMATION
  </div>


  <table class="employee-info">

    <tr>

      <td class="label">
        Employee ID
      </td>

      <td>
        ${escapeHtml(
          employee.employee_id || '—'
        )}
      </td>

      <td class="label">
        Status
      </td>

      <td>
        ${escapeHtml(
          employee.status || '—'
        )}
      </td>

    </tr>


    <tr>

      <td class="label">
        Full Name
      </td>

      <td colspan="3">
        ${escapeHtml(
          employee.full_name || '—'
        )}
      </td>

    </tr>


    <tr>

      <td class="label">
        Department
      </td>

      <td>
        ${escapeHtml(
          employee.department_name || '—'
        )}
      </td>

      <td class="label">
        Position
      </td>

      <td>
        ${escapeHtml(
          employee.position_title || '—'
        )}
      </td>

    </tr>


    <tr>

      <td class="label">
        Email
      </td>

      <td colspan="3">
        ${escapeHtml(
          employee.email || '—'
        )}
      </td>

    </tr>

  </table>


  <div class="section-title">
    ASSIGNED IT ASSETS
  </div>


  <table class="assets-table">

    <thead>

      <tr>

        <th style="width:5%;">
          #
        </th>

        <th style="width:14%;">
          Asset Tag
        </th>

        <th style="width:16%;">
          Asset Name
        </th>

        <th style="width:12%;">
          Category
        </th>

        <th style="width:17%;">
          Brand / Model
        </th>

        <th style="width:17%;">
          Serial Number
        </th>

        <th style="width:10%;">
          Status
        </th>

      </tr>

    </thead>

    <tbody>

      ${assetRows}

    </tbody>

  </table>


  <div class="statement">

    I hereby acknowledge receipt and custody of the IT assets
    listed above. I understand that these assets are company
    property and are issued to me for authorized business use.
    I agree to exercise reasonable care over the assets and to
    immediately report any loss, damage, malfunction, or other
    issue to the IT Department. I further acknowledge that the
    assets must be returned to the company upon request,
    transfer, separation, or termination of employment, subject
    to applicable company policies and procedures.

  </div>


  <table class="signature-table">

    <tr>

      <td>

        <div class="signature-line">
          Employee / Custodian Signature
        </div>

        <div>
          ${escapeHtml(
            employee.full_name || ''
          )}
        </div>

      </td>


      <td>

        <div class="signature-line">
          IT Department Representative
        </div>

        <div>
          Name / Signature
        </div>

      </td>

    </tr>


    <tr>

      <td style="padding-top:35px;">

        Date:
        __________________________

      </td>


      <td style="padding-top:35px;">

        Date:
        __________________________

      </td>

    </tr>

  </table>


  <div class="footer">

    Prima Fintech (Philippines) Lending Corporation
    · IT Asset Management

  </div>


</body>

</html>

  `);


  printWindow.document.close();


  // Give the browser time to render the document.
  setTimeout(() => {

    printWindow.focus();

    printWindow.print();

  }, 500);
}

// ============================================================
// PRINT EMPLOYEE CUSTODIAN FORM
// ============================================================

async function printEmployeeCustodianForm() {

  const employeeId =
    Number(viewedEmployeeDbId);


  if (
    !Number.isInteger(employeeId) ||
    employeeId <= 0
  ) {

    alert(
      'Unable to determine the selected employee.'
    );

    return;

  }


  // ==========================================================
  // OPEN WINDOW IMMEDIATELY
  //
  // Important:
  // Open before fetch() so Chrome does not block the popup.
  // ==========================================================

  const printWindow =
    window.open(
      '',
      '_blank',
      'width=1100,height=900'
    );


  if (!printWindow) {

    alert(
      'Please allow pop-ups for this site so the Custodian Form can be printed.'
    );

    return;

  }


  // ==========================================================
  // TEMPORARY LOADING PAGE
  // ==========================================================

  printWindow.document.open();

  printWindow.document.write(`
    <!doctype html>
    <html>
    <head>
      <title>Loading Custodian Form...</title>

      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 40px;
          text-align: center;
        }
      </style>
    </head>

    <body>
      <h3>Preparing Custodian Form...</h3>
      <p>Please wait.</p>
    </body>
    </html>
  `);

  printWindow.document.close();


  try {

    // ========================================================
    // LOAD EMPLOYEE + CURRENTLY ASSIGNED ASSETS
    // ========================================================

    const response =
      await fetch(
        `/api/custodians/${employeeId}`,
        {
          credentials: 'include'
        }
      );


    const data =
      await response
        .json()
        .catch(() => ({}));


    if (!response.ok) {

      throw new Error(
        data.message ||
        'Unable to load custodian information.'
      );

    }


    const employee =
      data.employee || {};


    const assets =
      Array.isArray(data.assets)
        ? data.assets
        : [];


    // ========================================================
    // ESCAPE HTML
    // ========================================================

    const esc = value => {

      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

    };


    // ========================================================
    // DATE
    // ========================================================

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


    // ========================================================
    // ASSET ROWS
    // ========================================================

    const assetRows =
      assets.length

        ? assets
            .map(
              (
                asset,
                index
              ) => {

                const brandModel =
                  [
                    asset.brand,
                    asset.model
                  ]
                    .filter(Boolean)
                    .join(' ') ||
                  '—';


                const assignedDate =
                  asset.assigned_at
                    ? new Date(
                        asset.assigned_at
                      )
                        .toLocaleDateString(
                          'en-PH',
                          {
                            year: 'numeric',
                            month: 'short',
                            day: '2-digit'
                          }
                        )
                    : '—';


                return `

                  <tr>

                    <td class="center">
                      ${index + 1}
                    </td>


                    <td class="fw">
                      ${esc(
                        asset.asset_id || '—'
                      )}
                    </td>


                    <td>
                      ${esc(
                        asset.asset_name || '—'
                      )}
                    </td>


                    <td>
                      ${esc(
                        asset.category_name || '—'
                      )}
                    </td>


                    <td>
                      ${esc(
                        brandModel
                      )}
                    </td>


                    <td>
                      ${esc(
                        asset.serial_number || '—'
                      )}
                    </td>


                    <td>
                      ${esc(
                        asset.condition_status || '—'
                      )}
                    </td>


                    <td>
                      ${esc(
                        assignedDate
                      )}
                    </td>

                  </tr>

                `;

              }
            )
            .join('')

        : `

            <tr>

              <td
                colspan="8"
                class="center empty"
              >

                No assets are currently assigned
                to this employee.

              </td>

            </tr>

          `;


    // ========================================================
    // PRINT DOCUMENT
    // ========================================================

    printWindow.document.open();


    printWindow.document.write(`

<!doctype html>

<html lang="en">

<head>

<meta charset="utf-8">

<title>
  IT Asset Custodian Acknowledgement Form
</title>


<style>

/* ==========================================================
   PAGE
========================================================== */

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

.page {

  width: 210mm;

  min-height: 297mm;

  padding:
    15mm
    14mm;

  margin:
    0 auto;

  position:
    relative;

  overflow:
    hidden;

}

.company-watermark {

  position:
    absolute;

  top:
    52%;

  left:
    50%;

  width:
    145mm;

  max-width:
    74%;

  height:
    auto;

  transform:
    translate(-50%, -50%)
    rotate(-24deg);

  opacity:
    0.055;

  filter:
    grayscale(1);

  pointer-events:
    none;

  user-select:
    none;

  z-index:
    0;

  -webkit-print-color-adjust:
    exact;

  print-color-adjust:
    exact;

}

.page > :not(.company-watermark) {

  position:
    relative;

  z-index:
    1;

}


/* ==========================================================
   HEADER
========================================================== */

.header {

  text-align:
    center;

  margin-bottom:
    20px;

}

.company {

  font-size:
    18px;

  font-weight:
    700;

  text-transform:
    uppercase;

}

.system-name {

  font-size:
    11px;

  color:
    #555;

  margin-top:
    3px;

}

.document-title {

  font-size:
    20px;

  font-weight:
    800;

  margin-top:
    18px;

}

.subtitle {

  font-size:
    11px;

  color:
    #666;

  margin-top:
    3px;

}


/* ==========================================================
   EMPLOYEE INFO
========================================================== */

.info-table {

  width:
    100%;

  border-collapse:
    collapse;

  margin-bottom:
    22px;

}

.info-table td {

  border:
    1px solid #333;

  padding:
    8px;

  font-size:
    11px;

}

.info-label {

  width:
    17%;

  font-weight:
    700;

  background:
    #f0f0f0;

}


/* ==========================================================
   SECTION
========================================================== */

.section-title {

  font-size:
    12px;

  font-weight:
    700;

  margin-bottom:
    7px;

  text-transform:
    uppercase;

}


/* ==========================================================
   ASSET TABLE
========================================================== */

.asset-table {

  width:
    100%;

  border-collapse:
    collapse;

  margin-bottom:
    20px;

}

.asset-table th,
.asset-table td {

  border:
    1px solid #333;

  padding:
    6px;

  font-size:
    9px;

  vertical-align:
    top;

}

.asset-table th {

  background:
    #efefef;

  font-weight:
    700;

  text-align:
    left;

}

.center {

  text-align:
    center;

}

.fw {

  font-weight:
    700;

}

.empty {

  padding:
    25px !important;

  color:
    #777;

}


/* ==========================================================
   STATEMENT
========================================================== */

.statement {

  border:
    1px solid #333;

  padding:
    12px;

  font-size:
    11px;

  line-height:
    1.55;

  margin-top:
    15px;

  text-align:
    justify;

}


/* ==========================================================
   SIGNATURE
========================================================== */

.signature-area {

  display:
    grid;

  grid-template-columns:
    1fr 1fr;

  gap:
    50px;

  margin-top:
    70px;

}

.signature-box {

  text-align:
    center;

}

.signature-line {

  border-top:
    1px solid #222;

  margin-bottom:
    5px;

}

.signature-name {

  font-size:
    11px;

  font-weight:
    700;

}

.signature-role {

  font-size:
    9px;

  color:
    #555;

  margin-top:
    3px;

}


/* ==========================================================
   FOOTER
========================================================== */

.footer {

  margin-top:
    45px;

  padding-top:
    8px;

  border-top:
    1px solid #aaa;

  text-align:
    center;

  font-size:
    8px;

  color:
    #666;

}


/* ==========================================================
   PRINT
========================================================== */

@page {

  size:
    A4 portrait;

  margin:
    0;

}


@media print {

  html,
  body {

    width:
      210mm;

    min-height:
      297mm;

  }


  .page {

    margin:
      0;

  }


  .info-label,
  .asset-table th {

    -webkit-print-color-adjust:
      exact;

    print-color-adjust:
      exact;

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

  <!-- ========================================================
       HEADER
  ========================================================= -->

  <div class="header">

    <div class="company">

      Prima Fintech (Philippines)
      Lending Corporation

    </div>


    <div class="system-name">

      PRIMA IT Asset Management

    </div>


    <div class="document-title">

      IT ASSET CUSTODIAN
      ACKNOWLEDGEMENT FORM

    </div>


    <div class="subtitle">

      Asset Assignment and Accountability Record

    </div>

  </div>



  <!-- ========================================================
       EMPLOYEE INFORMATION
  ========================================================= -->

  <table class="info-table">


    <tr>

      <td class="info-label">
        Employee ID
      </td>

      <td>

        ${esc(
          employee.employee_id || '—'
        )}

      </td>


      <td class="info-label">
        Date
      </td>

      <td>

        ${esc(today)}

      </td>

    </tr>



    <tr>

      <td class="info-label">
        Custodian
      </td>

      <td colspan="3">

        ${esc(
          employee.full_name || '—'
        )}

      </td>

    </tr>



    <tr>

      <td class="info-label">
        Department
      </td>

      <td>

        ${esc(
          employee.department_name || '—'
        )}

      </td>


      <td class="info-label">
        Position
      </td>

      <td>

        ${esc(
          employee.position_title || '—'
        )}

      </td>

    </tr>


  </table>



  <!-- ========================================================
       ASSETS
  ========================================================= -->

  <div class="section-title">

    Assigned IT Assets

  </div>


  <table class="asset-table">

    <thead>

      <tr>

        <th>#</th>

        <th>Asset Tag</th>

        <th>Asset</th>

        <th>Category</th>

        <th>Brand / Model</th>

        <th>Serial No.</th>

        <th>Condition</th>

        <th>Assigned Date</th>

      </tr>

    </thead>


    <tbody>

      ${assetRows}

    </tbody>

  </table>



  <!-- ========================================================
       ACKNOWLEDGEMENT
  ========================================================= -->

  <div class="statement">

    I acknowledge that the IT assets listed above have
    been issued to me for authorized company use.

    I understand that I am responsible for the proper
    care, security, and safekeeping of these assets while
    they are assigned to me.

    I will promptly report any loss, theft, damage,
    malfunction, or other issue to the IT Department and
    will return the assets when requested, transferred,
    separated from the company, or when my assignment
    ends.

  </div>



  <!-- ========================================================
       SIGNATURES
  ========================================================= -->

  <div class="signature-area">


    <div class="signature-box">

      <div class="signature-line"></div>

      <div class="signature-name">

        ${esc(
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



  <!-- ========================================================
       FOOTER
  ========================================================= -->

  <div class="footer">

    Generated by PRIMA IT Asset Management

  </div>


</div>



<script>

// ==========================================================
// PRINT AFTER PAGE IS READY
// ==========================================================

window.addEventListener(
  'load',
  function() {

    setTimeout(
      function() {

        window.focus();

        window.print();

      },
      400
    );

  }
);


// ==========================================================
// CLOSE AFTER PRINT
// ==========================================================

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


  } catch (error) {

    console.error(
      'PRINT EMPLOYEE CUSTODIAN FORM ERROR:',
      error
    );


    printWindow.document.open();


    printWindow.document.write(`

      <!doctype html>

      <html>

      <head>

        <title>
          Unable to Print
        </title>

        <style>

          body {
            font-family:
              Arial,
              sans-serif;

            padding:
              40px;
          }

          .error {
            border:
              1px solid #dc3545;

            background:
              #f8d7da;

            color:
              #842029;

            padding:
              15px;

            border-radius:
              6px;
          }

        </style>

      </head>


      <body>

        <div class="error">

          <strong>
            Unable to prepare Custodian Form.
          </strong>

          <br><br>

          ${String(
            error.message ||
            'Unknown error.'
          )}

        </div>

      </body>

      </html>

    `);


    printWindow.document.close();

  }

}


// =====================================================
// INITIALIZE
// =====================================================

async function init() {

  try {

    await loadMe();

    await loadDepartments();

    await loadEmployees();

  } catch (error) {

    console.error(
      'Employee initialization error:',
      error
    );

    showAlert(
      error.message ||
      'Unable to initialize Employees.',
      'danger'
    );
  }


  // ---------------------------------------------
  // BOOTSTRAP MODALS
  // ---------------------------------------------

  if ($('employeeModal')) {

    employeeModal =
      new bootstrap.Modal(
        $('employeeModal')
      );
  }


  if ($('importEmployeeModal')) {

    importEmployeeModal =
      new bootstrap.Modal(
        $('importEmployeeModal')
      );
  }


  if ($('employeeViewModal')) {

    employeeViewModal =
      new bootstrap.Modal(
        $('employeeViewModal')
      );
  }

  const requestedEmployeeId =
    Number(
      new URLSearchParams(window.location.search)
        .get('view')
    );

  if (
    Number.isInteger(requestedEmployeeId) &&
    requestedEmployeeId > 0
  ) {
    await viewEmployee(requestedEmployeeId);
  }


  // ---------------------------------------------
  // ADD EMPLOYEE
  // ---------------------------------------------

  if ($('addEmployeeBtn')) {

    $('addEmployeeBtn')
      .addEventListener(
        'click',
        () => {

          if ($('employeeForm')) {
            $('employeeForm').reset();
          }

          employeeModal.show();

        }
      );
  }


  // ---------------------------------------------
  // SAVE EMPLOYEE
  // ---------------------------------------------

  if ($('employeeForm')) {

    $('employeeForm')
      .addEventListener(
        'submit',
        saveEmployee
      );
  }


  // ---------------------------------------------
  // IMPORT EMPLOYEE
  // ---------------------------------------------

  if ($('importEmployeeBtn')) {

    $('importEmployeeBtn')
      .addEventListener(
        'click',
        () => {

          if ($('importEmployeeForm')) {
            $('importEmployeeForm').reset();
          }

          if ($('importResult')) {
            $('importResult').innerHTML = '';
          }

          lastEmployeeImportResults = null;

          importEmployeeModal.show();

        }
      );
  }


  // ---------------------------------------------
  // IMPORT FORM
  // ---------------------------------------------

  if ($('importEmployeeForm')) {

    $('importEmployeeForm')
      .addEventListener(
        'submit',
        importEmployees
      );
  }


  // ---------------------------------------------
  // TEMPLATE
  // ---------------------------------------------

  if ($('employeeTemplateBtn')) {

    $('employeeTemplateBtn')
      .addEventListener(
        'click',
        downloadEmployeeTemplate
      );
  }


  // ---------------------------------------------
  // PRINT CUSTODIAN FORM
  // ---------------------------------------------

  if ($('printEmployeeCustodianBtn')) {

    $('printEmployeeCustodianBtn')
      .addEventListener(
        'click',
        printEmployeeCustodianForm
      );
  }


  // ---------------------------------------------
  // DELETE EMPLOYEE
  // ---------------------------------------------

  if ($('deleteEmployeeBtn')) {
    $('deleteEmployeeBtn')
      .addEventListener(
        'click',
        deleteEmployee
      );
  }


  // ---------------------------------------------
  // SEARCH
  // ---------------------------------------------

  if ($('searchInput')) {

    $('searchInput')
      .addEventListener(
        'input',
        () => {

          clearTimeout(
            window.employeeSearchTimer
          );


          window.employeeSearchTimer =
            setTimeout(
              loadEmployees,
              250
            );

        }
      );
  }


  // ---------------------------------------------
  // DEPARTMENT FILTER
  // ---------------------------------------------

  if ($('departmentFilter')) {

    $('departmentFilter')
      .addEventListener(
        'change',
        loadEmployees
      );
  }


  // ---------------------------------------------
  // STATUS FILTER
  // ---------------------------------------------

  if ($('statusFilter')) {

    $('statusFilter')
      .addEventListener(
        'change',
        loadEmployees
      );
  }


  // ---------------------------------------------
  // LOGOUT
  // ---------------------------------------------

  if ($('logoutBtn')) {

    $('logoutBtn')
      .addEventListener(
        'click',
        async () => {

          try {

            await fetch(
              '/api/auth/logout',
              {
                method: 'POST'
              }
            );

          } finally {

            window.location.href = '/';

          }

        }
      );
  }
  // ============================================================
// PRINT EMPLOYEE CUSTODIAN FORM
// ============================================================

$('printEmployeeCustodianBtn')
  ?.addEventListener(
    'click',
    printEmployeeCustodianForm
  );
}




// =====================================================
// START
// =====================================================

init();
