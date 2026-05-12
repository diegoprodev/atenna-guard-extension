import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/popup.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'popup.js',
        inlineDynamicImports: true,
      },
    },
  },
});
