// ============================================================
// PRIMA IT ASSET MANAGEMENT
// MAINTENANCE.JS - SIMPLIFIED REPAIR WORKFLOW
// ============================================================

let repairRecords = [];
let selectedRepair = null;
let employees = [];
let repairModal = null;
let repairDetailsModal = null;
let saveInProgress = false;

const $ = id => document.getElementById(id);

const ACTIVE_REPAIR_STATUSES = [
  'For Repair',
  'Under Diagnosis',
  'Under Repair',
  'Waiting for Parts',
  'Repaired',
  'For Disposal'
];

const LOCKED_REPAIR_STATUSES = [
  'Returned',
  'For Disposal',
  'Disposed'
];


// ============================================================
// HELPERS
// ============================================================

function esc(value) {

  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

}


function alertBox(
  message,
  type = 'success'
) {

  const box =
    $('alertBox');

  if (!box) {

    console.log(
      `[${type}] ${message}`
    );

    return;

  }

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

      ${esc(message)}

      <button
        type="button"
        class="btn-close"
        data-bs-dismiss="alert"
        aria-label="Close"
      ></button>

    </div>

  `;

}


function formAlert(
  message,
  type = 'danger'
) {

  const box =
    $('repairFormAlert');


  if (!box) {

    console.error(
      message
    );

    return;

  }


  box.innerHTML =
    message

      ? `
          <div
            class="alert alert-${type} py-2 mb-3"
          >
            ${esc(message)}
          </div>
        `

      : '';

}


function formAlertHtml(
  html,
  type = 'danger'
) {

  const box =
    $('repairFormAlert');


  if (!box) {

    return;

  }


  box.innerHTML =
    html

      ? `
          <div
            class="alert alert-${type} py-2 mb-3"
          >
            ${html}
          </div>
        `

      : '';

}


function detailAlert(
  message,
  type = 'danger'
) {

  const box =
    $('repairDetailsAlert');


  if (!box) {

    console.error(
      message
    );

    return;

  }


  box.innerHTML =
    message

      ? `
          <div
            class="alert alert-${type} py-2 mb-3"
          >
            ${esc(message)}
          </div>
        `

      : '';

}


function dt(value) {

  if (!value) {

    return '—';

  }


  const date =
    new Date(
      String(value)
        .replace(
          ' ',
          'T'
        )
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return String(
      value
    );

  }


  return date.toLocaleString(
    'en-PH',
    {

      year:
        'numeric',

      month:
        'short',

      day:
        '2-digit',

      hour:
        '2-digit',

      minute:
        '2-digit'

    }
  );

}


function localDT(value) {

  if (!value) {

    return '';

  }


  return String(value)
    .replace(
      ' ',
      'T'
    )
    .slice(
      0,
      16
    );

}


function nowLocal() {

  const now =
    new Date();


  return new Date(

    now.getTime() -

    now.getTimezoneOffset() *
    60000

  )
    .toISOString()
    .slice(
      0,
      16
    );

}


function peso(value) {

  return Number(
    value || 0
  )
    .toLocaleString(
      'en-PH',
      {

        style:
          'currency',

        currency:
          'PHP',

        minimumFractionDigits:
          2

      }
    );

}


function badge(status) {

  const colors = {

    'For Repair':
      'text-bg-warning',

    'Under Diagnosis':
      'text-bg-secondary',

    'Under Repair':
      'text-bg-info',

    'Waiting for Parts':
      'text-bg-dark',

    'Repaired':
      'text-bg-success',

    'Returned':
      'text-bg-primary',

    'For Disposal':
      'text-bg-warning',

    'Disposed':
      'text-bg-secondary',

    'Beyond Repair':
      'text-bg-danger',

    'Cancelled':
      'text-bg-light border'

  };


  return `

    <span
      class="
        badge
        repair-status-badge
        ${colors[status] || 'text-bg-light'}
      "
    >

      ${esc(
        status ||
        '—'
      )}

    </span>

  `;

}


function setText(
  id,
  value
) {

  const el =
    $(id);


  if (el) {

    el.textContent =
      value ?? '';

  }

}


function setValue(
  id,
  value
) {

  const el =
    $(id);


  if (el) {

    el.value =
      value ?? '';

  }

}


function setHtml(
  id,
  html
) {

  const el =
    $(id);


  if (el) {

    el.innerHTML =
      html;

  }

}


// ============================================================
// MODAL ACCESSIBILITY
// ============================================================

function restoreMaintenancePageScroll() {

  window.requestAnimationFrame(
    () => {

      if (
        document.querySelector(
          '.modal.show'
        )
      ) {

        return;

      }


      document.body.classList.remove(
        'modal-open'
      );

      document.body.style.removeProperty(
        'overflow'
      );

      document.body.style.removeProperty(
        'padding-right'
      );


      document
        .querySelectorAll(
          '.modal-backdrop'
        )
        .forEach(
          backdrop =>
            backdrop.remove()
        );

    }
  );

}


function setupModalAccessibility(modalElement) {

  if (
    !modalElement ||
    modalElement.dataset.accessibilityReady === 'true'
  ) {

    return;
  }


  modalElement.dataset.accessibilityReady =
    'true';


  // Hidden modals must not contain focusable content in the
  // accessibility tree. The attribute is removed before opening.
  modalElement.setAttribute(
    'inert',
    ''
  );


  modalElement.addEventListener(
    'show.bs.modal',
    () => {

      modalElement.removeAttribute(
        'inert'
      );

    }
  );


  modalElement.addEventListener(
    'hide.bs.modal',
    () => {

      const activeElement =
        document.activeElement;


      if (
        activeElement instanceof HTMLElement &&
        modalElement.contains(activeElement)
      ) {

        activeElement.blur();

      }

    }
  );


  modalElement.addEventListener(
    'hidden.bs.modal',
    () => {

      modalElement.setAttribute(
        'inert',
        ''
      );


      restoreMaintenancePageScroll();

    }
  );

}


function hideRepairDetailsModal() {

  const modalElement =
    $('repairDetailsModal');


  if (
    !modalElement ||
    !modalElement.classList.contains('show')
  ) {

    return Promise.resolve();
  }


  const modalInstance =
    repairDetailsModal ||
    bootstrap.Modal.getOrCreateInstance(
      modalElement
    );


  return new Promise(
    resolve => {

      modalElement.addEventListener(
        'hidden.bs.modal',
        resolve,
        { once: true }
      );


      const hide =
        () => modalInstance.hide();


      // Bootstrap ignores hide() while the opening fade transition
      // is running. Queue it until shown so fast clicks still work.
      if (modalInstance._isTransitioning) {

        modalElement.addEventListener(
          'shown.bs.modal',
          hide,
          { once: true }
        );

      } else {

        hide();

      }

    }
  );

}


// ============================================================
// AUTH
// ============================================================

async function me() {

  try {

    const response =
      await fetch(
        '/api/auth/me',
        {

          credentials:
            'include'

        }
      );


    if (
      !response.ok
    ) {

      location.href =
        '/';

      return;

    }


    const data =
      await response.json();


    const user =
      data.user ||
      data;


    setText(

      'userName',

      user.full_name ||

      user.name ||

      user.username ||

      ''

    );

  } catch (error) {

    console.error(
      'AUTH ERROR:',
      error
    );

  }

}


async function logout() {

  try {

    const response =
      await fetch(
        '/api/auth/logout',
        {

          method:
            'POST',

          credentials:
            'include'

        }
      );


    if (
      !response.ok
    ) {

      throw new Error(
        'Logout failed.'
      );

    }


    location.href =
      '/';

  } catch (error) {

    alert(
      error.message
    );

  }

}


// ============================================================
// SUMMARY
// ============================================================

async function summary() {

  const response =
    await fetch(
      '/api/maintenance/summary',
      {

        credentials:
          'include'

      }
    );


  const data =
    await response
      .json()
      .catch(
        () => ({})
      );


  if (
    !response.ok
  ) {

    throw new Error(

      data.message ||

      'Unable to load summary.'

    );

  }


  setText(
    'underRepair',
    data.under_repair ||
    0
  );


  setText(
    'repaired',
    data.repaired ||
    0
  );


  setText(
    'forDisposal',
    data.for_disposal ||
    0
  );


  setText(

    'totalRepairCost',

    peso(
      data.total_repair_cost
    )

  );

}


// ============================================================
// LOAD / RENDER REPAIRS
// Priority is no longer shown or filtered.
// ============================================================

async function loadRepairs() {

  const query =
    new URLSearchParams();


  const search =
    $('repairSearch')
      ?.value
      .trim() ||
    '';


  const status =
    $('repairStatusFilter')
      ?.value ||
    '';


  if (search) {

    query.set(
      'search',
      search
    );

  }


  if (status) {

    query.set(
      'status',
      status
    );

  }


  const response =
    await fetch(

      '/api/repairs?' +
      query.toString(),

      {

        credentials:
          'include'

      }

    );


  const data =
    await response
      .json()
      .catch(
        () => []
      );


  if (
    !response.ok
  ) {

    throw new Error(

      data.message ||

      'Unable to load repair records.'

    );

  }


  repairRecords =
    Array.isArray(
      data
    )

      ? data

      : [];


  renderRepairs();

}


function renderRepairs() {

  const tbody =
    $('repairTableBody');


  if (!tbody) {

    return;

  }


  setText(

    'repairCount',

    `${repairRecords.length} record${
      repairRecords.length === 1
        ? ''
        : 's'
    }`

  );


  if (
    !repairRecords.length
  ) {

    tbody.innerHTML = `

      <tr>

        <td
          colspan="9"
          class="
            text-center
            text-muted
            py-5
          "
        >

          No maintenance / repair records found.

        </td>

      </tr>

    `;


    return;

  }


  tbody.innerHTML =

    repairRecords

      .map(
        record => {

          const locked =
            LOCKED_REPAIR_STATUSES
              .includes(
                record.status
              );


          return `

            <tr data-repair-id="${Number(record.id) || ''}">

              <td
                class="fw-semibold repair-sticky-col repair-col-repair-no"
              >

                ${esc(
                  record.repair_no ||
                  (record.id
                    ? `Repair #${record.id}`
                    : 'No repair ID')
                )}

              </td>


              <td class="repair-sticky-col repair-col-asset-id">

                ${esc(
                  record.asset_code ||
                  (record.db_asset_id
                    ? `Asset #${record.db_asset_id}`
                    : 'No asset ID')
                )}

              </td>


              <td>

                <div
                  class="fw-semibold"
                >

                  ${esc(
                    record.asset_name
                  )}

                </div>


                <div
                  class="
                    small
                    text-muted
                  "
                >

                  ${esc(

                    [

                      record.brand,

                      record.model,

                      record.serial_number

                        ? `S/N: ${record.serial_number}`

                        : ''

                    ]

                      .filter(
                        Boolean
                      )

                      .join(
                        ' • '
                      ) ||

                    '—'

                  )}

                </div>

              </td>


              <td>

                ${esc(
                  record.custodian_name ||
                  'IT Inventory'
                )}


                ${
                  record.custodian_employee_id

                    ? `

                        <div
                          class="
                            small
                            text-muted
                          "
                        >

                          ${esc(
                            record.custodian_employee_id
                          )}

                        </div>

                      `

                    : ''
                }

              </td>


              <td>

                ${dt(
                  record.date_reported
                )}

              </td>


              <td>

                ${esc(
                  record.technician_name ||
                  'Unassigned'
                )}

              </td>


              <td>

                ${badge(
                  record.status
                )}

              </td>


              <td>

                ${peso(
                  record.total_cost
                )}

              </td>


              <td class="repair-sticky-col repair-col-action">

                <div
                  class="
                    d-flex
                    gap-1
                  "
                >

                  <button
                    type="button"
                    class="
                      btn
                      btn-sm
                      btn-outline-primary
                      vrep
                    "
                    data-id="${record.id}"
                  >

                    View

                  </button>


                  ${
                    !locked

                      ? `

                          <button
                            type="button"
                            class="
                              btn
                              btn-sm
                              btn-outline-secondary
                              erep
                            "
                            data-id="${record.id}"
                          >

                            Edit

                          </button>

                        `

                      : ''
                  }

                </div>

              </td>

            </tr>

          `;

        }

      )
      .join('');


  tbody
    .querySelectorAll(
      '.vrep'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () => {

            details(
              Number(
                button.dataset.id
              )
            );

          }
        );

      }
    );


  tbody
    .querySelectorAll(
      '.erep'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () => {

            edit(
              Number(
                button.dataset.id
              )
            );

          }
        );

      }
    );

}


// ============================================================
// TECHNICIANS
// ============================================================

async function techs() {

  const response =
    await fetch(
      '/api/employees?status=active',
      {

        credentials:
          'include'

      }
    );


  const data =
    await response
      .json()
      .catch(
        () => []
      );


  if (
    !response.ok
  ) {

    throw new Error(

      data.message ||

      'Unable to load employees.'

    );

  }


  employees =
    Array.isArray(
      data
    )

      ? data

      : [];


  const select =
    $('repairTechnician');


  if (!select) {

    return;

  }


  select.innerHTML = `

    <option value="">
      Unassigned
    </option>

    ${
      employees

        .map(
          employee => `

            <option
              value="${employee.id}"
            >

              ${esc(
                employee.full_name
              )}

              ${
                employee.department_name

                  ? ` — ${esc(
                      employee.department_name
                    )}`

                  : ''
              }

            </option>

          `

        )
        .join('')
    }

  `;

}


// ============================================================
// ASSET HELPERS
// ============================================================

function fillAssetFields(
  asset
) {

  setValue(
    'repairAssetId',
    asset.id ||
    ''
  );


  setValue(
    'repairAssetSearch',
    asset.asset_id ||
    ''
  );


  setValue(
    'repairAssetCode',
    asset.asset_id ||
    ''
  );


  setValue(
    'repairAssetName',
    asset.asset_name ||
    ''
  );


  setValue(
    'repairAssetBrand',
    asset.brand ||
    ''
  );


  setValue(
    'repairAssetModel',
    asset.model ||
    ''
  );


  setValue(
    'repairAssetSerial',
    asset.serial_number ||
    ''
  );


  if (
    $('repairInitialCondition') &&
    asset.condition_status
  ) {

    $('repairInitialCondition').value =
      asset.condition_status;

  }


  setHtml(
    'repairAssetInfo',
    `

      <div
        class="row g-2"
      >

        <div
          class="col-md-6"
        >

          <strong>
            Asset ID:
          </strong>

          ${esc(
            asset.asset_id ||
            '—'
          )}

        </div>


        <div
          class="col-md-6"
        >

          <strong>
            Asset Name:
          </strong>

          ${esc(
            asset.asset_name ||
            '—'
          )}

        </div>


        <div
          class="col-md-6"
        >

          <strong>
            Brand:
          </strong>

          ${esc(
            asset.brand ||
            '—'
          )}

        </div>


        <div
          class="col-md-6"
        >

          <strong>
            Model:
          </strong>

          ${esc(
            asset.model ||
            '—'
          )}

        </div>


        <div
          class="col-md-6"
        >

          <strong>
            Serial Number:
          </strong>

          ${esc(
            asset.serial_number ||
            '—'
          )}

        </div>


        <div
          class="col-md-6"
        >

          <strong>
            Current Status:
          </strong>

          ${badge(
            asset.status
          )}

        </div>

      </div>

    `
  );

}


async function findActiveRepairForAsset(
  assetId,
  assetCode = ''
) {

  const searchValue =
    String(
      assetCode ||
      ''
    )
      .trim();


  if (!searchValue) {

    return null;

  }


  try {

    const response =
      await fetch(

        '/api/repairs?search=' +
        encodeURIComponent(
          searchValue
        ),

        {

          credentials:
            'include',

          headers: {

            'Accept':
              'application/json'

          }

        }

      );


    const data =
      await response
        .json()
        .catch(
          () => []
        );


    if (
      !response.ok
    ) {

      console.warn(

        'Unable to check active repair:',

        data.message ||

        response.status

      );


      return null;

    }


    const records =
      Array.isArray(
        data
      )

        ? data

        : [];


    const normalizedCode =
      searchValue
        .toLowerCase();


    return records
      .find(
        record => {

          const recordAssetId =
            Number(

              record.db_asset_id ||

              record.asset_id ||

              0

            );


          const recordAssetCode =
            String(
              record.asset_code ||
              ''
            )
              .trim()
              .toLowerCase();


          const sameAsset =

            (
              assetId &&

              recordAssetId ===
                Number(
                  assetId
                )
            )

            ||

            (
              normalizedCode &&

              recordAssetCode ===
                normalizedCode
            );


          return (

            sameAsset &&

            ACTIVE_REPAIR_STATUSES
              .includes(
                record.status
              )

          );

        }

      ) ||

      null;


  } catch (error) {

    console.error(
      'FIND ACTIVE REPAIR ERROR:',
      error
    );


    return null;

  }

}


function showExistingRepairWarning(
  activeRepair
) {

  formAlertHtml(
    `

      <div>

        <strong>

          <i
            class="
              bi
              bi-exclamation-triangle
              me-1
            "
          ></i>

          This asset already has an active maintenance record.

        </strong>


        <div
          class="mt-2"
        >

          Repair No:

          <strong>

            ${esc(
              activeRepair.repair_no ||
              '—'
            )}

          </strong>

        </div>


        <div>

          Status:

          ${badge(
            activeRepair.status
          )}

        </div>


        <button
          type="button"
          class="
            btn
            btn-sm
            btn-primary
            mt-2
          "
          id="maintenanceViewExistingRepairBtn"
        >

          <i
            class="
              bi
              bi-eye
              me-1
            "
          ></i>

          View Repair

        </button>

      </div>

    `,
    'warning'
  );


  setTimeout(
    () => {

      const button =
        $('maintenanceViewExistingRepairBtn');


      if (button) {

        button.onclick =
          async () => {

            if (
              repairModal
            ) {

              repairModal.hide();

            }


            await details(
              Number(
                activeRepair.id
              )
            );

          };

      }

    },
    0
  );

}


async function findAsset() {

  const input =
    $('repairAssetSearch');


  if (!input) {

    return;

  }


  const searchValue =
    input.value
      .trim();


  if (!searchValue) {

    formAlert(

      'Please enter an Asset ID, barcode, serial number, or asset name.',

      'warning'

    );


    return;

  }


  try {

    formAlert(
      'Searching for asset...',
      'info'
    );


    const response =
      await fetch(

        '/api/assets/scan/' +
        encodeURIComponent(
          searchValue
        ),

        {

          credentials:
            'include',

          headers: {

            'Accept':
              'application/json'

          }

        }

      );


    const data =
      await response
        .json()
        .catch(
          () => ({})
        );


    if (
      !response.ok
    ) {

      throw new Error(

        data.message ||

        'Asset not found.'

      );

    }


    const asset =
      data.asset ||
      data;


    if (
      !asset ||
      !asset.id
    ) {

      throw new Error(
        'Asset not found.'
      );

    }


    fillAssetFields(
      asset
    );


    const activeRepair =
      await findActiveRepairForAsset(
        asset.id,
        asset.asset_id
      );


    if (
      activeRepair
    ) {

      showExistingRepairWarning(
        activeRepair
      );


      return;

    }


    formAlert(
      'Asset is ready to start a repair record.',
      'success'
    );


  } catch (error) {

    console.error(
      'FIND ASSET ERROR:',
      error
    );


    formAlert(

      error.message ||

      'Unable to search for asset.',

      'danger'

    );

  }

}


// ============================================================
// OPEN NEW REPAIR
// New repair goes directly to Under Repair.
// ============================================================

async function openNew(
  assetId = 0
) {

  try {

    selectedRepair =
      null;


    $('repairForm')
      ?.reset();


    setValue(
      'repairId',
      ''
    );


    setValue(
      'repairAssetId',
      ''
    );


    setValue(
      'repairAssetSearch',
      ''
    );


    setValue(
      'repairAssetCode',
      ''
    );


    setValue(
      'repairAssetName',
      ''
    );


    setValue(
      'repairAssetBrand',
      ''
    );


    setValue(
      'repairAssetModel',
      ''
    );


    setValue(
      'repairAssetSerial',
      ''
    );


    setValue(
      'repairDateReported',
      nowLocal()
    );


    setValue(
      'repairDateReceived',
      ''
    );


    setValue(
      'repairInitialCondition',
      'Good'
    );


    setValue(
      'repairPriority',
      'Medium'
    );


    setValue(
      'repairStatus',
      'Under Repair'
    );


    setValue(
      'repairPartsCost',
      0
    );


    setValue(
      'repairLaborCost',
      0
    );


    setText(
      'repairModalTitle',
      'Start Repair'
    );


    setText(
      'saveRepairBtn',
      '🔧 Start Repair'
    );


    setHtml(

      'repairAssetInfo',

      'Search or select an asset before starting the repair.'

    );


    formAlertHtml(
      ''
    );


    if (!assetId) {

      repairModal
        ?.show();


      setTimeout(
        () => {

          $('repairAssetSearch')
            ?.focus();

        },
        200
      );


      return;

    }


    const response =
      await fetch(

        '/api/assets/' +
        encodeURIComponent(
          assetId
        ),

        {

          credentials:
            'include',

          headers: {

            'Accept':
              'application/json'

          }

        }

      );


    const data =
      await response
        .json()
        .catch(
          () => ({})
        );


    if (
      !response.ok
    ) {

      throw new Error(

        data.message ||

        'Unable to load asset.'

      );

    }


    const asset =
      data.asset ||
      data;


    if (
      !asset ||
      !asset.id
    ) {

      throw new Error(
        'Asset not found.'
      );

    }


    const activeRepair =
      await findActiveRepairForAsset(
        asset.id,
        asset.asset_id
      );


    if (
      activeRepair
    ) {

      await details(
        Number(
          activeRepair.id
        )
      );


      return;

    }


    fillAssetFields(
      asset
    );


    repairModal
      ?.show();


  } catch (error) {

    console.error(
      'OPEN NEW REPAIR ERROR:',
      error
    );


    alertBox(

      error.message ||

      'Unable to open repair form.',

      'danger'

    );

  }

}


// ============================================================
// SAVE / UPDATE REPAIR
// ============================================================

async function save(
  event
) {

  event
    ?.preventDefault();


  if (
    saveInProgress
  ) {

    return;

  }


  const assetId =
    Number(
      $('repairAssetId')
        ?.value ||
      0
    );


  const repairId =
    Number(
      $('repairId')
        ?.value ||
      0
    );


  if (!assetId) {

    formAlert(
      'Please select a valid asset.',
      'warning'
    );


    return;

  }


  const problem =
    $('repairProblem')
      ?.value
      .trim() ||
    '';


  if (!problem) {

    formAlert(
      'Problem / Issue is required.',
      'warning'
    );


    $('repairProblem')
      ?.focus();


    return;

  }


  if (!repairId) {

    const activeRepair =
      await findActiveRepairForAsset(

        assetId,

        $('repairAssetSearch')
          ?.value
          .trim() ||
        ''

      );


    if (
      activeRepair
    ) {

      showExistingRepairWarning(
        activeRepair
      );


      return;

    }

  }


  const payload = {

    asset_id:
      assetId,


    date_reported:
      $('repairDateReported')
        ?.value ||
      null,


    date_received:
      $('repairDateReceived')
        ?.value ||
      null,


    problem_description:
      problem,


    priority:
      'Medium',


    initial_condition:
      $('repairInitialCondition')
        ?.value ||
      'Good',


    technician_id:
      $('repairTechnician')
        ?.value ||
      null,


    vendor:
      $('repairVendor')
        ?.value
        .trim() ||
      '',


    diagnosis:
      $('repairDiagnosis')
        ?.value
        .trim() ||
      '',


    repair_action:
      $('repairAction')
        ?.value
        .trim() ||
      '',


    parts_replaced:
      $('repairPartsReplaced')
        ?.value
        .trim() ||
      '',


    parts_cost:
      Number(
        $('repairPartsCost')
          ?.value ||
        0
      ),


    labor_cost:
      Number(
        $('repairLaborCost')
          ?.value ||
        0
      ),


    warranty:
      $('repairWarranty')
        ?.value
        .trim() ||
      '',


    remarks:
      $('repairRemarks')
        ?.value
        .trim() ||
      '',


    status:
      repairId

        ? (
            selectedRepair
              ?.status ||

            'Under Repair'
          )

        : 'Under Repair'

  };


  const button =
    $('saveRepairBtn');


  saveInProgress =
    true;


  if (button) {

    button.disabled =
      true;


    button.innerHTML = `

      <span
        class="
          spinner-border
          spinner-border-sm
          me-1
        "
        role="status"
      ></span>

      Saving...

    `;

  }


  formAlert(
    ''
  );


  try {

    const url =
      repairId

        ? `/api/repairs/${repairId}`

        : '/api/repairs';


    const method =
      repairId

        ? 'PUT'

        : 'POST';


    const response =
      await fetch(
        url,
        {

          method,

          credentials:
            'include',

          headers: {

            'Content-Type':
              'application/json',

            'Accept':
              'application/json'

          },

          body:
            JSON.stringify(
              payload
            )

        }
      );


    const data =
      await response
        .json()
        .catch(
          () => ({})
        );


    if (
      !response.ok
    ) {

      throw new Error(

        data.message ||

        `Unable to ${
          repairId
            ? 'update'
            : 'start'
        } repair.`

      );

    }


    repairModal
      ?.hide();


    alertBox(

      data.message ||

      (
        repairId

          ? 'Repair work saved successfully.'

          : 'Repair started successfully.'
      ),

      'success'

    );


    await refresh();


  } catch (error) {

    console.error(
      'SAVE REPAIR ERROR:',
      error
    );


    formAlert(

      error.message ||

      'Unable to save repair record.',

      'danger'

    );


  } finally {

    saveInProgress =
      false;


    if (button) {

      button.disabled =
        false;


      button.textContent =
        repairId

          ? 'Save Repair Work'

          : '🔧 Start Repair';

    }

  }

}


// ============================================================
// GET REPAIR
// ============================================================

async function getRepair(
  id
) {

  const response =
    await fetch(
      `/api/repairs/${id}`,
      {

        credentials:
          'include',

        headers: {

          'Accept':
            'application/json'

        }

      }
    );


  const data =
    await response
      .json()
      .catch(
        () => ({})
      );


  if (
    !response.ok
  ) {

    throw new Error(

      data.message ||

      'Unable to load repair.'

    );

  }


  return data;

}


// ============================================================
// EDIT REPAIR
// ============================================================

async function edit(
  id
) {

  try {

    const repair =
      await getRepair(
        id
      );


    if (
      LOCKED_REPAIR_STATUSES
        .includes(
          repair.status
        )
    ) {

      alertBox(

        `Repair ${repair.repair_no || ''} is already ${repair.status} and cannot be edited.`,

        'warning'

      );


      return;

    }


    selectedRepair =
      repair;


    setValue(
      'repairId',
      repair.id
    );


    setValue(

      'repairAssetId',

      repair.db_asset_id ||

      repair.asset_id ||

      ''

    );


    setValue(
      'repairAssetSearch',
      repair.asset_code ||
      ''
    );


    setValue(
      'repairPriority',
      'Medium'
    );


    setValue(
      'repairStatus',
      repair.status ||
      'Under Repair'
    );


    setHtml(
      'repairAssetInfo',
      `

        <div
          class="
            border
            rounded
            p-2
            bg-light
          "
        >

          <div
            class="fw-semibold"
          >

            ${esc(
              repair.asset_code ||
              '—'
            )}

            —

            ${esc(
              repair.asset_name ||
              '—'
            )}

          </div>


          <div>

            ${esc(

              [

                repair.brand,

                repair.model,

                repair.serial_number

                  ? `S/N: ${repair.serial_number}`

                  : ''

              ]

                .filter(
                  Boolean
                )

                .join(
                  ' • '
                ) ||

              '—'

            )}

          </div>

        </div>

      `
    );


    setValue(

      'repairDateReported',

      localDT(
        repair.date_reported
      )

    );


    setValue(

      'repairDateReceived',

      localDT(
        repair.date_received
      )

    );


    setValue(
      'repairInitialCondition',
      repair.initial_condition ||
      'Good'
    );


    setValue(
      'repairTechnician',
      repair.technician_id ||
      ''
    );


    setValue(
      'repairVendor',
      repair.vendor ||
      ''
    );


    setValue(
      'repairWarranty',
      repair.warranty ||
      ''
    );


    setValue(
      'repairProblem',
      repair.problem_description ||
      ''
    );


    setValue(
      'repairDiagnosis',
      repair.diagnosis ||
      ''
    );


    setValue(
      'repairAction',
      repair.repair_action ||
      ''
    );


    setValue(
      'repairPartsReplaced',
      repair.parts_replaced ||
      ''
    );


    setValue(
      'repairPartsCost',
      repair.parts_cost ||
      0
    );


    setValue(
      'repairLaborCost',
      repair.labor_cost ||
      0
    );


    setValue(
      'repairRemarks',
      repair.remarks ||
      ''
    );


    setText(

      'repairModalTitle',

      `Repair Work — ${repair.repair_no || ''}`

    );


    setText(
      'saveRepairBtn',
      'Save Repair Work'
    );


    formAlert(
      ''
    );


    repairModal
      ?.show();


  } catch (error) {

    console.error(
      'EDIT REPAIR ERROR:',
      error
    );


    alertBox(

      error.message ||

      'Unable to edit repair.',

      'danger'

    );

  }

}


// ============================================================
// SIMPLE REPAIR ACTION BUTTON VISIBILITY
// ============================================================

function showRepairActionButton(
  id,
  show
) {

  const button =
    $(id);


  if (!button) {

    return;

  }


  button.classList.toggle(
    'd-none',
    !show
  );


  button.disabled =
    !show;

}


// ============================================================
// RENDER SIMPLE REPAIR ACTIONS
// ============================================================

function renderRepairActions(
  repair
) {

  const status =
    repair.status ||
    'Under Repair';


  setHtml(
    'detailCurrentStatus',
    badge(status)
  );


  [

    'resumeRepairBtn',

    'waitingForPartsBtn',

    'markRepairedBtn',

    'returnToCustodianBtn',

    'returnToInventoryBtn',

    'markBeyondRepairBtn'

  ]
    .forEach(
      id => {

        showRepairActionButton(
          id,
          false
        );

      }
    );


  const message =
    $('repairCompletedMessage');


  if (message) {

    message.classList.remove(
      'alert-warning',
      'alert-info',
      'alert-primary',
      'alert-success',
      'alert-danger'
    );

    message.classList.add(
      'alert-secondary'
    );

    message.classList.add(
      'd-none'
    );

    message.textContent =
      '';

  }


  const disposalBox =
    $('beyondRepairDisposition');


  if (disposalBox) {

    disposalBox.classList.add(
      'd-none'
    );

  }


  if (
    status === 'For Repair' ||
    status === 'Under Diagnosis'
  ) {

    showRepairActionButton(
      'resumeRepairBtn',
      true
    );


    $('resumeRepairBtn').textContent =
      '▶ Start Repair';


    showRepairActionButton(
      'markBeyondRepairBtn',
      true
    );


    if (
      status === 'For Repair' &&
      repair.disposal_status === 'Rejected' &&
      message
    ) {

      const disposalNumber =
        String(
          repair.disposal_no ||
          ''
        ).trim();


      const rejectionRemarks =
        String(
          repair.disposal_remarks ||
          ''
        ).trim();


      message.classList.remove(
        'alert-secondary'
      );


      message.classList.add(
        'alert-danger'
      );


      message.textContent =
        disposalNumber
          ? `❌ Disposal Request ${disposalNumber} was rejected.`
          : '❌ The Disposal Request was rejected.';


      if (
        rejectionRemarks
      ) {

        const reason =
          document.createElement(
            'div'
          );


        reason.className =
          'mt-1';


        reason.textContent =
          `Reason: ${rejectionRemarks}`;


        message.appendChild(
          reason
        );

      }


      message.classList.remove(
        'd-none'
      );

    }


    return;

  }


  if (
    status === 'Under Repair'
  ) {

    showRepairActionButton(
      'waitingForPartsBtn',
      true
    );


    showRepairActionButton(
      'markRepairedBtn',
      true
    );


    showRepairActionButton(
      'markBeyondRepairBtn',
      true
    );


    return;

  }


  if (
    status === 'Waiting for Parts'
  ) {

    showRepairActionButton(
      'resumeRepairBtn',
      true
    );


    $('resumeRepairBtn').textContent =
      '▶ Resume Repair';


    showRepairActionButton(
      'markBeyondRepairBtn',
      true
    );


    return;

  }


  if (
    status === 'Repaired'
  ) {

    const hasActiveCustodian =
      Number(
        repair.has_active_custodian
      ) === 1;


    showRepairActionButton(
      'returnToCustodianBtn',
      hasActiveCustodian
    );


    showRepairActionButton(
      'returnToInventoryBtn',
      true
    );


    showRepairActionButton(
      'markBeyondRepairBtn',
      true
    );


    return;

  }


  if (
    status === 'Returned'
  ) {

    if (message) {

      message.textContent =
        '✅ Repair completed and asset returned.';

      message.classList.remove(
        'd-none'
      );

    }


    return;

  }


  if (
    status === 'For Disposal'
  ) {

    const hasDisposalRequest =
      Number(
        repair.disposal_id ||
        0
      ) > 0;


    if (
      !hasDisposalRequest
    ) {

      showRepairActionButton(
        'markBeyondRepairBtn',
        true
      );


      const disposalButton =
        $('markBeyondRepairBtn');


      if (
        disposalButton
      ) {

        disposalButton.textContent =
          '📝 Create Disposal Request';

      }


      if (
        message
      ) {

        message.textContent =
          '⚠ Asset is marked For Disposal, but its Disposal Request has not been created yet.';

        message.classList.remove(
          'd-none'
        );

      }


      return;

    }


    const disposalStatus =
      String(
        repair.disposal_status ||
        ''
      ).trim();


    const disposalNumber =
      String(
        repair.disposal_no ||
        ''
      ).trim();


    const disposalLabel =
      disposalNumber
        ? ` ${disposalNumber}`
        : '';


    if (
      disposalStatus === 'Rejected'
    ) {

      showRepairActionButton(
        'markBeyondRepairBtn',
        true
      );


      const disposalButton =
        $('markBeyondRepairBtn');


      if (
        disposalButton
      ) {

        disposalButton.textContent =
          '📝 Create New Disposal Request';

      }

    }


    if (
      message
    ) {

      const rejectionRemarks =
        String(
          repair.disposal_remarks ||
          ''
        ).trim();


      const disposalMessages = {

        'Pending Approval': {
          style: 'alert-warning',
          text: `🟡 Disposal Request${disposalLabel} has been created and is awaiting IT approval.`
        },

        'IT Approved': {
          style: 'alert-info',
          text: `🔵 Disposal Request${disposalLabel} has been approved by IT and is awaiting Accounting approval.`
        },

        'Accounting Approved': {
          style: 'alert-info',
          text: `🔵 Disposal Request${disposalLabel} has been approved by Accounting and is awaiting President approval.`
        },

        'President Approved': {
          style: 'alert-primary',
          text: `🟣 Disposal Request${disposalLabel} has been approved by the President and is awaiting final IT authorization.`
        },

        'Approved for Disposal': {
          style: 'alert-success',
          text: `🟢 Disposal Request${disposalLabel} has been fully approved for disposal.`
        },

        Rejected: {
          style: 'alert-danger',
          text: `❌ Disposal Request${disposalLabel} was rejected.`
        },

        Disposed: {
          style: 'alert-success',
          text: `✅ Disposal Request${disposalLabel} has been completed and the asset has been disposed.`
        }

      };


      const disposalMessage =
        disposalMessages[
          disposalStatus
        ] || {
          style: 'alert-secondary',
          text:
            disposalStatus
              ? `Disposal Request${disposalLabel} currently has status "${disposalStatus}".`
              : `Disposal Request${disposalLabel} exists, but its current approval status is unavailable.`
        };


      message.classList.remove(
        'alert-secondary'
      );


      message.classList.add(
        disposalMessage.style
      );


      message.textContent =
        disposalMessage.text;


      if (
        disposalStatus === 'Rejected' &&
        rejectionRemarks
      ) {

        const reason =
          document.createElement(
            'div'
          );


        reason.className =
          'mt-1';


        reason.textContent =
          `Reason: ${rejectionRemarks}`;


        message.appendChild(
          reason
        );

      }


      message.classList.remove(
        'd-none'
      );

    }


    return;

  }


  if (
    status === 'Disposed'
  ) {

    if (message) {

      message.classList.remove(
        'alert-secondary'
      );


      message.classList.add(
        'alert-success'
      );


      message.textContent =
        repair.disposal_no
          ? `✅ Disposal Request ${repair.disposal_no} has been completed and the asset has been disposed.`
          : '✅ Asset has been disposed.';

      message.classList.remove(
        'd-none'
      );

    }


    return;

  }


  if (
    status === 'Cancelled'
  ) {

    if (message) {

      message.textContent =
        'This repair record was cancelled.';

      message.classList.remove(
        'd-none'
      );

    }

  }

}


// ============================================================
// DETAILS
// ============================================================

async function details(
  id
) {

  try {

    const repair =
      await getRepair(
        id
      );


    selectedRepair =
      repair;

    setText(

      'repairDetailsSubTitle',

      `${repair.asset_code || 'Asset'} — ${repair.asset_name || ''}`

    );


    setText(
      'detailRepairNo',
      repair.repair_no ||
      '—'
    );


    setText(
      'detailAssetId',
      repair.asset_code ||
      '—'
    );


    setText(
      'detailAssetName',
      repair.asset_name ||
      '—'
    );


    setHtml(

      'detailAssetStatus',

      badge(
        repair.asset_status
      )

    );


    setText(
      'detailCustodian',
      repair.custodian_name ||
      'IT Inventory'
    );


    setText(
      'detailDepartment',
      repair.department_name ||
      '—'
    );


    setText(
      'detailTechnician',
      repair.technician_name ||
      'Unassigned'
    );


    setText(

      'detailDateReported',

      dt(
        repair.date_reported
      )

    );


    setText(

      'detailDateReceived',

      dt(
        repair.date_received
      )

    );


    setText(

      'detailDateCompleted',

      dt(
        repair.date_completed
      )

    );


    setText(

      'detailTotalCost',

      peso(
        repair.total_cost
      )

    );


    setText(
      'detailProblem',
      repair.problem_description ||
      '—'
    );


    setText(
      'detailDiagnosis',
      repair.diagnosis ||
      '—'
    );


    setText(
      'detailAction',
      repair.repair_action ||
      '—'
    );


    setText(
      'detailParts',
      repair.parts_replaced ||
      '—'
    );


    setText(
      'detailRemarks',
      repair.remarks ||
      '—'
    );


    setText(
      'detailVendor',
      repair.vendor ||
      '—'
    );


    setText(
      'detailWarranty',
      repair.warranty ||
      '—'
    );


    const disposalButton =
      $('markBeyondRepairBtn');


    if (
      disposalButton
    ) {

      disposalButton.textContent =
        '⚠️ For Disposal';

    }


    renderRepairActions(
      repair
    );


    const locked =
      [
        'Returned',
        'For Disposal',
        'Disposed'
      ]
        .includes(
          repair.status
        );


    if (
      $('editRepairBtn')
    ) {

      $('editRepairBtn').disabled =
        locked;

    }


    const printButton =
      $('printRepairJobOrderBtn');


    if (
      printButton
    ) {

      printButton.disabled =
        false;

      printButton.classList.remove(
        'disabled'
      );

    }


    if (
      $('beyondRepairDisposition')
    ) {

      $('beyondRepairDisposition')
        .classList
        .add(
          'd-none'
        );

    }


    setValue(
      'detailDispositionSelect',
      'Pending Decision'
    );


    setValue(
      'disposalMethod',
      ''
    );


    setValue(
      'detailDispositionRemarks',
      ''
    );


    if (
      $('disposalMethodContainer')
    ) {

      $('disposalMethodContainer').style.display =
        'none';

    }


    detailAlert(
      ''
    );


    repairDetailsModal
      ?.show();


  } catch (error) {

    console.error(
      'DETAIL REPAIR ERROR:',
      error
    );


    alertBox(

      error.message ||

      'Unable to load repair details.',

      'danger'

    );

  }

}


// ============================================================
// CHANGE REPAIR STATUS
// ============================================================

async function changeRepairStatus(
  nextStatus,
  confirmationMessage = ''
) {

  if (
    !selectedRepair
  ) {

    return;

  }


  if (
    confirmationMessage &&
    !confirm(
      confirmationMessage
    )
  ) {

    return;

  }


  const current =
    selectedRepair;


  try {

    const completedAt =

      nextStatus === 'Repaired'

        ? (
            localDT(
              current.date_completed
            ) ||

            nowLocal()
          )

        : (
            localDT(
              current.date_completed
            ) ||

            null
          );


    const response =
      await fetch(
        `/api/repairs/${current.id}`,
        {

          method:
            'PUT',

          credentials:
            'include',

          headers: {

            'Content-Type':
              'application/json',

            'Accept':
              'application/json'

          },

          body:
            JSON.stringify({

              status:
                nextStatus,


              priority:
                'Medium',


              technician_id:
                current.technician_id ||
                null,


              date_received:
                localDT(
                  current.date_received
                ) ||
                null,


              date_completed:
                completedAt,


              diagnosis:
                current.diagnosis ||
                '',


              repair_action:
                current.repair_action ||
                '',


              parts_replaced:
                current.parts_replaced ||
                '',


              parts_cost:
                Number(
                  current.parts_cost ||
                  0
                ),


              labor_cost:
                Number(
                  current.labor_cost ||
                  0
                ),


              vendor:
                current.vendor ||
                '',


              warranty:
                current.warranty ||
                '',


              remarks:
                current.remarks ||
                ''

            })

        }
      );


    const data =
      await response
        .json()
        .catch(
          () => ({})
        );


    if (
      !response.ok
    ) {

      throw new Error(
        data.message ||
        'Unable to update repair status.'
      );

    }


    alertBox(
      data.message ||
      `Repair status changed to ${nextStatus}.`,
      'success'
    );


    await refresh();


    await details(
      current.id
    );


  } catch (error) {

    console.error(
      'CHANGE REPAIR STATUS ERROR:',
      error
    );


    detailAlert(
      error.message ||
      'Unable to update repair status.',
      'danger'
    );

  }

}


// ============================================================
// FINALIZE REPAIR
// ============================================================

async function finalize(
  disposition,
  options = {}
) {

  if (
    !selectedRepair
  ) {

    return;

  }


  const valid = [

    'custodian',

    'inventory',

    'disposal'

  ];


  if (
    !valid.includes(
      disposition
    )
  ) {

    detailAlert(
      'Invalid final disposition.',
      'danger'
    );


    return;

  }


  const canReturn =
    selectedRepair.status ===
    'Repaired';


  const canDispose =
    ACTIVE_REPAIR_STATUSES
      .includes(
        selectedRepair.status
      );


  if (
    [
      'custodian',
      'inventory'
    ]
      .includes(
        disposition
      )

    &&

    !canReturn
  ) {

    detailAlert(

      'The repair must be marked Repaired before returning the asset.',

      'warning'

    );


    return;

  }


  if (
    disposition ===
      'disposal'

    &&

    !canDispose
  ) {

    detailAlert(

      'This repair cannot be moved to For Disposal from its current status.',

      'warning'

    );


    return;

  }


  const prompts = {

    custodian:
      'Return the repaired asset to the current custodian?',


    inventory:
      'Put the repaired asset back into IT inventory as Available?',


    disposal:
      'Create a disposal request for this asset?'

  };


  if (

    !options.skipConfirm

    &&

    !confirm(
      prompts[disposition]
    )

  ) {

    return;

  }


  const payload = {

    disposition,


    disposal_method:
      options.disposal_method ||
      '',


    remarks:
      options.remarks ||
      ''

  };


  try {

    const response =
      await fetch(
        `/api/repairs/${selectedRepair.id}/finalize`,
        {

          method:
            'POST',

          credentials:
            'include',

          headers: {

            'Content-Type':
              'application/json',

            'Accept':
              'application/json'

          },

          body:
            JSON.stringify(
              payload
            )

        }
      );


    const data =
      await response
        .json()
        .catch(
          () => ({})
        );


    if (
      !response.ok
    ) {

      throw new Error(

        data.message ||

        'Unable to finalize repair.'

      );

    }


    repairDetailsModal
      ?.hide();


    alertBox(

      data.message ||

      'Repair finalized successfully.',

      'success'

    );


    await refresh();


    return data;


  } catch (error) {

    console.error(
      'FINALIZE ERROR:',
      error
    );


    detailAlert(

      error.message ||

      'Unable to finalize repair.',

      'danger'

    );


    throw error;

  }

}


// ============================================================
// REFRESH
// ============================================================

async function refresh() {

  await Promise.all(
    [

      summary(),

      loadRepairs()

    ]
  );

}


// ============================================================
// OPEN REPAIR JOB ORDER
// ============================================================

function openRepairJobOrderPage() {

  if (
    !selectedRepair ||
    !selectedRepair.id
  ) {

    detailAlert(
      'Please open a repair record first.',
      'warning'
    );

    return;
  }


  const repairId =
    Number(selectedRepair.id);


  if (!Number.isInteger(repairId) || repairId < 1) {

    detailAlert(
      'This repair record does not have a valid ID.',
      'danger'
    );

    return;
  }


  const jobOrderUrl =
    `/repair-job-order.html?id=${encodeURIComponent(repairId)}`;


  const jobOrderWindow =
    window.open(
      jobOrderUrl,
      '_blank'
    );


  if (!jobOrderWindow) {

    detailAlert(
      'The Job Order window was blocked. Please allow pop-ups for this site and try again.',
      'warning'
    );

    return;
  }


  // Prevent the printable page from controlling the Maintenance page.
  jobOrderWindow.opener = null;

}


// ============================================================
// PRINT REPAIR JOB ORDER
// SAME-PAGE PRINT VERSION
// Keeps Repair Details modal open
// A4 Portrait / One-page-friendly
// ============================================================

function printRepairJobOrder() {

  if (
    !selectedRepair ||
    !selectedRepair.id
  ) {

    detailAlert(
      'Please open a repair record first.',
      'warning'
    );

    return;
  }


  const repair =
    selectedRepair;


  console.log(
    'PRINT JOB ORDER:',
    repair
  );


  // ==========================================================
  // HELPERS
  // ==========================================================

  const value =
    v => {

      if (
        v === null ||
        v === undefined ||
        String(v).trim() === ''
      ) {

        return '—';

      }


      return esc(v);

    };


  const dateValue =
    v => {

      return v
        ? dt(v)
        : '—';

    };


  const money =
    v => peso(v);


  // ==========================================================
  // REMOVE OLD PRINT AREA
  // ==========================================================

  document
    .getElementById(
      'repairJobOrderPrintRoot'
    )
    ?.remove();


  document
    .getElementById(
      'repairJobOrderPrintStyle'
    )
    ?.remove();


  // ==========================================================
  // CREATE PRINT STYLE
  // ==========================================================

  const style =
    document.createElement(
      'style'
    );


  style.id =
    'repairJobOrderPrintStyle';


  style.textContent = `

    /* ========================================================
       REPAIR JOB ORDER PRINT
       ======================================================== */

    #repairJobOrderPrintRoot {

      display:
        none;

    }


    @page {

      size:
        A4 portrait;

      margin:
        6mm;

    }


    @media print {

      html,
      body {

        width:
          auto !important;

        height:
          auto !important;

        margin:
          0 !important;

        padding:
          0 !important;

        overflow:
          visible !important;

        background:
          #ffffff !important;

      }


      body.modal-open {

        overflow:
          visible !important;

        padding-right:
          0 !important;

      }


      body >
      *:not(
        #repairJobOrderPrintRoot
      ) {

        display:
          none !important;

      }


      #repairJobOrderPrintRoot {

        display:
          block !important;

        position:
          static !important;

        width:
          100% !important;

        margin:
          0 !important;

        padding:
          0 !important;

        background:
          #ffffff !important;

        color:
          #111111 !important;

      }


      #repairJobOrderPrintRoot * {

        box-sizing:
          border-box !important;

      }


      #repairJobOrderPrintRoot
      .job-page {

        width:
          100%;

        margin:
          0;

        padding:
          0;

        font-family:
          Arial,
          Helvetica,
          sans-serif;

        font-size:
          8px;

        line-height:
          1.2;

        color:
          #111111;

        background:
          #ffffff;

      }


      #repairJobOrderPrintRoot
      .job-header {

        display:
          flex;

        justify-content:
          space-between;

        align-items:
          flex-start;

        gap:
          6mm;

        padding-bottom:
          2.5mm;

        margin-bottom:
          2.5mm;

        border-bottom:
          2px solid #172033;

      }


      #repairJobOrderPrintRoot
      .company-name {

        font-size:
          13px;

        font-weight:
          800;

      }


      #repairJobOrderPrintRoot
      .document-title {

        margin-top:
          1mm;

        font-size:
          15px;

        font-weight:
          800;

        text-transform:
          uppercase;

      }


      #repairJobOrderPrintRoot
      .document-subtitle {

        margin-top:
          .5mm;

        font-size:
          7px;

        color:
          #555;

      }


      #repairJobOrderPrintRoot
      .job-number-box {

        width:
          48mm;

        border:
          1px solid #444;

        padding:
          2mm;

        text-align:
          center;

      }


      #repairJobOrderPrintRoot
      .small-label {

        font-size:
          6px;

        font-weight:
          700;

        color:
          #666;

        text-transform:
          uppercase;

      }


      #repairJobOrderPrintRoot
      .job-number {

        margin-top:
          1mm;

        font-size:
          10px;

        font-weight:
          800;

      }


      #repairJobOrderPrintRoot
      .summary-grid {

        display:
          grid;

        grid-template-columns:
          repeat(
            3,
            1fr
          );

        gap:
          2mm;

        margin-bottom:
          2mm;

      }


      #repairJobOrderPrintRoot
      .summary-box {

        border:
          1px solid #555;

        padding:
          1.5mm 2mm;

      }


      #repairJobOrderPrintRoot
      .summary-value {

        margin-top:
          .5mm;

        font-size:
          8px;

        font-weight:
          700;

      }


      #repairJobOrderPrintRoot
      .section {

        margin-top:
          1.4mm;

        page-break-inside:
          avoid;

        break-inside:
          avoid;

      }


      #repairJobOrderPrintRoot
      .section-title {

        padding:
          1mm 2mm;

        background:
          #172033 !important;

        color:
          #ffffff !important;

        font-size:
          7.5px;

        font-weight:
          800;

        text-transform:
          uppercase;

        -webkit-print-color-adjust:
          exact;

        print-color-adjust:
          exact;

      }


      #repairJobOrderPrintRoot
      table {

        width:
          100%;

        border-collapse:
          collapse;

        table-layout:
          fixed;

      }


      #repairJobOrderPrintRoot
      th,

      #repairJobOrderPrintRoot
      td {

        border:
          1px solid #555;

        padding:
          1mm 1.5mm;

        vertical-align:
          top;

        word-break:
          break-word;

      }


      #repairJobOrderPrintRoot
      th {

        width:
          19%;

        background:
          #f3f4f6 !important;

        font-size:
          6.5px;

        text-align:
          left;

        -webkit-print-color-adjust:
          exact;

        print-color-adjust:
          exact;

      }


      #repairJobOrderPrintRoot
      td {

        font-size:
          7.5px;

      }


      #repairJobOrderPrintRoot
      .text-box {

        min-height:
          6mm;

        border:
          1px solid #555;

        padding:
          1.2mm 1.5mm;

        white-space:
          pre-wrap;

        font-size:
          7.5px;

      }


      #repairJobOrderPrintRoot
      .cost-table
      td:last-child,

      #repairJobOrderPrintRoot
      .cost-table
      th:last-child {

        width:
          28%;

        text-align:
          right;

      }


      #repairJobOrderPrintRoot
      .total-row {

        font-weight:
          800;

        background:
          #f3f4f6 !important;

        -webkit-print-color-adjust:
          exact;

        print-color-adjust:
          exact;

      }


      #repairJobOrderPrintRoot
      .acknowledgement {

        border:
          1px solid #555;

        padding:
          1.2mm 1.5mm;

        font-size:
          7px;

      }


      #repairJobOrderPrintRoot
      .signature-section {

        width:
          65mm;

        margin:
          4mm auto 0;

        text-align:
          center;

        page-break-inside:
          avoid;

        break-inside:
          avoid;

      }


      #repairJobOrderPrintRoot
      .signature-space {

        height:
          7mm;

        border-bottom:
          1px solid #222;

      }


      #repairJobOrderPrintRoot
      .signature-role {

        margin-top:
          .8mm;

        font-size:
          7px;

        font-weight:
          800;

        text-transform:
          uppercase;

      }


      #repairJobOrderPrintRoot
      .signature-note {

        margin-top:
          .3mm;

        font-size:
          5.8px;

        color:
          #666;

      }


      #repairJobOrderPrintRoot
      .document-footer {

        margin-top:
          2.5mm;

        padding-top:
          1mm;

        border-top:
          1px solid #999;

        text-align:
          center;

        font-size:
          5.8px;

        color:
          #666;

      }

    }

  `;


  document.head.appendChild(
    style
  );


  // ==========================================================
  // CREATE PRINT ROOT
  // ==========================================================

  const root =
    document.createElement(
      'div'
    );


  root.id =
    'repairJobOrderPrintRoot';


  root.innerHTML = `

    <div class="job-page">


      <!-- ====================================================
           HEADER
           ==================================================== -->

      <div class="job-header">


        <div>

          <div class="company-name">

            Prima Fintech (Philippines) Lending Corporation

          </div>


          <div class="document-title">

            Repair Job Order / Maintenance Record

          </div>


          <div class="document-subtitle">

            IT Asset Repair and Maintenance Documentation

          </div>

        </div>


        <div class="job-number-box">

          <div class="small-label">

            Repair Job Order

          </div>


          <div class="job-number">

            ${value(
              repair.repair_no
            )}

          </div>

        </div>


      </div>


      <!-- ====================================================
           SUMMARY
           ==================================================== -->

      <div class="summary-grid">


        <div class="summary-box">

          <div class="small-label">

            Repair No.

          </div>


          <div class="summary-value">

            ${value(
              repair.repair_no
            )}

          </div>

        </div>


        <div class="summary-box">

          <div class="small-label">

            Current Status

          </div>


          <div class="summary-value">

            ${value(
              repair.status
            )}

          </div>

        </div>


        <div class="summary-box">

          <div class="small-label">

            Date Reported

          </div>


          <div class="summary-value">

            ${dateValue(
              repair.date_reported
            )}

          </div>

        </div>


      </div>


      <!-- ====================================================
           REPAIR INFORMATION
           ==================================================== -->

      <div class="section">

        <div class="section-title">

          Repair Information

        </div>


        <table>

          <tr>

            <th>
              Date Reported
            </th>

            <td>
              ${dateValue(
                repair.date_reported
              )}
            </td>


            <th>
              Date Received
            </th>

            <td>
              ${dateValue(
                repair.date_received
              )}
            </td>

          </tr>


          <tr>

            <th>
              Date Completed
            </th>

            <td>
              ${dateValue(
                repair.date_completed
              )}
            </td>


            <th>
              Technician
            </th>

            <td>
              ${value(
                repair.technician_name ||
                'Unassigned'
              )}
            </td>

          </tr>


          <tr>

            <th>
              Initial Condition
            </th>

            <td>
              ${value(
                repair.initial_condition
              )}
            </td>


            <th>
              Vendor / Repair Center
            </th>

            <td>
              ${value(
                repair.vendor
              )}
            </td>

          </tr>


          <tr>

            <th>
              Warranty
            </th>

            <td colspan="3">

              ${value(
                repair.warranty
              )}

            </td>

          </tr>

        </table>

      </div>


      <!-- ====================================================
           ASSET INFORMATION
           ==================================================== -->

      <div class="section">

        <div class="section-title">

          Asset Information

        </div>


        <table>

          <tr>

            <th>
              Asset Tag
            </th>

            <td>

              ${value(
                repair.asset_code
              )}

            </td>


            <th>
              Asset Name
            </th>

            <td>

              ${value(
                repair.asset_name
              )}

            </td>

          </tr>


          <tr>

            <th>
              Brand
            </th>

            <td>

              ${value(
                repair.brand
              )}

            </td>


            <th>
              Model
            </th>

            <td>

              ${value(
                repair.model
              )}

            </td>

          </tr>


          <tr>

            <th>
              Serial Number
            </th>

            <td>

              ${value(
                repair.serial_number
              )}

            </td>


            <th>
              Asset Status
            </th>

            <td>

              ${value(
                repair.asset_status
              )}

            </td>

          </tr>

        </table>

      </div>


      <!-- ====================================================
           CUSTODIAN
           ==================================================== -->

      <div class="section">

        <div class="section-title">

          Custodian / Accountability

        </div>


        <table>

          <tr>

            <th>
              Custodian
            </th>

            <td>

              ${value(
                repair.custodian_name ||
                'IT Inventory'
              )}

            </td>


            <th>
              Employee ID
            </th>

            <td>

              ${value(
                repair.custodian_employee_id
              )}

            </td>

          </tr>


          <tr>

            <th>
              Department
            </th>

            <td colspan="3">

              ${value(
                repair.department_name
              )}

            </td>

          </tr>

        </table>

      </div>


      <!-- ====================================================
           PROBLEM
           ==================================================== -->

      <div class="section">

        <div class="section-title">

          Problem / Issue

        </div>


        <div class="text-box">

          ${value(
            repair.problem_description
          )}

        </div>

      </div>


      <!-- ====================================================
           DIAGNOSIS
           ==================================================== -->

      <div class="section">

        <div class="section-title">

          Diagnosis

        </div>


        <div class="text-box">

          ${value(
            repair.diagnosis
          )}

        </div>

      </div>


      <!-- ====================================================
           REPAIR ACTION
           ==================================================== -->

      <div class="section">

        <div class="section-title">

          Repair Action / Work Performed

        </div>


        <div class="text-box">

          ${value(
            repair.repair_action
          )}

        </div>

      </div>


      <!-- ====================================================
           PARTS
           ==================================================== -->

      <div class="section">

        <div class="section-title">

          Parts / Materials Replaced

        </div>


        <div class="text-box">

          ${value(
            repair.parts_replaced
          )}

        </div>

      </div>


      <!-- ====================================================
           COST
           ==================================================== -->

      <div class="section">

        <div class="section-title">

          Repair Cost

        </div>


        <table class="cost-table">

          <tr>

            <th>
              Cost Description
            </th>

            <th>
              Amount
            </th>

          </tr>


          <tr>

            <td>
              Parts / Materials
            </td>

            <td>

              ${money(
                repair.parts_cost
              )}

            </td>

          </tr>


          <tr>

            <td>
              Labor / Service
            </td>

            <td>

              ${money(
                repair.labor_cost
              )}

            </td>

          </tr>


          <tr class="total-row">

            <td>
              TOTAL REPAIR COST
            </td>

            <td>

              ${money(
                repair.total_cost
              )}

            </td>

          </tr>

        </table>

      </div>


      <!-- ====================================================
           REMARKS
           ==================================================== -->

      <div class="section">

        <div class="section-title">

          Remarks / Additional Notes

        </div>


        <div class="text-box">

          ${value(
            repair.remarks
          )}

        </div>

      </div>


      <!-- ====================================================
           FINAL STATUS
           ==================================================== -->

      <div class="section">

        <div class="section-title">

          Final Status / Disposition

        </div>


        <div class="text-box">

          ${value(
            repair.status
          )}

        </div>

      </div>


      <!-- ====================================================
           ACKNOWLEDGEMENT
           ==================================================== -->

      <div class="section">

        <div class="section-title">

          Acknowledgement

        </div>


        <div class="acknowledgement">

          I acknowledge that the above IT asset was inspected,
          repaired, maintained, or otherwise processed as
          indicated in this Repair Job Order / Maintenance Record.

        </div>

      </div>


      <!-- ====================================================
           IT TECHNICIAN ONLY
           ==================================================== -->

      <div class="signature-section">

        <div class="signature-space"></div>


        <div class="signature-role">

          IT Technician

        </div>


        <div class="signature-note">

          Signature over printed name / Date

        </div>

      </div>


      <!-- ====================================================
           FOOTER
           ==================================================== -->

      <div class="document-footer">

        Prima Fintech (Philippines) Lending Corporation
        • IT Asset Management

        <br>

        Repair Job Order / Maintenance Record
        •
        ${value(
          repair.repair_no
        )}

      </div>


    </div>

  `;


  document.body.appendChild(
    root
  );


  // ==========================================================
  // TEMPORARY PDF / PRINT TITLE
  // ==========================================================

  const oldTitle =
    document.title;


  document.title =
    `${repair.repair_no || 'Repair'} Repair Job Order`;


  // ==========================================================
  // CLEANUP AFTER PRINT
  // ==========================================================

  let cleaned =
    false;


  const cleanup =
    () => {

      if (
        cleaned
      ) {

        return;

      }


      cleaned =
        true;


      root.remove();

      style.remove();


      document.title =
        oldTitle;


      window.removeEventListener(
        'afterprint',
        cleanup
      );

  };


  window.addEventListener(
    'afterprint',
    cleanup,
    {
      once:
        true
    }
  );


  // Safety cleanup if browser does not fire afterprint.
  setTimeout(
    cleanup,
    60000
  );


  // ==========================================================
  // PRINT
  // ==========================================================

  setTimeout(
    () => {

      try {

        window.focus();

        window.print();

      } catch (error) {

        console.error(
          'PRINT REPAIR JOB ORDER ERROR:',
          error
        );


        cleanup();


        detailAlert(
          error.message ||
          'Unable to print Repair Job Order.',
          'danger'
        );

      }

    },
    150
  );

}


// ============================================================
// INIT / EVENTS
// ============================================================

async function init() {

  console.log(
    'PRIMA Maintenance JS loaded.'
  );


  document
    .querySelectorAll(
      '.modal'
    )
    .forEach(
      setupModalAccessibility
    );


  restoreMaintenancePageScroll();


  if (
    $('repairModal')
  ) {

    repairModal =
      bootstrap.Modal
        .getOrCreateInstance(
          $('repairModal')
        );

  }


  if (
    $('repairDetailsModal')
  ) {

    repairDetailsModal =
      bootstrap.Modal
        .getOrCreateInstance(
          $('repairDetailsModal')
        );

  }


  $('logoutBtn')
    ?.addEventListener(
      'click',
      logout
    );


  $('newRepairBtn')
    ?.addEventListener(
      'click',
      () => {

        openNew();

      }
    );


  $('loadAssetBtn')
    ?.addEventListener(
      'click',
      findAsset
    );


  $('refreshRepairsBtn')
    ?.addEventListener(
      'click',
      refresh
    );


  $('printRepairJobOrderBtn')
    ?.addEventListener(
      'click',
      openRepairJobOrderPage
    );


  [
    'closeRepairDetailsHeaderBtn',
    'closeRepairDetailsBtn'
  ]
    .forEach(
      id => {

        $(id)
          ?.addEventListener(
            'click',
            () => {

              hideRepairDetailsModal();

            }
          );

      }
    );


  $('repairForm')
    ?.addEventListener(
      'submit',
      save
    );


  $('repairAssetSearch')
    ?.addEventListener(
      'keydown',
      event => {

        if (
          event.key ===
          'Enter'
        ) {

          event.preventDefault();

          findAsset();

        }

      }
    );


  let searchTimer =
    null;


  $('repairSearch')
    ?.addEventListener(
      'input',
      () => {

        clearTimeout(
          searchTimer
        );


        searchTimer =
          setTimeout(
            loadRepairs,
            250
          );

      }
    );


  $('repairStatusFilter')
    ?.addEventListener(
      'change',
      loadRepairs
    );


  $('clearRepairFiltersBtn')
    ?.addEventListener(
      'click',
      () => {

        setValue(
          'repairSearch',
          ''
        );


        setValue(
          'repairStatusFilter',
          ''
        );


        loadRepairs();

      }
    );


  // ==========================================================
  // SIMPLE REPAIR ACTIONS
  // ==========================================================

  $('waitingForPartsBtn')
    ?.addEventListener(
      'click',
      () => {

        changeRepairStatus(
          'Waiting for Parts',
          'Mark this repair as Waiting for Parts?'
        );

      }
    );


  $('resumeRepairBtn')
    ?.addEventListener(
      'click',
      () => {

        changeRepairStatus(
          'Under Repair',
          'Resume this repair?'
        );

      }
    );


  $('markRepairedBtn')
    ?.addEventListener(
      'click',
      () => {

        changeRepairStatus(
          'Repaired',
          'Mark this repair as completed?'
        );

      }
    );


  $('returnToCustodianBtn')
    ?.addEventListener(
      'click',
      () => {

        finalize(
          'custodian'
        )
          .catch(
            () => {}
          );

      }
    );


  $('returnToInventoryBtn')
    ?.addEventListener(
      'click',
      () => {

        finalize(
          'inventory'
        )
          .catch(
            () => {}
          );

      }
    );


  // ==========================================================
  // OPEN DISPOSAL FORM
  // ==========================================================

  $('markBeyondRepairBtn')
    ?.addEventListener(
      'click',
      () => {

        if (
          !selectedRepair
        ) {

          detailAlert(
            'No repair record selected.',
            'warning'
          );

          return;

        }


        const box =
          $('beyondRepairDisposition');


        if (!box) {

          console.error(
            'beyondRepairDisposition NOT FOUND'
          );

          return;

        }


        box.classList.remove(
          'd-none'
        );


        setValue(
          'disposalMethod',
          ''
        );


        setValue(
          'detailDispositionRemarks',
          ''
        );


        setTimeout(
          () => {

            box.scrollIntoView({
              behavior:
                'smooth',

              block:
                'nearest'
            });


            $('disposalMethod')
              ?.focus();

          },
          100
        );

      }
    );


  // ==========================================================
  // CANCEL DISPOSAL
  // ==========================================================

  $('cancelDisposalBtn')
    ?.addEventListener(
      'click',
      () => {

        const box =
          $('beyondRepairDisposition');


        if (
          box
        ) {

          box.classList.add(
            'd-none'
          );

        }


        setValue(
          'disposalMethod',
          ''
        );


        setValue(
          'detailDispositionRemarks',
          ''
        );

      }
    );


  // ==========================================================
  // CREATE DISPOSAL REQUEST
  // ==========================================================

  $('saveDispositionBtn')
    ?.addEventListener(
      'click',
      async () => {

        if (
          !selectedRepair ||
          !selectedRepair.id
        ) {

          detailAlert(
            'No repair record selected.',
            'warning'
          );

          return;

        }


        const disposalMethod =
          String(
            $('disposalMethod')
              ?.value ||
            ''
          )
            .trim();


        const remarks =
          String(
            $('detailDispositionRemarks')
              ?.value ||
            ''
          )
            .trim();


        if (
          !disposalMethod
        ) {

          detailAlert(
            'Please enter the Disposal Method.',
            'warning'
          );


          $('disposalMethod')
            ?.focus();


          return;

        }


        const confirmed =
          confirm(
            'Create a disposal request for this asset?'
          );


        if (
          !confirmed
        ) {

          return;

        }


        const button =
          $('saveDispositionBtn');


        try {

          if (button) {

            button.disabled =
              true;


            button.innerHTML = `

              <span
                class="spinner-border spinner-border-sm me-1"
              ></span>

              Creating...

            `;

          }


          const data =
            await finalize(
              'disposal',
              {

                skipConfirm:
                  true,

                disposal_method:
                  disposalMethod,

                remarks:
                  remarks

              }
            );


          if (
            data?.disposal_no
          ) {

            alertBox(
              `Disposal request ${data.disposal_no} created successfully.`,
              'success'
            );

          }


        } catch (error) {

          console.error(
            'CREATE DISPOSAL REQUEST ERROR:',
            error
          );


        } finally {

          if (button) {

            button.disabled =
              false;


            button.textContent =
              'Create Disposal Request';

          }

        }

      }
    );


  // ==========================================================
  // EDIT REPAIR
  // ==========================================================

  $('editRepairBtn')
    ?.addEventListener(
      'click',
      async () => {

        if (
          !selectedRepair
        ) {

          return;

        }


        const repairId =
          selectedRepair.id;


        await hideRepairDetailsModal();


        await edit(
          repairId
        );

      }
    );


  // ==========================================================
  // PRINT DISPOSAL APPROVAL
  // ==========================================================

  const printDisposalApprovalBtn =
    $('printDisposalApprovalBtn');


  if (
    printDisposalApprovalBtn
  ) {

    printDisposalApprovalBtn
      .addEventListener(
        'click',
        async () => {

          if (
            !selectedRepair
              ?.id
          ) {

            alert(
              'No repair record selected.'
            );


            return;

          }


          try {

            printDisposalApprovalBtn.disabled =
              true;


            printDisposalApprovalBtn.textContent =
              'Loading...';


            const repair =
              await getRepair(
                selectedRepair.id
              );


            if (
              !repair.disposal_id
            ) {

              alert(
                'No disposal request is associated with this repair.'
              );


              return;

            }


            window.open(

              `/disposal-approval.html?id=${repair.disposal_id}`,

              '_blank'

            );


          } catch (error) {

            console.error(

              'PRINT DISPOSAL APPROVAL ERROR:',

              error

            );


            alert(

              error.message ||

              'Unable to open Disposal Approval Form.'

            );


          } finally {

            printDisposalApprovalBtn.disabled =
              false;


            printDisposalApprovalBtn.textContent =
              '🖨️ Print Disposal Approval Form';

          }

        }
      );

  }


  // ==========================================================
  // INITIAL DATA
  // ==========================================================

  try {

    await me();


    await techs();


    await refresh();


    const query =
      new URLSearchParams(
        location.search
      );


    const report =
      query.get(
        'report'
      );


    const assetId =
      Number(

        query.get(
          'asset_id'
        ) ||

        0

      );


    const repairId =
      Number(

        query.get(
          'repair_id'
        ) ||

        0

      );


    if (
      report ===
        '1'

      &&

      assetId
    ) {

      await openNew(
        assetId
      );

    }


    if (
      repairId >
      0
    ) {

      await details(
        repairId
      );

    }


  } catch (error) {

    console.error(
      'MAINTENANCE INIT ERROR:',
      error
    );


    alertBox(

      error.message ||

      'Unable to load maintenance module.',

      'danger'

    );

  }

}


// ============================================================
// START
// ============================================================

document.addEventListener(
  'DOMContentLoaded',
  init
);
