import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
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
      // Vitest 4 leaves a file no spec imports out of the report instead of counting it at 0%,
      // which hid the four extension generators and `library-context.ts`. Listing the sources keeps
      // them in the denominator.
      include: ['src/**/*.ts'],
    },
  },
}));
