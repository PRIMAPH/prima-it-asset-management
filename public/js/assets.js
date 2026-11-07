// ============================================================
// PRIMA IT ASSET MANAGEMENT
// ASSETS.JS
// ============================================================

let assets = [];
const selectedAssetIds = new Set();
let assetListRequest = 0;
let categories = [];
let locations = [];
let employees = [];
let currentUser = null;

let addAssetModal;
let importAssetModal;
let lastAssetImportResults = null;
let assignAssetsModal;

// Custodian Management
let custodianModal;
let custodians = [];
let selectedCustodian = null;

// Direct asset assignment (used by Scan -> Details -> Assign)
let directAssignAssetId = null;

// Asset images
let assetImageRemoved = false;
let receiptImageRemoved = false;
let activeCameraTarget = null;
let cameraStream = null;

// Label printing
let selectedLabelType = 'both';

const $ = id => document.getElementById(id);

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

// Shared image URLs use the existing backend /uploads/assets/<filename> paths.
function getAssetImageUrl(path) {

  if (!path) {
    return '';
  }

  if (
    String(path).startsWith('http://') ||
    String(path).startsWith('https://') ||
    String(path).startsWith('data:')
  ) {
    return String(path);
  }

  if (String(path).startsWith('/')) {
    return String(path);
  }

  return `/${String(path)}`;

}

// ============================================================
// STATUS BADGE
// ============================================================
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
      ${escapeHtml(status || 'Unknown')}
    </span>
  `;
}

// ============================================================
// ALERT
// ============================================================
function showAlert(message, type = 'success') {
  const box = $('alertBox');

  if (!box) return;

  if (window.PRIMAAlerts) {
    window.PRIMAAlerts.show(box, message, { type });
    return;
  }

  box.textContent = message;
}


// ============================================================
// ASSIGN ALERT
// ============================================================
function showAssignAlert(message, type = 'danger') {
  const box = $('assignAlert');

  if (!box) return;

  box.innerHTML = `
    <div class="alert alert-${type} py-2 mb-3">
      ${escapeHtml(message)}
    </div>
  `;
}

// ============================================================
// LOAD CURRENT USER
// ============================================================
async function loadMe() {
  const response = await fetch('/api/auth/me');

  if (!response.ok) {
    clearAssetSelection();
    window.location.href = '/';
    return;
  }

  const user = await response.json();
  if (currentUser && String(currentUser.id) !== String(user.id)) clearAssetSelection();
  currentUser = user;

  if ($('userName')) {
    $('userName').textContent =
      `${user.full_name} · ${user.role}`;
  }

  return user;
}

// ============================================================
// LOAD CATEGORIES
// ============================================================
async function loadCategories() {
  const response =
    await fetch('/api/asset-categories');

  if (!response.ok) {
    throw new Error(
      'Unable to load categories.'
    );
  }

  categories = await response.json();

  if ($('categoryFilter')) {
    $('categoryFilter').innerHTML =
      `<option value="">All Categories</option>` +
      categories.map(category => `
        <option value="${category.id}">
          ${escapeHtml(category.name)}
        </option>
      `).join('');
  }

  if ($('assetCategory')) {
    $('assetCategory').innerHTML =
      `<option value="">Select category</option>` +
      categories.map(category => `
        <option value="${category.id}">
          ${escapeHtml(category.name)}
        </option>
      `).join('');
  }
}

// ============================================================
// LOAD LOCATIONS
// ============================================================
async function loadLocations() {
  const response =
    await fetch('/api/locations');

  if (!response.ok) {
    throw new Error(
      'Unable to load locations.'
    );
  }

  locations = await response.json();

  if ($('locationFilter')) {
    const selected = $('locationFilter').value;
    $('locationFilter').innerHTML =
      '<option value="">All Locations</option><option value="none">No Location</option>' +
      locations.map(location => `<option value="${location.id}">${escapeHtml(location.name)}</option>`).join('');
    $('locationFilter').value = selected;
  }

  if ($('assetLocation')) {
    $('assetLocation').innerHTML =
      `<option value="">Select location</option>` +
      locations.map(location => `
        <option value="${location.id}">
          ${escapeHtml(location.name)}
        </option>
      `).join('');
  }
}

// ============================================================
// LOAD ASSETS
// ============================================================
async function loadAssets() {
  const request = ++assetListRequest;
  updateBulkButtons();
  const params = new URLSearchParams();

  const search =
    String(
      $('searchInput')?.value || ''
    ).trim();

  const status =
    $('statusFilter')?.value || '';

  const categoryId =
    $('categoryFilter')?.value || '';

  if (search) {
    params.set('search', search);
  }

  if (status) {
    params.set('status', status);
  }

  if (categoryId) {
    params.set('category_id', categoryId);
  }

  const locationId = $('locationFilter')?.value || '';
  if (locationId) params.set('location_id', locationId);

  const response =
    await fetch(
      `/api/assets?${params.toString()}`
    );

  if (request !== assetListRequest) return;

  if (!response.ok) {
    const data =
      await response
        .json()
        .catch(() => ({}));

    throw new Error(
      data.message ||
      'Unable to load assets.'
    );
  }

  const rows = await response.json();
  if (request !== assetListRequest) return;
  assets = rows;

  renderAssets();
}

// ============================================================
// RENDER ASSETS
// ============================================================
function renderAssets() {
  const tbody =
    $('assetTableBody');

  if (!tbody) return;

  if ($('assetCount')) {
    $('assetCount').textContent =
      `${assets.length} asset${assets.length === 1 ? '' : 's'}`;
  }


  if (!assets.length) {
    tbody.innerHTML = `
      <tr>
        <td
          colspan="12"
          class="text-center text-muted py-5"
        >
          No assets found.
        </td>
      </tr>
    `;

    updateBulkButtons();

    return;
  }

  tbody.innerHTML =
    assets.map(asset => `
      <tr>

        <td>
          <input
            class="form-check-input asset-check"
            type="checkbox"
            value="${asset.id}"
            ${selectedAssetIds.has(Number(asset.id)) ? 'checked' : ''}
          >
        </td>

        <td class="fw-semibold">
          ${escapeHtml(asset.asset_id)}
        </td>

        <td>
          ${escapeHtml(asset.asset_name)}
        </td>

        <td>
          ${escapeHtml(
            asset.category_name || '—'
          )}
        </td>

        <td>
          ${escapeHtml(
            asset.brand || '—'
          )}
        </td>

        <td>
          ${escapeHtml(
            asset.model || '—'
          )}
        </td>

        <td>
          ${escapeHtml(
            asset.serial_number || '—'
          )}
        </td>

        <td>
          ${escapeHtml(
            asset.barcode || '—'
          )}
        </td>

        <td>
          ${escapeHtml(
            asset.custodian_name || '—'
          )}
        </td>

        <td>
          ${escapeHtml(
            asset.department_name || '—'
          )}
        </td>

        <td>
          ${statusBadge(asset.status)}
        </td>

        <td>
          <div class="d-flex gap-1">

            <button
              type="button"
              class="btn btn-sm btn-outline-primary view-btn"
              data-id="${asset.id}"
            >
              View
            </button>

            ${
              asset.status === 'Assigned'
                ? `
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary custodian-btn"
                    data-custodian-id="${asset.custodian_id || ''}"
                    title="View Custodian"
                  >
                    👤
                  </button>

                  <button
                    type="button"
                    class="btn btn-sm btn-outline-success return-btn"
                    data-id="${asset.id}"
                    title="Return Asset"
                  >
                    ↩️
                  </button>
                `
                : ''
            }

            ${
              !['Disposed', 'Retired'].includes(asset.status)
                ? `
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-warning repair-btn"
                    data-id="${asset.id}"
                    title="Report Problem / Send for Repair"
                  >
                    🔧
                  </button>
                `
                : ''
            }

          </div>
        </td>

      </tr>
    `).join('');

// ============================================================
// ASSET CHECKBOX CHANGE HANDLER
// Supports dynamically loaded asset rows
// ============================================================



  document
    .querySelectorAll('.view-btn')
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          viewAsset(
            button.dataset.id
          );
        }
      );
    });

  document
    .querySelectorAll('.return-btn')
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          openReturnModal(
            Number(button.dataset.id)
          );
        }
      );
    });

  document
    .querySelectorAll('.repair-btn')
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          const assetId = Number(
            button.dataset.id
          );

          if (!assetId) {
            showAlert(
              'Invalid asset ID.',
              'warning'
            );
            return;
          }

          window.location.href =
            `/maintenance?asset_id=${assetId}&report=1`;
        }
      );
    });

  document
    .querySelectorAll('.custodian-btn')
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          const custodianId =
            Number(
              button.dataset.custodianId
            );

          if (!custodianId) {
            showAlert(
              'Custodian information is not available.',
              'warning'
            );
            return;
          }

          openCustodianModal(
            custodianId
          );
        }
      );
    });

  updateBulkButtons();
}

// ============================================================
// LOAD EMPLOYEES (for Assign Modal picker)
// ============================================================
async function loadEmployees() {

  const response =
    await fetch('/api/employees?status=active');

  if (!response.ok) {
    throw new Error('Unable to load employees.');
  }

  employees = await response.json();
}

// =====================================================
// OPEN ASSET FROM URL
// Examples: /assets?view=28 or /assets?label=28
// =====================================================
async function openAssetFromUrl() {

  const params =
    new URLSearchParams(
      window.location.search
    );

  const viewAssetId =
    params.get('view');

  const labelAssetId =
    params.get('label');

  // Preserve existing inventory/bookmarked label links without the obsolete modal.
  if (labelAssetId) {
    const target = new URLSearchParams({ ids: labelAssetId });
    for (const key of ['inventory_session_id', 'inventory_item_id']) {
      if (params.get(key)) target.set(key, params.get(key));
    }
    window.location.replace('/asset-label-print?' + target.toString());
    return;
  }

  const assetId =
    labelAssetId || viewAssetId;

  if (!assetId) {
    return;
  }

  try {

    if (!assets.length) {
      await loadAssets();
    }

    const asset =
      assets.find(
        item => String(item.id) === String(assetId)
      );

    if (!asset) {

      console.warn(
        'Asset not found:',
        assetId
      );

      return;
    }

    await viewAsset(asset.id);

  } catch (error) {

    console.error(
      'Unable to open asset from URL:',
      error
    );

  }

}

// ============================================================
// SELECTED IDS
// ============================================================
function selectedIds() {
  return [...selectedAssetIds];
}

function clearAssetSelection() {
  selectedAssetIds.clear();
  window.currentAssignAssetIds = [];
  window.bulkAssignAssetIds = [];
  updateBulkButtons();
}

function updateBulkButtons() {
  const count = selectedAssetIds.size;
  if ($('assignBtn')) $('assignBtn').disabled = !count;
  if ($('qrOnlyLabelBtn')) $('qrOnlyLabelBtn').disabled = !count;
  if ($('clearAssetSelectionBtn')) $('clearAssetSelectionBtn').disabled = !count;
  if ($('assetSelectionCount')) $('assetSelectionCount').textContent = count + (count === 1 ? ' asset selected' : ' assets selected');
  const visible = [...document.querySelectorAll('#assetTableBody .asset-check')];
  visible.forEach(box => { box.checked = selectedAssetIds.has(Number(box.value)); });
  const checked = visible.filter(box => box.checked).length;
  if ($('selectAll')) {
    $('selectAll').checked = visible.length > 0 && checked === visible.length;
    $('selectAll').indeterminate = checked > 0 && checked < visible.length;
    $('selectAll').disabled = !visible.length;
  }
}

document.addEventListener('change', event => {
  if (!event.target.matches('#assetTableBody .asset-check')) return;
  const id = Number(event.target.value);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  if (event.target.checked) selectedAssetIds.add(id);
  else selectedAssetIds.delete(id);
  updateBulkButtons();
});
document.addEventListener('click', event => {
  if (event.target.closest('#clearAssetSelectionBtn')) clearAssetSelection();
  if (event.target.closest('#qrOnlyLabelBtn') && selectedAssetIds.size) {
    window.open('/asset-label-print?ids=' + selectedIds().join(','), '_blank', 'noopener');
  }
});
// In-memory only: never restore another user's selection through the back cache.
window.addEventListener('pagehide', clearAssetSelection);

async function verifyAssetSelectionUser() {
  const previousId = currentUser?.id;
  const user = await loadMe();
  if (!user || (previousId != null && String(previousId) !== String(user.id))) {
    clearAssetSelection();
    throw new Error('Your session changed. Please select the assets again.');
  }
}

async function fetchSelectedAssets(ids) {
  const results = await Promise.all(ids.map(async id => {
    try {
      const response = await fetch('/api/assets/' + id, { credentials: 'include', cache: 'no-store' });
      if (response.status === 404) {
        selectedAssetIds.delete(Number(id));
        throw new Error('Asset #' + id + ' no longer exists and was removed from selection.');
      }
      if (!response.ok) throw new Error('Unable to verify asset #' + id + '. Please retry.');
      const data = await response.json();
      const asset = data.asset || data;
      if (Number(asset.id) !== Number(id)) throw new Error('Invalid asset response for #' + id);
      return { asset };
    } catch (error) { return { error: error.message }; }
  }));
  updateBulkButtons();
  const errors = results.filter(result => result.error);
  if (errors.length) throw new Error(errors.map(result => result.error).join(' '));
  return results.map(result => result.asset);
}

// ============================================================
// LOCAL DATE/TIME
// ============================================================
function getLocalDateTime() {
  const now = new Date();

  return new Date(
    now.getTime() -
    now.getTimezoneOffset() * 60000
  )
    .toISOString()
    .slice(0, 16);
}

// ============================================================
// VIEW ASSET + HISTORY
// ============================================================

async function deleteAsset(asset, detailsModal) {
  const assetId = Number(asset?.id);

  if (!Number.isInteger(assetId) || assetId <= 0) {
    showAlert('Invalid asset ID.', 'danger');
    return;
  }

  if (asset.status === 'Assigned' || asset.custodian_name) {
    showAlert(
      'This asset is assigned to an employee. Return the asset before deleting it.',
      'warning'
    );
    return;
  }

  const assetLabel =
    asset.asset_id || asset.asset_name || `Asset ${assetId}`;

  if (!window.confirm(
    `Delete ${assetLabel}? This permanently removes the asset and its related records.`
  )) {
    return;
  }

  const button = $('detailsDeleteBtn');
  const originalHtml = button?.innerHTML || '';

  try {
    if (button) {
      button.disabled = true;
      button.innerHTML = `
        <span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
        Deleting...
      `;
    }

    const response = await fetch(`/api/assets/${assetId}`, {
      method: 'DELETE'
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || 'Unable to delete asset.');
    }

    const modalElement = $('assetDetailsModal');

    if (detailsModal && modalElement) {
      modalElement.addEventListener(
        'hidden.bs.modal',
        () => modalElement.remove(),
        { once: true }
      );
      detailsModal.hide();
    }

    selectedAssetIds.delete(assetId);
    updateBulkButtons();
    await loadAssets();
    showAlert(result.message || 'Asset deleted successfully.', 'success');
  } catch (error) {
    showAlert(error.message || 'Unable to delete asset.', 'danger');

    if (button) {
      button.disabled = false;
      button.innerHTML = originalHtml;
    }
  }
}

// ============================================================
// VIEW ASSET - COMPLETE ASSET DETAILS
// ============================================================
async function viewAsset(id) {

  try {

    const response =
      await fetch(
        `/api/assets/${id}`
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {

      throw new Error(
        data.message ||
        'Unable to load asset details.'
      );

    }

    const asset =
      data.asset || data;

    let history = [];

    try {

      const historyResponse =
        await fetch(
          `/api/assets/${id}/history`
        );

      if (historyResponse.ok) {

        const historyData =
          await historyResponse
            .json()
            .catch(() => []);

        history =
          Array.isArray(historyData)
            ? historyData
            : (
                Array.isArray(historyData.history)
                  ? historyData.history
                  : []
              );
      }

    } catch (historyError) {

      console.warn(
        'Unable to load asset history:',
        historyError
      );

    }

    document
      .getElementById(
        'assetDetailsModal'
      )
      ?.remove();

    const value =
      value => {

        if (
          value === null ||
          value === undefined ||
          value === ''
        ) {

          return '—';

        }

        return escapeHtml(
          String(value)
        );

      };

    const formatDate =
      value => {

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

          return value(
            value
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

      };

    const formatDateTime =
      value => {

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

          return value(
            value
          );

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

      };

    const money =
      amount => {

        if (
          amount === null ||
          amount === undefined ||
          amount === ''
        ) {

          return '—';

        }

        const number =
          Number(amount);

        if (
          Number.isNaN(number)
        ) {

          return value(amount);

        }

        return number.toLocaleString(
          'en-PH',
          {
            style: 'currency',
            currency: 'PHP'
          }
        );

      };

    const status =
      asset.status ||
      'Available';

    const condition =
      asset.condition_status ||
      '—';

    const statusHTML =
      statusBadge(status);

    const custodianName =
      asset.custodian_name ||
      asset.employee_name ||
      '';

    const custodianEmployeeId =
      asset.custodian_employee_id ||
      asset.employee_id ||
      '';

    const custodianDepartment =
      asset.custodian_department_name ||
      asset.department_name ||
      '';

    const custodianPosition =
      asset.custodian_position_title ||
      asset.position_title ||
      '';

    const custodianAssignedAt =
      asset.assigned_at ||
      asset.assignment_date ||
      '';

    const custodianRemarks =
      asset.assignment_remarks ||
      asset.remarks ||
      '';

    const hasCustodian =
      Boolean(
        custodianName ||
        custodianEmployeeId
      );

    let activeRepair = null;

    try {

      const repairResponse =
        await fetch(
          `/api/repairs?search=${encodeURIComponent(
            asset.asset_id || ''
          )}`
        );

      if (repairResponse.ok) {

        const repairData =
          await repairResponse
            .json()
            .catch(() => []);

        const repairs =
          Array.isArray(repairData)
            ? repairData
            : (
                Array.isArray(
                  repairData.repairs
                )
                  ? repairData.repairs
                  : []
              );

        activeRepair =
          repairs.find(
            repair =>
              repair.asset_id ===
                asset.asset_id &&
              [
                'For Repair',
                'Under Diagnosis',
                'Under Repair',
                'Waiting for Parts',
                'Repaired'
              ].includes(
                repair.status
              )
          ) || null;

      }

    } catch (repairError) {

      console.warn(
        'Unable to check active repair:',
        repairError
      );

    }

    let maintenanceHTML = `
      <div class="text-muted">
        No maintenance record currently active.
      </div>
    `;

    if (activeRepair) {

      maintenanceHTML = `
        <div class="border rounded-3 p-3 bg-light">

          <div class="d-flex justify-content-between align-items-start mb-2">

            <div>

              <div class="fw-bold">
                ${value(
                  activeRepair.repair_no ||
                  activeRepair.id
                )}
              </div>

              <div class="small text-muted">
                ${value(
                  activeRepair.problem_description ||
                  activeRepair.issue_description ||
                  activeRepair.reason
                )}
              </div>

            </div>

            <span class="badge text-bg-warning">
              ${value(activeRepair.status)}
            </span>

          </div>

        </div>
      `;

    }

  // ============================================================
// MAINTENANCE SECTION
// ============================================================

let maintenanceHTML2 = `
  <div class="text-muted">
    No maintenance record currently active.
  </div>
