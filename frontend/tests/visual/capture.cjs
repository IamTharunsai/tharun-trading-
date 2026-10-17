// CI-only isolated browser proof; never connect to a live account or broker.
// https://playwright.dev/docs/docker
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = '/tmp/commons-dist';
const output = '/output';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://127.0.0.1:4173').pathname);
    const target = path.resolve(root, `.${requested === '/' ? '/index.html' : requested}`);
    if (!target.startsWith(`${root}/`) || !mime[path.extname(target)] || !fs.statSync(target).isFile()) throw new Error('not found');
    res.setHeader('Content-Type', mime[path.extname(target)]);
    fs.createReadStream(target).pipe(res);
  } catch { res.statusCode = 404; res.end('not found'); }
});
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(4173, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1,
      reducedMotion: 'reduce', serviceWorkers: 'block' });
    const failures = [];
    await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4173'
      ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', () => failures.push('page_error'));
    page.on('requestfailed', request => failures.push(new URL(request.url()).origin === 'http://127.0.0.1:4173' ? 'local_asset_failed' : 'external_request_blocked'));
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
    await page.locator('.rainlight-plate').first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.rainlight-plate').length === 4 && document.images.length === 5 && [...document.images].every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await page.locator('img.rainlight-crest').count(), 1);
    await page.evaluate(() => document.fonts.ready);
    const regions = await page.locator('.rainlight-plate').evaluateAll(images => images.map(image => {
      const box = image.getBoundingClientRect();
      return { className: image.className, x: box.x, y: box.y, width: box.width, height: box.height,
        naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
    }));
    const lettering = await page.evaluate(() => ({
      fontsReady: { display: document.fonts.check('24px Alike'), body: document.fonts.check('14px "IBM Plex Sans"') },
      regions: ['session-status', 'review-asset', 'review-market', 'review-stage', 'review-caption', 'specialist-index', 'forecast-label']
        .map(id => {
          const node = document.querySelector(`[data-region="${id}"]`);
          const style = getComputedStyle(node);
          return { id, fontFamily: style.fontFamily, fontSize: style.fontSize, fontStretch: style.fontStretch,
            lineHeight: style.lineHeight, width: node.clientWidth, height: node.clientHeight,
            contentWidth: node.scrollWidth, contentHeight: node.scrollHeight };
        }),
    }));
    fs.writeFileSync(`${output}/plate-render.json`, JSON.stringify({ stage: 'semantic_first_viewport', viewport: { width: 1536, height: 1024 },
      regions, lettering, pageErrors: failures, sourceCommit: process.env.SOURCE_COMMIT, sourceHeadCommit: process.env.SOURCE_HEAD_COMMIT,
      scope: 'Rendered isolated fixture, not live agent, financial or audio behavior.' }, null, 2));
    assert.equal(regions.length, 4); assert.deepEqual(failures, []);
    assert.equal(lettering.fontsReady.display, true); assert.equal(lettering.fontsReady.body, true);
    const expected = [{ x: 0, y: 0, width: 210, height: 1024 }, { x: 210, y: 0, width: 663, height: 166 },
      { x: 873, y: 0, width: 663, height: 166 }, { x: 210, y: 211, width: 941, height: 506 }];
    regions.forEach((region, index) => Object.keys(expected[index]).forEach(key => assert.ok(Math.abs(region[key] - expected[index][key]) < 0.2, `plate_geometry_${index}_${key}`)));
    await page.screenshot({ path: `${output}/hero-repro.png`, fullPage: false });
    await page.locator('[data-region="station-5"] button').click();
    assert.equal(await page.locator('[data-region="specialist-name"]').textContent(), '5. Risk Manager');
    assert.equal(await page.locator('[data-region="station-5"] button').getAttribute('aria-pressed'), 'true');
    await page.getByRole('tab', { name: 'Notes', exact: true }).click();
    assert.match(await page.getByRole('tabpanel', { name: 'Notes', exact: true }).textContent(), /No attributable notes/);
    await page.getByRole('tab', { name: 'Notes', exact: true }).press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: 'Handoffs', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('tab', { name: 'Handoffs', exact: true }).evaluate(node => document.activeElement === node), true);
    await page.getByRole('button', { name: 'Previous specialist', exact: true }).click();
    assert.equal(await page.locator('[data-region="specialist-name"]').textContent(), '4. Fundamental');
    await page.locator('[data-region="station-2"] button').click();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    assert.match(await page.getByRole('tabpanel', { name: 'History', exact: true }).textContent(), /Sample source observation/);
    await page.getByRole('combobox', { name: 'Choose observed review', exact: true }).selectOption('fixture-review-complete');
    await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
    assert.equal(await page.locator('[data-region="review-asset"]').textContent(), 'AAPL');
    assert.equal(await page.locator('[data-region="price-value"]').textContent(), 'Unavailable');
    assert.equal(await page.locator('[data-region="specialist-state"]').textContent(), 'Not observed');
    await page.locator('[data-region="fault-status"] button').click();
    assert.equal(await page.locator('[data-region="review-asset"]').textContent(), 'NU');
    assert.equal(await page.locator('[data-region="specialist-name"]').textContent(), '12. Options Flow');
    assert.equal(await page.locator('[data-region="specialist-state"]').textContent(), 'Observed issue');
    fs.writeFileSync(`${output}/interaction-proof.json`, JSON.stringify({ viewport: { width: 1536, height: 1024 },
      sourceCommit: process.env.SOURCE_COMMIT, sourceHeadCommit: process.env.SOURCE_HEAD_COMMIT,
      cases: ['select-specialist', 'unknown-notes', 'keyboard-tabs', 'previous-specialist',
        'attributed-history', 'review-selection-clears-previous-evidence', 'fault-opens-attributable-review'], scope: 'Isolated fixture interactions, not backend or live trading proof.' }, null, 2));
    await context.close();
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(() => { process.stderr.write('commons_visual_proof_failed\n'); process.exitCode = 1; });
