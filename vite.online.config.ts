import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  publicDir: 'public',
  build: {
    outDir: 'web-build',
    emptyOutDir: true,
    lib: {
      entry: 'offline/main.tsx',
      name: 'MoonlitFate',
      formats: ['iife'],
      fileName: 'app',
      cssFileName: 'app',
    },
    sourcemap: false,
  },
});