`;

if (activeRepair) {

  maintenanceHTML2 = `
    <div class="border rounded-3 p-3 bg-light">

      <div class="d-flex justify-content-between align-items-start mb-2">

        <div>

          <div class="fw-bold">
            ${value(
              activeRepair.repair_no ||
              activeRepair.id
            )}
          </div>

          <div class="small text-muted">
            ${value(
              activeRepair.problem_description ||
              activeRepair.issue_description ||
              activeRepair.reason
            )}
          </div>

        </div>

        <span class="badge text-bg-warning">
          ${value(activeRepair.status)}
        </span>

      </div>

      <div class="row g-2 small">

        <div class="col-md-4">
          <strong>Priority:</strong>
          ${value(activeRepair.priority)}
        </div>

        <div class="col-md-4">
          <strong>Reported:</strong>
          ${formatDateTime(
            activeRepair.created_at
          )}
        </div>

        <div class="col-md-4">
          <strong>Technician:</strong>
          ${value(
            activeRepair.technician_name
          )}
        </div>

      </div>

    </div>
  `;

}

// ----------------------------------------------------------
// ASSET IMAGE
// ----------------------------------------------------------

const assetImageUrl =
  getAssetImageUrl(
    asset.asset_image
  );

const receiptImageUrl =
  getAssetImageUrl(
    asset.receipt_image
  );

const assetImageHTML =
  assetImageUrl
    ? `
      <div class="text-center">

        <img
          src="${escapeHtml(assetImageUrl)}"
          alt="Asset Image"
          class="img-fluid rounded border"
          style="
            max-height:260px;
            object-fit:contain;
            cursor:pointer;
          "
          onclick="window.open(
            '${escapeHtml(assetImageUrl)}',
            '_blank'
          )"
        >

      </div>
    `
    : `
      <div
        class="border rounded bg-light text-center text-muted py-5"
      >
        <i class="bi bi-image fs-1 d-block mb-2"></i>
        No asset image
      </div>
    `;

const receiptImageHTML =
  receiptImageUrl
    ? `
      <div class="text-center">

        <img
          src="${escapeHtml(receiptImageUrl)}"
          alt="Receipt Image"
          class="img-fluid rounded border"
          style="
            max-height:260px;
            object-fit:contain;
            cursor:pointer;
          "
          onclick="window.open(
            '${escapeHtml(receiptImageUrl)}',
            '_blank'
          )"
        >

      </div>
    `
    : `
      <div
        class="border rounded bg-light text-center text-muted py-5"
      >
        <i class="bi bi-receipt fs-1 d-block mb-2"></i>
        No receipt image
      </div>
    `;

// ----------------------------------------------------------
// HISTORY HTML
// ----------------------------------------------------------

const historyHTML =
  history.length
    ? `
      <div class="table-responsive">

        <table class="table table-sm table-hover mb-0">

          <thead>
            <tr>

              <th>Date</th>
              <th>Action</th>
              <th>User</th>
              <th>Remarks</th>

            </tr>
          </thead>

          <tbody>

            ${history.map(item => `

              <tr>

                <td>
                  ${formatDateTime(
                    item.created_at ||
                    item.action_date
                  )}
                </td>

                <td>
                  ${value(
                    item.action ||
                    item.event ||
                    item.history_type
                  )}
                </td>

                <td>
                  ${value(
                    item.user_name ||
                    item.created_by_name ||
                    item.performed_by_name
                  )}
                </td>

                <td>
                  ${value(
                    item.remarks ||
                    item.details
                  )}
                </td>

              </tr>

            `).join('')}

          </tbody>

        </table>

      </div>
    `
    : `
      <div class="text-muted">
        No asset history found.
      </div>
    `;

// ----------------------------------------------------------
// ASSIGN BUTTON
// ----------------------------------------------------------

const assignButtonHTML =
  status === 'Available'
    ? `
      <button
        type="button"
        class="btn btn-primary"
        id="detailsAssignBtn"
      >
        <i class="bi bi-person-plus me-1"></i>
        Assign
      </button>
    `
    : '';


// ----------------------------------------------------------
// EDIT BUTTON
// ----------------------------------------------------------

const editButtonHTML = `
  <button
    type="button"
    class="btn btn-warning"
    id="detailsEditBtn"
  >
    <i class="bi bi-pencil-square me-1"></i>
    Edit Asset
  </button>
`;




// ----------------------------------------------------------
// REPAIR BUTTON
// ----------------------------------------------------------

const repairButtonHTML =
  !['Disposed', 'Retired'].includes(status)
    ? `
      <button
        type="button"
        class="btn btn-outline-danger"
        id="detailsRepairBtn"
      >
        <i class="bi bi-tools me-1"></i>
        Report Problem
      </button>
    `
    : '';


// ----------------------------------------------------------
// DELETE BUTTON (ADMIN ONLY)
// ----------------------------------------------------------

const assetIsAssigned =
  status === 'Assigned' || hasCustodian;

const deleteButtonHTML =
  currentUser?.role === 'admin'
    ? `
      <button
        type="button"
        class="btn btn-danger"
        id="detailsDeleteBtn"
        ${assetIsAssigned ? 'disabled' : ''}
        title="${assetIsAssigned
          ? 'Return this asset before deleting it.'
          : 'Delete this asset permanently.'}"
      >
        <i class="bi bi-trash me-1"></i>
        Delete Asset
      </button>
    `
    : '';

// ----------------------------------------------------------
// MODAL HTML
// ----------------------------------------------------------

const modalHTML = `

  <div
    class="modal fade"
    id="assetDetailsModal"
    tabindex="-1"
    aria-hidden="true"
  >

    <div
      class="modal-dialog modal-xl modal-dialog-scrollable"
    >

      <div class="modal-content">

        <div class="modal-header">

          <div>

            <h5 class="modal-title mb-1">
              Asset Details
            </h5>

            <div class="small text-muted">
              ${value(asset.asset_id)}
            </div>

          </div>

          <button
            type="button"
            class="btn-close"
            data-bs-dismiss="modal"
            aria-label="Close"
          ></button>

        </div>

        <div class="modal-body">

          <!-- ==========================================
               BASIC INFORMATION
          =========================================== -->

          <div class="card mb-4">

            <div class="card-header bg-white">

              <h6 class="mb-0">
                <i class="bi bi-info-circle me-2"></i>
                Asset Information
              </h6>

            </div>

            <div class="card-body">

              <div class="row g-3">

                <div class="col-md-4">

                  <div class="small text-muted">
                    Asset Tag
                  </div>

                  <div class="fw-semibold">
                    ${value(asset.asset_id)}
                  </div>

                </div>

                <div class="col-md-4">

                  <div class="small text-muted">
                    Asset Name
                  </div>

                  <div class="fw-semibold">
                    ${value(asset.asset_name)}
                  </div>

                </div>

                <div class="col-md-4">

                  <div class="small text-muted">
                    Status
                  </div>

                  <div>
                    ${statusHTML}
                  </div>

                </div>

                <div class="col-md-4">

                  <div class="small text-muted">
                    Category
                  </div>

                  <div>
                    ${value(asset.category_name)}
                  </div>

                </div>

                <div class="col-md-4">

                  <div class="small text-muted">
                    Brand
                  </div>

                  <div>
                    ${value(asset.brand)}
                  </div>

                </div>

                <div class="col-md-4">

                  <div class="small text-muted">
                    Model
                  </div>

                  <div>
                    ${value(asset.model)}
                  </div>

                </div>

                <div class="col-md-4">

                  <div class="small text-muted">
                    Serial Number
                  </div>

                  <div>
                    ${value(asset.serial_number)}
                  </div>

                </div>

                <div class="col-md-4">

                  <div class="small text-muted">
                    Barcode
                  </div>

                  <div>
                    ${value(asset.barcode)}
                  </div>

                </div>

                <div class="col-md-4">

                  <div class="small text-muted">
                    Condition
                  </div>

                  <div>
                    ${value(condition)}
                  </div>

                </div>

                <div class="col-md-4">

                  <div class="small text-muted">
                    Location
                  </div>

                  <div>
                    ${value(asset.location_name)}
                  </div>

                </div>

                <div class="col-md-4">

                  <div class="small text-muted">
                    Purchase Date
                  </div>

                  <div>
                    ${formatDate(asset.purchase_date)}
                  </div>

                </div>

                <div class="col-md-4">

                  <div class="small text-muted">
                    Purchase Cost
                  </div>

                  <div>
                    ${money(asset.purchase_cost)}
                  </div>

                </div>

                <div class="col-md-4">

                  <div class="small text-muted">
                    Warranty Expiry
                  </div>

                  <div>
                    ${formatDate(asset.warranty_expiry)}
                  </div>

                </div>

                <div class="col-12">

                  <div class="small text-muted">
                    Notes
                  </div>

                  <div class="border rounded p-3 bg-light">
                    ${value(asset.notes)}
                  </div>

                </div>

              </div>

            </div>

          </div>

          <!-- ==========================================
               IMAGES
          =========================================== -->

          <div class="card mb-4">

            <div class="card-header bg-white">

              <h6 class="mb-0">
                <i class="bi bi-images me-2"></i>
                Asset Documents / Images
              </h6>

            </div>

            <div class="card-body">

              <div class="row g-4">

                <div class="col-md-6">

                  <div class="fw-semibold mb-2">
                    Asset Image
                  </div>

                  ${assetImageHTML}

                </div>

                <div class="col-md-6">

                  <div class="fw-semibold mb-2">
                    Receipt Image
                  </div>

                  ${receiptImageHTML}

                </div>

              </div>

            </div>

          </div>

          <!-- ==========================================
               CUSTODIAN
          =========================================== -->

          <div class="card mb-4">

            <div class="card-header bg-white">

              <h6 class="mb-0">
                <i class="bi bi-person-badge me-2"></i>
                Current Custodian
              </h6>

            </div>

            <div class="card-body">

              ${
                hasCustodian
                  ? `

                    <div class="row g-3">

                      <div class="col-md-4">

                        <div class="small text-muted">
                          Employee
                        </div>

                        <div class="fw-semibold">
                          ${value(custodianName)}
                        </div>

                      </div>

                      <div class="col-md-4">

                        <div class="small text-muted">
                          Employee ID
                        </div>

                        <div>
                          ${value(custodianEmployeeId)}
                        </div>

                      </div>

                      <div class="col-md-4">

                        <div class="small text-muted">
                          Department
                        </div>

                        <div>
                          ${value(custodianDepartment)}
                        </div>

                      </div>

                      <div class="col-md-4">

                        <div class="small text-muted">
                          Position
                        </div>

                        <div>
                          ${value(custodianPosition)}
                        </div>

                      </div>

                      <div class="col-md-4">

                        <div class="small text-muted">
                          Assigned Date
                        </div>

                        <div>
                          ${formatDateTime(
                            custodianAssignedAt
                          )}
                        </div>

                      </div>

                      <div class="col-md-4">

                        <div class="small text-muted">
                          Remarks
                        </div>

                        <div>
                          ${value(custodianRemarks)}
                        </div>

                      </div>

                    </div>

                  `
                  : `
                    <div class="text-muted">
                      This asset is currently not assigned
                      to a custodian.
                    </div>
                  `
              }

            </div>

          </div>

          <!-- ==========================================
               MAINTENANCE
          =========================================== -->

          <div class="card mb-4">

            <div class="card-header bg-white">

              <h6 class="mb-0">
                <i class="bi bi-tools me-2"></i>
                Maintenance
              </h6>

            </div>

            <div class="card-body">

              ${maintenanceHTML}

            </div>

          </div>

          <!-- ==========================================
               HISTORY
          =========================================== -->

          <div class="card">

            <div class="card-header bg-white">

              <h6 class="mb-0">
                <i class="bi bi-clock-history me-2"></i>
                Asset History
              </h6>

            </div>

            <div class="card-body p-0">

              ${historyHTML}

            </div>

          </div>

        </div>

        <div class="modal-footer">

          ${assignButtonHTML}
          ${editButtonHTML}
          ${repairButtonHTML}
          ${deleteButtonHTML}

          <button
            type="button"
            class="btn btn-secondary"
            data-bs-dismiss="modal"
          >
            Close
          </button>

        </div>

      </div>

    </div>

  </div>

