const searchInput =
    document.getElementById('searchInput');

const statusFilter =
    document.getElementById('statusFilter');

const clearFiltersBtn =
    document.getElementById('clearFiltersBtn');

const refreshBtn =
    document.getElementById('refreshBtn');

const loadingState =
    document.getElementById('loadingState');

const emptyState =
    document.getElementById('emptyState');

const tableContainer =
    document.getElementById('tableContainer');

const disposalsTableBody =
    document.getElementById('disposalsTableBody');

const disposalDetails =
    document.getElementById('disposalDetails');

const printFromModalBtn =
    document.getElementById('printFromModalBtn');

const viewDisposalModal =
    new bootstrap.Modal(
        document.getElementById('viewDisposalModal')
    );

const createDisposalBtn =
    document.getElementById('createDisposalBtn');

const createDisposalModal =
    new bootstrap.Modal(
        document.getElementById('createDisposalModal')
    );

const eligibleAssetsBody =
    document.getElementById('eligibleAssetsBody');

const selectAllAssets =
    document.getElementById('selectAllAssets');

const selectedAssetCount =
    document.getElementById('selectedAssetCount');

const createReason =
    document.getElementById('createReason');

const createRecommendation =
    document.getElementById('createRecommendation');

const createDisposalMethod =
    document.getElementById('createDisposalMethod');

const createRemarks =
    document.getElementById('createRemarks');

const saveDisposalRequestBtn =
    document.getElementById('saveDisposalRequestBtn');


let currentDisposalId = null;


// ============================================================
// HELPERS
// ============================================================

function escapeHtml(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return '';
    }

    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

}


function safe(value) {

    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return '-';
    }

    return escapeHtml(value);

}


function formatDate(value) {

    if (!value) {
        return '-';
    }

    const date =
        new Date(value);

    if (Number.isNaN(date.getTime())) {
        return safe(value);
    }

    return date.toLocaleDateString(
        'en-PH',
        {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }
    );

}


function getStatusBadge(status) {

    let className =
        'bg-secondary';

    switch (status) {

        case 'Pending Approval':
            className = 'bg-warning text-dark';
            break;

        case 'IT Approved':
            className = 'bg-info text-dark';
            break;

       case 'Accounting Approved':
    className = 'bg-primary';
    break;

case 'President Approved':
    className = 'bg-primary text-white';
    break;

case 'Approved for Disposal':
    className = 'bg-success';
    break;

    }

    return `
        <span class="badge status-badge ${className}">
            ${safe(status)}
        </span>
    `;

}


// ============================================================
// SELECTED ASSET COUNT
// ============================================================

function getSelectedAssetIds() {

    return [
        ...document.querySelectorAll(
            '.disposal-asset-checkbox:checked'
        )
    ]
    .map(
        checkbox =>
            Number(checkbox.value)
    );

}

function updateSelectedAssetCount() {

    const selected =
        getSelectedAssetIds();

    selectedAssetCount.textContent =
        `${selected.length} selected`;

    if (selectAllAssets) {

        const checkboxes =
            document.querySelectorAll(
                '.disposal-asset-checkbox'
            );

        selectAllAssets.checked =
            checkboxes.length > 0 &&
            selected.length === checkboxes.length;

        selectAllAssets.indeterminate =
            selected.length > 0 &&
            selected.length < checkboxes.length;

    }

}


// ============================================================
// SELECT ALL
// ============================================================

selectAllAssets.addEventListener(
    'change',
    () => {

        document
            .querySelectorAll(
                '.disposal-asset-checkbox'
            )
            .forEach(
                checkbox => {

                    checkbox.checked =
                        selectAllAssets.checked;

                }
            );

        updateSelectedAssetCount();

    }
);


// ============================================================
// LOAD ELIGIBLE DISPOSAL ASSETS
// ============================================================

