// Actual web entrypoint smoke: no database/auth/provider credentials, no orders.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const env = { PATH: process.env.PATH, NODE_ENV: 'production', PORT: '4317', DEPLOYMENT_ROLE: 'frontend', VITE_API_URL: 'https://example.invalid' };
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', chunk => { output = (output + chunk).slice(-12000); });
child.stderr.on('data', chunk => { output = (output + chunk).slice(-12000); });
try {
  let health;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error(`Web process exited before startup: ${output}`);
    try { const response = await fetch('http://127.0.0.1:4317/health', { signal: AbortSignal.timeout(1000) }); health = await response.json(); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.equal(health?.status, 'OPERATIONAL');
  assert.equal(health.role, 'frontend');
  assert.equal(health.apiOrigin, env.VITE_API_URL);
  const home = await fetch('http://127.0.0.1:4317/', { signal: AbortSignal.timeout(1000) });
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<html/i);
  const script = html.match(/src="([^"\s]+\.js)"/);
  assert.ok(script, 'Production page must load its compiled script');
  const asset = await fetch(new URL(script[1], 'http://127.0.0.1:4317'), { signal: AbortSignal.timeout(1000) });
  assert.equal(asset.status, 200);
  assert.ok((await asset.text()).includes(env.VITE_API_URL), 'Built frontend must use the same backend origin as the web deployment');
  const api = await fetch('http://127.0.0.1:4317/api/auth/me', { signal: AbortSignal.timeout(1000) });
  assert.equal(api.status, 404, 'Frontend process must not start duplicate private API routes');
  assert.match(output, /web_server_started/);
  console.log('Production web server, assets, health, backend origin and no-secret frontend startup verified.');
} finally {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
  timer.unref();
}
