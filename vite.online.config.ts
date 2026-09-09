import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';

const moonlitRoot = fileURLToPath(new URL('./apps/tests/moonlit-fate/', import.meta.url));

export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [react()],
  resolve: { alias: { '@': moonlitRoot } },
  css: { postcss: { plugins: [tailwindcss()] } },
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('./web-build/tests/moonlit-fate', import.meta.url)),
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./apps/tests/moonlit-fate/entry/main.tsx', import.meta.url)),
      name: 'MoonlitFate',
      formats: ['iife'],
      fileName: 'app',
      cssFileName: 'app',
    },
    sourcemap: false,
  },
});
