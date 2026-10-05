async function loadSummary() {
  const response = await fetch('/api/dashboard/summary', {
    cache: 'no-store'
  });

  if (!response.ok) return;

  const summary = await response.json();
  document.getElementById('totalAssets').textContent = summary.total_assets ?? 0;
  document.getElementById('availableAssets').textContent = summary.available ?? 0;
  document.getElementById('assignedAssets').textContent = summary.assigned ?? 0;
  document.getElementById('repairAssets').textContent = summary.for_repair ?? 0;
  document.getElementById('disposalAssets').textContent = summary.for_disposal ?? 0;
}

async function init() {
  const me = await fetch('/api/auth/me');
  if (!me.ok) return window.location.href = '/';
  const user = await me.json();
  document.getElementById('userName').textContent = `${user.full_name} · ${user.role}`;

  await loadSummary();
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

init();

window.addEventListener('focus', loadSummary);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadSummary();
});
