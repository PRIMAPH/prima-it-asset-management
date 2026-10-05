// ============================================================
// PRIMA GLOBAL ALERT MANAGER
// ============================================================

// Send the whole browser to login when an API call reports that
// the session has expired. Login requests are excluded so invalid
// credentials can still display their normal validation message.
(function installSessionRedirect() {
  'use strict';

  if (window.__primaSessionRedirectInstalled) return;

  window.__primaSessionRedirectInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  let redirecting = false;

  window.fetch = async function primaSessionFetch(input, init) {
    const response = await nativeFetch(input, init);

    if (response.status !== 401) {
      return response;
    }

    if (redirecting) {
      return new Promise(() => {});
    }

    let requestUrl;

    try {
      requestUrl = new URL(
        typeof input === 'string' || input instanceof URL
          ? input
          : input.url,
        window.location.href
      );
    } catch (_) {
      return response;
    }

    const isApiRequest =
      requestUrl.origin === window.location.origin &&
      requestUrl.pathname.startsWith('/api/');

    const isLoginRequest =
      requestUrl.pathname === '/api/auth/login';

    const isLoginPage =
      window.location.pathname === '/' ||
      window.location.pathname === '/login.html';

    if (!isApiRequest || isLoginRequest || isLoginPage) {
      return response;
    }

    redirecting = true;

    const returnTo =
      `${window.location.pathname}${window.location.search}${window.location.hash}`;

    window.location.replace(
      `/?session=expired&returnTo=${encodeURIComponent(returnTo)}`
    );

    // Keep legacy page handlers from replacing the redirect with their
    // own fallback URL while the browser is unloading this page.
    return new Promise(() => {});
  };
})();

(function () {
  'use strict';

  const timers = new WeakMap();
  const closing = new WeakSet();
  const observedAlerts = new WeakSet();

  const style = document.createElement('style');
  style.textContent = `
    .alert.prima-alert.fade {
      transform: translateY(-6px);
      transition: opacity .45s ease, transform .45s ease;
    }

    .alert.prima-alert.fade.show {
      transform: translateY(0);
    }
  `;
  document.head.appendChild(style);

  function clearTimer(alert) {
    const timer = timers.get(alert);

    if (timer) {
      window.clearTimeout(timer);
      timers.delete(alert);
    }
  }

  function isHidden(alert) {
    return alert.hidden || alert.classList.contains('d-none');
  }

  function isTransient(alert) {
    if (alert.matches('[data-alert-persistent]')) return false;

    if (
      alert.matches(
        '.alert-dismissible, [role="alert"], [data-prima-alert]'
      )
    ) {
      return true;
    }

    if (/alert/i.test(alert.id || '')) return true;

    const container = alert.parentElement?.closest('[id]');
    return /alert/i.test(container?.id || '');
  }

  function durationFor(alert) {
    if (alert.dataset.alertDuration) {
      const duration = Number(alert.dataset.alertDuration);
      if (Number.isFinite(duration) && duration >= 0) return duration;
    }

    if (alert.classList.contains('alert-danger')) return 6000;
    if (alert.classList.contains('alert-warning')) return 5000;
    return 4000;
  }

  function finishDismissal(alert) {
    if (!alert.isConnected) return;

    if (alert.dataset.primaAlertReusable === 'true') {
      alert.classList.add('d-none');
      alert.classList.remove('show');
      alert.textContent = '';
      return;
    }

    alert.remove();
  }

  function dismiss(alert) {
    if (!(alert instanceof Element) || !alert.isConnected) return;

    clearTimer(alert);
    closing.add(alert);

    if (
      window.bootstrap?.Alert &&
      alert.dataset.primaAlertReusable !== 'true'
    ) {
      window.bootstrap.Alert.getOrCreateInstance(alert).close();
      return;
    }

    alert.classList.remove('show');

    const finish = () => finishDismissal(alert);
    alert.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, 550);
  }

  function prepare(alert, options = {}) {
    if (!(alert instanceof Element) || !alert.classList.contains('alert')) {
      return null;
    }

    if (!options.force && !isTransient(alert)) {
      clearTimer(alert);
      return alert;
    }

    if (isHidden(alert)) {
      clearTimer(alert);
      return alert;
    }

    if (closing.has(alert)) {
      if (alert.dataset.primaAlertReusable !== 'true') return alert;
      closing.delete(alert);
    }

    ['prima-alert', 'fade', 'show'].forEach(className => {
      if (!alert.classList.contains(className)) {
        alert.classList.add(className);
      }
    });

    if (!alert.hasAttribute('role')) {
      alert.setAttribute('role', 'alert');
    }

    if (!observedAlerts.has(alert)) {
      observedAlerts.add(alert);

      alert.addEventListener('close.bs.alert', () => {
        clearTimer(alert);
        closing.add(alert);
      });

      alert.addEventListener('closed.bs.alert', () => {
        clearTimer(alert);
      });
    }

    clearTimer(alert);

    const duration = options.duration ?? durationFor(alert);
    if (duration === 0) return alert;

    timers.set(
      alert,
      window.setTimeout(() => dismiss(alert), duration)
    );

    return alert;
  }

  function show(container, message, options = {}) {
    if (!(container instanceof Element)) return null;

    const type = options.type || 'success';
    const dismissible = options.dismissible !== false;
    const alert = document.createElement('div');

    alert.className = `alert alert-${type}${dismissible ? ' alert-dismissible' : ''}`;
    alert.setAttribute('role', 'alert');

    const messageNode = document.createElement('span');
    messageNode.textContent = String(message ?? '');
    alert.appendChild(messageNode);

    if (dismissible) {
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'btn-close';
      closeButton.setAttribute('data-bs-dismiss', 'alert');
      closeButton.setAttribute('aria-label', 'Close');
      alert.appendChild(closeButton);
    }

    container.replaceChildren(alert);
    return prepare(alert, { ...options, force: true });
  }

  function scan(root) {
    if (!(root instanceof Element) && root !== document) return;

    if (root instanceof Element && root.matches('.alert')) {
      prepare(root);
    }

    root.querySelectorAll?.('.alert').forEach(alert => prepare(alert));
  }

  function start() {
    // Existing alert elements with IDs are reused by their page scripts.
    document.querySelectorAll('.alert[id]').forEach(alert => {
      alert.dataset.primaAlertReusable = 'true';
    });

    scan(document);

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes') {
          prepare(mutation.target);
          return;
        }

        mutation.addedNodes.forEach(node => {
          if (node instanceof Element) scan(node);
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden']
    });
  }

  window.PRIMAAlerts = {
    show,
    prepare,
    dismiss
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
