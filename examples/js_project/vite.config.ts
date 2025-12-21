import { defineConfig } from 'vite';
import moonbit from 'vite-plugin-moonbit';

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
