import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/tools/builder-mcp',
  test: {
    name: 'builder-mcp',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/tools/builder-mcp',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
}));