`;

document.body.insertAdjacentHTML(
  'beforeend',
  modalHTML
);

// ----------------------------------------------------------
// EDIT ASSET BUTTON
// ----------------------------------------------------------

const detailsEditBtn =
  document.getElementById('detailsEditBtn');

if (detailsEditBtn) {

  detailsEditBtn.addEventListener(
    'click',
    function () {

      console.log(
        'Edit Asset clicked:',
        asset.id
      );

      editAssetFromView(asset.id);

    }
  );

} else {

  console.warn(
    'detailsEditBtn was not found.'
  );

}

const detailsModalElement =
  $('assetDetailsModal');

const detailsModal =
  new bootstrap.Modal(
    detailsModalElement
  );

detailsModal.show();

$('detailsDeleteBtn')
  ?.addEventListener(
    'click',
    () => deleteAsset(asset, detailsModal)
  );

// ----------------------------------------------------------
// DETAILS -> ASSIGN
// IMPORTANT: remember THIS asset ID
// ----------------------------------------------------------

$('detailsAssignBtn')
  ?.addEventListener(
    'click',
    () => {

      directAssignAssetId =
        Number(asset.id);

      detailsModal.hide();

detailsModal._element.addEventListener(
  'hidden.bs.modal',
  () => {

    setTimeout(() => {

      if (
        typeof openAssignModal ===
        'function'
      ) {

        openAssignModal();

      }

    }, 50);

  },
  {
    once: true
  }
);

    }
  );

// ----------------------------------------------------------
// DETAILS -> REPAIR
// ----------------------------------------------------------

$('detailsRepairBtn')
  ?.addEventListener(
    'click',
    () => {

      const assetDbId =
        Number(asset.id);

      if (!assetDbId) {

        showAlert(
          'Invalid asset ID.',
          'warning'
        );

        return;

      }

      window.location.href =
        `/maintenance?asset_id=${assetDbId}&report=1`;

    }
  );

  } catch (error) {

    console.error(
      'viewAsset error:',
      error
    );

    showAlert(
      error.message ||
      'Unable to load asset details.',
      'danger'
    );

  }

}
// ============================================================
// EDIT ASSET FROM VIEW
// Uses the existing Add Asset modal
// ============================================================

async function editAssetFromView(id) {

    try {

        console.log('Opening asset for edit:', id);

        const response = await fetch(`/api/assets/${id}`, {
            credentials: 'include'
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.message || 'Unable to load asset.'
            );
        }

        const asset = data.asset || data;

        console.log('Asset loaded for editing:', asset);

        // ----------------------------------------------------
        // Close View Asset modal
        // ----------------------------------------------------

        const detailsModal =
            document.getElementById('assetDetailsModal');

        if (detailsModal) {

            const detailsInstance =
                bootstrap.Modal.getInstance(detailsModal);

            if (detailsInstance) {
                detailsInstance.hide();
            }
        }

        // ----------------------------------------------------
        // Get existing Add/Edit modal
        // ----------------------------------------------------

        const modalElement =
            document.getElementById('addAssetModal');

        if (!modalElement) {
            throw new Error(
                'Asset modal not found.'
            );
        }

        const form =
            document.getElementById('assetForm');

        if (!form) {
            throw new Error(
                'Asset form not found.'
            );
        }

        // ----------------------------------------------------
        // IMPORTANT:
        // Store database ID so saveAsset knows this is EDIT
        // ----------------------------------------------------

        delete form.dataset.createdId;
        form.dataset.editId = String(asset.id);
        $('assetIdPreviewGroup').hidden = true;
        $('newAssetAssignment').hidden = true;
        $('newEmployeeSearch').required = false;

        // ----------------------------------------------------
        // Reset form first
        // ----------------------------------------------------

        form.reset();

        // ----------------------------------------------------
        // Get fields by NAME
        // ----------------------------------------------------

        const assetName =
            form.elements.namedItem('asset_name');

        const categoryId =
            form.elements.namedItem('category_id');

        const brand =
            form.elements.namedItem('brand');

        const model =
            form.elements.namedItem('model');

        const serialNumber =
            form.elements.namedItem('serial_number');

        const barcode =
            form.elements.namedItem('barcode');

        const conditionStatus =
            form.elements.namedItem('condition_status');

        const purchaseDate =
            form.elements.namedItem('purchase_date');

        const purchaseCost =
            form.elements.namedItem('purchase_cost');

        const warrantyExpiry =
            form.elements.namedItem('warranty_expiry');

        const locationId =
            form.elements.namedItem('location_id');

        const notes =
            form.elements.namedItem('notes');

        // ----------------------------------------------------
        // Populate existing values
        // ----------------------------------------------------

        if (assetName) {
            assetName.value =
                asset.asset_name || '';
        }

        if (categoryId) {
            categoryId.value =
                asset.category_id || '';
        }

        if (brand) {
            brand.value =
                asset.brand || '';
        }

        if (model) {
            model.value =
                asset.model || '';
        }

        if (serialNumber) {
            serialNumber.value =
                asset.serial_number || '';
        }

        if (barcode) {
            barcode.value =
                asset.barcode || '';
        }

        if (conditionStatus) {
            conditionStatus.value =
                asset.condition_status || 'Good';
        }

        if (purchaseDate) {
            purchaseDate.value =
                asset.purchase_date
                    ? String(asset.purchase_date).substring(0, 10)
                    : '';
        }

        if (purchaseCost) {

    purchaseCost.value =
        asset.purchase_cost !== null &&
        asset.purchase_cost !== undefined

          ? formatPurchaseCost(
              asset.purchase_cost
            )

          : '';

}

        if (warrantyExpiry) {
            warrantyExpiry.value =
                asset.warranty_expiry
                    ? String(asset.warranty_expiry).substring(0, 10)
                    : '';
        }

        if (locationId) {
            locationId.value =
                asset.location_id || '';
        }

        if (notes) {
            notes.value =
                asset.notes || '';
        }

        // ----------------------------------------------------
        // Reset image state
        // ----------------------------------------------------

        assetImageRemoved = false;
        receiptImageRemoved = false;

        const assetImageFile =
            document.getElementById('assetImageFile');

        const receiptImageFile =
            document.getElementById('receiptImageFile');

        if (assetImageFile) {
            assetImageFile.value = '';
        }

        if (receiptImageFile) {
            receiptImageFile.value = '';
        }

        // ----------------------------------------------------
        // Show existing images
        // ----------------------------------------------------

        showExistingAssetImage(
            asset.asset_image,
            'assetImagePreview'
        );

        showExistingAssetImage(
            asset.receipt_image,
            'receiptImagePreview'
        );

        // ----------------------------------------------------
        // Change modal title
        // ----------------------------------------------------

        const modalTitle =
            modalElement.querySelector('.modal-title');

        if (modalTitle) {
            modalTitle.innerHTML = `
                <i class="bi bi-pencil-square me-2"></i>
                Edit Asset
            `;
        }

        // ----------------------------------------------------
        // Hide "New assets are created..." message
        // ----------------------------------------------------

        const newAssetNotice =
            document.getElementById('newAssetNotice');

        if (newAssetNotice) {
            newAssetNotice.style.display = 'none';
        }

        // ----------------------------------------------------
        // Change submit button
        // ----------------------------------------------------

        const submitButton =
            form.querySelector(
                'button[type="submit"]'
            );

        if (submitButton) {
            submitButton.innerHTML = `
                <i class="bi bi-save me-1"></i>
                Update Asset
            `;
        }

        // ----------------------------------------------------
        // Show modal
        // ----------------------------------------------------

        const modal =
            bootstrap.Modal.getOrCreateInstance(
                modalElement
            );

        modal.show();

    } catch (error) {

        console.error(
            'EDIT ASSET ERROR:',
            error
        );

        showAlert(
            error.message ||
            'Unable to edit asset.',
            'danger'
        );
    }
}
// ============================================================
// OPEN ADD ASSET MODAL
// ============================================================

async function loadAssetIdPreview() {
    const form = $('assetForm');
    const preview = $('assetIdPreview');
    const retry = $('assetIdPreviewRetry');
    const token = String(Number(form.dataset.previewToken || 0) + 1);
    form.dataset.previewToken = token;
    preview.value = '';
    preview.placeholder = 'Loading Asset ID...';
    preview.setAttribute('aria-busy', 'true');
    retry.hidden = true;
    const isCurrent = () => form.dataset.previewToken === token && !form.dataset.editId && !form.dataset.createdId;
    try {
        const response = await fetch('/api/assets/next-id', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error('Preview unavailable');
        const data = await response.json();
        if (typeof data.asset_id !== 'string' || !data.asset_id.trim()) throw new Error('Invalid preview response');
        if (isCurrent()) preview.value = data.asset_id;
    } catch (error) {
        if (isCurrent()) {
            preview.placeholder = 'Unable to load Asset ID';
            retry.hidden = false;
        }
    } finally {
        if (form.dataset.previewToken === token) preview.setAttribute('aria-busy', 'false');
    }
}

function openAddAssetModal() {

    const modalElement =
        document.getElementById('addAssetModal');

    if (!modalElement) {
        console.error(
            'addAssetModal not found.'
        );
        return;
    }

    const form =
        document.getElementById('assetForm');

    if (!form) {
        console.error(
            'assetForm not found.'
        );
        return;
    }

    // --------------------------------------------------------
    // New Asset mode
    // --------------------------------------------------------

    form.dataset.editId = '';
    delete form.dataset.creationRequestId;
    delete form.dataset.createdId;
    form.reset();
    setupNewAssetAssignment();
    $('assetIdPreviewGroup').hidden = false;
    loadAssetIdPreview();

    // --------------------------------------------------------
    // Reset image state
    // --------------------------------------------------------

    assetImageRemoved = false;
    receiptImageRemoved = false;

    const assetImageFile =
        document.getElementById('assetImageFile');

    const receiptImageFile =
        document.getElementById('receiptImageFile');

    if (assetImageFile) {
        assetImageFile.value = '';
    }

    if (receiptImageFile) {
        receiptImageFile.value = '';
    }

    // --------------------------------------------------------
    // Reset image previews
    // --------------------------------------------------------

    resetAssetImagePreview();
    resetReceiptImagePreview();

    // --------------------------------------------------------
    // Show New Asset notice
    // --------------------------------------------------------

    const newAssetNotice =
        document.getElementById('newAssetNotice');

    if (newAssetNotice) {
        newAssetNotice.style.display = '';
    }

    // --------------------------------------------------------
    // Change title
    // --------------------------------------------------------

    const modalTitle =
        modalElement.querySelector('.modal-title');

    if (modalTitle) {
        modalTitle.innerHTML = `
            <i class="bi bi-plus-circle me-2"></i>
            Add New Asset
        `;
    }

    // --------------------------------------------------------
    // Change submit button
    // --------------------------------------------------------

    const submitButton =
        form.querySelector(
            'button[type="submit"]'
        );

    if (submitButton) {
        submitButton.innerHTML = `
            <i class="bi bi-save me-1"></i>
            Save Asset
        `;
    }

    // --------------------------------------------------------
    // Show modal
    // --------------------------------------------------------

    const modal =
        bootstrap.Modal.getOrCreateInstance(
            modalElement
        );

    modal.show();
}

// ============================================================
// IMAGE PREVIEW HELPERS
// ============================================================
function resetAssetImagePreview() {

    const preview =
        document.getElementById('assetImagePreview');

    if (!preview) return;

    preview.classList.remove('d-none');
    preview.dataset.existingImage = '';

    preview.innerHTML = `
        <div class="text-muted py-5">
            <i class="bi bi-camera fs-1 d-block mb-2"></i>
            No asset image
        </div>
    `;
}

function resetReceiptImagePreview() {

    const preview =
        document.getElementById('receiptImagePreview');

    if (!preview) return;

    preview.classList.remove('d-none');
    preview.dataset.existingImage = '';

    preview.innerHTML = `
        <div class="text-muted py-5">
            <i class="bi bi-receipt fs-1 d-block mb-2"></i>
            No receipt image
        </div>
    `;
}


// ============================================================
// PREVIEW IMAGE FILE
// ============================================================
function previewImageFile(
  file,
  previewElement,
  emptyIcon,
  emptyText
) {

  if (!previewElement) {
    return;
  }

  if (!file) {

    previewElement.innerHTML = `
      <div class="text-muted py-5">
        <i class="${emptyIcon} fs-1 d-block mb-2"></i>
        ${escapeHtml(emptyText)}
      </div>
    `;

    return;

  }

  if (!file.type.startsWith('image/')) {

    previewElement.innerHTML = `
      <div class="text-danger py-5">
        <i class="bi bi-exclamation-triangle fs-1 d-block mb-2"></i>
        Invalid image file
      </div>
    `;

    return;

  }

  const reader =
    new FileReader();

  reader.onload =
    event => {

      previewElement.innerHTML = `
        <img
          src="${event.target.result}"
          alt="Preview"
          class="img-fluid rounded"
          style="
            max-height:220px;
            object-fit:contain;
          "
        >
      `;

    };

  reader.readAsDataURL(file);

}

// ============================================================
// OPEN ASSET / RECEIPT CAMERA
// ============================================================

async function openCamera(target) {

  activeCameraTarget =
    target;


  // ==========================================================
  // CREATE CAMERA MODAL IF MISSING
  // ==========================================================

  let modalElement =
    $('cameraModal');


  if (!modalElement) {

    document.body.insertAdjacentHTML(
      'beforeend',
      `

      <div
        class="modal fade"
        id="cameraModal"
        tabindex="-1"
        aria-hidden="true"
      >

        <div
          class="modal-dialog modal-lg modal-dialog-centered"
        >

          <div class="modal-content">

            <div class="modal-header">

              <div>

                <h5
                  class="modal-title"
                  id="cameraModalTitle"
                >
                  Camera
                </h5>

                <div
                  class="small text-muted"
                >
                  Position the image inside the camera view.
                </div>

              </div>


              <button
                type="button"
                class="btn-close"
                data-bs-dismiss="modal"
              ></button>

            </div>


            <div class="modal-body">

              <div
                class="bg-dark rounded overflow-hidden"
              >

                <video
                  id="cameraVideo"
                  autoplay
                  muted
                  playsinline
                  class="w-100"
                  style="
                    display:block;
                    min-height:300px;
                    max-height:520px;
                    object-fit:contain;
                  "
                ></video>

              </div>


              <div
                id="cameraMessage"
                class="alert alert-info mt-3 mb-0"
              >
                Starting camera...
              </div>

            </div>


            <div class="modal-footer">

              <button
                type="button"
                class="btn btn-secondary"
                data-bs-dismiss="modal"
              >
                Cancel
              </button>


              <button
                type="button"
                class="btn btn-primary"
                id="captureCameraImageBtn"
                disabled
              >

                <i class="bi bi-camera-fill me-1"></i>

                Capture Photo

              </button>

            </div>

          </div>

        </div>

      </div>

      `
    );


    modalElement =
      $('cameraModal');


    // ----------------------------------------------------------
    // CAPTURE BUTTON
    // ----------------------------------------------------------

    $('captureCameraImageBtn')
      ?.addEventListener(
        'click',
        captureCameraImage
      );


    // ----------------------------------------------------------
    // CLEANUP + REOPEN ADD ASSET
    // ----------------------------------------------------------

    modalElement
      ?.addEventListener(
        'hidden.bs.modal',
        () => {

          stopCamera();


          setTimeout(
  () => {

    const addModalElement =
      $('addAssetModal');


    if (addModalElement) {

      bootstrap.Modal
        .getOrCreateInstance(
          addModalElement
        )
        .show();

    }

  },
  150
);

        }
      );

  }


  // ==========================================================
  // TITLE
  // ==========================================================

  const title =
    $('cameraModalTitle');


  if (title) {

    title.textContent =
      target === 'receipt'
        ? 'Capture Receipt Image'
        : 'Capture Asset Image';

  }


  // ==========================================================
  // CHECK HTTPS
  // ==========================================================

  if (
    !window.isSecureContext
  ) {

    showAlert(
      'Camera requires HTTPS. Open the system using https://.',
      'warning'
    );

    return;

  }


  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {

    showAlert(
      'Camera access is not supported by this browser.',
      'warning'
    );

    return;

  }




  const cameraModal =
    bootstrap.Modal
      .getOrCreateInstance(
        modalElement
      );


  // ==========================================================
  // START CAMERA AFTER MODAL OPENS
  // ==========================================================

  modalElement.addEventListener(
    'shown.bs.modal',
    async function cameraStarted() {

      const video =
        $('cameraVideo');

      const message =
        $('cameraMessage');

      const captureButton =
        $('captureCameraImageBtn');


      if (!video) {

        return;

      }


      try {

        stopCamera();


        if (message) {

          message.className =
            'alert alert-info mt-3 mb-0';

          message.textContent =
            'Requesting camera permission...';

        }


        cameraStream =
          await navigator.mediaDevices
            .getUserMedia({

              video: {

                facingMode: {
                  ideal:
                    'environment'
                },

                width: {
                  ideal:
                    1920
                },

                height: {
                  ideal:
                    1080
                }

              },

              audio:
                false

            });


        video.srcObject =
          cameraStream;


        await video.play();


        if (message) {

          message.className =
            'alert alert-success mt-3 mb-0';

          message.textContent =
            'Camera ready. Click Capture Photo.';

        }


        if (captureButton) {

          captureButton.disabled =
            false;

        }


      } catch (error) {

        console.error(
          'CAMERA ERROR:',
          error
        );


        let errorMessage =
          'Unable to access the camera.';


        if (
          error.name ===
          'NotAllowedError'
        ) {

          errorMessage =
            'Camera permission was denied. Allow camera access in Chrome and try again.';

        }


        if (
          error.name ===
          'NotFoundError'
        ) {

          errorMessage =
            'No camera was found on this device.';

        }


        if (
          error.name ===
          'NotReadableError'
        ) {

          errorMessage =
            'The camera may already be in use by another application.';

        }


        if (message) {

          message.className =
            'alert alert-danger mt-3 mb-0';

          message.textContent =
            errorMessage;

        }

      }

    },
    {
      once:
        true
    }
  );

// ==========================================================
// SHOW CAMERA AFTER ADD ASSET MODAL FINISHES CLOSING
// ==========================================================

const addModalElement =
  $('addAssetModal');


if (
  addModalElement &&
  addModalElement.classList.contains('show')
) {

  const currentAddModal =
    bootstrap.Modal.getOrCreateInstance(
      addModalElement
    );


  addModalElement.addEventListener(
    'hidden.bs.modal',
    () => {

      cameraModal.show();

    },
    {
      once: true
    }
  );


  currentAddModal.hide();

} else {

  cameraModal.show();

}

}

// ============================================================
// STOP CAMERA
// ============================================================
function stopCamera() {

  if (cameraStream) {

    cameraStream
      .getTracks()
      .forEach(track => {
        track.stop();
      });

    cameraStream = null;

  }

  const video =
    $('cameraVideo');

  if (video) {
    video.srcObject = null;
  }

}

// ============================================================
// CAPTURE CAMERA IMAGE
// ============================================================

function captureCameraImage() {

  const video =
    $('cameraVideo');


  if (
    !video ||
    !video.videoWidth ||
    !video.videoHeight
  ) {

    showAlert(
      'Camera is not ready yet.',
      'warning'
    );

    return;

  }


  const canvas =
    document.createElement(
      'canvas'
    );


  canvas.width =
    video.videoWidth;

  canvas.height =
    video.videoHeight;


  const context =
    canvas.getContext(
      '2d'
    );


  context.drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );


  const target =
    activeCameraTarget;


  canvas.toBlob(
    blob => {

      if (!blob) {

        showAlert(
          'Unable to capture image.',
          'danger'
        );

        return;

      }


      const filename =
        target === 'receipt'
          ? `receipt-${Date.now()}.jpg`
          : `asset-${Date.now()}.jpg`;


      const file =
        new File(
          [blob],
          filename,
          {
            type:
              'image/jpeg'
          }
        );


      const input =
        target === 'receipt'
          ? $('receiptImageFile')
          : $('assetImageFile');


      const preview =
        target === 'receipt'
          ? $('receiptImagePreview')
          : $('assetImagePreview');


      if (!input) {

        showAlert(
          'Image input was not found.',
          'danger'
        );

        return;

      }


      const transfer =
        new DataTransfer();


      transfer.items.add(
        file
      );


      input.files =
        transfer.files;


      if (
        target === 'receipt'
      ) {

        receiptImageRemoved =
          false;

      } else {

        assetImageRemoved =
          false;

      }


      previewImageFile(
        file,
        preview,
        target === 'receipt'
          ? 'bi bi-receipt'
          : 'bi bi-camera',
        target === 'receipt'
          ? 'No receipt image'
          : 'No asset image'
      );


      stopCamera();


      const modalElement =
        $('cameraModal');


      if (modalElement) {

        bootstrap.Modal
          .getInstance(
            modalElement
          )
          ?.hide();

      }

    },
    'image/jpeg',
    0.90
  );

}

// ============================================================
// UPLOAD ASSET IMAGES w/ REMOVE
// ============================================================
async function uploadAssetImages(
  assetId,
  assetImageFile = null,
  receiptImageFile = null,
  removeAsset = false,
  removeReceipt = false
) {

  if (!assetId) {
    throw new Error('Invalid asset ID.');
  }


  const formData = new FormData();


  if (assetImageFile) {

    formData.append(
      'asset_image',
      assetImageFile
    );

  }


  if (receiptImageFile) {

    formData.append(
      'receipt_image',
      receiptImageFile
    );

  }


  if (removeAsset) {

    formData.append(
      'remove_asset_image',
      'true'
    );

  }


  if (removeReceipt) {

    formData.append(
      'remove_receipt_image',
      'true'
    );

  }


  const response = await fetch(
    `/api/assets/${assetId}/images`,
    {
      method: 'POST',
      credentials: 'include',
      body: formData
    }
  );


  const data = await response.json();


  if (!response.ok) {

    throw new Error(
      data.message ||
      'Unable to update asset images.'
    );

  }


  console.log(
    'Asset images updated:',
    data
  );


  return data;
}

// ============================================================
// SETUP IMAGE CONTROLS
// ============================================================
function setupAssetImageControls() {

  const assetInput =
    $('assetImageFile');

  const receiptInput =
    $('receiptImageFile');

  assetInput
    ?.addEventListener(
      'change',
      () => {

        const file =
          assetInput.files?.[0] ||
          null;

        if (!file) {
          const preview = $('assetImagePreview');
          showExistingAssetImage(preview?.dataset.existingImage, 'assetImagePreview');
          return;
        }

        assetImageRemoved =
          false;

        previewImageFile(
          file,
          $('assetImagePreview'),
          'bi bi-camera',
          'No asset image'
        );

      }
    );

  receiptInput
    ?.addEventListener(
      'change',
      () => {

        const file =
          receiptInput.files?.[0] ||
          null;

        if (!file) {
          const preview = $('receiptImagePreview');
          showExistingAssetImage(preview?.dataset.existingImage, 'receiptImagePreview');
          return;
        }

        receiptImageRemoved =
          false;

        previewImageFile(
          file,
          $('receiptImagePreview'),
          'bi bi-receipt',
          'No receipt image'
        );

      }
    );

  $('assetImageCameraBtn')
    ?.addEventListener(
      'click',
      () => {
        openCamera('asset');
      }
    );

  $('receiptImageCameraBtn')
    ?.addEventListener(
      'click',
      () => {
        openCamera('receipt');
      }
    );

  $('removeAssetImageBtn')
    ?.addEventListener(
      'click',
      () => {

        assetImageRemoved =
          true;

        if (assetInput) {
          assetInput.value = '';
        }

        resetAssetImagePreview();

      }
    );

  $('removeReceiptImageBtn')
    ?.addEventListener(
      'click',
      () => {

        receiptImageRemoved =
          true;

        if (receiptInput) {
          receiptInput.value = '';
        }

        resetReceiptImagePreview();

      }
    );

}


// ============================================================
// EDIT ASSET - EXISTING IMAGE PREVIEW
// ============================================================

function showExistingAssetImage(imagePath, previewId) {
    const preview = document.getElementById(previewId);
    if (!preview) return;

    const isReceipt = previewId === 'receiptImagePreview';
    const showPlaceholder = (message) => {
        preview.innerHTML = '<div class="text-muted text-center py-4">' +
            '<i class="bi ' + (isReceipt ? 'bi-receipt' : 'bi-camera') +
            ' fs-1 d-block mb-2"></i>' + escapeHtml(message) + '</div>';
    };

    try {
        preview.classList.remove('d-none');
        preview.dataset.existingImage = imagePath || '';
        const imageUrl = getAssetImageUrl(imagePath);
        if (!imageUrl) {
            showPlaceholder(isReceipt ? 'No receipt image' : 'No asset image');
            return;
        }

        const image = document.createElement('img');
        image.alt = isReceipt ? 'Existing receipt image' : 'Existing asset image';
        image.className = 'img-fluid rounded border';
        image.style.cssText = 'max-height:220px; object-fit:contain;';
        image.onerror = () => {
            // A stale request must not overwrite a newly selected preview.
            if (preview.contains(image)) {
                showPlaceholder('Image preview unavailable. Existing image is kept unless replaced or removed.');
            }
        };
        preview.replaceChildren(image);
        image.src = imageUrl;
    } catch (error) {
        console.warn('Unable to preview existing image:', error);
        showPlaceholder('Image preview unavailable.');
    }
}

// ============================================================
// PURCHASE COST FORMAT
// ============================================================

function parsePurchaseCost(value) {

  const cleaned =
    String(
      value ?? ''
    )
      .replace(
        /,/g,
        ''
      )
      .replace(
        /[^0-9.]/g,
        ''
      );


  if (!cleaned) {

    return null;

  }


  const number =
    Number(cleaned);


  return Number.isFinite(number)
    ? number
    : null;

}


function formatPurchaseCost(value) {

  const number =
    parsePurchaseCost(
      value
    );


  if (
    number === null
  ) {

    return '';

  }


  return number.toLocaleString(
    'en-PH',
    {
      minimumFractionDigits:
        2,

      maximumFractionDigits:
        2
    }
  );

}


function setupPurchaseCostFormatting() {

  const form =
    $('assetForm');


  const input =
    form?.elements
      ?.namedItem(
        'purchase_cost'
      );


  if (!input) {

    return;

  }


  input.addEventListener(
    'focus',
    () => {

      input.value =
        String(
          input.value ||
          ''
        )
          .replace(
            /,/g,
            ''
          );

    }
  );


  input.addEventListener(
    'blur',
    () => {

      input.value =
        formatPurchaseCost(
          input.value
        );

    }
  );


  input.addEventListener(
    'input',
    () => {

      let value =
        input.value
          .replace(
            /[^0-9.]/g,
            ''
          );


      const pieces =
        value.split('.');


      if (
        pieces.length > 2
      ) {

        value =
          pieces.shift() +
          '.' +
          pieces.join('');

      }


      if (
        value.includes('.')
      ) {

        const [
          whole,
          decimal = ''
        ] =
          value.split('.');


        value =
          whole +
          '.' +
          decimal.slice(
            0,
            2
          );

      }


      input.value =
        value;

    }
  );

}

// ============================================================
// SAVE / UPDATE ASSET
// ============================================================

function setupNewAssetAssignment() {
  $('newAssetAssignment').hidden = false;
  $('newAssetEmployeeFields').hidden = true;
  $('newEmployeeSearch').required = false;
  $('newAssignEmployee').value = '';
  $('newEmployeeError').textContent = '';
  setupEmployeePicker(['newEmployeeSearch', 'newAssignEmployee', 'newEmployeePickerList', 'newEmployeePicker']);
  const update = async () => {
    const selected = $('assignNewAsset').checked;
    $('newAssetEmployeeFields').hidden = !selected;
    $('newEmployeeSearch').required = selected;
    $('newAssignEmployee').value = '';
    $('newEmployeeSearch').value = '';
    $('newEmployeePickerList').classList.remove('show');
    $('newEmployeeError').textContent = '';
    if (selected) {
      try {
        await loadEmployees();
        if ($('assignNewAsset').checked) renderEmployeePickerList('', 'newEmployeePickerList');
      } catch (error) {
        employees = [];
        $('newEmployeePickerList').classList.remove('show');
        $('newEmployeeError').textContent = error.message;
      }
    }
  };
  $('assignNewAsset').onchange = update;
  $('keepAssetAvailable').onchange = update;
}

async function saveAsset(event) {

    event.preventDefault();

    const form =
        document.getElementById('assetForm');

    if (!form) {
        console.error('assetForm not found.');
        return;
    }

    if (form.dataset.saving === 'true' || form.dataset.createdId) return;

    const editId =
        Number(form.dataset.editId || 0);

    const isEdit =
        editId > 0;


    // ========================================================
    // FORM HELPERS
    // ========================================================

    const field = (name) =>
        form.elements.namedItem(name);

    const getValue = (name) => {

        const el = field(name);

        return el
            ? String(el.value || '').trim()
            : '';
    };

   const getNumber = (name) => {

    const value =
        getValue(name)
          .replace(
            /,/g,
            ''
          );

    if (
      value === ''
    ) {

      return null;

    }


    const number =
      Number(value);


    return Number.isFinite(number)
      ? number
      : null;
};

    // ========================================================
    // BUILD PAYLOAD
    // ========================================================

    const payload = {

        category_id:
            getNumber('category_id'),

        asset_name:
            getValue('asset_name'),

        brand:
            getValue('brand') || null,

        model:
            getValue('model') || null,

        serial_number:
            getValue('serial_number') || null,

        barcode:
            getValue('barcode') || null,

        purchase_date:
            getValue('purchase_date') || null,

        purchase_cost:
            getNumber('purchase_cost'),

        warranty_expiry:
            getValue('warranty_expiry') || null,

        condition_status:
            getValue('condition_status') || 'Good',

        location_id:
            getNumber('location_id'),

        notes:
            getValue('notes') || null
    };


    // ========================================================
    // VALIDATION
    // ========================================================

    if (!payload.asset_name) {

        showAlert(
            'Asset name is required.',
            'warning'
        );

        const assetName =
            field('asset_name');

        if (assetName) {
            assetName.focus();
        }

        return;
    }


    // ========================================================
    // GET IMAGE FILES
    //
    // IMPORTANT:
    // Declare these ONCE only.
    // ========================================================

    if (!isEdit) {
      if ($('assignNewAsset').checked) {
        const employeeId = Number($('newAssignEmployee').value);
        if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
          $('newEmployeeError').textContent = 'Select an employee from the list.';
          $('newEmployeeSearch').focus();
          return;
        }
        payload.employee_id = employeeId;
      }
      form.dataset.creationRequestId ||= Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      payload.creation_request_id = form.dataset.creationRequestId;
    }
    form.dataset.saving = 'true';
    const assignedEmployeeName = payload.employee_id
      ? employees.find(employee => Number(employee.id) === payload.employee_id)?.full_name || $('newEmployeeSearch').value
      : null;
    let imageUploadWarning = null;

    const assetImageFile =
        $('assetImageFile')?.files?.[0] || null;

    const receiptImageFile =
        $('receiptImageFile')?.files?.[0] || null;


    // ========================================================
    // SUBMIT BUTTON
    // ========================================================

    const submitButton =
        form.querySelector(
            'button[type="submit"]'
        );

    const originalHTML =
        submitButton
            ? submitButton.innerHTML
            : '';


    if (submitButton) {

        submitButton.disabled = true;

        submitButton.innerHTML = `
            <span
                class="spinner-border spinner-border-sm me-1"
            ></span>
            ${isEdit ? 'Updating...' : 'Saving...'}
        `;
    }


    try {


        // ====================================================
        // EDIT EXISTING ASSET
        // ====================================================

        if (isEdit) {

            console.log(
                'Updating asset ID:',
                editId
            );


            const response =
                await fetch(
                    `/api/assets/${editId}`,
                    {
                        method: 'PUT',

                        headers: {
                            'Content-Type':
                                'application/json'
                        },

                        credentials: 'include',

                        body:
                            JSON.stringify(payload)
                    }
                );


            const data =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    data.message ||
                    'Unable to update asset.'
                );
            }


            // =================================================
            // UPDATE IMAGES
            //
            // This handles:
            // - new image
            // - replacement image
            // - remove image
            // =================================================

            if (
                assetImageFile ||
                receiptImageFile ||
                assetImageRemoved ||
                receiptImageRemoved
            ) {

                console.log(
                    'Updating asset images:',
                    {
                        assetImageFile:
                            !!assetImageFile,

                        receiptImageFile:
                            !!receiptImageFile,

                        assetImageRemoved:
                            assetImageRemoved,

                        receiptImageRemoved:
                            receiptImageRemoved
                    }
                );


                await uploadAssetImages(
                    editId,
                    assetImageFile,
                    receiptImageFile,
                    assetImageRemoved,
                    receiptImageRemoved
                );

            }


            showAlert(
                'Asset updated successfully.',
                'success'
            );

        }


        // ====================================================
        // CREATE NEW ASSET
        // ====================================================

        else {

            console.log(
                'Creating new asset'
            );


            const response =
                await fetch(
                    '/api/assets',
                    {
                        method: 'POST',

                        headers: {
                            'Content-Type':
                                'application/json'
                        },

                        credentials: 'include',

                        body:
                            JSON.stringify(payload)
                    }
                );


            const data =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    data.message ||
                    'Unable to create asset.'
                );
            }


            const newAssetId =
                Number(
                    data.id ||
                    data.asset?.id ||
                    0
                );


            form.dataset.createdId = String(newAssetId);
            $('assetIdPreview').value = data.asset_id;

            console.log(
                'New asset ID:',
                newAssetId
            );


            // =================================================
            // UPLOAD IMAGES FOR NEW ASSET
            // =================================================

            if (
                newAssetId &&
                (
                    assetImageFile ||
                    receiptImageFile
                )
            ) {

                await uploadAssetImages(
                    newAssetId,
                    assetImageFile,
                    receiptImageFile,
                    false,
                    false
                ).catch(error => {
                    imageUploadWarning = 'Asset saved, but images could not be uploaded. Use Edit to retry. ' + error.message;
                });

            }


            showAlert(
                `Asset ${data.asset_id} added successfully!` + (imageUploadWarning ? ` ${imageUploadWarning}` : (payload.employee_id ? ` Assigned to ${assignedEmployeeName}.` : '')),
                imageUploadWarning ? 'warning' : 'success'
            );

        }


        // ====================================================
        // RESET FORM
        // ====================================================

        form.dataset.editId = '';

        form.reset();

        assetImageRemoved = false;

        receiptImageRemoved = false;


        // ====================================================
        // RESET IMAGE PREVIEWS
        // ====================================================

        resetAssetImagePreview();

        resetReceiptImagePreview();


        // ====================================================
        // CLOSE MODAL
        // ====================================================

        const modalElement =
            document.getElementById(
                'addAssetModal'
            );


        if (modalElement) {

            const modal =
                bootstrap.Modal.getInstance(
                    modalElement
                );

            if (modal) {
                modal.hide();
            }

        }


        // ====================================================
        // RELOAD ASSETS
        // ====================================================

        await loadAssets();


    } catch (error) {

        console.error(
            'SAVE/UPDATE ASSET ERROR:',
            error
        );


        showAlert(
            error.message ||
            'Unable to save asset.',
            'danger'
        );


    } finally {
        delete form.dataset.saving;

        if (submitButton) {

            submitButton.disabled = false;

            submitButton.innerHTML =
                originalHTML;

        }

    }

}

// ============================================================
// OPEN ASSIGN MODAL
// Supports single asset + bulk selected assets
// Checks asset status before assignment
// ============================================================

async function openAssignModal(assetIds = null) {

  console.log('OPEN ASSIGN MODAL');

  const assignAlert =
    document.getElementById(
      'assignAlert'
    );

  if (assignAlert) {
    assignAlert.innerHTML = '';
  }

  // ----------------------------------------------------------
  // DETERMINE ASSET IDS
  // ----------------------------------------------------------

  let ids = [];

  // IDs passed from bulk assignment
  if (Array.isArray(assetIds) && assetIds.length) {

    ids = assetIds
      .map(Number)
      .filter(id =>
        Number.isInteger(id) &&
        id > 0
      );

  }

  // Fallback to stored bulk IDs
  if (
    !ids.length &&
    Array.isArray(window.bulkAssignAssetIds)
  ) {

    ids = window.bulkAssignAssetIds
      .map(Number)
      .filter(id =>
        Number.isInteger(id) &&
        id > 0
      );

  }

  // Fallback to single asset assignment
  if (!ids.length && directAssignAssetId) {

    const id =
      Number(directAssignAssetId);

    if (
      Number.isInteger(id) &&
      id > 0
    ) {

      ids = [id];

    }

  }

  console.log(
    'ASSIGN MODAL ASSET IDS:',
    ids
  );

  // ----------------------------------------------------------
  // VALIDATE
  // ----------------------------------------------------------

  if (!ids.length) {

    showAlert(
      'No asset selected.',
      'warning'
    );

    return;
  }

  // ----------------------------------------------------------
  // SELECTED ASSETS DISPLAY
  // ----------------------------------------------------------

  const selectedAssetsList =
    document.getElementById(
      'selectedAssetsList'
    );

  if (!selectedAssetsList) {

    console.error(
      '#selectedAssetsList was not found.'
    );

    return;
  }

  selectedAssetsList.innerHTML = `
    <div class="text-muted small">
      Checking selected assets...
    </div>
  `;

  // ----------------------------------------------------------
  // LOAD ASSET DATA
  // ----------------------------------------------------------

  let assetResults = [];
  window.currentAssignAssetIds = [];
  window.bulkAssignAssetIds = [];
  try {
    await verifyAssetSelectionUser();
    const checkedAssets = await fetchSelectedAssets(ids);
    const unavailable = checkedAssets.filter(asset => asset.status !== 'Available' || asset.custodian_id);
    if (unavailable.length) throw new Error('Nothing was assigned. Unavailable assets: ' + unavailable.map(asset => asset.asset_id + ' (' + asset.status + ')').join(', ') + '. Deselect these assets or return them before retrying.');
    assetResults = checkedAssets.map(asset => ({ ok: true, asset }));
  } catch (error) {
    selectedAssetsList.textContent = error.message;
    showAlert(error.message, 'warning');
    return;
  }

  console.log(
    'ASSIGN MODAL ASSET RESULTS:',
    assetResults
  );

  // ----------------------------------------------------------
  // SEPARATE AVAILABLE / UNAVAILABLE
  // ----------------------------------------------------------

  const availableAssets = [];
  const unavailableAssets = [];

  assetResults.forEach(result => {

    if (!result.ok) {

      unavailableAssets.push({
        id: result.id,
        asset_id: `Asset #${result.id}`,
        asset_name: 'Unable to load asset',
        status: 'Unable to verify'
      });

      return;
    }

    const asset =
      result.asset;

    const status =
      String(
        asset.status || ''
      ).trim();

    // ------------------------------------------
    // ONLY AVAILABLE ASSETS CAN BE ASSIGNED
    // ------------------------------------------

    if (status === 'Available') {

      availableAssets.push(asset);

    } else {

      unavailableAssets.push({

        id:
          asset.id,

        asset_id:
          asset.asset_id ||
          asset.asset_tag ||
          `Asset #${asset.id}`,

        asset_name:
          asset.asset_name ||
          asset.name ||
          'Unnamed Asset',

        status:
          status ||
          'Unknown',

        // Try several possible custodian field names
        custodian:
          asset.custodian_name ||
          asset.current_custodian ||
          asset.employee_name ||
          asset.custodian?.full_name ||
          ''

      });

    }

  });

  console.log(
    'AVAILABLE ASSETS:',
    availableAssets
  );

  console.log(
    'UNAVAILABLE ASSETS:',
    unavailableAssets
  );

  // ----------------------------------------------------------
  // BUILD DISPLAY
  // ----------------------------------------------------------

  selectedAssetsList.innerHTML = '';

  // ----------------------------------------------------------
  // SHOW AVAILABLE ASSETS
  // ----------------------------------------------------------

  availableAssets.forEach(asset => {

    const assetTag =
      asset.asset_id ||
      asset.asset_tag ||
      `Asset #${asset.id}`;

    const assetName =
      asset.asset_name ||
      asset.name ||
      'Unnamed Asset';

    const brand =
      asset.brand
        ? ` · ${asset.brand}`
        : '';

    const model =
      asset.model
        ? ` ${asset.model}`
        : '';

    const item =
      document.createElement('div');

    item.className =
      'border rounded p-2 mb-2 bg-light';

    item.innerHTML = `
      <div class="fw-semibold text-success">
        <i class="bi bi-check-circle me-1"></i>
        ${escapeHtml(assetTag)}
      </div>

      <div class="small text-muted">
        ${escapeHtml(assetName)}
        ${escapeHtml(brand)}
        ${escapeHtml(model)}
      </div>

      <div class="small text-success mt-1">
        Available for assignment
      </div>
    `;

    selectedAssetsList.appendChild(item);

  });

  // ----------------------------------------------------------
  // SHOW UNAVAILABLE ASSETS
  // ----------------------------------------------------------

  unavailableAssets.forEach(asset => {

    const item =
      document.createElement('div');

    item.className =
      'border rounded p-2 mb-2 bg-light';

    let custodianHtml = '';

    if (asset.custodian) {

      custodianHtml = `
        <div class="small text-danger mt-1">
          <i class="bi bi-person-fill me-1"></i>
          Current Custodian:
          <strong>
            ${escapeHtml(asset.custodian)}
          </strong>
        </div>
      `;

    }

    item.innerHTML = `
      <div class="fw-semibold text-danger">
        <i class="bi bi-x-circle me-1"></i>
        ${escapeHtml(
          asset.asset_id ||
          `Asset #${asset.id}`
        )}
      </div>

      <div class="small text-muted">
        ${escapeHtml(
          asset.asset_name ||
          'Unnamed Asset'
        )}
      </div>

      <div class="small text-danger mt-1">
        Status:
        <strong>
          ${escapeHtml(
            asset.status ||
            'Unavailable'
          )}
        </strong>
      </div>

      ${custodianHtml}
    `;

    selectedAssetsList.appendChild(item);

  });

  // ----------------------------------------------------------
  // NO AVAILABLE ASSETS
  // ----------------------------------------------------------

  if (!availableAssets.length) {

    const message =
      document.createElement('div');

    message.className =
      'alert alert-warning mt-2 mb-0';

    message.innerHTML = `
      <i class="bi bi-exclamation-triangle me-1"></i>
      <strong>No selected assets can be assigned.</strong>
      <div class="small mt-1">
        All selected assets are already assigned
        or are not currently available.
      </div>
    `;

    selectedAssetsList.appendChild(
      message
    );

    // Clear assignment IDs
    window.currentAssignAssetIds = [];
    window.bulkAssignAssetIds = [];

    return;
  }

  // ----------------------------------------------------------
  // SOME ASSETS ARE UNAVAILABLE
  // ----------------------------------------------------------

  if (unavailableAssets.length) {

    const warning =
      document.createElement('div');

    warning.className =
      'alert alert-warning mt-2 mb-0';

    warning.innerHTML = `
      <i class="bi bi-info-circle me-1"></i>

      <strong>
        ${availableAssets.length}
        asset(s) available.
      </strong>

      <div class="small mt-1">
        ${unavailableAssets.length}
        selected asset(s) cannot be assigned
        because they are not Available.
      </div>
    `;

    selectedAssetsList.appendChild(
      warning
    );

  }

  // ----------------------------------------------------------
  // STORE ONLY VALID ASSET IDS
  // ----------------------------------------------------------

  const availableIds =
    availableAssets
      .map(asset =>
        Number(asset.id)
      )
      .filter(id =>
        Number.isInteger(id) &&
        id > 0
      );

  window.currentAssignAssetIds =
    availableIds;

  window.bulkAssignAssetIds =
    availableIds;

  console.log(
    'FINAL ASSIGNMENT IDS:',
    availableIds
  );

  // ----------------------------------------------------------
  // RESET EMPLOYEE SELECTION
  // ----------------------------------------------------------

  const employeeInput =
    document.getElementById(
      'employeeSearch'
    );

  const employeeHidden =
    document.getElementById(
      'assignEmployee'
    );

  if (employeeInput) {

    employeeInput.value = '';

  }

  if (employeeHidden) {

    employeeHidden.value = '';

  }

  // ----------------------------------------------------------
  // CLEAR EMPLOYEE LIST SELECTION
  // ----------------------------------------------------------

  const employeePickerList =
    document.getElementById(
      'employeePickerList'
    );

  if (employeePickerList) {

    employeePickerList
      .querySelectorAll(
        '.active, .selected'
      )
      .forEach(element => {

        element.classList.remove(
          'active',
          'selected'
        );

      });

  }

  // ----------------------------------------------------------
  // SHOW ASSIGNMENT MODAL
  // ----------------------------------------------------------

  const modalElement =
    selectedAssetsList.closest(
      '.modal'
    );

  if (!modalElement) {

    console.error(
      'Could not find assignment modal.'
    );

    showAlert(
      'Assignment window could not be opened.',
      'danger'
    );

    return;
  }

  console.log(
    'ASSIGNMENT MODAL FOUND:',
    modalElement.id
  );

assignAssetsModal =
  bootstrap.Modal.getOrCreateInstance(
    modalElement
  );

// ----------------------------------------------------------
// PREVENT ARIA-HIDDEN / FOCUS WARNING
// ----------------------------------------------------------

if (
  document.activeElement &&
  modalElement.contains(
    document.activeElement
  )
) {

  document.activeElement.blur();

}

// Make sure the modal is not left inert/hidden
modalElement.removeAttribute('aria-hidden');
modalElement.removeAttribute('inert');

modalElement.addEventListener(
  'hidden.bs.modal',
  () => {
    window.currentAssignAssetIds = [];
    window.bulkAssignAssetIds = [];
    directAssignAssetId = null;

    if (assignAlert) {
      assignAlert.innerHTML = '';
    }
  },
  { once: true }
);

// Show modal
assignAssetsModal.show();

}
// // ============================================================
// // ASSIGN ASSETS
// // ============================================================
// async function assignAssets(event) {

//   event.preventDefault();

//   const hidden =
//     $('assignAssetIds');

//   let ids = [];

//   try {

//     ids =
//       JSON.parse(
//         hidden?.value || '[]'
//       );

//   } catch {

//     ids = [];

//   }

//   ids =
//     ids
//       .map(Number)
//       .filter(
//         id =>
//           Number.isInteger(id) &&
//           id > 0
//       );

//   if (!ids.length) {

//     showAssignAlert(
//       'No assets selected.'
//     );

//     return;

//   }

//   const employeeId =
//     Number(
//       $('assignEmployee')?.value
//     );

//   if (!employeeId) {

//     showAssignAlert(
//       'Please select an employee.'
//     );

//     return;

//   }

//   const assignedAt =
//     $('assignDate')?.value ||
//     getLocalDateTime();

//   const remarks =
//     String(
//       $('assignRemarks')?.value ||
//       ''
//     ).trim();

//   const button =
//     $('assignSubmitBtn');

//   if (button) {

//     button.disabled =
//       true;

//     button.innerHTML = `
//       <span
//         class="spinner-border spinner-border-sm me-1"
//       ></span>
//       Assigning...
//     `;