async function loadEligibleAssets() {

    eligibleAssetsBody.innerHTML = `

        <tr>

            <td
                colspan="7"
                class="text-center py-4"
            >

                <div
                    class="spinner-border spinner-border-sm"
                    role="status"
                ></div>

                <span class="ms-2">
                    Loading assets...
                </span>

            </td>

        </tr>

    `;

    selectAllAssets.checked =
        false;

    updateSelectedAssetCount();

    try {

        const response =
            await fetch(
                '/api/disposals/eligible-assets',
                {
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json'
                    }
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.message ||
                data.error ||
                'Unable to load eligible assets.'
            );

        }

        const assets =
            Array.isArray(data.assets)
                ? data.assets
                : [];

        if (!assets.length) {

            eligibleAssetsBody.innerHTML = `

                <tr>

                    <td
                        colspan="7"
                        class="text-center text-muted py-5"
                    >

                        <div style="font-size:35px;">
                            📦
                        </div>

                        <div class="fw-semibold mt-2">
                            No assets available for disposal
                        </div>

                        <div class="small">
                            Assets must have a status of
                            <strong>For Disposal</strong>.
                        </div>

                    </td>

                </tr>

            `;

            return;

        }

        eligibleAssetsBody.innerHTML =
            assets.map(
                asset => `

                    <tr>

                        <td>

                            <input
                                type="checkbox"
                                class="form-check-input disposal-asset-checkbox"
                                value="${Number(asset.id)}"
                            >

                        </td>

                        <td>

                            <span class="fw-semibold">
                                ${safe(asset.asset_id)}
                            </span>

                        </td>

                        <td>
                            ${safe(asset.asset_name)}
                        </td>

                        <td>
                            ${safe(asset.category_name)}
                        </td>

                        <td>

                            ${
                                safe(
                                    [
                                        asset.brand,
                                        asset.model
                                    ]
                                    .filter(Boolean)
                                    .join(' / ')
                                )
                            }

                        </td>

                        <td>
                            ${safe(asset.serial_number)}
                        </td>

                        <td>

                            <span class="badge bg-danger">
                                ${safe(asset.condition_status)}
                            </span>

                        </td>

                    </tr>

                `
            )
            .join('');

        document
            .querySelectorAll(
                '.disposal-asset-checkbox'
            )
            .forEach(
                checkbox => {

                    checkbox.addEventListener(
                        'change',
                        updateSelectedAssetCount
                    );

                }
            );

    } catch (error) {

        console.error(
            'LOAD ELIGIBLE ASSETS ERROR:',
            error
        );

        eligibleAssetsBody.innerHTML = `

            <tr>

                <td
                    colspan="7"
                    class="text-center text-danger py-4"
                >

                    ${safe(error.message)}

                </td>

            </tr>

        `;

    }

}


// ============================================================
// LOAD DISPOSALS
// ============================================================

async function loadDisposals() {

    loadingState.style.display =
        'block';

    emptyState.style.display =
        'none';

    tableContainer.style.display =
        'none';


    try {

        const params =
            new URLSearchParams();


        const search =
            searchInput.value.trim();

        const status =
            statusFilter.value;


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


        const query =
            params.toString();


        const response =
            await fetch(
                `/api/disposals${query ? `?${query}` : ''}`,
                {
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json'
                    }
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.message ||
                data.error ||
                'Unable to load disposal requests.'
            );

        }


        const disposals =
            Array.isArray(data.disposals)
                ? data.disposals
                : [];


        renderDisposals(disposals);


    } catch (error) {

        console.error(
            'LOAD DISPOSALS ERROR:',
            error
        );


        loadingState.style.display =
            'none';

        tableContainer.style.display =
            'block';

        disposalsTableBody.innerHTML = `

            <tr>

                <td
                    colspan="8"
                    class="text-center text-danger py-5"
                >

                    <div class="fw-semibold">
                        Unable to load disposal requests.
                    </div>

                    <div class="small mt-1">
                        ${safe(error.message)}
                    </div>

                </td>

            </tr>

        `;

    }

}


// ============================================================
// RENDER
// ============================================================

