// The production build (root vite.config.ts → root postcss.config.js) reads THIS
// file. It used to hold the old dark palette (apex.text = #F8FAFC) while the
// light theme lived only in frontend/tailwind.config.js — so every
// `text-apex-text` heading rendered near-white on a white page. Single source
// of truth now: reuse the frontend config, with root-relative content paths.
import frontendConfig from './frontend/tailwind.config.js';

export default {
  ...frontendConfig,
  content: [
    './frontend/index.html',
    './frontend/src/**/*.{js,ts,jsx,tsx}',
  ],
};
