import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  root: __dirname,
  plugins: [vue()],
  base: './',
  build: {
    outDir: resolve(__dirname, '../../dist/renderer'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
