const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const puppeteer = require('puppeteer');

test('employee list uses viewport space with a sticky header and visible toolbar', async () => {
  const browser = await puppeteer.launch({ headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => request.abort());
    await page.setContent(fs.readFileSync('public/employees.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, ''));
    for (const path of ['public/vendor/bootstrap/bootstrap.min.css', 'public/css/app.css', 'public/css/dark-theme.css', 'public/css/dark-components.css', 'public/css/navigation.css', 'public/css/employees.css']) {
      await page.addStyleTag({ content: fs.readFileSync(path, 'utf8') });
    }
    await page.addStyleTag({ content: '.main-content { animation: none; }' });
    await page.addScriptTag({ content: fs.readFileSync('public/js/employees.js', 'utf8').replace(/init\(\);\s*$/, '') });
    await page.evaluate(() => {
      currentUser = { role: 'admin' };
      employees = Array.from({ length: 19 }, (_, i) => ({ id: i + 1, employee_id: `EMP-${i + 1}`, full_name: `Employee ${i + 1}`, email: `employee${i + 1}@example.com`, department_name: 'IT', position_title: 'Engineer', status: 'active' }));
      renderEmployees();
      window.actions = [];
      viewEmployee = id => actions.push(['view', id]);
      editEmployee = id => actions.push(['edit', id]);
      deleteEmployee = id => actions.push(['delete', id]);
      setupEmployeeSelection();
    });
    for (const [width, height] of [[1366, 768], [1920, 1080]]) {
      for (const zoom of [1, 1.25]) {
        // Desktop browser zoom reduces the CSS viewport and scales its pixels.
        await page.setViewport({ width: Math.floor(width / zoom), height: Math.floor(height / zoom), deviceScaleFactor: zoom });
        await page.evaluate(() => { clearEmployeeSelection(); document.querySelector('.employee-table-scroll').scrollTop = 0; });
        const before = await page.$eval('[aria-label="Selected employee actions"]', el => el.getBoundingClientRect().top);
        assert.equal(await page.$$eval('#employeeTableBody tr[data-employee-id]', rows => rows.length), 19);
        const dimensions = await page.$eval('.employee-table-scroll', el => ({ height: el.clientHeight, total: el.scrollHeight }));
        assert.ok(dimensions.height > 80 && dimensions.total > dimensions.height, `${width}x${height} at ${zoom}`);
        await page.evaluate(() => { const container = document.querySelector('.employee-table-scroll'); container.scrollTop = container.scrollHeight; });
        await page.click('tr[data-employee-id="19"]');
        const state = await page.evaluate(() => {
          const container = document.querySelector('.employee-table-scroll').getBoundingClientRect();
          const toolbar = document.querySelector('[aria-label="Selected employee actions"]').getBoundingClientRect();
          const headers = [...document.querySelectorAll('#employeeTable th')].map(el => el.getBoundingClientRect());
          const cells = [...document.querySelector('tr[data-employee-id="19"]').cells].map(el => el.getBoundingClientRect());
          return {
            scrollY, pageHeight: document.documentElement.scrollHeight, viewport: innerHeight,
            toolbarTop: toolbar.top, toolbarBottom: toolbar.bottom,
            selected: document.querySelector('tr[data-employee-id="19"]').getAttribute('aria-selected'),
            sticky: headers.every(rect => Math.abs(rect.top - container.top) < 2),
            aligned: headers.every((rect, i) => Math.abs(rect.left - cells[i].left) < 2 && Math.abs(rect.width - cells[i].width) < 2)
          };
        });
        assert.equal(state.scrollY, 0);
        assert.ok(state.pageHeight <= state.viewport + 1, JSON.stringify(state));
        assert.ok(Math.abs(state.toolbarTop - before) < 2);
        assert.ok(state.toolbarTop >= 0 && state.toolbarBottom < state.viewport);
        assert.equal(state.selected, 'true');
        assert.equal(state.sticky, true);
        assert.equal(state.aligned, true);
        for (const id of ['selectedEmployeeViewBtn', 'selectedEmployeeEditBtn', 'selectedEmployeeDeleteBtn']) await page.click('#' + id);
        assert.deepEqual(await page.evaluate(() => actions.slice(-3)), [['view', 19], ['edit', 19], ['delete', 19]]);
        console.log(`Scroll/header/toolbar/selection passed: ${width}x${height}, ${zoom * 100}% zoom geometry`);
      }
    }
    await page.screenshot({ path: 'tmp/employee-scroll-layout.png' });
  } finally { await browser.close(); }
});

test('employee rows: single selection, keyboard, toolbar, filters and stale responses', async () => {
  const browser = await puppeteer.launch({ headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', r => r.abort());
    await page.setContent(fs.readFileSync('public/employees.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, ''));
    for (const path of ['public/vendor/bootstrap/bootstrap.min.css', 'public/css/app.css', 'public/css/dark-theme.css', 'public/css/dark-components.css', 'public/css/navigation.css', 'public/css/employees.css']) {
      await page.addStyleTag({ content: fs.readFileSync(path, 'utf8') });
    }
    await page.evaluate(() => {
      window.bootstrap = { Modal: class {
        constructor(el) { this.el = el; }
        show() { this.el.classList.add('show'); }
        hide() { this.el.classList.remove('show'); this.el.dispatchEvent(new Event('hidden.bs.modal')); }
      } };
      window.records = [
        { id: 7, employee_id: 'EMP-900', full_name: 'Alex Example', status: 'active', department_id: 2 },
        { id: 12, employee_id: 'EMP-100', full_name: 'Sam Example', status: 'inactive', department_id: 3 }
      ];
      window.requests = [];
      window.fetch = async (url, options = {}) => {
        requests.push({ url, method: options.method });
        let data;
        if (url === '/api/auth/me') data = { id: 1, full_name: 'Admin', role: 'admin' };
        else if (url === '/api/departments') data = [{ id: 2, name: 'IT' }, { id: 3, name: 'Finance' }];
        else if (url.endsWith('/assets')) data = [];
        else if (url.startsWith('/api/employees?')) {
          const params = new URLSearchParams(url.split('?')[1]);
          data = records.filter(r => (!params.get('search') || r.full_name.includes(params.get('search')))
            && (!params.get('department_id') || String(r.department_id) === params.get('department_id'))
            && (!params.get('status') || r.status === params.get('status')));
          if (window.holdList) {
            window.holdList = false;
            await new Promise(resolve => { window.releaseList = resolve; });
          }
        } else data = records.find(r => r.id === Number(url.split('/').pop()));
        return { ok: true, json: async () => data };
      };
    });
    await page.addScriptTag({ content: fs.readFileSync('public/js/employees.js', 'utf8') });
    await page.waitForSelector('tr[data-employee-id="12"]');
    const buttons = () => page.$$eval('[id^="selectedEmployee"][id$="Btn"]', els => els.map(e => e.disabled));
    const selected = () => page.$$eval('#employeeTableBody tr[aria-selected="true"]', rows => rows.map(r => Number(r.dataset.employeeId)));
    assert.deepEqual(await buttons(), [true, true, true]);
    assert.equal(await page.$$eval('#employeeTable thead th', els => els.length), 6);
    assert.equal(await page.$('#employeeTable input[type="checkbox"], #employeeTable button'), null);
    await page.click('tr[data-employee-id="7"] td:nth-child(3)');
    assert.deepEqual(await selected(), [7]);
    assert.deepEqual(await buttons(), [false, false, false]);
    assert.equal(await page.$eval('tr[data-employee-id="7"]', row => row.classList.contains('employee-row-selected')), true);
    assert.equal(await page.$eval('tr[data-employee-id="7"] td', cell => getComputedStyle(cell).borderLeftColor), 'rgb(45, 212, 191)');
    await page.screenshot({ path: 'tmp/employee-selection-desktop.png' });
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.$eval('[aria-label="Selected employee actions"]', el => {
      const bounds = el.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= window.innerWidth;
    }), true);
    await page.setViewport({ width: 1280, height: 900 });
    await page.click('tr[data-employee-id="12"]');
    assert.deepEqual(await selected(), [12]);
    await page.click('tr[data-employee-id="12"]');
    assert.deepEqual(await selected(), []);
    await page.focus('tr[data-employee-id="7"]');
    await page.keyboard.press('Enter');
    assert.deepEqual(await selected(), [7]);
    assert.equal(await page.$eval('tr[data-employee-id="7"]', row => getComputedStyle(row).outlineStyle), 'solid');
    await page.keyboard.press('Space');
    assert.deepEqual(await selected(), []);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    assert.deepEqual(await selected(), [12]);
    await page.click('#selectedEmployeeViewBtn');
    await page.waitForFunction(() => document.getElementById('viewEmployeeName').textContent === 'Sam Example');
    await page.evaluate(() => employeeViewModal.hide());
    await page.click('#selectedEmployeeEditBtn');
    await page.waitForFunction(() => document.getElementById('fullName').value === 'Sam Example');
    await page.evaluate(() => employeeModal.hide());
    await page.click('#selectedEmployeeDeleteBtn');
    await page.waitForFunction(() => document.getElementById('deleteEmployeeName').textContent === 'Sam Example');
    assert.equal(await page.evaluate(() => requests.some(r => r.method === 'DELETE')), false);
    await page.evaluate(() => employeeDeleteModal.hide());

    // Search clears immediately, before the debounce and response.
    await page.type('#searchInput', 'Alex');
    assert.deepEqual(await buttons(), [true, true, true]);
    await page.waitForFunction(() => document.querySelectorAll('#employeeTableBody tr[data-employee-id]').length === 1);
    await page.click('tr[data-employee-id="7"]');
    await page.select('#departmentFilter', '3');
    assert.deepEqual(await buttons(), [true, true, true]);
    await page.waitForFunction(() => document.getElementById('employeeTableBody').textContent.includes('No employees found'));
    await page.evaluate(async () => { $('searchInput').value = ''; $('departmentFilter').value = ''; await loadEmployees(); });
    await page.click('tr[data-employee-id="7"]');
    await page.select('#statusFilter', 'inactive');
    assert.deepEqual(await buttons(), [true, true, true]);
    await page.waitForSelector('tr[data-employee-id="12"]');
    // An older response must never restore hidden records or selection.
    await page.evaluate(async () => {
      $('statusFilter').value = ''; window.holdList = true;
      const stale = loadEmployees();
      $('statusFilter').value = 'active'; await loadEmployees();
      releaseList(); await stale;
    });
    assert.equal(await page.$('tr[data-employee-id="12"]'), null);
    assert.deepEqual(await buttons(), [true, true, true]);
    await page.evaluate(() => { currentUser = { role: 'viewer' }; selectEmployeeRow(7); });
    assert.deepEqual(await buttons(), [false, true, true]);
  } finally { await browser.close(); }
});