function renderDisposals(disposals) {

    loadingState.style.display =
        'none';


    if (!disposals.length) {

        tableContainer.style.display =
            'none';

        emptyState.style.display =
            'block';

        return;

    }


    emptyState.style.display =
        'none';

    tableContainer.style.display =
        'block';


    disposalsTableBody.innerHTML =
        disposals.map(
            disposal => {

                const assetTags =
                    disposal.asset_tags
                        ? escapeHtml(
                            disposal.asset_tags
                        )
                        : '-';


                return `

                    <tr>

                        <td class="ps-3">

                            <div class="fw-semibold">
                                ${safe(disposal.disposal_no)}
                            </div>

                        </td>


                        <td>

                            <div class="asset-tags">
                                ${assetTags}
                            </div>

                        </td>


                        <td>

                            <span class="badge bg-light text-dark border">
                                ${safe(disposal.asset_count)}
                            </span>

                        </td>


                        <td>
                            ${safe(disposal.disposal_method)}
                        </td>


                        <td>
                            ${getStatusBadge(disposal.status)}
                        </td>


                        <td>
                            ${formatDate(disposal.created_at)}
                        </td>


                        <td>
                            ${safe(disposal.created_by_name)}
                        </td>


                        <td class="text-end pe-3">

                            <div class="btn-group">

                                <button
                                    type="button"
                                    class="btn btn-sm btn-outline-primary"
                                    onclick="viewDisposal(${Number(disposal.id)})"
                                >
                                    👁️ View
                                </button>


                                <button
                                    type="button"
                                    class="btn btn-sm btn-outline-dark"
                                    onclick="printDisposal(${Number(disposal.id)})"
                                >
                                    🖨️ Print
                                </button>

                            </div>

                        </td>

                    </tr>

                `;

            }
        )
        .join('');

}


// ============================================================
// VIEW DISPOSAL
// ============================================================

async function viewDisposal(id) {

    currentDisposalId =
        Number(id);


    disposalDetails.innerHTML = `

        <div class="text-center py-5">

            <div
                class="spinner-border"
                role="status"
            ></div>

            <div class="mt-2">
                Loading disposal request...
            </div>

        </div>

    `;


    viewDisposalModal.show();


    try {

        const response =
            await fetch(
                `/api/disposals/${id}`,
                {
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json'
                    }
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.message ||
                data.error ||
                'Unable to load disposal request.'
            );

        }


        renderDisposalDetails(
            data.disposal,
            data.items || []
        );


    } catch (error) {

        console.error(
            'VIEW DISPOSAL ERROR:',
            error
        );


        disposalDetails.innerHTML = `

            <div class="alert alert-danger">
                ${safe(error.message)}
            </div>

        `;

    }

}


// ============================================================
// DISPOSAL DETAILS
// ============================================================

