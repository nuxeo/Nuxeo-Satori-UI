import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/tools/satori-generators',
  test: {
    name: 'satori-generators',
    watch: false,
    globals: true,
    environment: 'node',
    // `scripts/build-platform-generators.mjs` leaves `*.spec.ts` out of the published package.
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/tools/satori-generators',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
    },
  },
}));
