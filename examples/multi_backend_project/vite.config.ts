import { defineConfig } from 'vite';
import moonbit from 'vite-plugin-moonbit';

// Vite builds workers with a separate plugin pipeline, so re-instantiate the
// wasm-gc plugin for `worker.plugins` to keep `mbtw:` resolvable there.
export default defineConfig({
  plugins: [
    moonbit({ target: 'js' }),                          // mbt:* (main)
    moonbit({ target: 'wasm-gc', prefix: 'mbtw:' }),    // mbtw:* (main)
  ],
  worker: {
    // Use ES-module workers so the Wasm init's top-level await works.
    format: 'es',
    plugins: () => [
      moonbit({ target: 'wasm-gc', prefix: 'mbtw:', watch: false }),
    ],
  },
  server: { port: 3473 },
});