function renderDisposalDetails(
    disposal,
    items
) {

    let itemsHtml = '';


    // ========================================================
    // ASSET ITEMS
    // ========================================================

    if (!items.length) {

        itemsHtml = `

            <div class="alert alert-warning">
                No disposal items found.
            </div>

        `;

    } else {

        itemsHtml =
            items.map(
                (item, index) => `

                    <div class="card mb-3">

                        <div class="card-header fw-semibold">

                            Asset ${index + 1} —
                            ${safe(item.asset_tag)}

                        </div>


                        <div class="card-body">

                            <div class="row g-3">

                                <div class="col-md-6">

                                    <div class="small text-muted">
                                        Asset Name
                                    </div>

                                    <div class="fw-semibold">
                                        ${safe(item.asset_name)}
                                    </div>

                                </div>


                                <div class="col-md-6">

                                    <div class="small text-muted">
                                        Barcode
                                    </div>

                                    <div>
                                        ${safe(item.barcode)}
                                    </div>

                                </div>


                                <div class="col-md-6">

                                    <div class="small text-muted">
                                        Brand / Model
                                    </div>

                                    <div>
                                        ${
                                            safe(
                                                [
                                                    item.brand,
                                                    item.model
                                                ]
                                                .filter(Boolean)
                                                .join(' / ')
                                            )
                                        }
                                    </div>

                                </div>


                                <div class="col-md-6">

                                    <div class="small text-muted">
                                        Serial Number
                                    </div>

                                    <div>
                                        ${safe(item.serial_number)}
                                    </div>

                                </div>


                                <div class="col-md-6">

                                    <div class="small text-muted">
                                        Category
                                    </div>

                                    <div>
                                        ${safe(item.category_name)}
                                    </div>

                                </div>


                                <div class="col-md-6">

                                    <div class="small text-muted">
                                        Location
                                    </div>

                                    <div>
                                        ${safe(item.location_name)}
                                    </div>

                                </div>


                                <div class="col-md-6">

                                    <div class="small text-muted">
                                        Condition
                                    </div>

                                    <div>
                                        ${safe(item.condition_status)}
                                    </div>

                                </div>


                                <div class="col-md-6">

                                    <div class="small text-muted">
                                        Repair No.
                                    </div>

                                    <div>
                                        ${safe(item.repair_no)}
                                    </div>

                                </div>

                            </div>

                        </div>

                    </div>

                `
            )
            .join('');

    }


    // ========================================================
    // APPROVAL WORKFLOW
    // ========================================================

    let workflowHtml = '';


    // --------------------------------------------------------
    // Pending Approval
    // --------------------------------------------------------

    if (disposal.status === 'Pending Approval') {

        workflowHtml = `

            <div class="card border-warning mt-4">

                <div class="card-header bg-warning text-dark fw-bold">
                    🟡 IT Approval Required
                </div>

                <div class="card-body">

                    <p class="mb-3">
                        This disposal request is waiting for
                        IT approval.
                    </p>

                    <div class="d-flex gap-2 flex-wrap">

                        <button
                            type="button"
                            class="btn btn-success"
                            onclick="approveDisposalIT(${Number(disposal.id)})"
                        >
                            ✅ IT Approve
                        </button>

                        <button
                            type="button"
                            class="btn btn-danger"
                            onclick="rejectDisposal(${Number(disposal.id)})"
                        >
                            ❌ Reject
                        </button>

                    </div>

                </div>

            </div>

        `;

    }


    // --------------------------------------------------------
    // IT Approved
    // --------------------------------------------------------

    else if (disposal.status === 'IT Approved') {

        workflowHtml = `

            <div class="card border-info mt-4">

                <div class="card-header bg-info text-dark fw-bold">
                    🔵 Accounting Approval Required
                </div>

                <div class="card-body">

                    <div class="mb-3">

                        <label
                            for="accountingApproverName"
                            class="form-label fw-semibold"
                        >
                            Accounting Approver Name
                        </label>

                        <input
                            type="text"
                            id="accountingApproverName"
                            class="form-control"
                            placeholder="Enter Accounting approver name"
                        >

                    </div>


                    <div class="mb-3">

                        <label
                            for="accountingApprovalRemarks"
                            class="form-label fw-semibold"
                        >
                            Remarks
                        </label>

                        <textarea
                            id="accountingApprovalRemarks"
                            class="form-control"
                            rows="3"
                            placeholder="Optional remarks"
                        ></textarea>

                    </div>


                    <div class="d-flex gap-2 flex-wrap">

                        <button
                            type="button"
                            class="btn btn-success"
                            onclick="approveDisposalAccounting(${Number(disposal.id)})"
                        >
                            ✅ Accounting Approve
                        </button>

                        <button
                            type="button"
                            class="btn btn-danger"
                            onclick="rejectDisposal(${Number(disposal.id)})"
                        >
                            ❌ Reject
                        </button>

                    </div>

                </div>

            </div>

        `;

    }


    // --------------------------------------------------------
    // Accounting Approved
    // --------------------------------------------------------

    else if (disposal.status === 'Accounting Approved') {

        workflowHtml = `

            <div class="card border-primary mt-4">

                <div class="card-header bg-primary text-white fw-bold">
                    🔵 President Approval Required
                </div>

                <div class="card-body">

                    <div class="mb-3">

                        <label
                            for="presidentApproverName"
                            class="form-label fw-semibold"
                        >
                            President Approver Name
                        </label>

                        <input
                            type="text"
                            id="presidentApproverName"
                            class="form-control"
                            placeholder="Enter President approver name"
                        >

                    </div>


                    <div class="mb-3">

                        <label
                            for="presidentApprovalRemarks"
                            class="form-label fw-semibold"
                        >
                            Remarks
                        </label>

                        <textarea
                            id="presidentApprovalRemarks"
                            class="form-control"
                            rows="3"
                            placeholder="Optional remarks"
                        ></textarea>

                    </div>


                    <div class="d-flex gap-2 flex-wrap">

                        <button
                            type="button"
                            class="btn btn-success"
                            onclick="approveDisposalPresident(${Number(disposal.id)})"
                        >
                            ✅ President Approve
                        </button>

                        <button
                            type="button"
                            class="btn btn-danger"
                            onclick="rejectDisposal(${Number(disposal.id)})"
                        >
                            ❌ Reject
                        </button>

                    </div>

                </div>

            </div>

        `;

    }


    // --------------------------------------------------------
    // President Approved
    // --------------------------------------------------------

    else if (disposal.status === 'President Approved') {

        workflowHtml = `

            <div class="card border-primary mt-4">

                <div class="card-header bg-primary text-white fw-bold">
                    🟣 Final IT Authorization
                </div>

                <div class="card-body">

                    <p class="mb-3">
                        President approval has been recorded.
                        IT can now authorize the asset for actual disposal.
                    </p>

                    <div class="mb-3">

                        <label
                            for="finalDisposalRemarks"
                            class="form-label fw-semibold"
                        >
                            Final Authorization Remarks
                        </label>

                        <textarea
                            id="finalDisposalRemarks"
                            class="form-control"
                            rows="3"
                            placeholder="Optional remarks"
                        ></textarea>

                    </div>


                    <button
                        type="button"
                        class="btn btn-success"
                        onclick="approveForDisposal(${Number(disposal.id)})"
                    >
                        🟣 Approve for Disposal
                    </button>

                </div>

            </div>

        `;

    }


    // --------------------------------------------------------
    // Approved for Disposal
    // --------------------------------------------------------

    else if (disposal.status === 'Approved for Disposal') {

        workflowHtml = `

            <div class="card border-success mt-4">

                <div class="card-header bg-success text-white fw-bold">
                    🟢 Approved for Disposal
                </div>

                <div class="card-body">

                    <p class="mb-3">
                        All required approvals have been completed.
                        The assets may now be physically disposed.
                    </p>

                    <div class="mb-3">

                        <label
                            for="disposedRemarks"
                            class="form-label fw-semibold"
                        >
                            Disposal Completion Remarks
                        </label>

                        <textarea
                            id="disposedRemarks"
                            class="form-control"
                            rows="3"
                            placeholder="Enter disposal completion remarks"
                        ></textarea>

                    </div>


                    <button
                        type="button"
                        class="btn btn-dark"
                        onclick="markDisposalDisposed(${Number(disposal.id)})"
                    >
                        🗑️ Mark as Disposed
                    </button>

                </div>

            </div>

        `;

    }


    // --------------------------------------------------------
    // Disposed
    // --------------------------------------------------------

    else if (disposal.status === 'Disposed') {

        workflowHtml = `

            <div class="card border-dark mt-4">

                <div class="card-header bg-dark text-white fw-bold">
                    ⚫ Disposal Completed
                </div>

                <div class="card-body">

                    <div class="alert alert-success mb-0">

                        <strong>Completed.</strong>

                        This disposal request has been completed
                        and the associated assets are now marked
                        as <strong>Disposed</strong>.

                    </div>

                </div>

            </div>

        `;

    }


    // --------------------------------------------------------
    // Rejected
    // --------------------------------------------------------

    else if (disposal.status === 'Rejected') {

        workflowHtml = `

            <div class="card border-danger mt-4">

                <div class="card-header bg-danger text-white fw-bold">
                    ❌ Disposal Request Rejected
                </div>

                <div class="card-body">

                    <div class="alert alert-danger mb-0">

                        This disposal request has been rejected.

                    </div>

                </div>

            </div>

        `;

    }


    // ========================================================
    // APPROVAL HISTORY
    // ========================================================

    const approvalHistoryHtml = `

        <h6 class="fw-bold border-bottom pb-2 mt-4">
            Approval History
        </h6>


        <div class="row g-3">

            <div class="col-md-6">

                <div class="card h-100">

                    <div class="card-body">

                        <div class="fw-bold mb-2">
                            IT Approval
                        </div>

                        <div class="small text-muted">
                            Approved By
                        </div>

                        <div>
                            ${safe(disposal.it_approved_by_name || '-')}
                        </div>

                        <div class="small text-muted mt-2">
                            Date
                        </div>

                        <div>
                            ${formatDate(disposal.it_approved_at)}
                        </div>

                        <div class="small text-muted mt-2">
                            Remarks
                        </div>

                        <div>
                            ${safe(disposal.it_remarks)}
                        </div>

                    </div>

                </div>

            </div>


            <div class="col-md-6">

                <div class="card h-100">

                    <div class="card-body">

                        <div class="fw-bold mb-2">
                            Accounting Approval
                        </div>

                        <div class="small text-muted">
                            Approved By
                        </div>

                        <div>
                            ${safe(disposal.accounting_approved_name)}
                        </div>

                        <div class="small text-muted mt-2">
                            Date
                        </div>

                        <div>
                            ${formatDate(disposal.accounting_approved_at)}
                        </div>

                        <div class="small text-muted mt-2">
                            Remarks
                        </div>

                        <div>
                            ${safe(disposal.accounting_remarks)}
                        </div>

                    </div>

                </div>

            </div>


            <div class="col-md-6">

                <div class="card h-100">

                    <div class="card-body">

                        <div class="fw-bold mb-2">
                            President Approval
                        </div>

                        <div class="small text-muted">
                            Approved By
                        </div>

                        <div>
                            ${safe(disposal.president_approved_name)}
                        </div>

                        <div class="small text-muted mt-2">
                            Date
                        </div>

                        <div>
                            ${formatDate(disposal.president_approved_at)}
                        </div>

                        <div class="small text-muted mt-2">
                            Remarks
                        </div>

                        <div>
                            ${safe(disposal.president_remarks)}
                        </div>

                    </div>

                </div>

            </div>


            <div class="col-md-6">

                <div class="card h-100">

                    <div class="card-body">

                        <div class="fw-bold mb-2">
                            Final Disposal
                        </div>

                        <div class="small text-muted">
                            Remarks
                        </div>

                        <div>
                            ${safe(disposal.disposal_remarks)}
                        </div>

                        <div class="small text-muted mt-2">
                            Date Disposed
                        </div>

                        <div>
                            ${formatDate(disposal.disposed_at)}
                        </div>

                    </div>

                </div>

            </div>

        </div>

    `;


    // ========================================================
    // FINAL HTML
    // ========================================================

    disposalDetails.innerHTML = `

        <div class="row g-3 mb-4">

            <div class="col-md-3">

                <div class="small text-muted">
                    Disposal No.
                </div>

                <div class="fw-semibold">
                    ${safe(disposal.disposal_no)}
                </div>

            </div>


            <div class="col-md-3">

                <div class="small text-muted">
                    Status
                </div>

                <div>
                    ${getStatusBadge(disposal.status)}
                </div>

            </div>


            <div class="col-md-3">

                <div class="small text-muted">
                    Date Requested
                </div>

                <div>
                    ${formatDate(disposal.created_at)}
                </div>

            </div>


            <div class="col-md-3">

                <div class="small text-muted">
                    Created By
                </div>

                <div>
                    ${safe(disposal.created_by_name)}
                </div>

            </div>

        </div>


        <h6 class="fw-bold border-bottom pb-2">
            Assets
        </h6>

        ${itemsHtml}


        <h6 class="fw-bold border-bottom pb-2 mt-4">
            Disposal Details
        </h6>


        <div class="row g-3">

            <div class="col-md-12">

                <div class="small text-muted">
                    Reason
                </div>

                <div>
                    ${safe(disposal.reason)}
                </div>

            </div>


            <div class="col-md-12">

                <div class="small text-muted">
                    Recommendation
                </div>

                <div>
                    ${safe(disposal.recommendation)}
                </div>

            </div>


            <div class="col-md-12">

                <div class="small text-muted">
                    Disposal Method
                </div>

                <div>
                    ${safe(disposal.disposal_method)}
                </div>

            </div>

        </div>


        ${approvalHistoryHtml}

        ${workflowHtml}

    `;

}

