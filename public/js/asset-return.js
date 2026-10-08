(function () {
  'use strict';

  const modalId = 'returnAssetModal';
  let activeRequest = null;
  let submittedResult = null;

  function getLocalDateTime() {
    const now = new Date();
    const offset = now.getTimezoneOffset();

    return new Date(
      now.getTime() - offset * 60000
    )
      .toISOString()
      .slice(0, 16);
  }

  function formatDateTime(value) {
    if (!value) return '—';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function createModal() {
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content border-0 shadow">
            <form id="returnAssetForm">
              <div class="modal-header">
                <div>
                  <h5 class="modal-title">Return Asset</h5>
                  <div class="small text-muted">
                    Return the assigned asset to Available status.
                  </div>
                </div>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>

              <div class="modal-body">
                <div id="returnAlert"></div>

                <div class="mb-3">
                  <div class="small text-muted">Asset Tag</div>
                  <div id="returnAssetId" class="fw-semibold">—</div>
                </div>

                <div class="mb-3">
                  <div class="small text-muted">Asset</div>
                  <div id="returnAssetName" class="fw-semibold">—</div>
                </div>

                <div class="row">
                  <div class="col-md-6 mb-3">
                    <div class="small text-muted">Current Custodian</div>
                    <div id="returnCustodian" class="fw-semibold">—</div>
                  </div>
                  <div class="col-md-6 mb-3">
                    <div class="small text-muted">Department</div>
                    <div id="returnDepartment" class="fw-semibold">—</div>
                  </div>
                </div>

                <div class="mb-3">
                  <div class="small text-muted">Assigned</div>
                  <div id="returnAssignedAt" class="fw-semibold">—</div>
                </div>

                <div class="mb-3">
                  <label for="returnDate" class="form-label fw-semibold">Return Date *</label>
                  <input type="datetime-local" id="returnDate" class="form-control" required>
                </div>

                <div class="mb-3">
                  <label for="returnRemarks" class="form-label fw-semibold">Remarks</label>
                  <textarea id="returnRemarks" class="form-control" rows="3"
                    placeholder="Optional return remarks..."></textarea>
                </div>
              </div>

              <div class="modal-footer">
                <button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" id="confirmReturnBtn" class="btn btn-success">
                  ↩ Return Asset
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
      `
    );
  }

  function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
      element.textContent = value || '—';
    }
  }

  function showError(message) {
    const container = document.getElementById('returnAlert');

    if (!container) return;

    container.innerHTML = '';

    if (!message) return;

    const alert = document.createElement('div');
    alert.className = 'alert alert-danger';
    alert.setAttribute('role', 'alert');
    alert.textContent = message;
    container.appendChild(alert);
  }

  function restoreSubmitButton() {
    const button = document.getElementById('confirmReturnBtn');

    if (!button) return;

    button.disabled = false;
    button.innerHTML = '↩ Return Asset';
  }

  async function submitReturn(event) {
    event.preventDefault();

    const assetId = Number(activeRequest?.assetId);

    if (!Number.isInteger(assetId) || assetId <= 0) {
      showError('No valid asset is selected.');
      return;
    }

    const button = document.getElementById('confirmReturnBtn');

    if (button?.disabled) return;

    if (button) {
      button.disabled = true;
      button.innerHTML = `
        <span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
        Returning...
      `;
    }

    showError('');

    try {
      const response = await fetch(
        `/api/assets/${assetId}/return`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            returned_at:
              document.getElementById('returnDate')?.value ||
              getLocalDateTime(),
            remarks:
              document.getElementById('returnRemarks')?.value.trim() ||
              ''
          })
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
          'Unable to return asset.'
        );
      }

      submittedResult = data;

      bootstrap.Modal
        .getOrCreateInstance(document.getElementById(modalId))
        .hide();
    } catch (error) {
      console.error('Return asset error:', error);
      showError(
        error.message ||
        'Unable to return asset.'
      );
      restoreSubmitButton();
    }
  }

  function ensureModal() {
    let modal = document.getElementById(modalId);

    if (!modal) {
      createModal();
      modal = document.getElementById(modalId);
    }

    if (modal.dataset.returnWorkflowBound !== 'true') {
      modal.dataset.returnWorkflowBound = 'true';

      document
        .getElementById('returnAssetForm')
        ?.addEventListener('submit', submitReturn);

      modal.addEventListener(
        'hidden.bs.modal',
        async () => {
          const request = activeRequest;
          const result = submittedResult;

          activeRequest = null;
          submittedResult = null;
          restoreSubmitButton();

          try {
            if (result) {
              await request?.onSuccess?.(result);
            } else {
              await request?.onCancel?.();
            }
          } catch (error) {
            console.error('Return asset callback error:', error);
          }
        }
      );
    }

    return modal;
  }

  function open(options = {}) {
    const assetId = Number(options.assetId);

    if (!Number.isInteger(assetId) || assetId <= 0) {
      throw new Error('A valid asset database ID is required.');
    }

    if (activeRequest) {
      return;
    }

    const modal = ensureModal();
    const asset = options.asset || {};

    activeRequest = {
      assetId,
      onSuccess: options.onSuccess,
      onCancel: options.onCancel
    };
    submittedResult = null;

    setText(
      'returnAssetId',
      asset.asset_id || `Asset ${assetId}`
    );
    setText(
      'returnAssetName',
      asset.asset_name || asset.name || '—'
    );
    setText(
      'returnCustodian',
      asset.custodian_name ||
        asset.employee_name ||
        asset.custodian ||
        '—'
    );
    setText(
      'returnDepartment',
      asset.department_name ||
        asset.department ||
        '—'
    );
    setText(
      'returnAssignedAt',
      formatDateTime(asset.assigned_at)
    );

    const returnDate = document.getElementById('returnDate');
    const remarks = document.getElementById('returnRemarks');

    if (returnDate) returnDate.value = getLocalDateTime();
    if (remarks) remarks.value = '';

    showError('');
    restoreSubmitButton();
    bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  window.PRIMAAssetReturn = {
    open
  };
})();
