// Vite 5 loads a CJS config without writing a temporary ESM file into the source.
// The isolated fixture still builds the actual React workspace component.
// https://v5.vite.dev/config/
module.exports = {
  root: 'tests/visual',
  esbuild: { jsx: 'automatic' },
  build: { emptyOutDir: true, sourcemap: false },
};