//   }

//   try {

//     for (const assetId of ids) {

//     const response =
//         await fetch(
//           `/api/assets/${assetId}/assign`,
//           {
//             method: 'POST',
//             headers: {
//               'Content-Type':
//                 'application/json'
//             },
//             body:
//               JSON.stringify({
//                 employee_id:
//                   employeeId,
//                 assigned_at:
//                   assignedAt,
//                 remarks:
//                   remarks
//               })
//           }
//         );

//       const data =
//         await response
//           .json()
//           .catch(() => ({}));

//       if (!response.ok) {

//         throw new Error(
//           data.message ||
//           `Unable to assign asset ${assetId}.`
//         );

//       }

//     }

//     showAlert(
//       `${ids.length} asset${ids.length === 1 ? '' : 's'} assigned successfully.`,
//       'success'
//     );

//     // IMPORTANT:
//     // Clear direct assignment after successful assignment.
//     directAssignAssetId = null;

//     if (assignAssetsModal) {
//       assignAssetsModal.hide();
//     }

//     $('assignForm')
//       ?.reset();

//     await loadAssets();

//   } catch (error) {

//     console.error(
//       'assignAssets error:',
//       error
//     );

//     showAssignAlert(
//       error.message ||
//       'Unable to assign asset(s).'
//     );

