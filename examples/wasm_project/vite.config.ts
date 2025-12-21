import { defineConfig } from 'vite';
// import moonbit from 'vite-plugin-moonbit';
import moonbit from '../../dist/index.mjs';

export default defineConfig({
  plugins: [
    moonbit({
      target: 'wasm-gc',
    })
  ]
});
