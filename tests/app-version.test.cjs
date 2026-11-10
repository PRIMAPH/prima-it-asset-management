const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const puppeteer = require('puppeteer');
const { versionInfo, versionHandler } = require('../services/app-version');

test('release metadata stays synchronized and endpoint exposes only public release data', async () => {
  require('../scripts/check-release.cjs');
  const app = express();
  app.get('/api/version', versionHandler);
  app.use(express.static(path.resolve('public')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const script = await fetch(`http://127.0.0.1:${server.address().port}/js/release-notes.js?v=2`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /(?:text|application)\/javascript/);
    assert.match(await script.text(), /function openNotes/);
    const changelog = await fetch(`http://127.0.0.1:${server.address().port}/changelog.json`);
    assert.equal(changelog.status, 200);
    assert.match(changelog.headers.get('content-type'), /application\/json/);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/version`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const info = await response.json();
    assert.deepEqual(Object.keys(info).sort(), ['releases', 'systemName', 'version']);
    assert.equal(info.version, require('../package.json').version);
    for (const release of info.releases) assert.deepEqual(Object.keys(release).sort(), ['date', 'features', 'fixes', 'improvements', 'version']);
    // Simulate loading a newly deployed package at process startup.
    const sandbox = { module: { exports: {} }, require: name => name.includes('package.json') ? { version: '1.1.0', secret: 'must-not-leak' } : { releases: [] } };
    vm.runInNewContext(fs.readFileSync('services/app-version.js', 'utf8'), sandbox);
    assert.equal(sandbox.module.exports.versionInfo().version, '1.1.0');
    assert.equal(JSON.stringify(sandbox.module.exports.versionInfo()).includes('must-not-leak'), false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('missing script and unavailable metadata offer retry without breaking navigation', async () => {
  let missingScript = true;
  let metadata = 'unavailable';
  const app = express();
  app.get('/js/release-notes.js', (req, res, next) => missingScript ? res.status(404).send('Not found') : next());
  app.get('/api/version', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (metadata === 'unavailable') return res.status(503).json({ message: 'Unavailable' });
    if (metadata === 'malformed') return res.json({ version: 'bad' });
    res.json(versionInfo());
  });
  app.get('/api/auth/me', (req, res) => res.json({ role: 'admin' }));
  app.use(express.static(path.resolve('public')));
  app.get('/dashboard', (req, res) => res.send('<!doctype html><html><body><div id="sidebar"></div><main class="main-content"></main><script src="/js/navbar.js?v=8"></script></body></html>'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, pipe: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}/dashboard`);
    await page.waitForFunction(() => document.getElementById('primaVersion').textContent.includes('retry'));
    assert.equal(await page.$eval('.prima-navigation a[href="/assets"]', el => el.getAttribute('href')), '/assets');
    missingScript = false;
    await page.click('#primaReleaseNotes');
    await page.waitForFunction(() => document.getElementById('primaReleaseNotes').title.includes('Version information is unavailable'));
    await page.click('#primaReleaseNotes');
    await page.waitForSelector('dialog[open]');
    assert.match(await page.$eval('.prima-release-body', el => el.textContent), /temporarily unavailable/);
    metadata = 'malformed';
    await page.click('.prima-release-body button');
    await page.waitForSelector('.prima-release-body button:not(:disabled)');
    assert.match(await page.$eval('.prima-release-body', el => el.textContent), /temporarily unavailable/);
    metadata = 'valid';
    await page.click('.prima-release-body button');
    await page.waitForFunction(() => document.getElementById('primaVersion').textContent === 'v1.0');
    assert.match(await page.$eval('.prima-release-dialog', el => el.textContent), /v1\.0\.0/);
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]', { hidden: true });
    metadata = 'unavailable';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.getElementById('primaReleaseNotes').title.includes('last loaded version'));
    assert.equal(await page.$eval('#primaVersion', el => el.textContent), 'v1.0');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('sidebar, modal, deployed updates, persistent notifications, and mobile navigation', async () => {
  let deployed = versionInfo();
  const app = express();
  app.get('/api/version', (req, res) => res.set('Cache-Control', 'no-store').json(deployed));
  app.get('/api/auth/me', (req, res) => res.json({ full_name: 'Test user', role: 'admin' }));
  app.use(express.static(path.resolve('public')));
  app.get(['/dashboard', '/employees'], (req, res) => res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/vendor/bootstrap/bootstrap.min.css"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/navigation.css"></head><body><div id="sidebar"></div><main class="main-content">Test workspace</main><script src="/js/navbar.js"></script></body></html>`));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, pipe: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin + '/dashboard');
    await page.waitForFunction(() => document.getElementById('primaVersion')?.textContent === 'v1.0');
    assert.equal(await page.$eval('.prima-system-name', el => el.textContent), 'Asset Inventory System');
    assert.equal(await page.$eval('.prima-release-notice', el => el.hidden), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('prima.lastAcknowledgedVersion')), '1.0.0');
    const layout = await page.evaluate(() => ({ logo: document.querySelector('#primaSidebar .prima-brand-logo').getBoundingClientRect().bottom, name: document.querySelector('.prima-system-name').getBoundingClientRect().top }));
    assert.ok(layout.name >= layout.logo);
    await page.click('#primaReleaseNotes');
    await page.waitForSelector('dialog[open]');
    assert.match(await page.$eval('.prima-release-dialog', el => el.textContent), /v1\.0\.0.*2026-11-09/s);
    assert.equal(await page.$('details'), null);
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]', { hidden: true });

    deployed = { ...deployed, version: '1.0.1', releases: [{ version: '1.0.1', date: '2026-11-10', features: [], improvements: [], fixes: ['Test fixture fix'] }, ...deployed.releases] };
    await page.evaluate(() => { const modal = document.createElement('div'); modal.className = 'modal show'; modal.id = 'existingWorkflow'; document.body.appendChild(modal); window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => document.getElementById('primaVersion').textContent === 'v1.0.1');
    assert.equal(await page.$eval('.prima-release-notice', el => el.hidden), true);
    assert.equal(await page.$('dialog[open]'), null);
    await page.evaluate(() => document.getElementById('existingWorkflow').remove());
    await page.waitForFunction(() => !document.querySelector('.prima-release-notice').hidden);
    await page.click('.prima-release-notice button');
    await page.waitForSelector('dialog[open]');
    assert.match(await page.$eval('.prima-release-body', el => el.textContent), /Test fixture fix/);
    assert.ok(await page.$('details'));
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]', { hidden: true });
    await page.reload();
    await page.waitForFunction(() => document.getElementById('primaVersion').textContent === 'v1.0.1');
    assert.equal(await page.$eval('.prima-release-notice', el => el.hidden), true);

    deployed = { ...deployed, version: '1.1.0' };
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => !document.querySelector('.prima-release-notice').hidden);
    // Showing alone suppresses repeated notifications across refreshes.
    await page.reload();
    await page.waitForFunction(() => document.getElementById('primaVersion').textContent === 'v1.1');
    assert.equal(await page.$eval('.prima-release-notice', el => el.hidden), true);
    deployed = { ...deployed, version: '1.1.1' };
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => !document.querySelector('.prima-release-notice').hidden);
    await page.click('.prima-release-notice button[aria-label]');
    assert.equal(await page.evaluate(() => localStorage.getItem('prima.lastAcknowledgedVersion')), '1.1.1');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('primaVersion').textContent === 'v1.1.1');
    assert.equal(await page.$eval('.prima-release-notice', el => el.hidden), true);

    await page.setViewport({ width: 390, height: 844 });
    await page.click('#primaNavToggle');
    await page.waitForFunction(() => document.body.classList.contains('prima-nav-open'));
    await page.click('#primaReleaseNotes');
    await page.waitForSelector('dialog[open]');
    assert.equal(await page.evaluate(() => document.body.classList.contains('prima-nav-open')), false);
    assert.equal(await page.$eval('dialog', el => el.getBoundingClientRect().width <= innerWidth), true);
    assert.match(await page.$eval('.prima-release-body', el => el.textContent), /not available yet/);
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]', { hidden: true });
    await page.click('#primaNavToggle');
    await Promise.all([page.waitForNavigation(), page.click('.prima-navigation a[href="/employees"]')]);
    assert.equal(new URL(page.url()).pathname, '/employees');
    await page.waitForSelector('#primaReleaseNotes:not(:disabled)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