//   } finally {

//     if (button) {

//       button.disabled =
//         false;

//       button.innerHTML =
//         'Assign Asset';

//     }

//   }

// }
// ============================================================
// ASSIGN ASSETS
// ============================================================
async function assignAssets(event) {

  event.preventDefault();

  console.log('================================');
  console.log('ASSIGN ASSETS SUBMITTED');
  console.log('================================');

  // ----------------------------------------------------------
  // GET SELECTED ASSET IDS
  // ----------------------------------------------------------

  let ids =
    Array.isArray(
      window.currentAssignAssetIds
    )
      ? [
          ...window.currentAssignAssetIds
        ]
      : [];

  // Fallback for a modal opened directly from the current table selection.
  if (!ids.length) {
    ids = selectedIds();
  }

  // Direct assignment from Asset Details
  if (
    !ids.length &&
    directAssignAssetId
  ) {
    ids = [Number(directAssignAssetId)];
  }

  ids = [
    ...new Set(
      ids
        .map(Number)
        .filter(
          id =>
            Number.isInteger(id) &&
            id > 0
        )
    )
  ];

  console.log('ASSIGN ASSET IDS:', ids);

  if (!ids.length) {

    showAssignAlert(
      'No assets selected.'
    );

    return;
  }

  // ----------------------------------------------------------
  // GET EMPLOYEE
  // ----------------------------------------------------------

  const employeeId =
    Number(
      $('assignEmployee')?.value || 0
    );

  console.log(
    'ASSIGN EMPLOYEE ID:',
    employeeId
  );

  if (!employeeId) {

    showAssignAlert(
      'Please select an employee.'
    );

    return;
  }

  // ----------------------------------------------------------
  // ASSIGNMENT DATE
  // ----------------------------------------------------------

  const assignedAt =
    $('assignmentDate')?.value ||
    getLocalDateTime();

  // ----------------------------------------------------------
  // REMARKS
  // ----------------------------------------------------------

  const remarks =
    String(
      $('assignmentRemarks')?.value ||
      ''
    ).trim();

  // ----------------------------------------------------------
  // BUTTON
  // ----------------------------------------------------------

  const button =
    $('confirmAssignBtn');

  if (button?.disabled) return;

  const originalButtonHTML =
    button
      ? button.innerHTML
      : 'Assign Assets';

  if (button) {

    button.disabled = true;

    button.innerHTML = `
      <span
        class="spinner-border spinner-border-sm me-1"
      ></span>
      Assigning...
    `;
  }

  // ----------------------------------------------------------
  // ASSIGN
  // ----------------------------------------------------------

  try {

    await verifyAssetSelectionUser();
    const checkedAssets = await fetchSelectedAssets(ids);
    const unavailable = checkedAssets.filter(asset => asset.status !== 'Available' || asset.custodian_id);
    if (unavailable.length) throw new Error('Nothing was assigned. Unavailable assets: ' + unavailable.map(asset => asset.asset_id + ' (' + asset.status + ')').join(', '));

    const response =
      await fetch(
        '/api/assets/assign',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          credentials: 'include',

          body:
            JSON.stringify({
              asset_ids: ids,
              employee_id:
                employeeId,
              assigned_at:
                assignedAt,
              remarks:
                remarks
            })
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    console.log(
      'ASSIGN API STATUS:',
      response.status
    );

    console.log(
      'ASSIGN API RESPONSE:',
      data
    );

    if (!response.ok) {

      throw new Error(
        data.message ||
        'Unable to assign asset(s).'
      );
    }

    // --------------------------------------------------------
    // SUCCESS
    // --------------------------------------------------------

    showAlert(
      data.message ||
      `${data.assigned || ids.length} asset${ids.length === 1 ? '' : 's'} assigned successfully.`,
      'success'
    );

    console.log(
      'ASSETS ASSIGNED SUCCESSFULLY'
    );

    ids.forEach(id => selectedAssetIds.delete(id));
    updateBulkButtons();

    // Clear direct assignment
    directAssignAssetId = null;
    window.currentAssignAssetIds = [];
    window.bulkAssignAssetIds = [];

    // Close modal
    if (assignAssetsModal) {
      assignAssetsModal.hide();
    }

    // Reset form
    $('assignAssetsForm')
      ?.reset();

    // Clear employee picker
    if ($('assignEmployee')) {
      $('assignEmployee').value = '';
    }

    if ($('employeeSearch')) {
      $('employeeSearch').value = '';
    }

    if ($('employeePickerList')) {
      $('employeePickerList')
        .classList
        .remove('show');
    }

    selectedAssignEmployee = null;

    // Reload assets
    await loadAssets();

    // Update buttons
    updateBulkButtons();

  } catch (error) {

    console.error(
      'assignAssets error:',
      error
    );

    showAssignAlert(
      error.message ||
      'Unable to assign asset(s).'
    );

  } finally {

    if (button) {

      button.disabled = false;

      button.innerHTML =
        originalButtonHTML;
    }
  }
}
$('assignAssetsForm')
  ?.addEventListener(
    'submit',
    assignAssets
  );

// ============================================================
// OPEN RETURN MODAL
// ============================================================
function openReturnModal(assetId) {

  const assetDbId = Number(assetId);

  if (!Number.isInteger(assetDbId) || assetDbId <= 0) {

    showAlert(
      'Invalid asset ID.',
      'warning'
    );

    return;
  }

  const asset =
    assets.find(
      item => Number(item.id) === assetDbId
    );

  if (!asset) {

    showAlert(
      'Asset details are no longer available. Refresh the list and try again.',
      'warning'
    );

    return;
  }

  if (!window.PRIMAAssetReturn) {

    showAlert(
      'Return Asset is not available. Please refresh the page.',
      'danger'
    );

    return;
  }

  window.PRIMAAssetReturn.open({
    assetId: assetDbId,
    asset,
    onSuccess: async data => {
      await loadAssets();

      showAlert(
        `Asset ${data.asset_id || asset.asset_id} returned successfully.`,
        'success'
      );
    }
  });
}
// ============================================================
// SELECT ALL
// ============================================================
function setupSelectAll() {
  if (!$('selectAll')) return;
  $('selectAll').onchange = event => {
    document.querySelectorAll('#assetTableBody .asset-check').forEach(box => {
      const id = Number(box.value);
      if (event.target.checked) selectedAssetIds.add(id);
      else selectedAssetIds.delete(id);
    });
    updateBulkButtons();
  };
}
// ============================================================
// EMPLOYEE PICKER (Assign Modal)
// ============================================================

function renderEmployeePickerList(filterText = '', listId = 'employeePickerList') {

  const list = $(listId);

  if (!list) return;

  const term = filterText.trim().toLowerCase();

  const filtered = employees.filter(employee => {
    if (employee.status && employee.status !== 'active') return false;

    if (!term) return true;

    return (
      String(employee.full_name || '').toLowerCase().includes(term) ||
      String(employee.employee_id || '').toLowerCase().includes(term) ||
      String(employee.department_name || '').toLowerCase().includes(term)
    );
  });

  if (!filtered.length) {

    list.innerHTML = `
      <div class="employee-no-results">
        No matching employees.
      </div>
    `;

    list.classList.add('show');
    return;
  }

  list.innerHTML = filtered.map(employee => `
    <div
      class="employee-option"
      data-id="${employee.id}"
      data-name="${escapeHtml(employee.full_name || '')}"
    >
      <div class="employee-option-name">
        ${escapeHtml(employee.full_name || 'Unnamed')}
      </div>
      <div class="employee-option-details">
        ${escapeHtml(employee.employee_id || '')}
        ${employee.department_name ? ' · ' + escapeHtml(employee.department_name) : ''}
      </div>
    </div>
  `).join('');

  list.classList.add('show');
}

function setupEmployeePicker(ids = ['employeeSearch', 'assignEmployee', 'employeePickerList', 'employeePicker']) {

  const [input, hidden, list, picker] = ids.map($);

  if (!input || !hidden || !list || !picker) return;

  if (picker.dataset.initialized) return;
  picker.dataset.initialized = 'true';

  // Show/filter list on focus and while typing
  input.addEventListener('focus', () => {
    renderEmployeePickerList(input.value, list.id);
  });

  input.addEventListener('input', () => {
    hidden.value = '';
    renderEmployeePickerList(input.value, list.id);
  });

  // Select an employee
  list.addEventListener('click', event => {

    const option = event.target.closest('.employee-option');

    if (!option || !option.dataset.id) return;

    hidden.value = option.dataset.id;
    input.value = option.dataset.name || '';

    list.classList.remove('show');

    list.querySelectorAll('.employee-option').forEach(el => {
      el.classList.remove('active');
    });

    option.classList.add('active');
  });

  // Close list when clicking outside
  document.addEventListener('click', event => {

    if (!picker.contains(event.target)) {
      list.classList.remove('show');
    }
  });
}
// ============================================================
// SEARCH
// ============================================================
function setupSearch() {

  $('searchInput')
    ?.addEventListener(
      'input',
      debounce(
        () => {
          loadAssets()
            .catch(error => {
              console.error(
                error
              );
            });
        },
        300
      )
    );

  $('statusFilter')
    ?.addEventListener(
      'change',
      () => {

        loadAssets()
          .catch(error => {
            console.error(
              error
            );
          });

      }
    );

  $('categoryFilter')
    ?.addEventListener(
      'change',
      () => {

        loadAssets()
          .catch(error => {
            console.error(
              error
            );
          });

      }
    );

  $('locationFilter')?.addEventListener('change', () => {
    loadAssets().catch(error => {
      console.error(error);
      showAlert(error.message || 'Unable to filter assets.', 'danger');
    });
  });

  $('clearFiltersBtn')
    ?.addEventListener(
      'click',
      async event => {
        const button = event.currentTarget;
        const originalText = button.textContent;

        if ($('searchInput')) {
          $('searchInput').value = '';
        }

        if ($('statusFilter')) {
          $('statusFilter').value = '';
        }

        if ($('categoryFilter')) {
          $('categoryFilter').value = '';
        }

        if ($('locationFilter')) {
          $('locationFilter').value = '';
        }

        button.disabled = true;
        button.textContent = 'Clearing...';

        try {
          await loadAssets();
          updateBulkButtons();
          $('searchInput')?.focus();
        } catch (error) {
          console.error('Clear asset filters error:', error);
          showAlert(
            error.message ||
            'Unable to clear asset filters.',
            'danger'
          );
        } finally {
          button.disabled = false;
          button.textContent = originalText;
        }
      }
    );

}

// ============================================================
// DEBOUNCE
// ============================================================
function debounce(
  callback,
  delay
) {

  let timeout;

  return (...args) => {

    clearTimeout(
      timeout
    );

    timeout =
      setTimeout(
        () => {
          callback(...args);
        },
        delay
      );

  };

}

// ============================================================
// IMPORT MODAL
// ============================================================
function openImportModal() {

  if (!$('importAssetForm')) {
    return;
  }

  $('importAssetForm').reset();

  importAssetModal =
    bootstrap.Modal.getOrCreateInstance(
      $('importAssetModal')
    );

  importAssetModal.show();

}

// ============================================================
// IMPORT ASSETS
// ============================================================
function assetImportResultFileDate() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
}


