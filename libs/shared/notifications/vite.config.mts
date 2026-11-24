/// <reference types='vitest' />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

/**
 * Pin the time zone the suite runs in. The bell shows each item's instant in the reader's zone
 * (AGENTS/08-bug-patterns.md, pattern 29), and in UTC an instant shown in UTC and one shown in the
 * reader's zone are the same text, so no assertion could tell them apart. CI runners are UTC.
 *
 * It overrides an inherited `TZ` on purpose, so the verdict is the same on every machine;
 * `SATORI_TEST_TZ` asks for another zone, and the project's `test` target lists it as an input, so
 * that run is not answered from the default zone's cache. `suite-timezone.spec.ts` asserts the pin.
 */
process.env['TZ'] = process.env['SATORI_TEST_TZ'] ?? 'Asia/Calcutta';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/shared/notifications',
  plugins: [angular(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'shared-notifications',
    watch: false,
    // Under full-suite load a spec can run several seconds. The 5s Vitest default turned
    // that load into failures, so the limit is set for the whole project.
    testTimeout: 30_000,
    passWithNoTests: true,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/shared/notifications',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
    },
  },
}));
