import { defineConfig } from 'vite';
import moonbit from '../dist/index.js';

export default defineConfig({
  plugins: [
    moonbit({
      // test ディレクトリ自体が MoonBit プロジェクト
      watch: false,
      showLogs: true,
    })
  ],
  server: {
    port: 3456,
  }
});
