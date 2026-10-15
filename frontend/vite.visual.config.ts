import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Separate build entry: no login, API credentials, socket or production data.
// https://v5.vite.dev/guide/build.html#multi-page-app
export default defineConfig({ root: 'tests/visual', plugins: [react()],
  build: { emptyOutDir: true, sourcemap: false } });