// ============================================================
// APPROVAL API HELPER
// ============================================================

async function submitDisposalApproval(
    url,
    body = {},
    successMessage = 'Action completed successfully.'
) {

    try {

        const response =
            await fetch(
                url,
                {
                    method: 'PUT',

                    credentials: 'include',

                    headers: {
                        'Content-Type':
                            'application/json',

                        'Accept':
                            'application/json'
                    },

                    body:
                        JSON.stringify(body)
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.message ||
                data.error ||
                'Unable to complete approval action.'
            );

        }


        alert(
            data.message ||
            successMessage
        );


        await loadDisposals();


        if (currentDisposalId) {

            await viewDisposal(
                currentDisposalId
            );

        }


    } catch (error) {

        console.error(
            'DISPOSAL APPROVAL ERROR:',
            error
        );


        alert(
            error.message ||
            'Unable to complete approval action.'
        );

    }

}


// ============================================================
// IT APPROVE
// ============================================================

async function approveDisposalIT(id) {

    const remarks =
        prompt(
            'IT Approval Remarks (optional):'
        );


    if (remarks === null) {
        return;
    }


    await submitDisposalApproval(
        `/api/disposals/${Number(id)}/it-approve`,
        {
            remarks: remarks.trim()
        },
        'Disposal request approved by IT.'
    );

}


