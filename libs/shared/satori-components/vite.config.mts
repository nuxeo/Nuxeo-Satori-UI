/// <reference types='vitest' />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

/**
 * Pin the time zone the suite runs in, because several of its assertions are only meaningful
 * outside UTC (NXSAT-727).
 *
 * A date field edits a calendar day anchored in UTC. In UTC, anchoring it locally and anchoring it
 * in UTC produce byte-identical results, so in UTC no assertion can tell the two apart — and CI
 * runners are UTC. That is how a picked day being stored as local midnight passed this suite while
 * the layout row showed the previous day for every user east of Greenwich.
 *
 * `Asia/Calcutta` is the zone the defect was reported from, and its half-hour offset also catches
 * a conversion that rounds to whole hours. Set here rather than in `test-setup.ts` because Node
 * reads the zone once at startup: it has to be in the environment before the worker exists.
 *
 * It deliberately **overrides** an inherited `TZ`, so the suite's verdict is the same on every
 * machine. `SATORI_TEST_TZ` is the way to ask for a different one — a named variable rather than
 * `TZ` precisely so that running in another zone is a deliberate act and cannot happen by
 * inheriting a shell. `metadata-editor-skipped-day.spec.ts` needs `Pacific/Apia`; see its header.
 */
process.env['TZ'] = process.env['SATORI_TEST_TZ'] ?? 'Asia/Calcutta';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/shared/satori-components',
  plugins: [angular(), nxViteTsPaths()],
  test: {
    name: 'satori-components',
    watch: false,
    // Under full-suite load a spec can run several seconds. The 5s Vitest default turned
    // that load into failures, so the limit is set for the whole project.
    testTimeout: 30_000,
    globals: true,
    environment: 'jsdom',
    include: [
      '{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      '.storybook/**/*.spec.ts',
    ],
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    pool: 'threads',
    forceExit: true,
    coverage: {
      reportsDirectory: '../../../coverage/libs/shared/satori-components',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
    },
  },
}));
