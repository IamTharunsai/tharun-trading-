// Actual mounted page, local dummy HTTP only. Run solely in the offline browser jail.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
}).outputText, file);
const { TeamSessionRegistry } = require('../../../backend/src/services/teamSessions.ts');
const origin = 'http://127.0.0.1:4174', root = '/tmp/commons-live-dist', output = '/output';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
let mode = 'positive', postMode = 'ack', held = [], requests = [], cases = [], pageErrors = [];
function snapshot(actor = 'owner') {
  const registry = new TeamSessionRegistry(), asset = actor === 'next' ? 'NEW-IDENTITY' : 'SOURCE-ASSET';
  const context = { debateId: 'research-one', asset, market: 'stocks', purpose: 'RESEARCH', marketSnapshotAt: Date.now() - 1000 };
  const emit = (event, data) => registry.observe(context, event, { debateId: context.debateId, ...data }, false);
  emit('debate:start', {});
  emit('debate:agent-speaking', { agentId: 2, round: 1 });
  // Same asset, separate explicit ID and literal market; selection cannot join on asset.
  const other = { ...context, debateId: 'research-two', market: 'crypto' };
  registry.observe(other, 'debate:start', { debateId: other.debateId }, false);
  registry.observe(other, 'debate:agent-voted', { debateId: other.debateId, agentId: 2, vote: 'HOLD', confidence: 61, openingArgument: 'Second session evidence' }, false);
  // Bounded source registry produces actual omission markers; no hand-built parser bypass.
  for (let n = 0; n < 98; n++) emit('debate:agent-voted', { agentId: 3, vote: 'HOLD', openingArgument: 'x'.repeat(2200) });
  emit('debate:agent-error', { agentId: 12, round: 3, errorCode: 'final_unavailable' });
  emit('debate:master-thinking', {});
  emit('debate:complete', { transcript: { id: context.debateId, asset, market: 'stocks', purpose: 'RESEARCH',
    finalDecision: 'HOLD', finalConfidence: 64, executionApproved: false, masterSynthesis: 'Observed committee synthesis', blockReason: '', decisionId: 'dummy-decision-one' } });
  return registry.snapshot();
}
function send(res, status, data) { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname.startsWith('/api/')) {
    const actor = String(req.headers.authorization || '').replace(/^Bearer dummy-/, '');
    const request = { path: url.pathname, method: req.method, actor }; requests.push(request);
    if (!['owner', 'member', 'next'].includes(actor)) return send(res, 401, {});
    if (url.pathname === '/api/agents/sessions' && req.method === 'GET') {
      if (actor === 'member' || mode === 'forbidden') return send(res, 403, {});
      if (mode === 'unavailable') return send(res, 503, {});
      if (mode === 'unauthorized') return send(res, 401, {});
      if (mode === 'invalid') return send(res, 200, { schemaVersion: 9 });
      if (mode === 'hold' && actor === 'owner') { held.push({ res, kind: 'get' }); return; }
      const data = snapshot(actor); if (mode === 'empty') data.sessions = [];
      return send(res, 200, data);
    }
    if (url.pathname === '/api/agents/trigger-debate' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      request.body = body;
      assert.deepEqual(Object.keys(body).sort(), ['asset', 'market']);
      if (postMode === 'hold') { held.push({ res, kind: 'post' }); return; }
      return send(res, 200, { message: 'queued', asset: body.asset, status: 'running' });
    }
    return send(res, 404, {});
  }
  try {
    const appRoute = ['/', '/city', '/offices/council', '/dashboard', '/login'].includes(url.pathname);
    const target = path.resolve(root, `.${appRoute ? '/index.html' : decodeURIComponent(url.pathname)}`);
    if (!target.startsWith(`${root}/`) || !mime[path.extname(target)] || !fs.statSync(target).isFile()) throw Error();
    res.setHeader('Content-Type', mime[path.extname(target)]); fs.createReadStream(target).pipe(res);
  } catch { res.statusCode = 404; res.end(); }
});
async function run() {
  await new Promise(resolve => server.listen(4174, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  const coverage = page.locator('#workspace-coverage');
  const state = expected => page.waitForFunction(value => document.querySelector('[data-readback-state]')?.getAttribute('data-readback-state') === value, expected);
  const signIn = actor => page.evaluate(value => window.commonsFixture.signIn(value), actor);
  const refresh = () => page.getByRole('button', { name: 'Refresh observed team state', exact: true }).click();
  const research = () => page.getByRole('button', { name: 'Request research only', exact: true }).click();
  const countPosts = () => requests.filter(item => item.method === 'POST').length;
  const release = (kind, status, body) => { held.filter(item => item.kind === kind).forEach(item => send(item.res, status, body)); held = held.filter(item => item.kind !== kind); };
  const waitHeld = async kind => {
    const deadline = Date.now() + 2000;
    while (!held.some(item => item.kind === kind) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(held.some(item => item.kind === kind), `expected held ${kind} transport`);
  };
  async function check(name, fn) { await fn(); cases.push(name); process.stdout.write(`PASS ${name}\n`); }
  try {
    await page.goto(origin, { waitUntil: 'networkidle' });
    await check('signed-out-no-read-or-financial-defaults', async () => {
      await state('signed-out'); assert.equal(requests.length, 0);
      assert.match(await coverage.textContent(), /Current execution is unknown/);
      assert.match(await page.locator('[data-region="account-value"]').textContent(), /not been received/);
      assert.equal(await page.getByRole('link', { name: 'Choose asset for research', exact: true }).getAttribute('href'), '/agents/debate-room');
    });
    await check('actual-readback-selected-id-observed-not-running', async () => {
      await signIn('owner'); await state('ready');
      assert.equal(await page.locator('[data-region="review-asset"]').textContent(), 'SOURCE-ASSET');
      assert.ok(await page.evaluate(() => {
        const asset = document.querySelector('[data-region="review-asset"]');
        const market = document.querySelector('[data-region="review-market"]');
        const stage = document.querySelector('[data-region="review-stage"]');
        return asset.getBoundingClientRect().bottom <= market.getBoundingClientRect().top
          && market.getBoundingClientRect().bottom <= stage.getBoundingClientRect().top
          && getComputedStyle(asset).whiteSpace === 'nowrap'
          && getComputedStyle(asset).overflow === 'hidden';
      }), 'long instrument names must not wrap over market and stage labels');
      assert.equal(await page.locator('[data-region="specialist-state"]').textContent(), 'Work observed');
      assert.equal(await page.locator('.rainlight-state--running').count(), 0);
      assert.ok(await page.getByText('Observed issue', { exact: true }).count() > 0);
      assert.match(await coverage.textContent(), /Observed committee synthesis/);
      assert.match(await coverage.textContent(), /trade execution not observed/);
      assert.match(await coverage.textContent(), /Partial coverage/);
      assert.match(await coverage.textContent(), /Retention: 60 minutes; up to 32 sessions, 96 entries per session and 2048 characters/);
      assert.match(await coverage.textContent(), /EDT|EST/);
      assert.match(await coverage.textContent(), /no verified exchange quote timestamp/);
      assert.equal(await page.locator('[data-region="price-value"]').textContent(), 'Unavailable');
      assert.equal(await page.locator('img.rainlight-crest').getAttribute('alt'), 'Bhishma crest');
      assert.equal(await page.locator('[data-region="session-receipt"]').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      // Keep screenshots bounded to the approved viewport inside the resource-limited jail.
      fs.writeFileSync(`${output}/mounted-geometry.json`, JSON.stringify(await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      })), null, 2));
      await page.screenshot({ path: `${output}/commons-mounted.png`, fullPage: false });
      await coverage.evaluate(node => node.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `${output}/commons-coverage.png`, fullPage: false });
      await page.evaluate(() => window.scrollTo(0, 0));
    });
    await check('concurrent-same-asset-ids-stay-distinct', async () => {
      await page.getByRole('combobox', { name: 'Choose observed review' }).selectOption('research-two');
      assert.match(await coverage.textContent(), /Session research-two/);
      assert.doesNotMatch(await coverage.textContent(), /Observed committee synthesis/);
      assert.match(await page.locator('[data-region="review-market"]').textContent(), /Crypto/);
    });
    await check('research-only-literal-market-ack-is-not-session', async () => {
      const before = countPosts(); await research();
      await page.locator('[data-research-state="acknowledged"]').waitFor();
      assert.equal(countPosts(), before + 1);
      assert.deepEqual(requests.filter(item => item.method === 'POST').at(-1).body, { asset: 'SOURCE-ASSET', market: 'crypto' });
      assert.match(await coverage.textContent(), /No session identity was returned/);
      assert.equal(await page.getByRole('combobox', { name: 'Choose observed review' }).locator('option').count(), 2);
    });
    await check('pending-deduplicated-timeout-unconfirmed-no-retry', async () => {
      postMode = 'hold'; const before = countPosts(); await research();
      await page.locator('[data-research-state="pending"]').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Requesting research only', exact: true }).isDisabled(), true);
      await page.locator('[data-research-state="unconfirmed"]').waitFor({ timeout: 13_000 });
      assert.equal(countPosts(), before + 1); assert.match(await coverage.textContent(), /may have reached the server/);
      release('post', 200, { status: 'running' }); postMode = 'ack';
    });
    await check('503-hides-private-content-preserves-signin-retry', async () => {
      mode = 'unavailable'; await refresh(); await state('unavailable');
      assert.equal((await page.evaluate(() => window.commonsFixture.auth())).signedIn, true);
      assert.equal(await page.locator('[data-region="review-asset"]').textContent(), '—');
      assert.doesNotMatch(await coverage.textContent(), /Observed committee synthesis/);
      assert.match(await coverage.textContent(), /Previous readback/);
      mode = 'positive'; await page.getByRole('button', { name: 'Retry session readback' }).click(); await state('ready');
    });
    await check('403-owner-denial-removes-prior-snapshot', async () => {
      await signIn('member'); await state('forbidden');
      assert.equal(await page.getByRole('combobox', { name: 'Choose observed review' }).isDisabled(), true);
      assert.doesNotMatch(await coverage.textContent(), /SOURCE-ASSET|dummy-decision-one/);
      await signIn('owner'); await state('ready');
    });
    await check('malformed-response-is-hidden', async () => {
      mode = 'invalid'; await refresh(); await state('invalid-response');
      assert.doesNotMatch(await coverage.textContent(), /Observed committee synthesis/);
      mode = 'positive'; await refresh(); await state('ready');
    });
    await check('stale-receipt-is-explicit-not-current-execution', async () => {
      await page.evaluate(() => window.commonsFixture.ageReadback()); await state('stale');
      assert.match(await coverage.textContent(), /Older observations/); assert.match(await coverage.textContent(), /execution is unknown/);
      await refresh(); await state('ready');
    });
    await check('empty-is-bounded-coverage-not-fake-inactivity', async () => {
      mode = 'empty'; await refresh(); await state('empty');
      assert.match(await coverage.textContent(), /does not establish inactivity/);
      assert.equal(await page.getByRole('combobox', { name: 'Choose observed review' }).locator('option').count(), 1);
      mode = 'positive'; await refresh(); await state('ready');
    });
    await check('current-401-retires-actual-query-provider-and-auth', async () => {
      const before = await page.evaluate(() => window.commonsFixture.auth());
      mode = 'unauthorized'; await refresh(); await state('signed-out');
      const after = await page.evaluate(() => window.commonsFixture.auth());
      assert.equal(after.signedIn, false); assert.ok(after.epoch > before.epoch); assert.ok(after.cacheEpoch > before.cacheEpoch);
      assert.doesNotMatch(await coverage.textContent(), /SOURCE-ASSET|Observed committee synthesis/);
      mode = 'positive'; await signIn('owner'); await state('ready');
    });
    await check('late-old-read-401-cannot-retire-new-identity', async () => {
      mode = 'hold'; await refresh(); await waitHeld('get');
      mode = 'positive'; await signIn('next'); await state('ready');
      const before = await page.evaluate(() => window.commonsFixture.auth()); release('get', 401, {});
      await page.waitForTimeout(100); assert.deepEqual(await page.evaluate(() => window.commonsFixture.auth()), before);
      assert.equal(await page.locator('[data-region="review-asset"]').textContent(), 'NEW-IDENTITY');
    });
    await check('same-token-new-epoch-does-not-reuse-held-snapshot', async () => {
      await signIn('owner'); await state('ready'); mode = 'hold'; await refresh();
      await waitHeld('get');
      const before = await page.evaluate(() => window.commonsFixture.auth()); await signIn('owner'); await state('loading');
      assert.equal(await page.locator('[data-region="review-asset"]').textContent(), '—');
      assert.ok((await page.evaluate(() => window.commonsFixture.auth())).cacheEpoch > before.cacheEpoch);
      mode = 'positive'; release('get', 200, snapshot()); await state('ready');
    });
    await check('research-ack-from-retired-identity-is-discarded', async () => {
      postMode = 'hold'; await research(); await page.locator('[data-research-state="pending"]').waitFor(); await waitHeld('post');
      await signIn('next'); await state('ready'); release('post', 200, { status: 'running' }); postMode = 'ack';
      await page.waitForTimeout(100); assert.equal(await page.locator('[data-research-state]').count(), 0);
      assert.equal(await page.locator('[data-region="review-asset"]').textContent(), 'NEW-IDENTITY');
    });
    await check('exploration-links-are-real-destinations', async () => {
      await page.getByRole('button', { name: 'Review options' }).click();
      for (const [label, href] of [['Commons', '/'], ['City', '/city'], ['Council office', '/offices/council']]) assert.equal(await page.getByRole('link', { name: label, exact: true }).getAttribute('href'), href);
    });
    await check('city-links-cover-every-existing-app-tool', async () => {
      await page.getByRole('link', { name: 'City', exact: true }).click();
      await page.getByRole('heading', { name: 'A city for your work.' }).waitFor();
      const app = ts.createSourceFile('App.tsx', fs.readFileSync('/source/frontend/src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const routes = [];
      function visit(node) {
        if (ts.isJsxAttribute(node) && node.name.text === 'path' && node.initializer && ts.isStringLiteral(node.initializer)) routes.push(node.initializer.text);
        ts.forEachChild(node, visit);
      }
      visit(app);
      const tools = routes.filter(route => !route.startsWith('/')).map(route => `/${route}`);
      const doors = await page.locator('.bhishma-directory-office li a').evaluateAll(links => links.map(link => link.getAttribute('href')));
      assert.equal(tools.length, 29, '29 tool screens plus the separate login route must remain intact');
      assert.deepEqual([...doors].sort(), [...tools].sort(), 'every actual tool route has exactly one office door');
      const offices = await page.locator('.bhishma-directory-office h3 a').evaluateAll(links => links.map(link => ({ name: link.textContent, href: link.getAttribute('href') })));
      assert.equal(offices.length, 7);
      // Match the bounded Commons captures; preserve layout dimensions separately.
      fs.writeFileSync(`${output}/city-desktop-geometry.json`, JSON.stringify(await page.evaluate(() => ({
        width: window.innerWidth, height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      })), null, 2));
      await page.screenshot({ path: `${output}/city-desktop.png`, fullPage: false });
      for (const office of offices) {
        await page.locator(`a[href="${office.href}"]`).click();
        await page.getByRole('heading', { level: 1, name: office.name }).waitFor();
        await page.getByRole('link', { name: 'Back to the city' }).click();
      }
      await page.getByRole('searchbox').fill('no-such-office');
      await page.getByRole('status').filter({ hasText: 'No matching workspace' }).waitFor();
      await page.getByRole('searchbox').fill('');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile directory must not overflow');
      fs.writeFileSync(`${output}/city-mobile-geometry.json`, JSON.stringify(await page.evaluate(() => ({
        width: window.innerWidth, height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      })), null, 2));
      await page.screenshot({ path: `${output}/city-mobile.png`, fullPage: false });
      await page.locator('.bhishma-directory footer').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/city-mobile-footer.png`, fullPage: false });
      await page.getByRole('link', { name: 'Commons', exact: true }).click();
      await state('ready');
    });
    assert.deepEqual(pageErrors, []);
    assert.ok(requests.every(item => ['/api/agents/sessions', '/api/agents/trigger-debate'].includes(item.path)));
    await check('actual-app-protects-commons-city-and-office-and-keeps-dashboard-reachable', async () => {
      const postsBefore = countPosts();
      await page.setViewportSize({ width: 1536, height: 1024 });
      await page.evaluate(() => window.commonsFixture.signOut());
      for (const route of ['/city', '/offices/council', '/']) {
        await page.goto(`${origin}${route}?production-app=1`, { waitUntil: 'networkidle' });
        await page.waitForURL(`${origin}/login`);
        await page.getByTestId('login-submit').waitFor();
      }
      await signIn('owner');
      await page.goto(`${origin}/?production-app=1`, { waitUntil: 'networkidle' });
      await state('ready');
      await page.getByRole('button', { name: 'Review options' }).click();
      await page.getByRole('link', { name: 'City', exact: true }).click();
      await page.waitForURL(`${origin}/city`);
      await page.getByRole('heading', { name: 'A city for your work.' }).waitFor();
      await page.getByRole('link', { name: 'Council office', exact: true }).click();
      await page.waitForURL(`${origin}/offices/council`);
      await page.getByRole('heading', { level: 1, name: 'Council office' }).waitFor();
      await page.getByRole('link', { name: 'Trading dashboard', exact: true }).click();
      await page.waitForURL(`${origin}/dashboard`);
      await page.getByTestId('nav-home').waitFor();
      assert.equal(await page.getByTestId('nav-home').getAttribute('href'), '/');
      await page.getByTestId('nav-home').click();
      await state('ready');
      assert.deepEqual(pageErrors, []);
      assert.equal(countPosts(), postsBefore, 'navigation must not issue additional research or financial mutations');
    });
  } finally {
    fs.writeFileSync(`${output}/mounted-proof.json`, JSON.stringify({ sourceCommit: process.env.SOURCE_COMMIT,
      sourceHeadCommit: process.env.SOURCE_HEAD_COMMIT, cases, pageErrors, requestCount: requests.length,
      postCount: countPosts(), scope: 'Actual mounted Commons, SessionQueryProvider, store and Axios session interceptors against dummy localhost registry readback/research acknowledgments only. No backend auth, provider, scheduler or broker execution.' }, null, 2));
    await browser.close(); for (const item of held) item.res.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
