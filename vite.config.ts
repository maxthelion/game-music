import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The demo imports the library by its package name, exactly as a host would;
// here that name points at the source so the demo never needs a prior library build.
export default defineConfig({
  base: './',
  resolve: { alias: { 'game-music': fileURLToPath(new URL('./src/index.ts', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
