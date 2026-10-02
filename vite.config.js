import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  build: {
    rollupOptions: {
      input: {
        generator: resolve(import.meta.dirname, 'index.html'),
        scanner: resolve(import.meta.dirname, 'scan/index.html'),
      },
    },
  },
});
