// PRIMA IT Asset Management - Settings
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let usersLoaded = false;

  function showUserMessage(message = '', type = 'danger') {
    const container = $('userManagementAlert');
    if (!container) return;
    container.replaceChildren();
    if (!message) return;
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    container.appendChild(alert);
  }

  function roleLabel(role) {
    return ({ admin: 'Administrator', it_staff: 'IT staff', technician: 'Technician', viewer: 'Viewer' })[role] || role || 'Unknown';
  }

  function statusBadge(status) {
    const badge = document.createElement('span');
    const styles = { active: 'text-bg-success', pending: 'text-bg-warning', inactive: 'text-bg-secondary' };
    badge.className = `badge ${styles[status] || 'text-bg-secondary'}`;
    badge.textContent = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
    return badge;
  }

  function renderUsers(users) {
    const body = $('usersTableBody');
    if (!body) return;
    body.replaceChildren();
    $('userCountText').textContent = `${users.length} account${users.length === 1 ? '' : 's'}`;

    if (!users.length) {
      const row = body.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 4;
      cell.className = 'text-center text-muted py-4';
      cell.textContent = 'No user accounts found.';
      return;
    }

    users.forEach(user => {
      const row = body.insertRow();
      const identityCell = row.insertCell();
      const name = document.createElement('div');
      name.className = 'fw-semibold';
      name.textContent = user.full_name || 'Unnamed user';
      const username = document.createElement('div');
      username.className = 'small text-muted';
      username.textContent = `@${user.username}`;
      identityCell.append(name, username);
      row.insertCell().textContent = roleLabel(user.role);
      row.insertCell().appendChild(statusBadge(user.status));

      const employeeCell = row.insertCell();
      employeeCell.textContent = user.employee_id || '—';
      if (user.department_name) {
        const department = document.createElement('div');
        department.className = 'small text-muted';
        department.textContent = user.department_name;
        employeeCell.appendChild(department);
      }
    });
  }

  async function loadUsers() {
    const body = $('usersTableBody');
    const refresh = $('refreshUsersBtn');
    if (body) body.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Loading users…</td></tr>';
    if (refresh) refresh.disabled = true;
    showUserMessage();

    try {
      const response = await fetch('/api/users', { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to load users.');
      renderUsers(Array.isArray(data.users) ? data.users : []);
      usersLoaded = true;
    } catch (error) {
      if (body) body.innerHTML = '<tr><td colspan="4" class="text-center text-danger py-4">Unable to load user accounts.</td></tr>';
      $('userCountText').textContent = 'Accounts unavailable';
      showUserMessage(error.message);
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  async function createUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const password = $('newUserPassword').value;
    if (password !== $('newUserPasswordConfirm').value) {
      showUserMessage('Passwords do not match.');
      $('newUserPasswordConfirm').focus();
      return;
    }

    const button = $('createUserBtn');
    const values = new FormData(form);
    const payload = {
      full_name: String(values.get('full_name') || '').trim(),
      username: String(values.get('username') || '').trim(),
      employee_id: String(values.get('employee_id') || '').trim(),
      role: values.get('role'),
      status: values.get('status'),
      password
    };

    showUserMessage();
    button.disabled = true;
    button.textContent = 'Creating…';

    try {
      const response = await fetch('/api/users', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to create user.');

      form.reset();
      $('newUserRole').value = 'viewer';
      $('newUserStatus').value = 'active';
      await loadUsers();
      showUserMessage(data.message || 'User account created successfully.', 'success');
      $('newUserFullName').focus();
    } catch (error) {
      showUserMessage(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Create user';
    }
  }

  async function initializeUserManagement() {
    const openButton = $('openUserManagementBtn');
    if (!openButton) return;

    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to verify access.');
      const user = await response.json();

      if (user.role !== 'admin') {
        openButton.disabled = true;
        openButton.removeAttribute('data-bs-toggle');
        openButton.removeAttribute('data-bs-target');
        openButton.textContent = 'Administrator access required';
        return;
      }

      $('userManagementModal')?.addEventListener('show.bs.modal', () => {
        if (!usersLoaded) loadUsers();
      });
      $('refreshUsersBtn')?.addEventListener('click', loadUsers);
      $('addUserForm')?.addEventListener('submit', createUser);
    } catch (_) {
      openButton.disabled = true;
      openButton.textContent = 'Unable to verify access';
    }
  }

  function showBackupMessage(message = '', type = 'danger') {
    const container = $('backupRestoreAlert');
    if (!container) return;
    container.replaceChildren();
    if (!message) return;

    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    container.appendChild(alert);
  }

  function setBackupBusy(busy, activeAction = '') {
    const exportButton = $('exportDatabaseBtn');
    const restoreButton = $('restoreDatabaseBtn');
    const fileInput = $('databaseBackupFile');
    const confirmInput = $('confirmDatabaseRestore');

    if (exportButton) {
      exportButton.disabled = busy;
      exportButton.innerHTML =
        busy && activeAction === 'export'
          ? '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span> Preparing backupâ€¦'
          : '<i class="bi bi-download me-1" aria-hidden="true"></i> Download backup';
    }

    if (restoreButton) {
      restoreButton.disabled = busy;
      restoreButton.innerHTML =
        busy && activeAction === 'restore'
          ? '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span> Restoringâ€¦'
          : '<i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i> Restore backup';
    }

    if (fileInput) fileInput.disabled = busy;
    if (confirmInput) confirmInput.disabled = busy;
  }

  function backupPassword() {
    return $('backupAdminPassword')?.value || '';
  }

  function requireBackupPassword() {
    const password = backupPassword();

    if (!password) {
      showBackupMessage('Enter your current admin password.');
      $('backupAdminPassword')?.focus();
      return '';
    }

    return password;
  }

  async function readBackupError(response, fallback) {
    const data = await response.json().catch(() => ({}));

    if (
      response.status === 401 &&
      data.message === 'Login required.'
    ) {
      window.location.href = '/?session=expired&returnTo=%2Fsettings';
      return new Error('Your session has expired.');
    }

    return new Error(data.message || fallback);
  }

  async function exportDatabase() {
    const password = requireBackupPassword();
    if (!password) return;

    showBackupMessage();
    setBackupBusy(true, 'export');

    try {
      const response = await fetch('/api/backup/export', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        throw await readBackupError(
          response,
          'Unable to export the database backup.'
        );
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || 'prima-database-backup.json';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      $('backupAdminPassword').value = '';
      showBackupMessage(
        'Database backup downloaded successfully.',
        'success'
      );
    } catch (error) {
      showBackupMessage(
        error.message || 'Unable to export the database backup.'
      );
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreDatabase(event) {
    event.preventDefault();

    const password = requireBackupPassword();
    if (!password) return;

    const file = $('databaseBackupFile')?.files?.[0];

    if (!file) {
      showBackupMessage('Select a PRIMA JSON backup file.');
      $('databaseBackupFile')?.focus();
      return;
    }

    if (!$('confirmDatabaseRestore')?.checked) {
      showBackupMessage(
        'Confirm that you understand the current database will be replaced.'
      );
      $('confirmDatabaseRestore')?.focus();
      return;
    }

    showBackupMessage();
    setBackupBusy(true, 'restore');

    try {
      const formData = new FormData();
      formData.append('password', password);
      formData.append('backup', file, file.name);

      const response = await fetch('/api/backup/import', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData
      });

      if (!response.ok) {
        throw await readBackupError(
          response,
          'Unable to restore the database backup.'
        );
      }

      const data = await response.json().catch(() => ({}));

      showBackupMessage(
        data.message || 'Database restored successfully. Please sign in again.',
        'success'
      );

      window.setTimeout(() => {
        window.location.href = '/';
      }, 1800);
    } catch (error) {
      showBackupMessage(
        error.message || 'Unable to restore the database backup.'
      );
      setBackupBusy(false);
    }
  }

  async function initializeBackupRestore() {
    const openButton = $('openBackupRestoreBtn');
    if (!openButton) return;

    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store'
      });

      if (!response.ok) throw new Error('Unable to verify access.');

      const user = await response.json();

      if (user.role !== 'admin') {
        openButton.disabled = true;
        openButton.removeAttribute('data-bs-toggle');
        openButton.removeAttribute('data-bs-target');
        openButton.textContent = 'Administrator access required';
        return;
      }

      $('exportDatabaseBtn')?.addEventListener('click', exportDatabase);
      $('backupRestoreForm')?.addEventListener('submit', restoreDatabase);

      $('backupRestoreModal')?.addEventListener('hidden.bs.modal', () => {
        $('backupRestoreForm')?.reset();
        showBackupMessage();
        setBackupBusy(false);
      });
    } catch (_) {
      openButton.disabled = true;
      openButton.removeAttribute('data-bs-toggle');
      openButton.removeAttribute('data-bs-target');
      openButton.textContent = 'Unable to verify access';
    }
  }

  function showReportEmailMessage(message = '', type = 'danger') {
    const container = $('reportEmailAlert');
    if (!container) return;
    container.replaceChildren();
    if (!message) return;

    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    container.appendChild(alert);
  }

  function formatReportScheduleDate(value, emptyText) {
    if (!value) return emptyText;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return emptyText;
    return date.toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function updateReportScheduleFields() {
    const frequency = $('reportScheduleFrequency')?.value || 'weekly';
    const enabled = Boolean($('automaticReportEnabled')?.checked);

    $('reportScheduleWeekdayWrap')?.classList.toggle(
      'd-none',
      frequency !== 'weekly'
    );
    $('reportScheduleMonthdayWrap')?.classList.toggle(
      'd-none',
      frequency !== 'monthly'
    );
    $('reportScheduleFields')?.classList.toggle(
      'settings-schedule-disabled',
      !enabled
    );
  }

  function setReportEmailBusy(busy, action = '') {
    const saveButton = $('saveReportEmailSettingsBtn');
    const sendButton = $('sendReportNowBtn');

    if (saveButton) {
      saveButton.disabled = busy;
      saveButton.textContent =
        busy && action === 'save'
          ? 'Saving...'
          : 'Save settings';
    }

    if (sendButton) {
      sendButton.disabled = busy;
      sendButton.innerHTML =
        busy && action === 'send'
          ? '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span> Sending report...'
          : '<i class="bi bi-send me-1" aria-hidden="true"></i> Send saved report now';
    }
  }

  function fillReportFilterOptions(categories, locations) {
    const categorySelect = $('scheduledReportCategory');
    const locationSelect = $('scheduledReportLocation');

    if (categorySelect) {
      categorySelect.replaceChildren(new Option('All Categories', ''));
      categories.forEach(category => {
        categorySelect.add(new Option(category.name, category.id));
      });
    }

    if (locationSelect) {
      locationSelect.replaceChildren(new Option('All Locations', ''));
      locations.forEach(location => {
        locationSelect.add(new Option(location.name, location.id));
      });
    }
  }

  function renderReportEmailSettings(settings) {
    $('automaticReportEnabled').checked = Boolean(settings.enabled);
    $('reportEmailRecipients').value = settings.recipients || '';
    $('reportEmailSubject').value = settings.email_subject || 'Scheduled Asset Report';
    $('scheduledReportType').value = settings.report_status || 'all';
    $('scheduledReportCategory').value = settings.category_id || '';
    $('scheduledReportLocation').value = settings.location_id || '';
    $('reportScheduleFrequency').value = settings.frequency || 'weekly';
    $('reportScheduleTime').value = settings.send_time || '08:00';
    $('reportScheduleWeekday').value = String(settings.day_of_week ?? 1);
    $('reportScheduleMonthday').value = String(settings.day_of_month || 1);
    $('reportSmtpHost').value = settings.smtp_host || '';
    $('reportSmtpPort').value = String(settings.smtp_port || 587);
    $('reportSmtpSecure').checked = Boolean(settings.smtp_secure);
    $('reportSmtpUser').value = settings.smtp_user || '';
    $('reportSmtpPassword').value = '';
    $('reportSmtpFrom').value = settings.smtp_from || '';

    const passwordHelp = $('reportSmtpPasswordHelp');
    if (passwordHelp) {
      passwordHelp.textContent = settings.smtp_password_configured
        ? 'An SMTP password is configured. Leave this field blank to keep it.'
        : 'No SMTP password is currently configured.';
    }

    const statusBadge = $('reportEmailStatusBadge');
    if (statusBadge) {
      statusBadge.className = settings.enabled
        ? 'badge text-bg-success'
        : 'badge text-bg-secondary';
      statusBadge.textContent = settings.enabled ? 'Automatic sending active' : 'Automatic sending off';
    }

    $('reportEmailNextRun').textContent = formatReportScheduleDate(
      settings.next_run_at,
      settings.enabled ? 'Calculating schedule...' : 'Not scheduled'
    );
    $('reportEmailLastSent').textContent = formatReportScheduleDate(
      settings.last_sent_at,
      'Never'
    );

    const errorElement = $('reportEmailLastError');
    if (errorElement) {
      errorElement.textContent = settings.last_error || 'No errors';
      errorElement.classList.toggle('text-danger', Boolean(settings.last_error));
    }

    updateReportScheduleFields();
  }

  async function loadReportEmailSettings() {
    setReportEmailBusy(true);
    showReportEmailMessage();

    try {
      const [settingsResponse, categoriesResponse, locationsResponse] =
        await Promise.all([
          fetch('/api/settings/report-email', {
            credentials: 'same-origin',
            cache: 'no-store'
          }),
          fetch('/api/asset-categories', {
            credentials: 'same-origin',
            cache: 'no-store'
          }),
          fetch('/api/locations', {
            credentials: 'same-origin',
            cache: 'no-store'
          })
        ]);

      const settingsData = await settingsResponse.json().catch(() => ({}));

      if (!settingsResponse.ok) {
        throw new Error(settingsData.message || 'Unable to load report email settings.');
      }

      if (!categoriesResponse.ok || !locationsResponse.ok) {
        throw new Error('Unable to load report filter options.');
      }

      const categories = await categoriesResponse.json();
      const locations = await locationsResponse.json();

      fillReportFilterOptions(
        Array.isArray(categories) ? categories : [],
        Array.isArray(locations) ? locations : []
      );
      renderReportEmailSettings(settingsData.settings || {});
    } catch (error) {
      showReportEmailMessage(
        error.message || 'Unable to load report email settings.'
      );
    } finally {
      setReportEmailBusy(false);
    }
  }

  function collectReportEmailSettings() {
    return {
      enabled: Boolean($('automaticReportEnabled')?.checked),
      recipients: $('reportEmailRecipients')?.value || '',
      email_subject: $('reportEmailSubject')?.value.trim() || '',
      report_status: $('scheduledReportType')?.value || 'all',
      category_id: $('scheduledReportCategory')?.value || '',
      location_id: $('scheduledReportLocation')?.value || '',
      frequency: $('reportScheduleFrequency')?.value || 'weekly',
      send_time: $('reportScheduleTime')?.value || '08:00',
      day_of_week: Number($('reportScheduleWeekday')?.value ?? 1),
      day_of_month: Number($('reportScheduleMonthday')?.value || 1),
      smtp_host: $('reportSmtpHost')?.value.trim() || '',
      smtp_port: Number($('reportSmtpPort')?.value || 587),
      smtp_secure: Boolean($('reportSmtpSecure')?.checked),
      smtp_user: $('reportSmtpUser')?.value.trim() || '',
      smtp_password: $('reportSmtpPassword')?.value || '',
      smtp_from: $('reportSmtpFrom')?.value.trim() || ''
    };
  }

  async function saveReportEmailSettings(event, options = {}) {
    event?.preventDefault();

    const form = $('reportEmailSettingsForm');
    if (!form?.reportValidity()) return false;

    showReportEmailMessage();
    setReportEmailBusy(true, options.forSend ? 'send' : 'save');

    try {
      const response = await fetch('/api/settings/report-email', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectReportEmailSettings())
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || 'Unable to save report email settings.');
      }

      renderReportEmailSettings(data.settings || {});

      if (!options.silent) {
        showReportEmailMessage(
          data.message || 'Report email settings saved successfully.',
          'success'
        );
      }

      return true;
    } catch (error) {
      showReportEmailMessage(
        error.message || 'Unable to save report email settings.'
      );
      return false;
    } finally {
      if (!options.forSend) setReportEmailBusy(false);
    }
  }

  async function sendSavedReportNow() {
    const recipients = $('reportEmailRecipients')?.value.trim();

    if (!recipients) {
      showReportEmailMessage('Add at least one recipient email address.');
      $('reportEmailRecipients')?.focus();
      return;
    }

    const saved = await saveReportEmailSettings(null, {
      silent: true,
      forSend: true
    });

    if (!saved) {
      setReportEmailBusy(false);
      return;
    }

    try {
      const response = await fetch('/api/settings/report-email/send-now', {
        method: 'POST',
        credentials: 'same-origin'
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || 'Unable to send the asset report.');
      }

      showReportEmailMessage(
        data.message || 'Asset report sent successfully.',
        'success'
      );

      await loadReportEmailSettings();
      showReportEmailMessage(
        data.message || 'Asset report sent successfully.',
        'success'
      );
    } catch (error) {
      showReportEmailMessage(
        error.message || 'Unable to send the asset report.'
      );
    } finally {
      setReportEmailBusy(false);
    }
  }

  async function initializeReportEmailSettings() {
    const openButton = $('openReportEmailSettingsBtn');
    if (!openButton) return;

    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store'
      });

      if (!response.ok) throw new Error('Unable to verify access.');

      const user = await response.json();

      if (user.role !== 'admin') {
        openButton.disabled = true;
        openButton.removeAttribute('data-bs-toggle');
        openButton.removeAttribute('data-bs-target');
        openButton.textContent = 'Administrator access required';
        return;
      }

      $('reportEmailSettingsModal')?.addEventListener(
        'show.bs.modal',
        loadReportEmailSettings
      );
      $('reportEmailSettingsForm')?.addEventListener(
        'submit',
        saveReportEmailSettings
      );
      $('sendReportNowBtn')?.addEventListener(
        'click',
        sendSavedReportNow
      );
      $('reportScheduleFrequency')?.addEventListener(
        'change',
        updateReportScheduleFields
      );
      $('automaticReportEnabled')?.addEventListener(
        'change',
        updateReportScheduleFields
      );
    } catch (_) {
      openButton.disabled = true;
      openButton.removeAttribute('data-bs-toggle');
      openButton.removeAttribute('data-bs-target');
      openButton.textContent = 'Unable to verify access';
    }
  }

  document.addEventListener('DOMContentLoaded', initializeUserManagement);
  document.addEventListener('DOMContentLoaded', initializeBackupRestore);
  document.addEventListener('DOMContentLoaded', initializeReportEmailSettings);

  window.goBack = function goBack() {
    if (document.referrer && document.referrer !== window.location.href) history.back();
    else window.location.href = '/dashboard';
  };
})();