function downloadAssetImportResults() {
  if (!lastAssetImportResults) {
    return;
  }

  if (typeof XLSX === 'undefined') {
    showAlert('The Excel export library is not available.', 'danger');
    return;
  }

  const data = lastAssetImportResults;
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
        'Asset ID': item.asset_id,
        'Asset Name': item.asset_name,
        'Serial Number': item.serial_number,
        'Barcode': item.barcode,
        'Category': item.category,
        'Location': item.location,
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
        'Asset / Asset Name': item.asset_id || item.asset_name,
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
        'Record': item.asset_id || item.asset_name,
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
    `asset-import-results-${assetImportResultFileDate()}.xlsx`
  );
}


function renderAssetImportResults(rawData) {
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

  lastAssetImportResults = data;

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
                <th>Asset ID</th>
                <th>Asset Name</th>
                <th>Serial Number</th>
                <th>Category</th>
                <th>Location</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${data.successes.map(item => `
                <tr>
                  <td>${escapeHtml(item.row)}</td>
                  <td>${escapeHtml(item.asset_id)}</td>
                  <td>${escapeHtml(item.asset_name)}</td>
                  <td>${escapeHtml(item.serial_number || '—')}</td>
                  <td>${escapeHtml(item.category || '—')}</td>
                  <td>${escapeHtml(item.location || '—')}</td>
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
                <th>Asset / Asset Name</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              ${data.errors.map(item => `
                <tr>
                  <td>${escapeHtml(item.row)}</td>
                  <td>${escapeHtml(item.asset_id || item.asset_name || '—')}</td>
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
                  <td>${escapeHtml(item.asset_id || item.asset_name || '—')}</td>
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
      id="downloadAssetImportResultsBtn"
      class="btn btn-outline-primary"
    >
      ⬇ Download Import Results
    </button>
  `;

  const resultBox = $('importResult');

  if (resultBox) {
    resultBox.innerHTML = html;
    $('downloadAssetImportResultsBtn')?.addEventListener(
      'click',
      downloadAssetImportResults
    );
  }

  return data;
}


async function importAssets(event) {

  event.preventDefault();

  const input =
    $('assetExcelFile');

  if (
    !input ||
    !input.files ||
    !input.files.length
  ) {

    showAlert(
      'Please select an Excel file.',
      'warning'
    );

    return;

  }

  const file =
    input.files[0];

  const formData =
    new FormData();

  formData.append(
    'file',
    file
  );

  const button =
    $('importAssetSubmitBtn');

  if (button) {

    button.disabled =
      true;

    button.innerHTML = `
      <span
        class="spinner-border spinner-border-sm me-1"
      ></span>
      Importing...
    `;

  }

  try {

    const response =
      await fetch(
        '/api/assets/import',
        {
          method: 'POST',
          body: formData
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {

      throw new Error(
        data.message ||
        'Import failed.'
      );

    }

    const normalizedResults =
      renderAssetImportResults(data);


    input.value = '';


    if (normalizedResults.imported > 0) {
      await loadAssets();
    }


    showAlert(
      'Asset import completed. ' +
        normalizedResults.imported +
        ' asset(s) imported.',
      normalizedResults.skipped > 0
        ? 'warning'
        : 'success'
    );

  } catch (error) {

    console.error(
      'importAssets error:',
      error
    );

    const resultBox =
      $('importResult');

    if (resultBox) {
      resultBox.innerHTML = `
        <div class="alert alert-danger mb-0">
          ${escapeHtml(
            error.message ||
            'Import failed.'
          )}
        </div>
      `;
    }

    showAlert(
      error.message ||
      'Import failed.',
      'danger'
    );

  } finally {

    if (button) {

      button.disabled =
        false;

      button.innerHTML =
        'Import Assets';

    }

  }

}
// ============================================================
// CUSTODIAN MODAL
// ============================================================
async function loadCustodians(search = '') {
  const list = $('custodianList');

  if (list) {
    list.innerHTML = `
      <div class="custodian-empty">
        Loading custodians...
      </div>
    `;
  }

  const params = new URLSearchParams();

  if (String(search).trim()) {
    params.set('search', String(search).trim());
  }

  const query = params.toString();
  const response = await fetch(
    `/api/custodians${query ? `?${query}` : ''}`,
    { credentials: 'include' }
  );

  const data = await response.json().catch(() => []);

  if (!response.ok) {
    throw new Error(
      data.message ||
      'Unable to load custodians.'
    );
  }

  custodians = Array.isArray(data) ? data : [];
  renderCustodianList();
}


function renderCustodianList() {
  const list = $('custodianList');

  if (!list) return;

  if (!custodians.length) {
    list.innerHTML = `
      <div class="custodian-empty">
        No active employees found.
      </div>
    `;
    return;
  }

  list.innerHTML = custodians
    .map(custodian => {
      const active =
        Number(selectedCustodian?.id) ===
        Number(custodian.id);

      return `
        <div
          class="custodian-option ${active ? 'active' : ''}"
          data-id="${Number(custodian.id)}"
          role="button"
          tabindex="0"
        >
          <div class="custodian-option-name">
            ${escapeHtml(custodian.full_name || 'Unnamed employee')}
          </div>

          <div class="custodian-option-details">
            ${escapeHtml(custodian.employee_id || '—')}
            ${custodian.department_name
              ? ` · ${escapeHtml(custodian.department_name)}`
              : ''}
            <br>
            <span class="badge text-bg-primary mt-1">
              ${Number(custodian.assigned_asset_count || 0)} assigned
            </span>
          </div>
        </div>
      `;
    })
    .join('');

  list
    .querySelectorAll('.custodian-option')
    .forEach(option => {
      const open = () => {
        selectCustodian(
          Number(option.dataset.id)
        );
      };

      option.addEventListener('click', open);
      option.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    });
}


async function selectCustodian(custodianId) {
  const id = Number(custodianId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid custodian ID.');
  }

  try {
    const response = await fetch(
      `/api/custodians/${id}`,
      { credentials: 'include' }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message ||
        'Unable to load custodian details.'
      );
    }

    selectedCustodian = {
      ...(data.employee || {}),
      assets: Array.isArray(data.assets)
        ? data.assets
        : []
    };

    renderCustodianList();
    renderCustodianDetails();
  } catch (error) {
    console.error('Custodian load error:', error);
    showAlert(
      error.message ||
      'Unable to load custodian details.',
      'danger'
    );
  }
}


function setCustodianText(id, value) {
  const element = $(id);

  if (element) {
    element.textContent = String(value ?? '');
  }
}


function renderCustodianDetails() {
  const emptyState = $('custodianEmptyState');
  const details = $('custodianDetails');
  const printButton = $('printCustodianBtn');

  if (!selectedCustodian) {
    emptyState?.classList.remove('d-none');
    details?.classList.add('d-none');

    if (printButton) {
      printButton.disabled = true;
    }

    return;
  }

  emptyState?.classList.add('d-none');
  details?.classList.remove('d-none');

  setCustodianText(
    'custodianFullName',
    selectedCustodian.full_name || '—'
  );

  setCustodianText(
    'custodianEmployeeDetails',
    [selectedCustodian.email, selectedCustodian.status]
      .filter(Boolean)
      .join(' · ') || '—'
  );

  setCustodianText(
    'custodianEmployeeId',
    selectedCustodian.employee_id || '—'
  );

  setCustodianText(
    'custodianDepartment',
    selectedCustodian.department_name || '—'
  );

  setCustodianText(
    'custodianPosition',
    selectedCustodian.position_title || '—'
  );

  const assignedAssets = Array.isArray(selectedCustodian.assets)
    ? selectedCustodian.assets
    : [];

  setCustodianText('custodianAssetCount', assignedAssets.length);

  if (printButton) {
    printButton.disabled = false;
  }

  const tbody = $('custodianAssetTableBody');
  const noAssets = $('custodianNoAssets');

  if (!assignedAssets.length) {
    if (tbody) tbody.innerHTML = '';
    noAssets?.classList.remove('d-none');
    return;
  }

  noAssets?.classList.add('d-none');

  if (!tbody) return;

  tbody.innerHTML = assignedAssets
    .map(asset => {
      const brandModel = [asset.brand, asset.model]
        .filter(Boolean)
        .join(' ');

      return `
        <tr>
          <td class="fw-semibold">${escapeHtml(asset.asset_id || '—')}</td>
          <td>${escapeHtml(asset.asset_name || '—')}</td>
          <td>${escapeHtml(asset.category_name || '—')}</td>
          <td>${escapeHtml(brandModel || '—')}</td>
          <td>${escapeHtml(asset.serial_number || '—')}</td>
          <td>${escapeHtml(asset.condition_status || '—')}</td>
          <td>${formatCustodianDate(asset.assigned_at)}</td>
        </tr>
      `;
    })
    .join('');
}


function formatCustodianDate(value) {
  if (!value) return '—';

  const date = new Date(
    String(value).replace(' ', 'T')
  );

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  });
}


function printSelectedCustodianForm() {
  if (!selectedCustodian) {
    showAlert(
      'Please select an employee first.',
      'warning'
    );
    return;
  }

  const employee = selectedCustodian;
  const assignedAssets = Array.isArray(employee.assets)
    ? employee.assets
    : [];

  const printWindow = window.open(
    '',
    '_blank',
    'width=1000,height=900'
  );

  if (!printWindow) {
    showAlert(
      'Please allow pop-ups for this site so the Custodian Form can be printed.',
      'warning'
    );
    return;
  }

  const custodianName = String(
    employee.full_name || 'Custodian'
  ).trim();

  const safeCustodianName = custodianName
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const documentTitle =
    `${safeCustodianName} Asset Acknowledgement Form`;

  const today = new Date().toLocaleDateString(
    'en-PH',
    {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }
  );

  const assetRows = assignedAssets.length
    ? assignedAssets
        .map((asset, index) => {
          const brandModel = [asset.brand, asset.model]
            .filter(Boolean)
            .join(' ') || '—';

          return `
            <tr>
              <td class="center">${index + 1}</td>
              <td>${escapeHtml(asset.asset_id || '—')}</td>
              <td>${escapeHtml(asset.asset_name || '—')}</td>
              <td>${escapeHtml(asset.category_name || '—')}</td>
              <td>${escapeHtml(brandModel)}</td>
              <td>${escapeHtml(asset.serial_number || '—')}</td>
              <td>${escapeHtml(asset.condition_status || '—')}</td>
              <td>${formatCustodianDate(asset.assigned_at)}</td>
            </tr>
          `;
        })
        .join('')
    : `
        <tr>
          <td colspan="8" class="center">
            No assets currently assigned.
          </td>
        </tr>
      `;

  printWindow.document.open();
  printWindow.document.write(`
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(documentTitle)}</title>
      <style>
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          background: #fff;
          color: #111;
          font-family: Arial, Helvetica, sans-serif;
        }
        body { font-size: 11px; }
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
          margin-bottom: 8mm;
          text-align: center;
        }
        .company {
          font-size: 15px;
          font-weight: 700;
        }
        .document-title {
          margin-top: 4px;
          font-size: 14px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .subtitle {
          margin-top: 3px;
          color: #555;
          font-size: 10px;
        }
        .info-table,
        .asset-table {
          width: 100%;
          border-collapse: collapse;
        }
        .info-table { margin-bottom: 7mm; }
        .info-table td {
          padding: 4px 6px;
          border: 1px solid #ccc;
        }
        .info-label {
          width: 22%;
          background: #f5f5f5;
          font-weight: 700;
        }
        .asset-heading {
          margin-bottom: 4mm;
          font-weight: 700;
        }
        .asset-table th,
        .asset-table td {
          padding: 5px;
          border: 1px solid #333;
          vertical-align: middle;
        }
        .asset-table th {
          background: #f1f1f1;
          font-size: 8px;
        }
        .asset-table td { font-size: 8px; }
        .center { text-align: center; }
        .statement {
          margin-top: 8mm;
          line-height: 1.55;
          text-align: justify;
        }
        .signature-area {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 25mm;
          margin-top: 25mm;
        }
        .signature-box { text-align: center; }
        .signature-line {
          height: 18mm;
          margin-bottom: 3mm;
          border-bottom: 1px solid #111;
        }
        .signature-name { font-weight: 700; }
        .signature-role {
          margin-top: 2px;
          color: #555;
          font-size: 10px;
        }
        .footer-note {
          margin-top: 12mm;
          color: #666;
          font-size: 9px;
          text-align: center;
        }
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body {
            width: 210mm;
            min-height: 297mm;
          }
          .page { margin: 0; }
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
        <header class="header">
          <div class="company">
            Prima Fintech (Philippines) Lending Corporation
          </div>
          <div class="document-title">
            IT Asset Custodian Acknowledgement Form
          </div>
          <div class="subtitle">
            Asset assignment and accountability record
          </div>
        </header>

        <table class="info-table">
          <tr>
            <td class="info-label">Employee ID</td>
            <td>${escapeHtml(employee.employee_id || '—')}</td>
            <td class="info-label">Date</td>
            <td>${escapeHtml(today)}</td>
          </tr>
          <tr>
            <td class="info-label">Custodian</td>
            <td colspan="3">${escapeHtml(employee.full_name || '—')}</td>
          </tr>
          <tr>
            <td class="info-label">Department</td>
            <td>${escapeHtml(employee.department_name || '—')}</td>
            <td class="info-label">Position</td>
            <td>${escapeHtml(employee.position_title || '—')}</td>
          </tr>
        </table>

        <div class="asset-heading">Assigned IT Assets</div>

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
              <th>Assigned</th>
            </tr>
          </thead>
          <tbody>${assetRows}</tbody>
        </table>

        <div class="statement">
          I acknowledge that the IT assets listed above have been issued
          to me for authorized company use. I understand that I am
          responsible for their proper care, security, and safekeeping.
          I will promptly report any loss, theft, damage, malfunction, or
          other issue to the IT Department and return the assets when
          requested or when my assignment ends.
        </div>

        <div class="signature-area">
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-name">
              ${escapeHtml(employee.full_name || '')}
            </div>
            <div class="signature-role">Custodian / Employee</div>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <div class="signature-name">IT Department</div>
            <div class="signature-role">
              Authorized IT Representative
            </div>
          </div>
        </div>

        <div class="footer-note">
          Generated by PRIMA IT Asset Management
        </div>
      </main>

      <script>
        window.addEventListener('load', function () {
          setTimeout(function () {
            window.focus();
            window.print();
          }, 400);
        });

        window.onafterprint = function () {
          setTimeout(function () {
            window.close();
          }, 300);
        };
      <\/script>
    </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.document.title = documentTitle;
}


