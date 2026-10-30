/// <reference types='vitest' />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

/**
 * Pin the time zone the suite runs in: several of its date assertions are only able to fail outside
 * UTC (NXSAT-727).
 *
 * A date field edits a calendar day anchored in UTC. In UTC, anchoring it locally and anchoring it
 * in UTC produce byte-identical results, so in UTC no assertion can tell the two apart — and CI
 * runners are UTC. `satori-components` pins the same zone, for the same reason; see
 * `AGENTS/08-bug-patterns.md` pattern 28, which also records why setting `process.env.TZ` from
 * inside a case does not work.
 *
 * It deliberately **overrides** an inherited `TZ`, so the suite's verdict is the same on every
 * machine. `SATORI_TEST_TZ` is the way to ask for a different one — a named variable rather than
 * `TZ` precisely so that running in another zone is a deliberate act and cannot happen by
 * inheriting a shell. `satori-components` resolves the pin the same way.
 *
 * `nx.json` lists `SATORI_TEST_TZ` as an `env` input on the `test` targets, so asking for
 * another zone cannot be answered from the default zone's cache. Without that, the second
 * run of a documented verification command returns the first run's result and reads as proof.
 */
process.env['TZ'] = process.env['SATORI_TEST_TZ'] ?? 'Asia/Calcutta';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/shared/ui',
  plugins: [angular(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  // Uncomment this if you are using workers.
  // worker: {
  //   plugins: () => [ nxViteTsPaths() ],
  // },
  test: {
    name: 'ui',
    watch: false,
    // Under full-suite load a spec can run several seconds. The 5s Vitest default turned
    // that load into failures, so the limit is set for the whole project.
    testTimeout: 30_000,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    // Pin the worker pool explicitly: the Vitest default pool crashes under
    // Node 20 in Nx/CI for this project before any test output is emitted.
    pool: 'threads',
    // zone.js keeps the Node.js event loop alive after Angular TestBed teardown;
    // forceExit ensures Vitest can always exit cleanly in CI.
    forceExit: true,
    coverage: {
      reportsDirectory: '../../../coverage/libs/shared/ui',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
    },
  },
}));
