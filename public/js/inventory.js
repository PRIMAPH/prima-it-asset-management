// PRIMA IT Asset Management - Inventory Mode Phase 1 through Phase 4
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const state = {
    sessions: [], selectedSession: null, items: [], searchResults: [],
    selectedAsset: null, locations: [], employees: [], scanner: null,
    discrepancyItems: [], selectedReviewItem: null,
    scannerRunning: false, scannerPaused: false, scannerProcessing: false,
    scannerStopping: false, scannerKeepAliveOnHide: false,
    scannerCameras: [], selectedCameraId: '', continuousScan: false,
    lastScanText: '', lastScanAt: 0, scanCooldownUntil: 0,
    feedbackTimer: null, feedbackAsset: null, audioContext: null,
    soundEnabled: false, viewModePreference: 'auto', viewMode: 'desktop',
    socket: null, socketSessionId: null, liveActivity: [],
    liveRefreshTimer: null, itemSearchTimer: null,
    discrepancySearchTimer: null, activeTab: 'active'
  };
  const allowedMethods = new Set([
    'QR', 'Barcode', 'Asset Tag', 'Serial Number', 'Manual Search'
  ]);

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

  function formatDateTime(value, fallback = '—') {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function statusBadge(status) {
    const styles = {
      Draft: 'text-bg-secondary', 'In Progress': 'text-bg-primary',
      Completed: 'text-bg-success', Cancelled: 'text-bg-dark',
      Verified: 'text-bg-success', 'Wrong Location': 'text-bg-warning',
      'Wrong Custodian': 'text-bg-danger', 'Condition Changed': 'text-bg-warning',
      'Label Damaged': 'text-bg-info', Missing: 'text-bg-danger',
      'Not Yet Checked': 'text-bg-secondary',
      'Pending Review': 'text-bg-secondary', Reviewed: 'text-bg-info',
      'Action Required': 'text-bg-warning', Resolved: 'text-bg-success',
      'No Change Required': 'text-bg-primary'
    };
    return `<span class="badge ${styles[status] || 'text-bg-secondary'}">${esc(status || 'Unknown')}</span>`;
  }

  function showMessage(message, type = 'success', options = {}) {
    const container = $('inventoryAlertBox');
    if (!container) return;
    if (window.PRIMAAlerts?.show) {
      window.PRIMAAlerts.show(container, message, {
        type, duration: options.duration ?? (type === 'danger' ? 7000 : 4500)
      });
      return;
    }
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    container.replaceChildren(alert);
  }

  function readPreference(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
  }

  function savePreference(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function detectInventoryViewMode() {
    if (state.viewModePreference === 'mobile') return 'mobile';
    if (state.viewModePreference === 'desktop') return 'desktop';

    const smallViewport = window.matchMedia('(max-width: 767.98px)').matches;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const touchCapable = Number(navigator.maxTouchPoints || 0) > 0;
    const width = window.innerWidth || document.documentElement.clientWidth;

    return smallViewport || (coarsePointer && width <= 1100) || (touchCapable && width <= 900)
      ? 'mobile'
      : 'desktop';
  }

  function applyInventoryViewMode() {
    state.viewMode = detectInventoryViewMode();
    document.body.classList.toggle('inventory-mobile', state.viewMode === 'mobile');
    document.body.classList.toggle('inventory-desktop', state.viewMode === 'desktop');
    document.body.dataset.inventoryCamera = navigator.mediaDevices?.getUserMedia
      ? 'available'
      : 'unavailable';
    if ($('inventoryViewMode')) $('inventoryViewMode').value = state.viewModePreference;
  }

  function setInventoryConnectionStatus(status, label) {
    const element = $('inventoryConnectionStatus');
    if (!element) return;
    const normalized = ['live', 'connecting', 'offline'].includes(status)
      ? status
      : 'offline';
    element.className = `inventory-connection is-${normalized}`;
    element.innerHTML = `<span aria-hidden="true"></span>${esc(label || ({
      live: 'Live', connecting: 'Reconnecting', offline: 'Offline'
    }[normalized]))}`;
  }

  function unlockInventorySound() {
    if (!state.soundEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      state.audioContext ||= new AudioContext();
      if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(() => {});
    } catch (_) {}
  }

  function playScanSound(type) {
    if (!state.soundEnabled || !state.audioContext) return;
    try {
      const context = state.audioContext;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const frequency = type === 'success' ? 880 : type === 'duplicate' ? 360 : 520;
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      oscillator.type = 'sine';
      gain.gain.setValueAtTime(.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.055, context.currentTime + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .13);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + .14);
    } catch (_) {}
  }

  function vibrateScanResult(type) {
    if (typeof navigator.vibrate !== 'function') return;
    const patterns = {
      success: 80,
      warning: [150, 60, 150],
      duplicate: [80, 50, 80]
    };
    try { navigator.vibrate(patterns[type] || 60); } catch (_) {}
  }

  function hideScanFeedback() {
    window.clearTimeout(state.feedbackTimer);
    state.feedbackTimer = null;
    $('inventoryScanFeedback')?.classList.add('d-none');
  }

  function showScanFeedback(type, asset, detail = '', options = {}) {
    const overlay = $('inventoryScanFeedback');
    if (!overlay) return;
    const values = {
      success: ['✓', 'VERIFIED'],
      warning: ['⚠', 'VERIFIED WITH ISSUES'],
      duplicate: ['⚠', 'ALREADY VERIFIED']
    }[type] || ['✓', 'VERIFIED'];
    state.feedbackAsset = asset || null;
    overlay.className = `inventory-scan-feedback is-${type}`;
    $('inventoryScanFeedbackIcon').textContent = values[0];
    $('inventoryScanFeedbackTitle').textContent = values[1];
    $('inventoryScanFeedbackAsset').textContent = asset
      ? `${display(asset.asset_id, '')}${asset.asset_name ? ` · ${asset.asset_name}` : ''}`
      : '';
    $('inventoryScanFeedbackDetail').textContent = detail;
    $('inventoryScanFeedbackViewBtn')?.classList.toggle('d-none', !options.allowView);
    playScanSound(type);
    vibrateScanResult(type);
    window.clearTimeout(state.feedbackTimer);
    if (options.autoDismiss !== false) {
      state.feedbackTimer = window.setTimeout(() => {
        continueContinuousScanning();
      }, Number(options.duration || 1800));
    }
  }

  function addLiveActivity(message, occurredAt = new Date().toISOString()) {
    state.liveActivity.unshift({ message, occurredAt });
    state.liveActivity = state.liveActivity.slice(0, 8);
    const list = $('inventoryLiveActivityList');
    if (!list) return;
    list.innerHTML = state.liveActivity.map(entry => `<li><time>${esc(formatDateTime(entry.occurredAt))}</time>${esc(entry.message)}</li>`).join('');
  }

  async function refreshInventoryLiveState() {
    const sessionId = state.selectedSession?.id;
    if (!sessionId) return;
    const data = await request(`/api/inventory/sessions/${sessionId}`);
    state.selectedSession = data.session;
    renderActiveSession({ preserveSelection: true });
    await Promise.all([
      loadItems(),
      state.activeTab === 'discrepancies' ? loadDiscrepancies() : Promise.resolve()
    ]);
    if (state.selectedSession.status === 'Completed') {
      await stopInventoryScanner();
      hideScanFeedback();
    }
  }

  function scheduleLiveRefresh() {
    window.clearTimeout(state.liveRefreshTimer);
    state.liveRefreshTimer = window.setTimeout(() => {
      refreshInventoryLiveState().catch(error => showMessage(error.message, 'danger'));
    }, 120);
  }

  function joinInventorySocketRoom(sessionId) {
    if (!state.socket?.connected || !sessionId) return;
    state.socket.emit('inventory:join', { session_id: Number(sessionId) }, response => {
      if (!response?.ok) setInventoryConnectionStatus('offline', 'Live unavailable');
      else state.socketSessionId = Number(sessionId);
    });
  }

  function initializeInventorySocket() {
    if (typeof window.io !== 'function') {
      setInventoryConnectionStatus('offline', 'Live unavailable');
      return;
    }

    const socket = window.io({ transports: ['websocket', 'polling'] });
    state.socket = socket;
    setInventoryConnectionStatus('connecting', 'Connecting');

    socket.on('connect', () => {
      setInventoryConnectionStatus('live', 'Live');
      if (state.selectedSession?.id) {
        joinInventorySocketRoom(state.selectedSession.id);
        refreshInventoryLiveState().catch(() => {});
      }
    });
    socket.io.on('reconnect_attempt', () => setInventoryConnectionStatus('connecting', 'Reconnecting'));
    socket.on('disconnect', () => setInventoryConnectionStatus('offline', 'Offline'));
    socket.on('connect_error', () => setInventoryConnectionStatus('connecting', 'Reconnecting'));

    const liveEvents = [
      'inventory:session-started',
      'inventory:item-verified',
      'inventory:verification-updated',
      'inventory:discrepancy-reviewed',
      'inventory:session-completed'
    ];
    liveEvents.forEach(eventName => socket.on(eventName, payload => {
      if (Number(payload?.session_id) !== Number(state.selectedSession?.id)) return;
      if (payload.session) Object.assign(state.selectedSession, payload.session);
      if (payload.summary) {
        Object.assign(state.selectedSession, payload.summary);
        applySummary(payload.summary);
      }
      const knownSession = state.sessions.find(
        session => Number(session.id) === Number(payload.session_id)
      );
      if (knownSession) {
        if (payload.session) Object.assign(knownSession, payload.session);
        if (payload.summary) Object.assign(knownSession, payload.summary);
      }
      if (eventName === 'inventory:session-completed') {
        renderActiveSession({ preserveSelection: true });
        stopInventoryScanner().finally(() => {
          document.activeElement?.blur();
          bootstrap.Modal.getInstance($('inventoryScannerModal'))?.hide();
        });
        hideScanFeedback();
      }
      const item = payload.item;
      const actor = payload.actor_name || 'Another user';
      const activity = eventName === 'inventory:session-completed'
        ? `${actor} completed this inventory.`
        : eventName === 'inventory:discrepancy-reviewed'
          ? `${payload.asset_id || 'Asset'} reviewed by ${actor}.`
          : item
            ? `${item.asset_id} ${eventName.includes('updated') ? 'updated' : 'verified'} by ${actor}.`
            : `${actor} updated this inventory.`;
      addLiveActivity(activity, payload.occurred_at);
      scheduleLiveRefresh();
    }));
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin', ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.assign(`/?session=expired&returnTo=${encodeURIComponent(location.pathname)}`);
      throw new Error('Login required.');
    }
    if (!response.ok) {
      const error = new Error(data.message || 'The request could not be completed.');
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function setButtonBusy(button, busy, busyText, normalHtml) {
    if (!button) return;
    button.disabled = busy;
    button.innerHTML = busy
      ? `<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>${esc(busyText)}`
      : normalHtml;
  }

  function addOptions(select, records, placeholder, labelBuilder) {
    if (!select) return;
    select.replaceChildren(new Option(placeholder, ''));
    records.forEach(record => select.add(new Option(labelBuilder(record), record.id)));
  }

  async function loadReferenceData() {
    const [departments, locations, categories, activeEmployees, employees] = await Promise.all([
      request('/api/departments'), request('/api/locations'),
      request('/api/asset-categories'), request('/api/employees?status=active'),
      request('/api/employees')
    ]);
    state.locations = Array.isArray(locations) ? locations : [];
    state.employees = Array.isArray(employees) ? employees : [];
    addOptions($('inventoryDepartmentId'), departments, 'Select department', item => item.name);
    addOptions($('inventoryLocationId'), state.locations, 'Select location', item => item.name);
    addOptions($('inventoryCategoryId'), categories, 'Select category', item => item.name);
    addOptions(
      $('inventoryEmployeeId'), activeEmployees, 'Select custodian',
      item => `${item.full_name} (${item.employee_id})${item.department_name ? ` · ${item.department_name}` : ''}`
    );
    addOptions(
      $('actualInventoryLocation'), state.locations,
      'Unknown / No recorded location', item => item.name
    );
    addOptions(
      $('actualInventoryCustodian'), state.employees,
      'IT Inventory / Unassigned',
      item => `${item.full_name} (${item.employee_id})${item.department_name ? ` · ${item.department_name}` : ''}`
    );
  }

  const scopeFields = {
    Department: ['inventoryDepartmentField', 'inventoryDepartmentId'],
    Location: ['inventoryLocationField', 'inventoryLocationId'],
    Category: ['inventoryCategoryField', 'inventoryCategoryId'],
    Custodian: ['inventoryCustodianField', 'inventoryEmployeeId']
  };

  function updateScopeFields() {
    const scope = $('inventoryScopeType')?.value || 'All Assets';
    Object.entries(scopeFields).forEach(([name, [wrapperId, controlId]]) => {
      const active = scope === name;
      $(wrapperId)?.classList.toggle('d-none', !active);
      const control = $(controlId);
      if (control) {
        control.disabled = !active;
        control.required = active;
        if (!active) control.value = '';
      }
    });
  }

  function renderSessions() {
    const body = $('inventorySessionsBody');
    if (!body) return;
    const search = String($('inventoryHistorySearch')?.value || '').trim().toLowerCase();
    const status = $('inventoryHistoryStatus')?.value || '';
    const sessions = state.sessions.filter(session => {
      if (status && session.status !== status) return false;
      if (!search) return true;
      return [
        session.inventory_no,
        session.name,
        session.scope_type,
        session.scope_description,
        session.started_by_name,
        session.created_by_name
      ].some(value => String(value || '').toLowerCase().includes(search));
    });
    $('inventorySessionCount').textContent = `${sessions.length} of ${state.sessions.length} session${state.sessions.length === 1 ? '' : 's'}`;
    if (!sessions.length) {
      body.innerHTML = '<tr><td colspan="14" class="text-center text-muted py-4">No inventory sessions match the current filters.</td></tr>';
      return;
    }
    body.innerHTML = sessions.map(session => {
      const progress = Number(session.progress_percentage ?? session.progress_percent ?? 0);
      const active = Number(state.selectedSession?.id) === Number(session.id);
      return `<tr class="${active ? 'inventory-session-active' : ''}">
        <td class="fw-semibold">${esc(session.inventory_no)}</td>
        <td><div class="fw-semibold">${esc(session.name)}</div><div class="small text-muted">Created by ${esc(session.created_by_name || 'Unknown')}</div></td>
        <td><div>${esc(session.scope_type)}</div><div class="small text-muted">${esc(session.scope_description || 'All Assets')}</div></td>
        <td>${statusBadge(session.status)}</td>
        <td>${esc(display(session.started_by_name, 'Not started'))}</td>
        <td>${esc(formatDateTime(session.started_at))}</td>
        <td>${esc(formatDateTime(session.completed_at))}</td>
        <td>${Number(session.expected_assets || 0).toLocaleString()}</td>
        <td>${Number(session.checked_assets || 0).toLocaleString()}</td>
        <td>${Number(session.verified_assets || 0).toLocaleString()}</td>
        <td>${Number(session.discrepancies || 0).toLocaleString()}</td>
        <td>${Number(session.missing || 0).toLocaleString()}</td>
        <td><div class="small">${progress}%</div><div class="progress inventory-session-progress" aria-hidden="true"><div class="progress-bar" style="width:${progress}%"></div></div></td>
        <td class="text-end text-nowrap"><button type="button" class="btn btn-outline-primary btn-sm" data-open-session="${session.id}">View</button>${session.status === 'Draft' ? `<button type="button" class="btn btn-success btn-sm ms-1" data-start-session="${session.id}">Start</button>` : `<button type="button" class="btn btn-outline-secondary btn-sm ms-1" data-print-session="${session.id}" title="Print inventory report"><i class="bi bi-printer" aria-hidden="true"></i></button><button type="button" class="btn btn-outline-success btn-sm ms-1" data-export-session="${session.id}" title="Export Excel"><i class="bi bi-file-earmark-excel" aria-hidden="true"></i></button>`}</td>
      </tr>`;
    }).join('');
  }

  async function loadSessions() {
    const data = await request('/api/inventory/sessions');
    state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    renderSessions();
    return state.sessions;
  }

  function selectInventoryTab(tabName) {
    const allowed = new Set(['active', 'history', 'discrepancies']);
    const tab = allowed.has(tabName) ? tabName : 'active';
    state.activeTab = tab;
    document.querySelectorAll('[data-inventory-panel]').forEach(panel => {
      panel.classList.toggle('d-none', panel.dataset.inventoryPanel !== tab);
    });
    document.querySelectorAll('[data-inventory-tab]').forEach(button => {
      const active = button.dataset.inventoryTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    if (tab === 'discrepancies') {
      loadDiscrepancies().catch(error => showMessage(error.message, 'danger'));
    }
  }

  function openInventoryReport(sessionId, discrepancy = false) {
    const id = Number(sessionId || state.selectedSession?.id);
    if (!id) {
      showMessage('Select an inventory session first.', 'warning');
      return;
    }
    const route = discrepancy
      ? '/inventory-discrepancy-report'
      : '/inventory-report';
    window.open(`${route}?id=${id}`, '_blank', 'noopener');
  }

  function exportInventory(sessionId) {
    const id = Number(sessionId || state.selectedSession?.id);
    if (!id) {
      showMessage('Select an inventory session first.', 'warning');
      return;
    }
    location.assign(`/api/inventory/sessions/${id}/export`);
  }

  function applySummary(summary) {
    const expected = Number(summary?.expected_assets || 0);
    const checked = Number(summary?.checked_assets || 0);
    const verified = Number(summary?.verified ?? summary?.verified_assets ?? 0);
    const unchecked = Number(summary?.not_yet_checked ?? Math.max(0, expected - checked));
    const progress = Number(summary?.progress_percentage ?? summary?.progress_percent ?? 0);
    const values = {
      inventoryExpectedCount: expected, inventoryCheckedCount: checked,
      inventoryVerifiedCount: verified,
      inventoryDiscrepancyCount: Number(summary?.discrepancies || 0),
      inventoryMissingCount: Number(summary?.missing || 0),
      inventoryUncheckedCount: unchecked,
      inventoryWrongLocationCount: Number(summary?.wrong_location || 0),
      inventoryWrongCustodianCount: Number(summary?.wrong_custodian || 0),
      inventoryConditionChangedCount: Number(summary?.condition_changed || 0),
      inventoryLabelIssueCount: Number(summary?.label_issues || 0)
    };
    Object.entries(values).forEach(([id, value]) => {
      if ($(id)) $(id).textContent = value.toLocaleString();
    });
    $('inventoryProgressValue').textContent = `${progress}%`;
    $('inventoryProgressCaption').textContent = `${checked.toLocaleString()} of ${expected.toLocaleString()} checked`;
    const bar = $('inventoryProgressBar');
    if (bar) {
      const bounded = Math.max(0, Math.min(100, progress));
      bar.style.width = `${bounded}%`;
      bar.textContent = progress > 8 ? `${progress}%` : '';
      bar.closest('.progress')?.setAttribute('aria-valuenow', String(progress));
    }
    const mobileValues = {
      mobileInventoryExpected: expected,
      mobileInventoryChecked: checked,
      mobileInventoryDiscrepancies: Number(summary?.discrepancies || 0),
      mobileInventoryRemaining: unchecked,
      mobileInventoryProgress: `${progress}%`
    };
    Object.entries(mobileValues).forEach(([id, value]) => {
      if ($(id)) $(id).textContent = typeof value === 'number' ? value.toLocaleString() : value;
    });
    const mobileBar = $('mobileInventoryProgressBar');
    if (mobileBar) {
      mobileBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
      mobileBar.closest('.progress')?.setAttribute('aria-valuenow', String(progress));
    }
  }

  function setVerificationFormReadOnly(readOnly) {
    ['actualInventoryLocation', 'actualInventoryCustodian', 'actualInventoryCondition',
      'inventoryLabelCondition', 'inventoryVerificationRemarks'].forEach(id => {
      if ($(id)) $(id).disabled = readOnly;
    });
    $('verifyInventoryAssetBtn')?.classList.toggle('d-none', readOnly);
  }

  function renderActiveSession(options = {}) {
    const session = state.selectedSession;
    if (!session) return;
    $('inventoryEmptyState').classList.add('d-none');
    $('activeInventorySection').classList.remove('d-none');
    $('activeInventoryNo').textContent = session.inventory_no;
    $('activeInventoryTitle').textContent = session.name;
    $('activeInventoryName').textContent = session.name;
    $('activeInventoryScopeText').textContent = `${session.scope_type}: ${session.scope_description || 'All Assets'}`;
    $('activeInventoryScope').textContent = `${session.scope_type} · ${session.scope_description || 'All Assets'}`;
    $('activeInventoryStartedBy').textContent = display(session.started_by_name, 'Not started');
    $('activeInventoryStartedAt').textContent = formatDateTime(session.started_at, 'Not started');
    $('activeInventoryCompletedAt').textContent = formatDateTime(session.completed_at, 'Not completed');
    $('activeInventoryRemarks').textContent = display(session.remarks);
    const badge = $('activeInventoryStatus');
    badge.className = `badge ${{ Draft: 'text-bg-secondary', 'In Progress': 'text-bg-primary', Completed: 'text-bg-success', Cancelled: 'text-bg-dark' }[session.status] || 'text-bg-secondary'}`;
    badge.textContent = session.status;
    if ($('mobileInventoryNo')) $('mobileInventoryNo').textContent = session.inventory_no;
    if ($('mobileInventoryStatus')) $('mobileInventoryStatus').textContent = session.status;
    const isDraft = session.status === 'Draft';
    const inProgress = session.status === 'In Progress';
    const completed = session.status === 'Completed';
    $('startInventoryBtn').classList.toggle('d-none', !isDraft);
    $('completeInventoryBtn').classList.toggle('d-none', !inProgress);
    $('printInventoryBtn').classList.toggle('d-none', isDraft);
    $('exportInventoryBtn').classList.toggle('d-none', isDraft);
    $('inventoryDraftNotice').classList.toggle('d-none', !isDraft);
    $('inventoryCompletedNotice').classList.toggle('d-none', !completed);
    $('inventorySearchControls').classList.toggle('inventory-controls-disabled', !inProgress);
    $('inventoryAssetSearch').disabled = !inProgress;
    $('searchInventoryAssetBtn').disabled = !inProgress;
    $('inventoryScanBtn').disabled = !inProgress;
    setVerificationFormReadOnly(!inProgress);
    applySummary(session);
    $('inventoryTabIssueCount').textContent = Number(
      Number(session.discrepancies || 0) + Number(session.missing || 0)
    ).toLocaleString();
    $('inventoryDiscrepancySessionText').textContent =
      `${session.inventory_no} · ${session.name}`;
    $('printDiscrepancyReportBtn').disabled = isDraft;
    $('exportDiscrepancyBtn').disabled = isDraft;
    if (!options.preserveSelection) clearSelectedAsset();
    renderSessions();
  }

  async function openSession(id) {
    const sessionId = Number(id);
    if (!sessionId) return;
    const data = await request(`/api/inventory/sessions/${sessionId}`);
    state.selectedSession = data.session;
    renderActiveSession();
    await Promise.all([loadItems(), loadDiscrepancies()]);
    joinInventorySocketRoom(sessionId);
    $('activeInventorySection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function startSession(id = state.selectedSession?.id) {
    const sessionId = Number(id);
    const known = state.sessions.find(session => Number(session.id) === sessionId) || state.selectedSession;
    if (!sessionId || !confirm(`Start ${known?.inventory_no || 'this inventory'}?\n\nThe expected asset list will be frozen at this point.`)) return;
    const button = $('startInventoryBtn');
    setButtonBusy(button, true, 'Starting...', '<i class="bi bi-play-fill me-1" aria-hidden="true"></i>Start Inventory');
    try {
      const data = await request(`/api/inventory/sessions/${sessionId}/start`, { method: 'POST' });
      showMessage(data.message || 'Inventory session started.');
      await loadSessions();
      await openSession(sessionId);
      selectInventoryTab('active');
      $('inventoryAssetSearch').focus();
    } catch (error) {
      showMessage(error.message, 'danger');
    } finally {
      setButtonBusy(button, false, '', '<i class="bi bi-play-fill me-1" aria-hidden="true"></i>Start Inventory');
    }
  }

  function issueList(asset) {
    if (asset?.verification_status === 'Missing') return ['Missing'];
    if (Array.isArray(asset?.issues)) return asset.issues;
    const issues = [];
    if (Number(asset?.custodian_mismatch || 0)) issues.push('Wrong Custodian');
    if (Number(asset?.location_mismatch || 0)) issues.push('Wrong Location');
    if (Number(asset?.condition_mismatch || 0)) issues.push('Condition Changed');
    if (Number(asset?.label_issue || 0)) issues.push(asset.label_condition || 'Label Damaged');
    return issues;
  }

  function itemToSelectedAsset(item) {
    return {
      ...item,
      asset_database_id: item.asset_database_id || item.asset_id_database,
      matched_by: item.verification_method || 'Manual Search',
      exact_match: true
    };
  }

  function stackedValue(expected, actual, actualFallback = 'Not recorded') {
    return `<div class="inventory-stack"><span><small>Expected</small>${esc(display(expected))}</span><span><small>Actual</small>${esc(display(actual, actualFallback))}</span></div>`;
  }

  function itemActionButtons(
    item,
    index,
    { includeReview = false, primaryLabel = 'View' } = {}
  ) {
    const buttons = [
      `<button type="button" class="btn btn-outline-primary btn-sm" data-select-item="${index}">${esc(primaryLabel)}</button>`,
      `<button type="button" class="btn btn-outline-secondary btn-sm" data-view-live-asset="${item.asset_database_id}"><i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i>Asset</button>`
    ];
    if (Number(item.label_issue || 0)) {
      buttons.push(`<button type="button" class="btn btn-outline-info btn-sm" data-reprint-label="${index}"><i class="bi bi-upc-scan me-1" aria-hidden="true"></i>Reprint Label</button>`);
    }
    if (Number(item.condition_mismatch || 0) || item.actual_condition === 'Damaged') {
      buttons.push(`<button type="button" class="btn btn-outline-warning btn-sm" data-report-problem="${item.asset_database_id}"><i class="bi bi-tools me-1" aria-hidden="true"></i>Report Problem</button>`);
    }
    if (includeReview) {
      buttons.push(`<button type="button" class="btn btn-primary btn-sm" data-review-item="${index}"><i class="bi bi-clipboard-check me-1" aria-hidden="true"></i>Review</button>`);
    }
    return `<div class="inventory-action-group">${buttons.join('')}</div>`;
  }

  function renderMobileItems(message = '') {
    const container = $('inventoryItemsMobile');
    if (!container) return;
    if (!state.items.length) {
      container.innerHTML = `<div class="text-center text-muted small py-4">${esc(message || 'No assets match the current filters.')}</div>`;
      return;
    }
    const editable = state.selectedSession?.status === 'In Progress';
    container.innerHTML = state.items.map((item, index) => {
      const issues = issueList(item);
      const missing = item.verification_status === 'Missing';
      return `<article class="inventory-mobile-item">
        <div class="inventory-mobile-item-head">
          <div><button type="button" class="inventory-status-button inventory-mobile-item-title" data-select-item="${index}">${esc(item.asset_id)}</button><div class="inventory-mobile-item-name">${esc(item.asset_name)}</div></div>
          ${statusBadge(item.verification_status)}
        </div>
        ${issues.length ? `<div class="inventory-issue-badges mt-2">${issues.map(issue => `<span class="inventory-issue-badge">${esc(issue)}</span>`).join('')}</div>` : ''}
        <dl>
          <div><dt>Custodian</dt><dd>${esc(missing ? 'Not located' : display(item.actual_custodian_name, item.expected_custodian_name || 'IT Inventory / Unassigned'))}</dd></div>
          <div><dt>Location</dt><dd>${esc(missing ? 'Not located' : display(item.actual_location_name, item.expected_location_name))}</dd></div>
          <div><dt>Condition</dt><dd>${esc(missing ? 'Not located' : display(item.actual_condition, item.expected_condition))}</dd></div>
          <div><dt>Checked</dt><dd>${esc(formatDateTime(item.verified_at || item.missing_marked_at))}</dd></div>
        </dl>
        ${itemActionButtons(item, index, { primaryLabel: editable && item.verification_status !== 'Not Yet Checked' ? 'Edit' : 'View' })}
      </article>`;
    }).join('');
  }

  function renderItems() {
    const body = $('inventoryItemsBody');
    if (!body) return;
    $('inventoryItemsCount').textContent = `${state.items.length} asset${state.items.length === 1 ? '' : 's'} shown`;
    if (!state.items.length) {
      const message = state.selectedSession?.status === 'Draft'
        ? 'Start this session to create its expected asset snapshot.'
        : 'No assets match the current item filters.';
      body.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">${esc(message)}</td></tr>`;
      renderMobileItems(message);
      return;
    }

    const editable = state.selectedSession?.status === 'In Progress';
    body.innerHTML = state.items.map((item, index) => {
      const issues = issueList(item);
      const missing = item.verification_status === 'Missing';
      const checkedAt = item.verified_at || item.missing_marked_at;
      const checkedBy = missing ? 'System completion' : display(item.verified_by_name);
      return `<tr>
        <td><button type="button" class="inventory-status-button" data-select-item="${index}">${esc(item.asset_id)}</button></td>
        <td><div class="fw-semibold">${esc(item.asset_name)}</div><div class="small text-muted">${esc([item.brand, item.model].filter(Boolean).join(' ') || '—')}</div></td>
        <td>${stackedValue(item.expected_custodian_name || 'IT Inventory / Unassigned', item.actual_custodian_name || (item.actual_employee_id ? 'Unknown employee' : ''), missing ? 'Not located' : 'IT Inventory / Unassigned')}</td>
        <td>${stackedValue(item.expected_location_name, item.actual_location_name, missing ? 'Not located' : 'Unknown')}</td>
        <td>${stackedValue(item.expected_condition, item.actual_condition, missing ? 'Not located' : 'Not recorded')}</td>
        <td>${esc(display(item.label_condition, item.verification_status === 'Not Yet Checked' ? 'Not checked' : '—'))}</td>
        <td>${statusBadge(item.verification_status)}${issues.length ? `<div class="inventory-issue-badges mt-1">${issues.map(issue => `<span class="inventory-issue-badge">${esc(issue)}</span>`).join('')}</div>` : ''}</td>
        <td><div>${esc(formatDateTime(checkedAt))}</div><div class="small text-muted">${esc(checkedBy)}</div></td>
        <td>${itemActionButtons(item, index, { primaryLabel: editable && item.verification_status !== 'Not Yet Checked' ? 'Edit' : 'View' })}</td>
      </tr>`;
    }).join('');
    renderMobileItems();
  }

  async function loadItems() {
    const sessionId = state.selectedSession?.id;
    if (!sessionId) return;
    const params = new URLSearchParams();
    let filter = $('inventoryItemStatusFilter')?.value || '';
    if (filter === 'Discrepancies') {
      filter = $('inventoryDiscrepancyFilter')?.value || 'Discrepancies';
    }
    const search = $('inventoryItemSearch')?.value.trim() || '';
    if (filter) params.set('filter', filter);
    if (search) params.set('q', search);
    const data = await request(`/api/inventory/sessions/${sessionId}/items?${params}`);
    state.items = Array.isArray(data.items) ? data.items : [];
    renderItems();
  }

  function reviewStatusBlock(item) {
    const status = item.review_status || 'Pending Review';
    return `<div class="inventory-review-status">${statusBadge(status)}${item.reviewed_by_name ? `<small>${esc(item.reviewed_by_name)} · ${esc(formatDateTime(item.reviewed_at))}</small>` : '<small>Awaiting IT review</small>'}${item.review_remarks ? `<small>${esc(item.review_remarks)}</small>` : ''}</div>`;
  }

  function renderDiscrepancies() {
    const body = $('inventoryDiscrepanciesBody');
    if (!body) return;
    if (!state.selectedSession) {
      body.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">Select an inventory session.</td></tr>';
      return;
    }
    if (!state.discrepancyItems.length) {
      body.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No assets match this discrepancy filter.</td></tr>';
      return;
    }
    body.innerHTML = state.discrepancyItems.map((item, index) => {
      const missing = item.verification_status === 'Missing';
      const issues = issueList(item);
      const actualCustodian = missing
        ? 'Not Located During Inventory'
        : item.actual_custodian_name || 'IT Inventory / Unassigned';
      const actualLocation = missing
        ? 'Not Located During Inventory'
        : item.actual_location_name;
      const actualCondition = missing
        ? 'Not Located During Inventory'
        : item.actual_condition;
      return `<tr>
        <td><div class="fw-semibold">${esc(item.asset_id)}</div><div>${esc(item.asset_name)}</div><div class="small text-muted">${esc([item.brand, item.model].filter(Boolean).join(' ') || '—')}</div></td>
        <td><div class="inventory-issue-badges">${issues.map(issue => `<span class="inventory-issue-badge">${esc(issue)}</span>`).join('')}</div></td>
        <td>${stackedValue(item.expected_custodian_name || 'IT Inventory / Unassigned', actualCustodian)}</td>
        <td>${stackedValue(item.expected_location_name, actualLocation)}</td>
        <td>${stackedValue(item.expected_condition, actualCondition)}</td>
        <td>${esc(missing ? 'Not observed' : display(item.label_condition))}</td>
        <td>${reviewStatusBlock(item)}</td>
        <td>${itemActionButtons(item, index, { includeReview: true })}</td>
      </tr>`;
    }).join('');
  }

  async function loadDiscrepancies() {
    const sessionId = state.selectedSession?.id;
    if (!sessionId) {
      state.discrepancyItems = [];
      renderDiscrepancies();
      return;
    }
    const params = new URLSearchParams();
    params.set('filter', $('inventoryDiscrepancyTabFilter')?.value || 'All Issues');
    const search = $('inventoryDiscrepancySearch')?.value.trim() || '';
    if (search) params.set('q', search);
    const data = await request(`/api/inventory/sessions/${sessionId}/items?${params}`);
    state.discrepancyItems = Array.isArray(data.items) ? data.items : [];
    renderDiscrepancies();
  }

  function openDiscrepancyReview(item) {
    if (!item) return;
    state.selectedReviewItem = item;
    $('inventoryReviewAssetText').textContent = `${item.asset_id} · ${item.asset_name}`;
    $('inventoryReviewIssues').innerHTML = issueList(item)
      .map(issue => `<span class="inventory-issue-badge">${esc(issue)}</span>`)
      .join('');
    $('inventoryReviewStatus').value = item.review_status || 'Pending Review';
    $('inventoryReviewRemarks').value = item.review_remarks || '';
    bootstrap.Modal.getOrCreateInstance($('inventoryReviewModal')).show();
  }

  async function saveDiscrepancyReview(event) {
    event.preventDefault();
    const item = state.selectedReviewItem;
    const sessionId = state.selectedSession?.id;
    if (!item || !sessionId) return;
    const button = $('saveInventoryReviewBtn');
    const normal = '<i class="bi bi-check2-circle me-1" aria-hidden="true"></i>Save Review';
    setButtonBusy(button, true, 'Saving...', normal);
    try {
      const data = await request(
        `/api/inventory/sessions/${sessionId}/items/${item.id}/review`,
        {
          method: 'POST',
          body: JSON.stringify({
            review_status: $('inventoryReviewStatus').value,
            review_remarks: $('inventoryReviewRemarks').value.trim()
          })
        }
      );
      document.activeElement?.blur();
      bootstrap.Modal.getInstance($('inventoryReviewModal'))?.hide();
      showMessage(data.message || 'Discrepancy review saved.');
      await Promise.all([loadDiscrepancies(), loadItems()]);
    } catch (error) {
      showMessage(error.message, 'danger');
    } finally {
      setButtonBusy(button, false, '', normal);
    }
  }

  function openLiveAsset(assetId) {
    window.open(`/assets?view=${encodeURIComponent(assetId)}`, '_blank', 'noopener');
  }

  function openMaintenanceForAsset(assetId) {
    window.open(
      `/maintenance?asset_id=${encodeURIComponent(assetId)}&report=1`,
      '_blank',
      'noopener'
    );
  }

  function openExistingLabelWorkflow(item) {
    const params = new URLSearchParams({
      label: String(item.asset_database_id),
      inventory_session_id: String(item.inventory_session_id),
      inventory_item_id: String(item.id)
    });
    window.open(`/assets?${params}`, '_blank', 'noopener');
  }

  function clearSelectedAsset() {
    state.selectedAsset = null;
    $('selectedInventoryAsset')?.classList.add('d-none');
    $('existingVerificationNotice')?.classList.add('d-none');
    $('inventoryVerificationResult')?.classList.add('d-none');
  }

  function sameNullableId(left, right) {
    return String(left ?? '') === String(right ?? '');
  }

  function previewDiscrepancies() {
    const asset = state.selectedAsset;
    const box = $('inventoryDiscrepancyPreview');
    if (!asset || !box) return;
    const issues = [];
    if (!sameNullableId(asset.expected_location_id, $('actualInventoryLocation').value)) issues.push('Wrong Location');
    if (!sameNullableId(asset.expected_employee_id, $('actualInventoryCustodian').value)) issues.push('Wrong Custodian');
    if (String(asset.expected_condition || '') !== $('actualInventoryCondition').value) issues.push('Condition Changed');
    if ($('inventoryLabelCondition').value !== 'Good') issues.push($('inventoryLabelCondition').value);
    box.className = `inventory-discrepancy-preview mt-3 ${issues.length ? 'has-issues' : 'is-match'}`;
    box.innerHTML = issues.length
      ? `<strong><i class="bi bi-exclamation-triangle-fill me-1" aria-hidden="true"></i>${issues.length} issue${issues.length === 1 ? '' : 's'} detected</strong><ul>${issues.map(issue => `<li>${esc(issue)}</li>`).join('')}</ul>`
      : '<strong><i class="bi bi-check-circle-fill me-1" aria-hidden="true"></i>Expected and actual values match</strong>';
  }

  function setSelectedStatusBadge(status) {
    const badge = $('selectedAssetVerificationBadge');
    const styles = {
      Verified: 'text-bg-success', 'Wrong Location': 'text-bg-warning',
      'Wrong Custodian': 'text-bg-danger', 'Condition Changed': 'text-bg-warning',
      'Label Damaged': 'text-bg-info', Missing: 'text-bg-danger',
      'Not Yet Checked': 'text-bg-secondary'
    };
    badge.className = `badge ${styles[status] || 'text-bg-secondary'}`;
    badge.textContent = status || 'Not Yet Checked';
  }

  function selectAsset(asset, detectedMethod = '') {
    const existing = asset.verification_status && asset.verification_status !== 'Not Yet Checked';
    const method = existing && allowedMethods.has(asset.verification_method)
      ? asset.verification_method
      : allowedMethods.has(detectedMethod)
        ? detectedMethod
        : allowedMethods.has(asset.matched_by) ? asset.matched_by : 'Manual Search';

    state.selectedAsset = { ...asset, selected_verification_method: method };
    $('selectedAssetTitle').textContent = asset.asset_name || 'Asset';
    $('selectedAssetTag').textContent = display(asset.asset_id);
    $('selectedAssetName').textContent = display(asset.asset_name);
    $('selectedAssetCategory').textContent = display(asset.category_name);
    $('selectedAssetBrandModel').textContent = display([asset.brand, asset.model].filter(Boolean).join(' '));
    $('selectedAssetSerial').textContent = display(asset.serial_number);
    $('selectedAssetBarcode').textContent = display(asset.barcode);
    $('selectedAssetStatus').textContent = display(asset.current_asset_status);
    $('selectedVerificationMethod').textContent = method;
    $('selectedExpectedLocation').textContent = display(asset.expected_location_name, 'Unknown / No recorded location');
    $('selectedExpectedCustodian').textContent = display(asset.expected_custodian_name, 'IT Inventory / Unassigned');
    $('selectedExpectedCondition').textContent = display(asset.expected_condition);
    $('actualInventoryLocation').value = String(existing ? (asset.actual_location_id ?? '') : (asset.expected_location_id ?? ''));
    $('actualInventoryCustodian').value = String(existing ? (asset.actual_employee_id ?? '') : (asset.expected_employee_id ?? ''));
    $('actualInventoryCondition').value = existing ? (asset.actual_condition || asset.expected_condition || 'Good') : (asset.expected_condition || 'Good');
    $('inventoryLabelCondition').value = existing ? (asset.label_condition || 'Good') : 'Good';
    $('inventoryVerificationRemarks').value = existing ? (asset.remarks || '') : '';
    setSelectedStatusBadge(asset.verification_status || 'Not Yet Checked');

    const notice = $('existingVerificationNotice');
    notice.classList.toggle('d-none', !existing);
    if (existing) {
      const issues = issueList(asset);
      $('existingVerificationDetails').textContent = asset.verification_status === 'Missing'
        ? `Marked Missing when the inventory was completed ${formatDateTime(asset.missing_marked_at)}.`
        : `Checked ${formatDateTime(asset.verified_at)} by ${display(asset.verified_by_name, 'Unknown user')}.${issues.length ? ` ${issues.length} issue(s) recorded.` : ''}`;
    }

    const editable = state.selectedSession?.status === 'In Progress';
    setVerificationFormReadOnly(!editable);
    const verifyButton = $('verifyInventoryAssetBtn');
    if (verifyButton) {
      verifyButton.innerHTML = existing
        ? '<i class="bi bi-save me-1" aria-hidden="true"></i>Save Verification Changes'
        : '<i class="bi bi-check2-circle me-1" aria-hidden="true"></i>Verify Asset';
    }
    $('inventoryVerificationResult').classList.add('d-none');
    $('inventorySearchResults').classList.add('d-none');
    $('selectedInventoryAsset').classList.remove('d-none');
    previewDiscrepancies();
    $('selectedInventoryAsset').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderSearchResults(results, query) {
    const container = $('inventorySearchResults');
    state.searchResults = results;
    container.classList.remove('d-none');
    if (!results.length) {
      container.innerHTML = `<div class="p-3 text-muted small">No expected asset matched “${esc(query)}”. The asset may be outside this session's frozen scope.</div>`;
      return;
    }
    container.innerHTML = results.map((asset, index) => `<button type="button" class="inventory-search-result" data-search-result="${index}">
      <span><span class="inventory-search-result-title">${esc(asset.asset_id)} · ${esc(asset.asset_name)}</span><span class="inventory-search-result-meta d-block">${esc([asset.brand, asset.model, asset.serial_number].filter(Boolean).join(' · ') || 'No additional details')}</span></span>
      <span class="text-end">${asset.exact_match ? '<span class="badge text-bg-primary">Exact</span>' : ''} ${statusBadge(asset.verification_status)}</span>
    </button>`).join('');
  }

  async function searchInventoryAsset(queryValue, detectedMethod = '') {
    const query = String(queryValue ?? $('inventoryAssetSearch')?.value ?? '').trim();
    const sessionId = state.selectedSession?.id;
    if (!sessionId || state.selectedSession.status !== 'In Progress') {
      showMessage('Open an In Progress inventory session before searching.', 'warning');
      return null;
    }
    if (!query) {
      showMessage('Enter an Asset Tag, serial number, barcode, or asset name.', 'warning');
      $('inventoryAssetSearch').focus();
      return null;
    }

    const button = $('searchInventoryAssetBtn');
    setButtonBusy(button, true, 'Searching...', '<i class="bi bi-search" aria-hidden="true"></i><span class="d-none d-sm-inline ms-1">Search</span>');
    clearSelectedAsset();
    try {
      const data = await request(`/api/inventory/sessions/${sessionId}/search?q=${encodeURIComponent(query)}`);
      const results = Array.isArray(data.results) ? data.results : [];
      const exactMatches = results.filter(result => result.exact_match);
      if (exactMatches.length === 1) {
        const exact = exactMatches[0];
        selectAsset(exact, detectedMethod || exact.matched_by);
        if (exact.verification_status !== 'Not Yet Checked' && detectedMethod) {
          const detail = `Previously verified ${formatDateTime(exact.verified_at)} by ${display(exact.verified_by_name, 'Unknown user')}.`;
          showScanFeedback('duplicate', exact, detail, {
            allowView: true,
            autoDismiss: false
          });
        } else if (exact.verification_status !== 'Not Yet Checked') {
          showMessage('This asset already has a verification. You may review or correct it while the session is In Progress.', 'info');
        }
        return exact;
      } else {
        renderSearchResults(results, query);
        if (results.length > 1) showMessage('Multiple assets matched. Select the correct asset.', 'info');
        return null;
      }
    } catch (error) {
      showMessage(error.message, 'danger');
      return null;
    } finally {
      setButtonBusy(button, false, '', '<i class="bi bi-search" aria-hidden="true"></i><span class="d-none d-sm-inline ms-1">Search</span>');
    }
  }

  async function verifySelectedAsset(event) {
    event?.preventDefault();
    const asset = state.selectedAsset;
    const sessionId = state.selectedSession?.id;
    if (!asset || !sessionId || state.selectedSession?.status !== 'In Progress') return;
    const button = $('verifyInventoryAssetBtn');
    const existing = asset.verification_status !== 'Not Yet Checked';
    const normalHtml = existing
      ? '<i class="bi bi-save me-1" aria-hidden="true"></i>Save Verification Changes'
      : '<i class="bi bi-check2-circle me-1" aria-hidden="true"></i>Verify Asset';
    setButtonBusy(button, true, existing ? 'Saving...' : 'Verifying...', normalHtml);

    try {
      const data = await request(`/api/inventory/sessions/${sessionId}/verify`, {
        method: 'POST',
        body: JSON.stringify({
          asset_id: asset.asset_database_id,
          actual_location_id: $('actualInventoryLocation').value || null,
          actual_employee_id: $('actualInventoryCustodian').value || null,
          actual_condition: $('actualInventoryCondition').value,
          label_condition: $('inventoryLabelCondition').value,
          verification_method: asset.selected_verification_method || 'Manual Search',
          remarks: $('inventoryVerificationRemarks').value.trim(),
          allow_update: existing
        })
      });

      const issues = Array.isArray(data.item?.issues) ? data.item.issues : [];
      showMessage(data.message || 'Inventory verification saved.', issues.length ? 'warning' : 'success');
      Object.assign(state.selectedSession, data.summary || {});
      applySummary(data.summary);
      state.selectedAsset = { ...asset, ...data.item };
      const knownSession = state.sessions.find(session => Number(session.id) === Number(sessionId));
      if (knownSession) Object.assign(knownSession, data.summary || {});
      renderSessions();
      await Promise.all([loadItems(), loadDiscrepancies()]);
      addLiveActivity(`${data.item.asset_id} verified by you.`);

      if (state.continuousScan) {
        showScanFeedback(
          issues.length ? 'warning' : 'success',
          data.item,
          issues.length ? `Issues: ${issues.join(', ')}` : 'Ready for the next asset.'
        );
        clearSelectedAsset();
        $('inventoryAssetSearch').value = '';
        return;
      }

      selectAsset(state.selectedAsset, data.item?.verification_method);
      const result = $('inventoryVerificationResult');
      result.className = `alert mt-3 ${issues.length ? 'alert-warning' : 'alert-success'}`;
      result.innerHTML = issues.length
        ? `<strong><i class="bi bi-exclamation-triangle-fill me-1" aria-hidden="true"></i>VERIFIED WITH DISCREPANCIES</strong><div class="small mt-2">Issues found: ${esc(issues.join(', '))}</div>`
        : '<strong><i class="bi bi-check-circle-fill me-1" aria-hidden="true"></i>ASSET VERIFIED</strong><div class="small mt-2">All expected and actual values match.</div>';
    } catch (error) {
      if (error.status === 409 && error.data?.code === 'ALREADY_VERIFIED') {
        const duplicate = { ...asset, ...(error.data.item || {}) };
        state.selectedAsset = duplicate;
        if (error.data.summary) {
          Object.assign(state.selectedSession, error.data.summary);
          applySummary(error.data.summary);
        }
        showScanFeedback(
          'duplicate',
          duplicate,
          `Previously verified ${formatDateTime(duplicate.verified_at)} by ${display(duplicate.verified_by_name, 'Unknown user')}.`,
          { allowView: true, autoDismiss: false }
        );
        await loadItems().catch(() => {});
        return;
      }
      showMessage(error.message, 'danger');
    } finally {
      setButtonBusy(button, false, '', normalHtml);
    }
  }

  async function createSession(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const payload = Object.fromEntries(new FormData(form).entries());
    const button = $('createInventoryBtn');
    setButtonBusy(button, true, 'Creating...', 'Create Draft');
    try {
      const data = await request('/api/inventory/sessions', {
        method: 'POST', body: JSON.stringify(payload)
      });
      bootstrap.Modal.getInstance($('createInventoryModal'))?.hide();
      showMessage(data.message || 'Inventory session created.');
      await loadSessions();
      await openSession(data.session.id);
      selectInventoryTab('active');
    } catch (error) {
      showMessage(error.message, 'danger');
    } finally {
      setButtonBusy(button, false, '', 'Create Draft');
    }
  }

  function openCompleteInventoryModal() {
    if (state.selectedSession?.status !== 'In Progress') return;
    const unchecked = Number(state.selectedSession.not_yet_checked || 0);
    $('completeInventoryWarningTitle').textContent = unchecked
      ? `${unchecked.toLocaleString()} asset${unchecked === 1 ? '' : 's'} not verified`
      : 'All expected assets have been checked';
    $('completeInventoryWarningText').textContent = unchecked
      ? `Completing this inventory will mark ${unchecked.toLocaleString()} unchecked asset${unchecked === 1 ? '' : 's'} as Missing. Do you want to continue?`
      : 'No assets will be marked Missing. Complete and lock this inventory?';
    bootstrap.Modal.getOrCreateInstance($('completeInventoryModal')).show();
  }

  async function completeInventory() {
    const sessionId = state.selectedSession?.id;
    if (!sessionId || state.selectedSession?.status !== 'In Progress') return;
    const button = $('confirmCompleteInventoryBtn');
    setButtonBusy(button, true, 'Completing...', 'Complete Inventory');
    try {
      const data = await request(`/api/inventory/sessions/${sessionId}/complete`, { method: 'POST' });
      document.activeElement?.blur();
      bootstrap.Modal.getInstance($('completeInventoryModal'))?.hide();
      await stopInventoryScanner();
      state.selectedSession = { ...state.selectedSession, ...data.session, ...data.summary };
      renderActiveSession();
      await Promise.all([loadItems(), loadDiscrepancies(), loadSessions()]);
      showMessage(`${data.message} ${Number(data.missing_count || 0).toLocaleString()} asset(s) marked Missing.`);
    } catch (error) {
      showMessage(error.message, 'danger');
    } finally {
      setButtonBusy(button, false, '', 'Complete Inventory');
    }
  }

  function setScannerMessage(message, type = 'info') {
    const box = $('inventoryScannerMessage');
    if (!box) return;
    box.className = `alert alert-${type}`;
    box.dataset.alertPersistent = '';
    box.textContent = message;
  }

  function detectedScannerMethod(decodedResult) {
    const format = String(
      decodedResult?.result?.format?.formatName ||
      decodedResult?.result?.format?.format_name ||
      decodedResult?.result?.format || ''
    ).toUpperCase();
    return format.includes('QR') ? 'QR' : 'Barcode';
  }

  function setScannerPauseButton() {
    const button = $('pauseInventoryScannerBtn');
    if (!button) return;
    button.disabled = !state.scannerRunning;
    button.innerHTML = state.scannerPaused
      ? '<i class="bi bi-play-fill me-1" aria-hidden="true"></i>Resume'
      : '<i class="bi bi-pause-fill me-1" aria-hidden="true"></i>Pause';
  }

  async function pauseInventoryScanner() {
    if (!state.scanner || !state.scannerRunning || state.scannerPaused) return;
    try {
      state.scanner.pause(true);
      state.scannerPaused = true;
      setScannerMessage('Scanner paused. Resume when you are ready.', 'warning');
    } catch (_) {}
    setScannerPauseButton();
  }

  async function resumeInventoryScanner() {
    if (!state.scanner || !state.scannerRunning || !state.scannerPaused) return;
    try {
      state.scanner.resume();
      state.scannerPaused = false;
      setScannerMessage('Camera ready. Scan an asset QR code or barcode.', 'success');
    } catch (error) {
      setScannerMessage(`Unable to resume the camera: ${error.message || error}`, 'danger');
    }
    setScannerPauseButton();
  }

  async function stopInventoryScanner({ endContinuous = true } = {}) {
    if (state.scannerStopping) return;
    state.scannerStopping = true;
    const scanner = state.scanner;
    try {
      if (scanner && state.scannerRunning) await scanner.stop();
    } catch (_) {}
    try { if (scanner) await scanner.clear(); } catch (_) {}
    state.scanner = null;
    state.scannerRunning = false;
    state.scannerPaused = false;
    state.scannerProcessing = false;
    state.scannerStopping = false;
    if (endContinuous) state.continuousScan = false;
    setScannerPauseButton();
  }

  function scannerFormats() {
    return window.Html5QrcodeSupportedFormats ? [
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.CODABAR,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E
    ].filter(value => value !== undefined && value !== null) : [];
  }

  function populateCameraSelector(cameras) {
    const select = $('inventoryCameraSelect');
    const field = $('inventoryCameraField');
    if (!select || !field) return;
    select.replaceChildren();
    cameras.forEach((camera, index) => {
      select.add(new Option(camera.label || `Camera ${index + 1}`, camera.id));
    });
    if (state.selectedCameraId) select.value = state.selectedCameraId;
    field.classList.toggle('d-none', cameras.length < 2);
  }

  function friendlyCameraError(error) {
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      return 'Camera access requires HTTPS. Manual Search remains available.';
    }
    if (error?.name === 'NotAllowedError') {
      return 'Camera access was denied. You can continue using Manual Search.';
    }
    if (error?.name === 'NotFoundError') {
      return 'No camera was found. You can continue using Manual Search.';
    }
    if (error?.name === 'NotReadableError') {
      return 'The camera is busy in another app or tab. Close it there, then try again.';
    }
    return `Unable to start the camera. ${error?.message || 'Use Manual Search to continue.'}`;
  }

  async function handleInventoryScan(decodedText, decodedResult) {
    const text = String(decodedText || '').trim();
    const now = Date.now();
    if (!text || state.scannerProcessing || now < state.scanCooldownUntil) return;
    if (text === state.lastScanText && now - state.lastScanAt < 2200) return;

    state.scannerProcessing = true;
    state.lastScanText = text;
    state.lastScanAt = now;
    await pauseInventoryScanner();
    $('inventoryAssetSearch').value = text;

    const asset = await searchInventoryAsset(text, detectedScannerMethod(decodedResult));
    if (!asset) {
      showScanFeedback('warning', null, 'No expected asset matched. Use Manual Search or scan another label.');
      return;
    }
    if (asset.verification_status !== 'Not Yet Checked') return;

    state.scannerKeepAliveOnHide = true;
    document.activeElement?.blur();
    bootstrap.Modal.getInstance($('inventoryScannerModal'))?.hide();
  }

  async function startInventoryScanner() {
    if (state.scannerRunning) {
      await resumeInventoryScanner();
      return;
    }
    if (typeof window.Html5Qrcode === 'undefined') {
      setScannerMessage('The QR / barcode scanner library did not load. Use Manual Search to continue.', 'danger');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerMessage('Camera access is not supported by this browser. Use Manual Search to continue.', 'danger');
      return;
    }
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      setScannerMessage('Camera access requires HTTPS. Use Manual Search to continue.', 'warning');
      return;
    }

    state.continuousScan = true;
    state.scannerProcessing = false;
    unlockInventorySound();
    setScannerMessage('Starting camera...', 'info');
    $('inventoryScanner').replaceChildren();

    try {
      const permission = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      permission.getTracks().forEach(track => track.stop());
      const cameras = await Html5Qrcode.getCameras().catch(() => []);
      state.scannerCameras = cameras;
      const rear = cameras.find(camera => /back|rear|environment/i.test(camera.label || ''));
      if (!state.selectedCameraId || !cameras.some(camera => camera.id === state.selectedCameraId)) {
        state.selectedCameraId = rear?.id || cameras[0]?.id || '';
      }
      populateCameraSelector(cameras);
      const camera = state.selectedCameraId || { facingMode: { ideal: 'environment' } };

      state.scanner = new Html5Qrcode(
        'inventoryScanner',
        scannerFormats().length ? { formatsToSupport: scannerFormats() } : {}
      );
      await state.scanner.start(
        camera,
        {
          fps: 15,
          qrbox: (width, height) => ({
            width: Math.max(120, Math.floor(width * .88)),
            height: Math.max(90, Math.floor(Math.min(height * .55, width * .42)))
          }),
          aspectRatio: state.viewMode === 'mobile' ? 1.333333 : 1.777778
        },
        handleInventoryScan,
        () => {}
      );
      state.scannerRunning = true;
      state.scannerPaused = false;
      setScannerPauseButton();
      setScannerMessage('Camera ready. Scan an asset QR code or barcode.', 'success');
    } catch (error) {
      await stopInventoryScanner({ endContinuous: false });
      setScannerMessage(friendlyCameraError(error), 'danger');
    }
  }

  async function continueContinuousScanning() {
    hideScanFeedback();
    if (!state.continuousScan || state.selectedSession?.status !== 'In Progress') return;
    clearSelectedAsset();
    $('inventoryAssetSearch').value = '';
    state.scannerProcessing = false;
    state.scanCooldownUntil = Date.now() + 650;
    const modal = bootstrap.Modal.getOrCreateInstance($('inventoryScannerModal'));
    if (!$('inventoryScannerModal').classList.contains('show')) {
      state.scannerKeepAliveOnHide = false;
      modal.show();
    } else {
      await resumeInventoryScanner();
    }
  }

  function openInventoryScanner() {
    if (!state.selectedSession || state.selectedSession.status !== 'In Progress') {
      showMessage('Open an In Progress inventory session before scanning.', 'warning');
      return;
    }
    state.continuousScan = true;
    unlockInventorySound();
    bootstrap.Modal.getOrCreateInstance($('inventoryScannerModal')).show();
  }

  async function stopAndCloseInventoryScanner() {
    state.scannerKeepAliveOnHide = false;
    await stopInventoryScanner();
    document.activeElement?.blur();
    bootstrap.Modal.getInstance($('inventoryScannerModal'))?.hide();
    if (state.selectedSession?.status === 'In Progress') $('inventoryScanBtn')?.focus();
  }

  window.openScannerPage = openInventoryScanner;

  function bindEvents() {
    $('inventoryScopeType')?.addEventListener('change', updateScopeFields);
    $('createInventoryForm')?.addEventListener('submit', createSession);
    $('createInventoryModal')?.addEventListener('show.bs.modal', () => {
      $('createInventoryForm').reset();
      $('inventoryName').value = `${new Date().getFullYear()} Annual IT Asset Inventory`;
      updateScopeFields();
    });

    $('inventorySessionsBody')?.addEventListener('click', event => {
      const openButton = event.target.closest('[data-open-session]');
      const startButton = event.target.closest('[data-start-session]');
      const printButton = event.target.closest('[data-print-session]');
      const exportButton = event.target.closest('[data-export-session]');
      if (openButton) {
        openSession(openButton.dataset.openSession)
          .then(() => selectInventoryTab('active'))
          .catch(error => showMessage(error.message, 'danger'));
      }
      if (startButton) startSession(startButton.dataset.startSession);
      if (printButton) openInventoryReport(printButton.dataset.printSession);
      if (exportButton) exportInventory(exportButton.dataset.exportSession);
    });

    document.querySelectorAll('[data-inventory-tab]').forEach(button => {
      button.addEventListener('click', () => selectInventoryTab(button.dataset.inventoryTab));
    });
    $('inventoryHistorySearch')?.addEventListener('input', renderSessions);
    $('inventoryHistoryStatus')?.addEventListener('change', renderSessions);

    $('startInventoryBtn')?.addEventListener('click', () => startSession());
    $('completeInventoryBtn')?.addEventListener('click', openCompleteInventoryModal);
    $('confirmCompleteInventoryBtn')?.addEventListener('click', completeInventory);
    $('printInventoryBtn')?.addEventListener('click', () => openInventoryReport());
    $('exportInventoryBtn')?.addEventListener('click', () => exportInventory());
    $('printDiscrepancyReportBtn')?.addEventListener('click', () => openInventoryReport(null, true));
    $('exportDiscrepancyBtn')?.addEventListener('click', () => exportInventory());
    $('refreshInventoryBtn')?.addEventListener('click', async () => {
      try {
        await loadSessions();
        if (state.selectedSession?.id) await openSession(state.selectedSession.id);
        showMessage('Inventory data refreshed.', 'info');
      } catch (error) {
        showMessage(error.message, 'danger');
      }
    });

    $('searchInventoryAssetBtn')?.addEventListener('click', () => searchInventoryAsset());
    $('inventoryAssetSearch')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchInventoryAsset();
      }
    });
    $('inventoryScanBtn')?.addEventListener('click', openInventoryScanner);
    $('inventoryVerificationForm')?.addEventListener('submit', verifySelectedAsset);
    $('clearSelectedInventoryAssetBtn')?.addEventListener('click', () => {
      if (state.continuousScan) continueContinuousScanning();
      else clearSelectedAsset();
    });
    [
      'actualInventoryLocation', 'actualInventoryCustodian',
      'actualInventoryCondition', 'inventoryLabelCondition'
    ].forEach(id => $(id)?.addEventListener('change', previewDiscrepancies));

    $('inventorySearchResults')?.addEventListener('click', event => {
      const button = event.target.closest('[data-search-result]');
      if (!button) return;
      const asset = state.searchResults[Number(button.dataset.searchResult)];
      if (asset) selectAsset(asset, asset.matched_by);
    });

    const handleItemAction = event => {
      const button = event.target.closest('[data-select-item]');
      const viewAssetButton = event.target.closest('[data-view-live-asset]');
      const labelButton = event.target.closest('[data-reprint-label]');
      const maintenanceButton = event.target.closest('[data-report-problem]');
      if (button) {
        const item = state.items[Number(button.dataset.selectItem)];
        if (!item) return;
        selectAsset(
          itemToSelectedAsset(item),
          item.verification_method || 'Manual Search'
        );
      }
      if (viewAssetButton) openLiveAsset(viewAssetButton.dataset.viewLiveAsset);
      if (labelButton) {
        const item = state.items[Number(labelButton.dataset.reprintLabel)];
        if (item) openExistingLabelWorkflow(item);
      }
      if (maintenanceButton) openMaintenanceForAsset(maintenanceButton.dataset.reportProblem);
    };
    $('inventoryItemsBody')?.addEventListener('click', handleItemAction);
    $('inventoryItemsMobile')?.addEventListener('click', handleItemAction);
    $('inventoryItemStatusFilter')?.addEventListener('change', () => {
      const discrepancies = $('inventoryItemStatusFilter').value === 'Discrepancies';
      $('inventoryDiscrepancyFilterField').classList.toggle('d-none', !discrepancies);
      if (!discrepancies) $('inventoryDiscrepancyFilter').value = 'Discrepancies';
      loadItems().catch(error => showMessage(error.message, 'danger'));
    });
    $('inventoryDiscrepancyFilter')?.addEventListener('change', () => {
      loadItems().catch(error => showMessage(error.message, 'danger'));
    });
    $('inventoryItemSearch')?.addEventListener('input', () => {
      window.clearTimeout(state.itemSearchTimer);
      state.itemSearchTimer = window.setTimeout(() => {
        loadItems().catch(error => showMessage(error.message, 'danger'));
      }, 280);
    });
    $('refreshInventoryItemsBtn')?.addEventListener('click', () => {
      loadItems().catch(error => showMessage(error.message, 'danger'));
    });

    $('inventoryDiscrepanciesBody')?.addEventListener('click', event => {
      const reviewButton = event.target.closest('[data-review-item]');
      const viewButton = event.target.closest('[data-select-item]');
      const viewAssetButton = event.target.closest('[data-view-live-asset]');
      const labelButton = event.target.closest('[data-reprint-label]');
      const maintenanceButton = event.target.closest('[data-report-problem]');
      if (reviewButton) {
        openDiscrepancyReview(
          state.discrepancyItems[Number(reviewButton.dataset.reviewItem)]
        );
      } else if (viewButton) {
        const item = state.discrepancyItems[Number(viewButton.dataset.selectItem)];
        if (item) {
          selectAsset(itemToSelectedAsset(item), item.verification_method || 'Manual Search');
          selectInventoryTab('active');
        }
      }
      if (viewAssetButton) openLiveAsset(viewAssetButton.dataset.viewLiveAsset);
      if (labelButton) {
        const item = state.discrepancyItems[Number(labelButton.dataset.reprintLabel)];
        if (item) openExistingLabelWorkflow(item);
      }
      if (maintenanceButton) openMaintenanceForAsset(maintenanceButton.dataset.reportProblem);
    });
    $('inventoryDiscrepancyTabFilter')?.addEventListener('change', () => {
      loadDiscrepancies().catch(error => showMessage(error.message, 'danger'));
    });
    $('inventoryDiscrepancySearch')?.addEventListener('input', () => {
      window.clearTimeout(state.discrepancySearchTimer);
      state.discrepancySearchTimer = window.setTimeout(() => {
        loadDiscrepancies().catch(error => showMessage(error.message, 'danger'));
      }, 280);
    });
    $('inventoryReviewForm')?.addEventListener('submit', saveDiscrepancyReview);

    $('inventoryScannerModal')?.addEventListener('shown.bs.modal', async () => {
      if (state.scannerRunning) await resumeInventoryScanner();
      else await startInventoryScanner();
    });
    $('inventoryScannerModal')?.addEventListener('hidden.bs.modal', async () => {
      if (state.scannerKeepAliveOnHide) {
        state.scannerKeepAliveOnHide = false;
        return;
      }
      await stopInventoryScanner();
      if (state.selectedSession?.status === 'In Progress') $('inventoryScanBtn')?.focus();
    });
    $('pauseInventoryScannerBtn')?.addEventListener('click', async () => {
      if (state.scannerPaused) await resumeInventoryScanner();
      else await pauseInventoryScanner();
    });
    $('stopInventoryScannerBtn')?.addEventListener('click', stopAndCloseInventoryScanner);
    document.querySelectorAll('[data-scanner-stop]').forEach(button => {
      button.addEventListener('click', stopAndCloseInventoryScanner);
    });
    $('inventoryCameraSelect')?.addEventListener('change', async event => {
      state.selectedCameraId = event.target.value;
      await stopInventoryScanner({ endContinuous: false });
      await startInventoryScanner();
    });
    $('inventoryScannerManualSearchBtn')?.addEventListener('click', async () => {
      await pauseInventoryScanner();
      state.scannerKeepAliveOnHide = true;
      document.activeElement?.blur();
      bootstrap.Modal.getInstance($('inventoryScannerModal'))?.hide();
      window.setTimeout(() => $('inventoryAssetSearch')?.focus(), 180);
    });
    $('inventoryScanFeedbackContinueBtn')?.addEventListener('click', continueContinuousScanning);
    $('inventoryScanFeedbackViewBtn')?.addEventListener('click', () => {
      window.clearTimeout(state.feedbackTimer);
      hideScanFeedback();
      if (state.feedbackAsset) {
        selectAsset(
          state.feedbackAsset,
          state.feedbackAsset.verification_method || state.feedbackAsset.matched_by
        );
      }
      if ($('inventoryScannerModal')?.classList.contains('show')) {
        state.scannerKeepAliveOnHide = true;
        document.activeElement?.blur();
        bootstrap.Modal.getInstance($('inventoryScannerModal'))?.hide();
      }
    });
    $('inventoryViewMode')?.addEventListener('change', event => {
      const preference = ['auto', 'mobile', 'desktop'].includes(event.target.value)
        ? event.target.value
        : 'auto';
      state.viewModePreference = preference;
      savePreference('primaInventoryViewMode', preference);
      applyInventoryViewMode();
    });
    $('inventorySoundEnabled')?.addEventListener('change', event => {
      state.soundEnabled = event.target.checked;
      savePreference('primaInventorySoundEnabled', state.soundEnabled ? '1' : '0');
      if (state.soundEnabled) unlockInventorySound();
    });
    window.addEventListener('resize', applyInventoryViewMode, { passive: true });
    window.addEventListener('pagehide', () => { stopInventoryScanner(); });
  }

  async function initialize() {
    state.viewModePreference = readPreference('primaInventoryViewMode', 'auto');
    if (!['auto', 'mobile', 'desktop'].includes(state.viewModePreference)) {
      state.viewModePreference = 'auto';
    }
    state.soundEnabled = readPreference('primaInventorySoundEnabled', '0') === '1';
    if ($('inventorySoundEnabled')) $('inventorySoundEnabled').checked = state.soundEnabled;
    applyInventoryViewMode();
    bindEvents();
    updateScopeFields();
    initializeInventorySocket();
    try {
      await Promise.all([loadReferenceData(), loadSessions()]);
      const preferred =
        state.sessions.find(session => session.status === 'In Progress') ||
        state.sessions.find(session => session.status === 'Draft') ||
        state.sessions[0];
      if (preferred) await openSession(preferred.id);
    } catch (error) {
      showMessage(
        error.message || 'Unable to initialize Inventory.',
        'danger',
        { duration: 0 }
      );
      $('inventorySessionsBody').innerHTML = '<tr><td colspan="14" class="text-center text-danger py-4">Unable to load inventory sessions.</td></tr>';
    }
  }

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();