async function openCustodianModal(custodianId) {
  const modalElement = $('custodianModal');

  if (!modalElement) {
    showAlert('Custodian window was not found.', 'danger');
    return;
  }

  custodianModal =
    bootstrap.Modal.getOrCreateInstance(modalElement);

  custodianModal.show();

  try {
    await loadCustodians(
      $('custodianSearch')?.value || ''
    );

    if (custodianId) {
      await selectCustodian(custodianId);
    }
  } catch (error) {
    console.error('openCustodianModal error:', error);
    showAlert(
      error.message ||
      'Unable to load custodians.',
      'danger'
    );
  }
}


let custodianSearchTimer;

$('custodianSearch')
  ?.addEventListener('input', () => {
    clearTimeout(custodianSearchTimer);

    custodianSearchTimer = setTimeout(() => {
      loadCustodians(
        $('custodianSearch')?.value || ''
      ).catch(error => {
        console.error('Custodian search error:', error);
        showAlert(
          error.message ||
          'Unable to search custodians.',
          'danger'
        );
      });
    }, 250);
  });


$('printCustodianBtn')
  ?.addEventListener(
    'click',
    printSelectedCustodianForm
  );



// ============================================================
// PRIMA IT ASSET MANAGEMENT
// ASSETS.JS — PART 3
// Remaining Asset Functions
// Camera Modal
// Image Upload / Capture
// Initialization
// Event Handlers
// End of File
// ============================================================


// ============================================================
// DELETE / REMOVE IMAGE HELPERS
// ============================================================

function removeAssetImage() {
  assetImageRemoved = true;
  const input = $('assetImageFile');
  if (input) input.value = '';
  resetAssetImagePreview();
}

function removeReceiptImage() {
  receiptImageRemoved = true;
  const input = $('receiptImageFile');
  if (input) input.value = '';
  resetReceiptImagePreview();
}


// ============================================================
// IMAGE PREVIEW
// ============================================================

function previewImage(input, previewId, placeholderId) {

  if (!input || !input.files || !input.files[0]) {
    return;
  }

  const file = input.files[0];

  if (!file.type.startsWith('image/')) {
    alert('Please select a valid image file.');
    input.value = '';
    return;
  }

  const reader = new FileReader();

  reader.onload = function (event) {

    const preview = document.getElementById(previewId);
    const placeholder = document.getElementById(placeholderId);

    if (preview) {
      preview.src = event.target.result;
      preview.classList.remove('d-none');
    }

    if (placeholder) {
      placeholder.classList.add('d-none');
    }
  };

  reader.readAsDataURL(file);
}


// ============================================================
// SET IMAGE FILE FROM CAMERA CAPTURE
// ============================================================

function setImageFile(blob, targetInputId, previewId, placeholderId) {

  if (!blob) {
    return;
  }

  const input = document.getElementById(targetInputId);

  if (!input) {
    console.error('Image input not found:', targetInputId);
    return;
  }

  const extension =
    blob.type === 'image/png'
      ? 'png'
      : 'jpg';

  const file = new File(
    [blob],
    `${targetInputId}-${Date.now()}.${extension}`,
    {
      type: blob.type || 'image/jpeg'
    }
  );

  try {

    const dataTransfer = new DataTransfer();

    dataTransfer.items.add(file);

    input.files = dataTransfer.files;

  } catch (error) {

    console.error('Unable to attach camera image:', error);

    /*
     * Some older browsers may not allow assigning FileList.
     * The preview is still shown so the user can retry with
     * the normal upload control.
     */
  }

  const reader = new FileReader();

  reader.onload = function (event) {

    const preview = document.getElementById(previewId);
    const placeholder = document.getElementById(placeholderId);

    if (preview) {
      preview.src = event.target.result;
      preview.classList.remove('d-none');
    }

    if (placeholder) {
      placeholder.classList.add('d-none');
    }
  };

  reader.readAsDataURL(file);

  if (targetInputId === 'assetImage') {
    assetImageRemoved = false;
  }

  if (targetInputId === 'receiptImage') {
    receiptImageRemoved = false;
  }
}


// ============================================================
// CAMERA MODAL
// ============================================================

function openImageCamera(target) {

  activeCameraTarget = target;

  const modalElement =
    document.getElementById('assetCameraModal');

  if (!modalElement) {
    console.error('assetCameraModal not found.');
    return;
  }

  const title =
    document.getElementById('assetCameraModalTitle');

  if (title) {

    if (target === 'asset') {
      title.textContent = 'Capture Asset Image';
    } else if (target === 'receipt') {
      title.textContent = 'Capture Receipt Image';
    } else {
      title.textContent = 'Capture Image';
    }
  }

  const modal =
    bootstrap.Modal.getOrCreateInstance(modalElement);

  modal.show();

  modalElement.addEventListener(
    'shown.bs.modal',
    function cameraShownHandler() {

      modalElement.removeEventListener(
        'shown.bs.modal',
        cameraShownHandler
      );

      startAssetCamera();
    }
  );
}


// ============================================================
// START CAMERA
// ============================================================

async function startAssetCamera() {

  const video =
    document.getElementById('assetCameraVideo');

  const message =
    document.getElementById('assetCameraMessage');

  if (!video) {
    console.error('assetCameraVideo not found.');
    return;
  }

  stopAssetCamera();

  if (!navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia) {

    if (message) {
      message.textContent =
        'Camera access is not supported by this browser.';
    }

    return;
  }

  try {

    if (message) {
      message.textContent =
        'Requesting camera access...';
    }

    cameraStream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: {
            ideal: 'environment'
          },
          width: {
            ideal: 1280
          },
          height: {
            ideal: 720
          }
        },
        audio: false
      });

    video.srcObject = cameraStream;

    video.setAttribute('playsinline', 'true');

    await video.play();

    if (message) {
      message.textContent =
        'Position the image inside the camera frame, then click Capture.';
    }

  } catch (error) {

    console.error('Camera error:', error);

    if (message) {

      if (error.name === 'NotAllowedError') {

        message.textContent =
          'Camera permission was denied. Please allow camera access and try again.';

      } else if (error.name === 'NotFoundError') {

        message.textContent =
          'No camera was found on this device.';

      } else {

        message.textContent =
          'Unable to start the camera. ' + error.message;
      }
    }
  }
}


// ============================================================
// STOP CAMERA
// ============================================================

function stopAssetCamera() {

  if (cameraStream) {

    cameraStream.getTracks().forEach(function (track) {
      track.stop();
    });

    cameraStream = null;
  }

  const video =
    document.getElementById('assetCameraVideo');

  if (video) {
    video.pause();

    try {
      video.srcObject = null;
    } catch (error) {
      console.warn('Unable to clear camera source:', error);
    }
  }
}


// ============================================================
// CAPTURE CAMERA PHOTO
// ============================================================

function captureAssetPhoto() {

  const video =
    document.getElementById('assetCameraVideo');

  const canvas =
    document.getElementById('assetCameraCanvas');

  if (!video || !canvas) {
    alert('Camera is not ready.');
    return;
  }

  if (!video.videoWidth || !video.videoHeight) {
    alert('Camera is still starting. Please wait a moment and try again.');
    return;
  }

  const context =
    canvas.getContext('2d');

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  context.drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );

  canvas.toBlob(
    function (blob) {

      if (!blob) {
        alert('Unable to capture image.');
        return;
      }

      if (activeCameraTarget === 'asset') {

        setImageFile(
          blob,
          'assetImage',
          'assetImagePreview',
          'assetImagePlaceholder'
        );

      } else if (activeCameraTarget === 'receipt') {

        setImageFile(
          blob,
          'receiptImage',
          'receiptImagePreview',
          'receiptImagePlaceholder'
        );
      }

      stopAssetCamera();

      const modalElement =
        document.getElementById('assetCameraModal');

      if (modalElement) {

        const modal =
          bootstrap.Modal.getInstance(modalElement);

        if (modal) {
          modal.hide();
        }
      }

    },
    'image/jpeg',
    0.90
  );
}


// ============================================================
// CAMERA MODAL CLEANUP
// ============================================================

function initializeCameraModal() {

  const modalElement =
    document.getElementById('assetCameraModal');

  if (!modalElement) {
    return;
  }

  modalElement.addEventListener(
    'hidden.bs.modal',
    function () {

      stopAssetCamera();

      activeCameraTarget = null;

      const message =
        document.getElementById('assetCameraMessage');

      if (message) {
        message.textContent = '';
      }
    }
  );
}


// ============================================================
// CREATE CAMERA MODAL IF IT DOES NOT EXIST
// ============================================================

function ensureAssetCameraModal() {

  if (document.getElementById('assetCameraModal')) {
    initializeCameraModal();
    return;
  }

  const modalHTML = `
    <div
      class="modal fade"
      id="assetCameraModal"
      tabindex="-1"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-lg modal-dialog-centered">

        <div class="modal-content">

          <div class="modal-header">

            <h5
              class="modal-title"
              id="assetCameraModalTitle"
            >
              Capture Image
            </h5>

            <button
              type="button"
              class="btn-close"
              data-bs-dismiss="modal"
              aria-label="Close"
            ></button>

          </div>

          <div class="modal-body">

            <div
              class="camera-preview-wrapper position-relative bg-dark rounded overflow-hidden"
              style="min-height:320px;"
            >

              <video
                id="assetCameraVideo"
                class="w-100 d-block"
                autoplay
                muted
                playsinline
                style="max-height:70vh;object-fit:contain;"
              ></video>

            </div>

            <canvas
              id="assetCameraCanvas"
              class="d-none"
            ></canvas>

            <div
              id="assetCameraMessage"
              class="text-muted small text-center mt-3"
            >
            </div>

          </div>

          <div class="modal-footer">

            <button
              type="button"
              class="btn btn-secondary"
              data-bs-dismiss="modal"
            >
              Cancel
            </button>

            <button
              type="button"
              class="btn btn-primary"
              id="captureAssetPhotoBtn"
            >
              <i class="bi bi-camera"></i>
              Capture
            </button>

            

          </div>

        </div>

      </div>
    </div>
  `;

  document.body.insertAdjacentHTML(
    'beforeend',
    modalHTML
  );

  initializeCameraModal();
}


// ============================================================
// FILE INPUT HANDLERS
// ============================================================

function initializeImageInputs() {

  const assetInput =
    document.getElementById('assetImage');

  const receiptInput =
    document.getElementById('receiptImage');

  if (assetInput) {

    assetInput.addEventListener(
      'change',
      function () {

        assetImageRemoved = false;

        previewImage(
          this,
          'assetImagePreview',
          'assetImagePlaceholder'
        );
      }
    );
  }

  if (receiptInput) {

    receiptInput.addEventListener(
      'change',
      function () {

        receiptImageRemoved = false;

        previewImage(
          this,
          'receiptImagePreview',
          'receiptImagePlaceholder'
        );
      }
    );
  }
}


// ============================================================
// IMAGE BUTTON HANDLERS
// ============================================================

