import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/tools/builder-mcp',
  test: {
    name: 'builder-mcp',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // The pipeline tests run the real pipeline, a second or so each and several in one test, while
    // the spec files run side by side: 5 seconds, vitest's default, is what one of them took once
    // the preview's spec ran beside it.
    testTimeout: 30_000,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/tools/builder-mcp',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
}));
