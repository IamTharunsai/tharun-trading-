import 'dotenv/config';
import path from 'path';
import express from 'express';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function start() {
  const PORT = Number(process.env.PORT ?? 3000);
  if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be an integer between 1 and 65535');

  const role = (process.env.DEPLOYMENT_ROLE ?? 'unified').trim().toLowerCase();
  if (role !== 'frontend' && role !== 'unified') throw new Error('DEPLOYMENT_ROLE must be frontend or unified');
  let app: express.Express;
  let boot: (port: number) => Promise<void>;
  if (role === 'frontend') {
    // The separate web deployment uses the existing backend. Never import its
    // auth/database modules or start a second scheduler in this process.
    const apiUrl = new URL(process.env.VITE_API_URL ?? '');
    if (apiUrl.protocol !== 'https:' || apiUrl.username || apiUrl.password || apiUrl.pathname !== '/' || apiUrl.search || apiUrl.hash) {
      throw new Error('Frontend VITE_API_URL must be an HTTPS origin without credentials or a path');
    }
    app = express();
    app.disable('x-powered-by');
    const webServer = http.createServer(app);
    app.get(['/health', '/api/health'], (_req, res) => res.json({
      status: 'OPERATIONAL', role: 'frontend', apiOrigin: apiUrl.origin,
      revision: /^[a-f0-9]{40}$/i.test(process.env.RAILWAY_GIT_COMMIT_SHA ?? '') ? process.env.RAILWAY_GIT_COMMIT_SHA : null,
    }));
    app.all('/api/*', (_req, res) => res.status(404).json({ error: 'This web service uses the configured backend API.' }));
    boot = port => new Promise((resolve, reject) => {
      webServer.once('error', reject);
      webServer.listen(port, '0.0.0.0', () => {
        console.info(JSON.stringify({ event: 'web_server_started', role: 'frontend', port, apiOrigin: apiUrl.origin }));
        resolve();
      });
    });
  } else {
    const backend = await import('./backend/src/index');
    app = backend.app;
    boot = backend.boot;
  }

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0' },
      appType: 'spa',
      root: path.resolve(__dirname, 'frontend'),
    });
    app.use(vite.middlewares);
  }

  await boot(PORT);
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
