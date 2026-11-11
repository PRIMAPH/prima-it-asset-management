(function () {
    'use strict';
    const trigger = document.getElementById('primaReleaseNotes');
    if (!trigger) return;
    const acknowledgedKey = 'prima.lastAcknowledgedVersion';
    const notifiedKey = 'prima.lastNotifiedVersion';
    let info;
    let pending = false;
    let loading = false;
    let returnFocus;
    const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ } };
    const valid = version => /^\d+\.\d+\.\d+$/.test(version);
    const newer = (a, b) => {
        if (!valid(a) || !valid(b)) return false;
        const left = a.split('.').map(Number), right = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i];
        return false;
    };
    const dialog = document.createElement('dialog');
    dialog.className = 'prima-release-dialog';
    dialog.setAttribute('aria-labelledby', 'primaReleaseTitle');
    dialog.innerHTML = '<header class="prima-release-header"><div class="prima-release-heading"><p class="prima-release-eyebrow">PRIMA ? What?s New</p><h2 id="primaReleaseTitle">Asset Inventory System</h2><div class="prima-release-meta"></div></div><button type="button" class="prima-release-close" aria-label="Close Release Notes"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header><div class="prima-release-body" tabindex="0" aria-label="Release details"></div>';
    document.body.appendChild(dialog);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let closeTimer;
    function closeNotes() {
        if (!dialog.open || dialog.classList.contains('is-closing')) return;
        if (reducedMotion.matches) { dialog.close(); return; }
        dialog.classList.add('is-closing');
        closeTimer = window.setTimeout(() => dialog.close(), 160);
    }
    dialog.querySelector('button').onclick = closeNotes;
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeNotes(); });
    dialog.addEventListener('close', () => {
        window.clearTimeout(closeTimer);
        dialog.classList.remove('is-closing');
        const target = returnFocus && !returnFocus.closest('[inert], [hidden]')
            ? returnFocus
            : trigger.closest('[inert]') ? document.getElementById('primaNavToggle') : trigger;
        target.focus();
    });

    const notice = document.createElement('aside');
    notice.className = 'prima-release-notice';
    notice.hidden = true;
    notice.setAttribute('role', 'status');
    notice.innerHTML = '<span></span><div><button type="button">Release Notes</button><button type="button" aria-label="Dismiss new version notification">Dismiss</button></div>';
    document.body.appendChild(notice);

    function busy() {
        return Boolean(document.querySelector('.modal.show, .modal-backdrop, dialog[open], .offcanvas.show, .swal2-container') || document.body.classList.contains('prima-nav-open'));
    }
    function acknowledge() {
        write(acknowledgedKey, info.version);
        pending = false;
        notice.hidden = true;
    }
    function updateNotice() {
        const hidden = !pending || busy();
        if (notice.hidden !== hidden) notice.hidden = hidden;
        if (!hidden) write(notifiedKey, info.version);
    }
    function addText(parent, tag, text) {
        const element = document.createElement(tag);
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }
    function renderRelease(parent, release, current = false) {
        const article = parent.appendChild(document.createElement('article'));
        article.className = 'prima-release-entry';
        if (!current) {
            addText(article, 'h3', `v${release.version}`);
            addText(article, 'p', `Release date: ${release.date}`).className = 'prima-release-date';
        }
        for (const [key, title] of [['features', 'Features'], ['improvements', 'Improvements'], ['fixes', 'Bug Fixes']]) {
            const section = article.appendChild(document.createElement('section'));
            section.className = 'prima-release-section';
            addText(section, current ? 'h3' : 'h4', title);
            const items = release[key] || [];
            if (!items.length) addText(section, 'p', 'None recorded.');
            else {
                const list = section.appendChild(document.createElement('ul'));
                items.forEach(item => addText(list, 'li', item));
            }
        }
    }
    function renderNotes() {
        const body = dialog.querySelector('.prima-release-body');
        body.replaceChildren();
        const meta = dialog.querySelector('.prima-release-meta');
        meta.replaceChildren();
        if (info) addText(meta, 'span', `v${info.version}`).className = 'prima-release-badge';
        if (!info) {
            addText(body, 'p', 'Version and release information is temporarily unavailable. Check your connection and try again.');
            const retry = addText(body, 'button', 'Retry');
            retry.type = 'button';
            retry.onclick = async () => {
                retry.disabled = true;
                await refresh();
                renderNotes();
                if (info) acknowledge();
                else body.querySelector('button').focus();
            };
            return;
        }
        const current = info.releases.find(release => release.version === info.version);
        if (current) {
            const date = addText(meta, 'time', `Released ${current.date}`);
            date.dateTime = current.date;
            renderRelease(body, current, true);
        }
        else addText(body, 'p', `v${info.version} — Release notes are not available yet.`);
        const previous = info.releases.filter(release => newer(info.version, release.version));
        if (previous.length) {
            const history = body.appendChild(document.createElement('details'));
            addText(history, 'summary', 'Previous releases');
            previous.sort((a, b) => newer(a.version, b.version) ? -1 : 1).forEach(release => renderRelease(history, release));
        }
    }
    function openNotes() {
        if (busy()) return;
        returnFocus = document.activeElement;
        renderNotes();
        if (info) acknowledge();
        dialog.classList.remove('is-closing');
        dialog.showModal();
        dialog.querySelector('.prima-release-body').scrollTop = 0;
    }
    trigger.addEventListener('click', openNotes);
    notice.querySelectorAll('button')[0].onclick = openNotes;
    notice.querySelectorAll('button')[1].onclick = acknowledge;
    new MutationObserver(updateNotice).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'open'], childList: true });
    window.addEventListener('storage', event => {
        if (info && [acknowledgedKey, notifiedKey].includes(event.key) && event.newValue === info.version) {
            pending = false;
            updateNotice();
        }
    });
    async function refresh() {
        if (loading) return;
        loading = true;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
            if (!response.ok) throw new Error('Version metadata unavailable');
            const next = await response.json();
            if (!valid(next.version) || !Array.isArray(next.releases)) throw new Error('Invalid version metadata');
            next.releases = next.releases.filter(release => release && valid(release.version) && typeof release.date === 'string' &&
                ['features', 'improvements', 'fixes'].every(key => Array.isArray(release[key]) && release[key].every(item => typeof item === 'string')));
            trigger.disabled = false;
            trigger.title = 'View release notes';
            if (info && info.version === next.version) return;
            info = next;
            document.getElementById('primaVersion').textContent = `v${info.version.endsWith('.0') ? info.version.slice(0, -2) : info.version}`;
            trigger.disabled = false;
            const acknowledged = read(acknowledgedKey);
            if (!acknowledged) write(acknowledgedKey, info.version);
            pending = Boolean(acknowledged && newer(info.version, acknowledged) && read(notifiedKey) !== info.version);
            notice.querySelector('span').textContent = `What’s New in v${info.version}`;
            updateNotice();
        } catch {
            trigger.disabled = false;
            trigger.title = info ? 'Showing the last loaded version; refresh is temporarily unavailable.' : 'Version information is unavailable. Open release notes to retry.';
        }
        finally { window.clearTimeout(timeout); loading = false; }
    }
    window.addEventListener('focus', refresh);
    window.setInterval(() => { if (!document.hidden) refresh(); }, 300000);
    refresh();
})();
