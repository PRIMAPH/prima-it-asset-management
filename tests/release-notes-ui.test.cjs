const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const puppeteer = require('puppeteer');
const { versionInfo } = require('../services/app-version');

test('release dialog layout, long content, keyboard focus and reduced motion across viewports', async () => {
  const info = structuredClone(versionInfo());
  info.releases[0].features.push(...Array.from({ length: 24 }, (_, i) => `Long release note fixture ${i + 1}: verify readable wrapping and scrolling within the release dialog.`));
  const app = express();
  app.get('/api/version', (req, res) => res.json(info));
  app.use(express.static(path.resolve('public')));
  app.get('/preview', (req, res) => res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/vendor/bootstrap/bootstrap.min.css"><link rel="stylesheet" href="/css/dark-theme.css"><link rel="stylesheet" href="/css/dark-components.css"><link rel="stylesheet" href="/css/navigation.css?v=5"></head><body><button id="primaReleaseNotes"><span id="primaVersion"></span>Release Notes</button><script src="/js/release-notes.js?v=3"></script></body></html>`));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, pipe: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/preview`);
    await page.waitForFunction(() => document.getElementById('primaVersion').textContent === 'v1.0');
    for (const [width, height] of [[1366, 900], [768, 1024], [390, 844], [360, 640], [844, 390]]) {
      await page.setViewport({ width, height });
      await page.click('#primaReleaseNotes');
      await page.waitForSelector('dialog[open]');
      await page.evaluate(() => Promise.all(document.querySelector('dialog').getAnimations().map(animation => animation.finished)));
      assert.equal(await page.$eval('.prima-release-badge', el => el.textContent), 'v1.0.0');
      assert.equal(await page.$eval('.prima-release-meta time', el => el.dateTime), info.releases[0].date);
      assert.deepEqual(await page.$$eval('.prima-release-section h3', nodes => nodes.map(el => el.textContent)), ['Features', 'Improvements', 'Bug Fixes']);
      const geometry = await page.evaluate(() => {
        const dialog = document.querySelector('dialog').getBoundingClientRect();
        const header = document.querySelector('.prima-release-header').getBoundingClientRect();
        const close = document.querySelector('.prima-release-close').getBoundingClientRect();
        const body = document.querySelector('.prima-release-body');
        body.scrollTop = body.scrollHeight;
        return {
          fits: dialog.left >= 0 && dialog.right <= innerWidth && dialog.top >= 0 && dialog.bottom <= innerHeight,
          scrolls: body.scrollHeight > body.clientHeight && body.scrollTop > 0,
          noHorizontalScroll: body.scrollWidth <= body.clientWidth,
          fixedHeader: document.querySelector('.prima-release-header').getBoundingClientRect().top === header.top,
          closeAtTopRight: close.right <= header.right && close.right > header.right - 30 && close.top < header.top + 30
        };
      });
      assert.ok(Object.values(geometry).every(Boolean), `${width}x${height}: ${JSON.stringify(geometry)}`);
      await page.click('.prima-release-close');
      await page.waitForSelector('dialog[open]', { hidden: true });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'primaReleaseNotes');
      console.log(`Release dialog layout passed: ${width}x${height}`);
    }
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.click('#primaReleaseNotes');
    assert.equal(await page.$eval('dialog', el => getComputedStyle(el).animationName), 'none');
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('dialog', el => el.open), false);
    await page.click('#primaReleaseNotes');
    assert.equal(await page.$eval('.prima-release-body', el => el.scrollTop), 0);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