function initializeImageButtons() {

  document.addEventListener(
    'click',
    function (event) {

      const uploadAssetBtn =
        event.target.closest('#uploadAssetImageBtn');

      const cameraAssetBtn =
        event.target.closest('#cameraAssetImageBtn');

      const uploadReceiptBtn =
        event.target.closest('#uploadReceiptImageBtn');

      const cameraReceiptBtn =
        event.target.closest('#cameraReceiptImageBtn');

      const removeAssetBtn =
        event.target.closest('#removeAssetImageBtn');

      const removeReceiptBtn =
        event.target.closest('#removeReceiptImageBtn');

      if (uploadAssetBtn) {

        const input =
          document.getElementById('assetImage');

        if (input) {
          input.click();
        }

        return;
      }

      if (cameraAssetBtn) {

        openImageCamera('asset');

        return;
      }

      if (uploadReceiptBtn) {

        const input =
          document.getElementById('receiptImage');

        if (input) {
          input.click();
        }

        return;
      }

      if (cameraReceiptBtn) {

        openImageCamera('receipt');

        return;
      }

      if (removeAssetBtn) {

        removeAssetImage();

        return;
      }

      if (removeReceiptBtn) {

        removeReceiptImage();

        return;
      }
    }
  );
}


// ============================================================
// CAMERA CAPTURE BUTTON
// ============================================================

function initializeCameraButton() {

  document.addEventListener(
    'click',
    function (event) {

      const button =
        event.target.closest('#captureAssetPhotoBtn');

      if (!button) {
        return;
      }

      captureAssetPhoto();
    }
  );
}


// ============================================================
// IMAGE LIGHTBOX / VIEW IMAGE
// ============================================================

function viewAssetImage(src, title) {

  if (!src) {
    return;
  }

  let modalElement =
    document.getElementById('assetImageViewerModal');

  if (!modalElement) {

    const html = `
      <div
        class="modal fade"
        id="assetImageViewerModal"
        tabindex="-1"
        aria-hidden="true"
      >

        <div class="modal-dialog modal-xl modal-dialog-centered">

          <div class="modal-content">

            <div class="modal-header">

              <h5
                class="modal-title"
                id="assetImageViewerTitle"
              >
                Image
              </h5>

              <button
                type="button"
                class="btn-close"
                data-bs-dismiss="modal"
              ></button>

            </div>

            <div class="modal-body text-center">

              <img
                id="assetImageViewer"
                src=""
                alt="Asset Image"
                class="img-fluid rounded"
                style="max-height:75vh;object-fit:contain;"
              >

            </div>

          </div>

        </div>

      </div>
    `;

    document.body.insertAdjacentHTML(
      'beforeend',
      html
    );

    modalElement =
      document.getElementById('assetImageViewerModal');
  }

  const image =
    document.getElementById('assetImageViewer');

  const titleElement =
    document.getElementById('assetImageViewerTitle');

  if (image) {
    image.src = src;
  }

  if (titleElement) {
    titleElement.textContent =
      title || 'Image';
  }

  const modal =
    bootstrap.Modal.getOrCreateInstance(modalElement);

  modal.show();
}


// ============================================================
// ASSET FORM RESET
// ============================================================

function resetAssetImageState() {

  assetImageRemoved = false;
  receiptImageRemoved = false;

  const assetInput =
    document.getElementById('assetImage');

  const receiptInput =
    document.getElementById('receiptImage');

  if (assetInput) {
    assetInput.value = '';
  }

  if (receiptInput) {
    receiptInput.value = '';
  }

  const assetPreview =
    document.getElementById('assetImagePreview');

  const receiptPreview =
    document.getElementById('receiptImagePreview');

  const assetPlaceholder =
    document.getElementById('assetImagePlaceholder');

  const receiptPlaceholder =
    document.getElementById('receiptImagePlaceholder');

  if (assetPreview) {

    assetPreview.src = '';

    assetPreview.classList.add('d-none');
  }

  if (receiptPreview) {

    receiptPreview.src = '';

    receiptPreview.classList.add('d-none');
  }

  if (assetPlaceholder) {
    assetPlaceholder.classList.remove('d-none');
  }

  if (receiptPlaceholder) {
    receiptPlaceholder.classList.remove('d-none');
  }
}


// ============================================================
// ASSET FORM IMAGE STATE
// ============================================================

function setExistingAssetImages(asset) {

  assetImageRemoved = false;
  receiptImageRemoved = false;

  const assetPreview =
    document.getElementById('assetImagePreview');

  const receiptPreview =
    document.getElementById('receiptImagePreview');

  const assetPlaceholder =
    document.getElementById('assetImagePlaceholder');

  const receiptPlaceholder =
    document.getElementById('receiptImagePlaceholder');

  /*
   * Support the common backend field names:
   *
   * asset_image
   * asset_image_url
   * image
   * image_url
   *
   * receipt_image
   * receipt_image_url
   * receipt
   */

  const assetImage =
    asset?.asset_image ||
    asset?.asset_image_url ||
    asset?.image ||
    asset?.image_url ||
    '';

  const receiptImage =
    asset?.receipt_image ||
    asset?.receipt_image_url ||
    asset?.receipt ||
    '';

  if (assetPreview) {

    if (assetImage) {

      assetPreview.src = assetImage;

      assetPreview.classList.remove('d-none');

      if (assetPlaceholder) {
        assetPlaceholder.classList.add('d-none');
      }

    } else {

      assetPreview.src = '';

      assetPreview.classList.add('d-none');

      if (assetPlaceholder) {
        assetPlaceholder.classList.remove('d-none');
      }
    }
  }

  if (receiptPreview) {

    if (receiptImage) {

      receiptPreview.src = receiptImage;

      receiptPreview.classList.remove('d-none');

      if (receiptPlaceholder) {
        receiptPlaceholder.classList.add('d-none');
      }

    } else {

      receiptPreview.src = '';

      receiptPreview.classList.add('d-none');

      if (receiptPlaceholder) {
        receiptPlaceholder.classList.remove('d-none');
      }
    }
  }
}


// ============================================================
// ASSET IMAGE CLICK HANDLER
// ============================================================

function initializeImagePreviewHandlers() {

  document.addEventListener(
    'click',
    function (event) {

      const image =
        event.target.closest(
          '#assetImagePreview, #receiptImagePreview'
        );

      if (!image) {
        return;
      }

      if (!image.src) {
        return;
      }

      const title =
        image.id === 'assetImagePreview'
          ? 'Asset Image'
          : 'Receipt Image';

      viewAssetImage(
        image.src,
        title
      );
    }
  );
}


// ============================================================
// MODAL FORM CLEANUP
// ============================================================

function initializeAssetModalCleanup() {

  const modalElement =
    document.getElementById('addAssetModal');

  if (!modalElement) {
    return;
  }

  modalElement.addEventListener(
    'hidden.bs.modal',
    function () {

      stopAssetCamera();

      activeCameraTarget = null;

      /*
       * Do not automatically reset the form here.
       * Existing application logic may still need the
       * values after the modal closes.
       */
    }
  );
}


// ============================================================
// SCANNER CLEANUP
// ============================================================

function cleanupScanner() {

  try {

    if (
      typeof html5QrCode !== 'undefined' &&
      html5QrCode
    ) {

      if (
        typeof html5QrCode.isScanning === 'function' &&
        html5QrCode.isScanning()
      ) {

        html5QrCode.stop()
          .then(function () {

            try {
              html5QrCode.clear();
            } catch (error) {
              console.warn(
                'Unable to clear scanner:',
                error
              );
            }

          })
          .catch(function (error) {

            console.warn(
              'Unable to stop scanner:',
              error
            );
          });
      }
    }

  } catch (error) {

    console.warn(
      'Scanner cleanup error:',
      error
    );
  }
}


// ============================================================
// BEFORE PAGE UNLOAD
// ============================================================

function initializePageCleanup() {

  window.addEventListener(
    'beforeunload',
    function () {

      stopAssetCamera();

      cleanupScanner();
    }
  );
}


// ============================================================
// KEYBOARD HANDLERS
// ============================================================

function initializeKeyboardHandlers() {

  document.addEventListener(
    'keydown',
    function (event) {

      /*
       * ESC should always stop the camera.
       */

      if (event.key === 'Escape') {
        stopAssetCamera();
      }
    }
  );
}


// ============================================================
// REFRESH ASSET LIST
// ============================================================

async function refreshAssets() {

  try {

    if (typeof loadAssets === 'function') {

      await loadAssets();

      return;
    }

    if (
      typeof fetchAssets === 'function'
    ) {

      await fetchAssets();

      return;
    }

    console.warn(
      'No asset reload function is available.'
    );

  } catch (error) {

    console.error(
      'Unable to refresh assets:',
      error
    );
  }
}


// ============================================================
// GENERIC API ERROR HANDLER
// ============================================================

async function getApiErrorMessage(response) {

  try {

    const data =
      await response.json();

    return (
      data.message ||
      data.error ||
      `Request failed with status ${response.status}.`
    );

  } catch (error) {

    return (
      `Request failed with status ${response.status}.`
    );
  }
}


// ============================================================
// SAFE JSON FETCH
// ============================================================

async function fetchJson(url, options = {}) {

  const response =
    await fetch(url, options);

  if (!response.ok) {

    const message =
      await getApiErrorMessage(response);

    throw new Error(message);
  }

  return response.json();
}


// ============================================================
// ASSET IMAGE URL HELPER
// ============================================================

function getAssetImageSource(asset) {

  if (!asset) {
    return '';
  }

  return (
    asset.asset_image ||
    asset.asset_image_url ||
    asset.image ||
    asset.image_url ||
    ''
  );
}


// ============================================================
// RECEIPT IMAGE URL HELPER
// ============================================================

function getReceiptImageUrl(asset) {

  if (!asset) {
    return '';
  }

  return (
    asset.receipt_image ||
    asset.receipt_image_url ||
    asset.receipt ||
    ''
  );
}


// ============================================================
// IMAGE HTML HELPER
// ============================================================

function getAssetImageHTML(asset, type = 'asset') {

  const src =
    type === 'receipt'
      ? getReceiptImageUrl(asset)
      : getAssetImageSource(asset);

  const title =
    type === 'receipt'
      ? 'Receipt Image'
      : 'Asset Image';

  if (!src) {

    return `
      <div
        class="d-flex align-items-center justify-content-center
               bg-light border rounded text-muted"
        style="width:90px;height:70px;"
      >
        <i class="bi bi-image fs-4"></i>
      </div>
    `;
  }

  return `
    <img
      src="${escapeHtml(src)}"
      alt="${title}"
      title="Click to view ${title}"
      class="img-thumbnail asset-list-image"
      style="
        width:90px;
        height:70px;
        object-fit:cover;
        cursor:pointer;
      "
      onclick="viewAssetImage(
        '${escapeJsString(src)}',
        '${escapeJsString(title)}'
      )"
      onerror="this.style.display='none';"
    >
  `;
}


// ============================================================
// ESCAPE JAVASCRIPT STRING
// ============================================================

function escapeJsString(value) {

  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}


// ============================================================
// FORM IMAGE BUTTON STATE
// ============================================================

function updateImageButtonState() {

  const assetInput =
    document.getElementById('assetImage');

  const receiptInput =
    document.getElementById('receiptImage');

  const assetCameraButton =
    document.getElementById('cameraAssetImageBtn');

  const receiptCameraButton =
    document.getElementById('cameraReceiptImageBtn');

  /*
   * Camera buttons remain enabled as long as the browser
   * provides camera support.
   */

  const cameraAvailable =
    !!(
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia
    );

  if (assetCameraButton) {
    assetCameraButton.disabled =
      !cameraAvailable;
  }

  if (receiptCameraButton) {
    receiptCameraButton.disabled =
      !cameraAvailable;
  }

  /*
   * File inputs are intentionally not disabled.
   */

  if (assetInput) {
    assetInput.disabled = false;
  }

  if (receiptInput) {
    receiptInput.disabled = false;
  }
}


// ============================================================
// INITIALIZE ASSET IMAGE / RECEIPT IMAGE FEATURES
// ============================================================

function initializeAssetImageFeatures() {

  /*
   * Make sure the camera modal exists before buttons are used.
   */

  ensureAssetCameraModal();

  initializeImageInputs();

  initializeImageButtons();

  initializeCameraButton();

  initializeImagePreviewHandlers();

  updateImageButtonState();

  initializeAssetModalCleanup();
}


// ============================================================
// GENERAL PAGE INITIALIZATION
// ============================================================

async function initializeAssetsPage() {

  try {

    await loadMe();

// ========================================================
// ASSET / RECEIPT IMAGE CONTROLS
// ========================================================

setupAssetImageControls();


// ========================================================
// PURCHASE COST FORMATTING
// ========================================================

setupPurchaseCostFormatting();
    initializePageCleanup();

    initializeKeyboardHandlers();

    // ========================================================
    // SEARCH / FILTER INITIALIZATION
    // ========================================================
    if (
      typeof setupSearch === 'function'
    ) {
      
      setupSearch();
    }
    if (typeof setupSelectAll === 'function') {
  setupSelectAll();
}
    if (typeof setupEmployeePicker === 'function') {
  setupEmployeePicker();
}



    /*
     * Existing asset page initialization.
     * These functions are only called when they exist so
     * this section remains compatible with the existing
     * Assets page implementation.
     */

    if (
      typeof loadDepartments === 'function'
    ) {
      await loadDepartments();
    }

    if (
      typeof loadCategories === 'function'
    ) {
      await loadCategories();
    }
    if (typeof loadEmployees === 'function') {
  await loadEmployees();
}

    if (
      typeof loadLocations === 'function'
    ) {
      await loadLocations();
    }

    if (
      typeof loadCustodians === 'function'
    ) {
      await loadCustodians();
    }

    if (
      typeof loadAssets === 'function'
    ) {
      await loadAssets();
    }

    if (
      typeof openAssetFromUrl === 'function'
    ) {
      await openAssetFromUrl();
    }

    if (
      typeof initializeScanner === 'function'
    ) {
      initializeScanner();
    }

  } catch (error) {

    console.error(
      'Assets page initialization error:',
      error
    );
  }
}
// ============================================================
// DOM READY
// ============================================================

document.addEventListener(
  'DOMContentLoaded',
  function () {

    initializeAssetsPage();

    // ========================================================
    // ADD ASSET BUTTON
    // ========================================================

    const addAssetBtn =
      document.getElementById('addAssetBtn');

    if (addAssetBtn) {

      addAssetBtn.addEventListener(
        'click',
        function () {

          openAddAssetModal();

        }
      );

    }


    // ========================================================
    // BULK IMPORT BUTTON
    // ========================================================

    const importAssetBtn =
      document.getElementById('importAssetBtn');

    if (importAssetBtn) {

      importAssetBtn.addEventListener(
        'click',
        function () {

          const modalElement =
            document.getElementById(
              'importAssetModal'
            );

          if (!modalElement) {

            console.error(
              'importAssetModal not found.'
            );

            showAlert(
              'Import modal was not found.',
              'danger'
            );

            return;

          }

          const importForm =
            document.getElementById(
              'importAssetForm'
            );

          if (importForm) {
            importForm.reset();
          }

          const resultBox =
            document.getElementById(
              'importResult'
            );

          if (resultBox) {
            resultBox.innerHTML = '';
          }

          lastAssetImportResults = null;

          importAssetModal =
            bootstrap.Modal.getOrCreateInstance(
              modalElement
            );

          importAssetModal.show();

        }
      );

    }


    // ========================================================
    // IMPORT ASSET FORM
    // ========================================================

    const importAssetForm =
      document.getElementById(
        'importAssetForm'
      );

    if (importAssetForm) {

      importAssetForm.addEventListener(
        'submit',
        importAssets
      );

    }

  }
);

// ============================================================
// GLOBAL WINDOW HANDLERS
// ============================================================

window.openImageCamera =
  openImageCamera;

window.startAssetCamera =
  startAssetCamera;

window.stopAssetCamera =
  stopAssetCamera;

window.captureAssetPhoto =
  captureAssetPhoto;

window.removeAssetImage =
  removeAssetImage;

window.removeReceiptImage =
  removeReceiptImage;

window.previewImage =
  previewImage;

window.viewAssetImage =
  viewAssetImage;

window.refreshAssets =
  refreshAssets;


// ============================================================
// CAMERA MODAL SAFETY
// ============================================================

window.addEventListener(
  'pagehide',
  function () {

    stopAssetCamera();

    cleanupScanner();
  }
);
// ============================================================
// BULK ASSIGN SELECTED ASSETS
// Only Available assets can be assigned
// ============================================================

document.addEventListener('click', async event => {
  const button = event.target.closest('#assignBtn');
  if (!button || button.disabled) return;
  const ids = selectedIds();
  if (!ids.length) return;
  button.disabled = true;
  try { await openAssignModal(ids); }
  finally { updateBulkButtons(); }
});
// ============================================================
// END OF ASSETS.JS
// ============================================================