// ============================================================
// ACCOUNTING APPROVE
// ============================================================

async function approveDisposalAccounting(id) {

    const nameInput =
        document.getElementById(
            'accountingApproverName'
        );

    const remarksInput =
        document.getElementById(
            'accountingApprovalRemarks'
        );


    const approverName =
        nameInput
            ? nameInput.value.trim()
            : '';

    const remarks =
        remarksInput
            ? remarksInput.value.trim()
            : '';


    if (!approverName) {

        alert(
            'Please enter the Accounting approver name.'
        );

        if (nameInput) {
            nameInput.focus();
        }

        return;

    }


    await submitDisposalApproval(
        `/api/disposals/${Number(id)}/accounting-approve`,
        {
            approver_name:
                approverName,

            remarks:
                remarks
        },
        'Disposal request approved by Accounting.'
    );

}


// ============================================================
// PRESIDENT APPROVE
// ============================================================

async function approveDisposalPresident(id) {

    const nameInput =
        document.getElementById(
            'presidentApproverName'
        );

    const remarksInput =
        document.getElementById(
            'presidentApprovalRemarks'
        );


    const approverName =
        nameInput
            ? nameInput.value.trim()
            : '';

    const remarks =
        remarksInput
            ? remarksInput.value.trim()
            : '';


    if (!approverName) {

        alert(
            'Please enter the President approver name.'
        );

        if (nameInput) {
            nameInput.focus();
        }

        return;

    }


    await submitDisposalApproval(
        `/api/disposals/${Number(id)}/president-approve`,
        {
            approver_name:
                approverName,

            remarks:
                remarks
        },
        'Disposal request approved by President.'
    );

}


