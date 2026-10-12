import 'dotenv/config';
import path from 'path';
import express from 'express';
import { fileURLToPath } from 'url';
import { app, server, boot } from './backend/src/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function start() {
  const PORT = Number(process.env.PORT ?? 3000);
  if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be an integer between 1 and 65535');

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
