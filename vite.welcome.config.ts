import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/welcome/welcome.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'welcome.js',
        inlineDynamicImports: true,
      },
    },
  },
});