// ============================================================
// APPROVE FOR DISPOSAL
// ============================================================

async function approveForDisposal(id) {

    const remarksInput =
        document.getElementById(
            'finalDisposalRemarks'
        );

    const remarks =
        remarksInput
            ? remarksInput.value.trim()
            : '';


    if (
        !confirm(
            'Approve this request for actual disposal?'
        )
    ) {
        return;
    }


    await submitDisposalApproval(
        `/api/disposals/${Number(id)}/approve-for-disposal`,
        {
            remarks:
                remarks
        },
        'Asset approved for disposal.'
    );

}


// ============================================================
// REJECT
// ============================================================

async function rejectDisposal(id) {

    const remarks =
        prompt(
            'Please enter the reason for rejection:'
        );


    if (remarks === null) {
        return;
    }


    if (!remarks.trim()) {

        alert(
            'Rejection remarks are required.'
        );

        return;

    }


    if (
        !confirm(
            'Reject this disposal request?'
        )
    ) {
        return;
    }


    await submitDisposalApproval(
        `/api/disposals/${Number(id)}/reject`,
        {
            remarks:
                remarks.trim()
        },
        'Disposal request rejected.'
    );

}


// ============================================================
// MARK AS DISPOSED
// ============================================================

async function markDisposalDisposed(id) {

    const remarksInput =
        document.getElementById(
            'disposedRemarks'
        );

    const remarks =
        remarksInput
            ? remarksInput.value.trim()
            : '';


    if (
        !confirm(
            'Mark all assets in this disposal request as DISPOSED?\n\nThis action should only be performed after the physical disposal has been completed.'
        )
    ) {
        return;
    }


    await submitDisposalApproval(
        `/api/disposals/${Number(id)}/dispose`,
        {
            remarks:
                remarks
        },
        'Disposal request completed successfully.'
    );

}

// ============================================================
// PRINT
// ============================================================

