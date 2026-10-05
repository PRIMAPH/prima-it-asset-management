/* PRIMA shared navigation. Page scripts may continue using userName and logoutBtn. */
(function () {
    'use strict';

    const sidebarContainer = document.getElementById('sidebar');
    if (!sidebarContainer) return;

    const pagePath = window.location.pathname.toLowerCase().replace(/\/+$/, '');
    const routes = [
        { key: 'dashboard', href: '/dashboard', label: 'Dashboard', icon: 'grid-1x2', section: 'Workspace' },
        { key: 'assets', href: '/assets', label: 'Assets', icon: 'pc-display' },
        { key: 'scanner', label: 'Scan QR / Barcode', icon: 'qr-code-scan' },
        { key: 'employees', href: '/employees', label: 'Employees', icon: 'people' },
        { key: 'maintenance', href: '/maintenance', label: 'Maintenance', icon: 'tools', section: 'Operations' },
        { key: 'inventory', href: '/inventory', label: 'Inventory', icon: 'clipboard-check', staffOnly: true },
        { key: 'disposal', href: '/disposals.html', label: 'Disposal Requests', icon: 'archive' },
        { key: 'reports', href: '/reports', label: 'Reports', icon: 'bar-chart-line' },
        { key: 'custodian', href: '/custodian-forms', label: 'Custodian Forms', icon: 'file-earmark-text' },
        { key: 'clearance', href: '/clearance', label: 'Clearance', icon: 'person-check' },
        { key: 'settings', href: '/settings', label: 'Settings', icon: 'gear', section: 'System' },
        { key: 'audit', href: '/audit-logs', label: 'Audit Logs', icon: 'shield-check', adminOnly: true }
    ];
    const currentRoute = routes.find(route => pagePath.includes(route.key)) ||
        (pagePath === '' ? routes[0] : null);
    const companyLogo = `
        <img class="prima-brand-logo" src="/images/prima-company-logo.png"
            alt="Prima Fintech" width="229" height="38">`;

    sidebarContainer.innerHTML = `
        <div class="prima-mobile-bar">
            <button type="button" id="primaNavToggle" class="prima-nav-toggle"
                aria-controls="primaSidebar" aria-expanded="false" aria-label="Open navigation">
                <i class="bi bi-list" aria-hidden="true"></i>
            </button>
            <a class="prima-mobile-brand" href="/dashboard" aria-label="PRIMA IT dashboard">
                ${companyLogo}
            </a>
            <span class="prima-mobile-page">${currentRoute ? currentRoute.label : 'Workspace'}</span>
        </div>
        <div class="prima-nav-backdrop" aria-hidden="true" hidden></div>
        <aside id="primaSidebar" class="sidebar prima-sidebar" aria-label="Main navigation">
            <div class="prima-brand-row">
                <a class="brand prima-brand" href="/dashboard" aria-label="PRIMA IT dashboard">
                    ${companyLogo}
                </a>
                <button type="button" class="prima-nav-close" aria-label="Close navigation">
                    <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
            </div>
            <nav class="nav flex-column prima-navigation" aria-label="Workspace">
                ${routes.map(route => `
                    ${route.section ? `<div class="prima-nav-section">${route.section}</div>` : ''}
                    ${route.key === 'scanner' ? `
                        <button type="button" id="primaNavScan" class="nav-link prima-scan-link">
                            <i class="bi bi-${route.icon} nav-icon" aria-hidden="true"></i><span>${route.label}</span>
                        </button>` : `
                        <a class="nav-link ${route === currentRoute ? 'active' : ''}" href="${route.href}"
                            ${route.adminOnly ? 'data-prima-admin-only hidden' : ''}
                            ${route.staffOnly ? 'data-prima-staff-only hidden' : ''}
                            ${route === currentRoute ? 'aria-current="page"' : ''}>
                            <i class="bi bi-${route.icon} nav-icon" aria-hidden="true"></i><span>${route.label}</span>
                        </a>`}
                `).join('')}
            </nav>
            <div class="sidebar-bottom prima-sidebar-bottom">
                <div class="prima-account">
                    <span class="prima-account-avatar" aria-hidden="true"><i class="bi bi-person"></i></span>
                    <div class="prima-account-copy">
                        <span class="prima-account-label">Signed in</span>
                        <div id="userName">Your account</div>
                    </div>
                </div>
                <button id="logoutBtn" type="button" class="prima-logout">
                    <i class="bi bi-box-arrow-right" aria-hidden="true"></i><span>Log out</span>
                </button>
                <div id="primaNavMessage" class="prima-nav-message" role="status" hidden></div>
            </div>
        </aside>`;

    const sidebar = document.getElementById('primaSidebar');
    const toggle = document.getElementById('primaNavToggle');
    const closeButton = sidebar.querySelector('.prima-nav-close');
    const backdrop = sidebarContainer.querySelector('.prima-nav-backdrop');
    const mobile = window.matchMedia('(max-width: 900px)');
    const mainContent = document.querySelector('.main-content');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let isOpen = false;
    let mainWasInert = mainContent ? mainContent.inert : false;
    let navigationPending = false;

    function setMenuOpen(open, restoreFocus = true) {
        const wasOpen = isOpen;
        isOpen = Boolean(open && mobile.matches);
        document.body.classList.toggle('prima-nav-open', isOpen);
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
        backdrop.hidden = !isOpen;
        sidebar.inert = mobile.matches && !isOpen;
        if (mobile.matches && !isOpen) sidebar.setAttribute('aria-hidden', 'true');
        else sidebar.removeAttribute('aria-hidden');

        if (mainContent) {
            if (isOpen && !wasOpen) {
                mainWasInert = mainContent.inert;
                mainContent.inert = true;
            } else if (!isOpen && wasOpen) {
                mainContent.inert = mainWasInert;
            }
        }

        if (isOpen) closeButton.focus();
        else if (restoreFocus && mobile.matches) toggle.focus();
    }

    toggle.addEventListener('click', () => setMenuOpen(!isOpen));
    closeButton.addEventListener('click', () => setMenuOpen(false));
    backdrop.addEventListener('click', () => setMenuOpen(false));
    sidebarContainer.querySelectorAll('a[href]').forEach(link => {
        link.addEventListener('click', event => {
            if (isOpen) setMenuOpen(false, false);

            if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                link.target === '_blank' ||
                link.hasAttribute('download')
            ) return;

            const destination = new URL(link.href, window.location.href);

            if (destination.origin !== window.location.origin) return;

            if (destination.href === window.location.href) {
                event.preventDefault();
                return;
            }

            event.preventDefault();

            if (navigationPending) return;

            navigationPending = true;
            link.setAttribute('aria-busy', 'true');
            document.body.classList.add('prima-page-leaving');

            window.setTimeout(
                () => window.location.assign(destination.href),
                reduceMotion.matches ? 0 : 170
            );
        });
    });

    window.addEventListener('pageshow', () => {
        navigationPending = false;
        document.body.classList.remove('prima-page-leaving');
        sidebarContainer.querySelectorAll('[aria-busy="true"]').forEach(link => {
            link.removeAttribute('aria-busy');
        });
    });

    document.addEventListener('keydown', event => {
        if (!isOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            setMenuOpen(false);
        } else if (event.key === 'Tab') {
            const focusable = Array.from(sidebar.querySelectorAll('a[href], button:not([disabled])'))
                .filter(element => element.getClientRects().length > 0);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        }
    });

    mobile.addEventListener('change', () => setMenuOpen(false, false));
    setMenuOpen(false, false);

    document.getElementById('primaNavScan').addEventListener('click', () => {
        if (isOpen) setMenuOpen(false);
        if (typeof window.openScannerPage === 'function') {
            window.openScannerPage();
        } else {
            console.warn('PRIMA Scanner: openScannerPage() is not available.');
        }
    });

    // Populate the same account field that existing page scripts already update.
    fetch('/api/auth/me', { credentials: 'same-origin' })
        .then(response => response.ok ? response.json() : null)
        .then(user => {
            if (!user) return;
            const name = user.full_name || user.username || 'Your account';
            document.getElementById('userName').textContent = user.role ? `${name} · ${user.role}` : name;
            sidebar.querySelectorAll('[data-prima-admin-only]').forEach(link => {
                link.hidden = user.role !== 'admin';
            });
            sidebar.querySelectorAll('[data-prima-staff-only]').forEach(link => {
                link.hidden = !['admin', 'it_staff', 'technician'].includes(user.role);
            });
        })
        .catch(() => { /* Pages retain their existing session/error handling. */ });

    // A capture listener avoids duplicate requests from legacy page-specific handlers.
    const logoutButton = document.getElementById('logoutBtn');
    logoutButton.addEventListener('click', async event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (logoutButton.disabled) return;
        logoutButton.disabled = true;
        const message = document.getElementById('primaNavMessage');
        message.hidden = true;
        try {
            const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
            if (!response.ok) throw new Error('Logout failed');
            window.location.href = '/';
        } catch (error) {
            message.textContent = 'Unable to log out. Please try again.';
            message.hidden = false;
            logoutButton.disabled = false;
        }
    }, true);
})();
