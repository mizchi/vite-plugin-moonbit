import { defineConfig } from 'vite';
import moonbit from '../../dist/index.mjs';

export default defineConfig({
  plugins: [
    moonbit({
      watch: true,
      showLogs: true,
    })
  ],
  server: {
    port: 3456,
  }
});
