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
    dialog.innerHTML = '<header><div><p>What’s New</p><h2 id="primaReleaseTitle">Asset Inventory System</h2></div><button type="button" aria-label="Close release notes">×</button></header><div class="prima-release-body"></div>';
    document.body.appendChild(dialog);
    dialog.querySelector('button').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
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
    function renderRelease(parent, release) {
        addText(parent, 'h3', `v${release.version}`);
        addText(parent, 'p', `Release date: ${release.date}`);
        for (const [key, title] of [['features', 'Features'], ['improvements', 'Improvements'], ['fixes', 'Bug fixes']]) {
            addText(parent, 'h4', title);
            const items = release[key] || [];
            if (!items.length) addText(parent, 'p', 'None recorded.');
            else {
                const list = parent.appendChild(document.createElement('ul'));
                items.forEach(item => addText(list, 'li', item));
            }
        }
    }
    function renderNotes() {
        const body = dialog.querySelector('.prima-release-body');
        body.replaceChildren();
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
        if (current) renderRelease(body, current);
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
        dialog.showModal();
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
