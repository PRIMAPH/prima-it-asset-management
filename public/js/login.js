const loginParams = new URLSearchParams(window.location.search);
const requestedReturnTo = loginParams.get('returnTo');
let safeReturnTo = '/dashboard';

if (requestedReturnTo) {
  try {
    const returnUrl = new URL(requestedReturnTo, window.location.origin);

    if (returnUrl.origin === window.location.origin) {
      safeReturnTo =
        `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
    }
  } catch (_) {
    safeReturnTo = '/dashboard';
  }
}

if (loginParams.get('session') === 'expired') {
  const alertBox = document.getElementById('alertBox');

  if (window.PRIMAAlerts) {
    window.PRIMAAlerts.show(
      alertBox,
      'Your session expired. Please sign in again.',
      { type: 'warning', duration: 6000 }
    );
  } else {
    alertBox.textContent = 'Your session expired. Please sign in again.';
  }
}

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const alertBox = document.getElementById('alertBox');
  alertBox.innerHTML = '';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: document.getElementById('username').value, password: document.getElementById('password').value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Login failed');
    window.location.replace(safeReturnTo);
  } catch (error) {
    alertBox.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
  }
});