function printDisposal(id) {

    window.open(
        `/disposal-approval.html?id=${Number(id)}`,
        '_blank'
    );

}


if (printFromModalBtn) {

    printFromModalBtn.addEventListener(
        'click',
        () => {

            if (!currentDisposalId) {
                return;
            }

            printDisposal(
                currentDisposalId
            );

        }
    );

}


// ============================================================
// OPEN CREATE DISPOSAL MODAL
// ============================================================

createDisposalBtn.addEventListener(
    'click',
    async () => {

        createReason.value =
            '';

        createRecommendation.value =
            '';

        createDisposalMethod.value =
            '';

        createRemarks.value =
            '';

        saveDisposalRequestBtn.disabled =
            false;

        saveDisposalRequestBtn.textContent =
            'Create Disposal Request';

        createDisposalModal.show();

        await loadEligibleAssets();

    }
);


// ============================================================
// CREATE DISPOSAL REQUEST
// ============================================================

saveDisposalRequestBtn.addEventListener(
    'click',
    async () => {

        const assetIds =
            getSelectedAssetIds();

        const reason =
            createReason.value.trim();

        const recommendation =
            createRecommendation.value.trim();

        const disposalMethod =
            createDisposalMethod.value.trim();

        const remarks =
            createRemarks.value.trim();

        if (!assetIds.length) {

            alert(
                'Please select at least one asset.'
            );

            return;

        }

        if (!reason) {

            alert(
                'Please enter the Reason.'
            );

            createReason.focus();

            return;

        }

        if (!recommendation) {

            alert(
                'Please enter the Recommendation.'
            );

            createRecommendation.focus();

            return;

        }

        if (!disposalMethod) {

            alert(
                'Please enter the Disposal Method.'
            );

            createDisposalMethod.focus();

            return;

        }

        try {

            saveDisposalRequestBtn.disabled =
                true;

            saveDisposalRequestBtn.textContent =
                'Creating...';

            const response =
                await fetch(
                    '/api/disposals',
                    {
                        method: 'POST',

                        credentials: 'include',

                        headers: {
                            'Content-Type':
                                'application/json',

                            'Accept':
                                'application/json'
                        },

                        body:
                            JSON.stringify({
                                asset_ids:
                                    assetIds,

                                reason:
                                    reason,

                                recommendation:
                                    recommendation,

                                disposal_method:
                                    disposalMethod,

                                remarks:
                                    remarks
                            })
                    }
                );

            const data =
                await response.json();

            if (!response.ok) {

                if (
                    data.duplicates &&
                    data.duplicates.length
                ) {

                    const duplicateText =
                        data.duplicates
                            .map(
                                item =>
                                    `${item.asset_tag} → ${item.disposal_no}`
                            )
                            .join('\n');

                    throw new Error(
                        `${data.message}\n\n${duplicateText}`
                    );

                }

                throw new Error(
                    data.message ||
                    data.error ||
                    'Failed to create disposal request.'
                );

            }

            createDisposalModal.hide();

            alert(
                `Disposal request ${data.disposal_no} created successfully.`
            );

            await loadDisposals();

            // Automatically open the approval form
            window.open(
                `/disposal-approval.html?id=${data.disposal_id}`,
                '_blank'
            );

        } catch (error) {

            console.error(
                'CREATE DISPOSAL ERROR:',
                error
            );

            alert(
                error.message ||
                'Failed to create disposal request.'
            );

        } finally {

            saveDisposalRequestBtn.disabled =
                false;

            saveDisposalRequestBtn.textContent =
                'Create Disposal Request';

        }

    }
);


// ============================================================
// FILTERS
// ============================================================

let searchTimer = null;


searchInput.addEventListener(
    'input',
    () => {

        clearTimeout(searchTimer);

        searchTimer =
            setTimeout(
                loadDisposals,
                300
            );

    }
);


statusFilter.addEventListener(
    'change',
    loadDisposals
);


clearFiltersBtn.addEventListener(
    'click',
    () => {

        searchInput.value =
            '';

        statusFilter.value =
            '';

        loadDisposals();

    }
);


refreshBtn.addEventListener(
    'click',
    loadDisposals
);


// ============================================================
// INITIAL LOAD
// ============================================================

loadDisposals();