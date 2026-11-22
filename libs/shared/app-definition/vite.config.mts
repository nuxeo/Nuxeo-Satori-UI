/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';

// Plain TypeScript and Node: no Angular plugin, no DOM. The library has no Angular in it.
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/shared/app-definition',
  test: {
    name: 'shared-app-definition',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/shared/app-definition',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
}));
