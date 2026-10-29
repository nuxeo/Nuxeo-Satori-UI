import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

/**
 * The `test` target's config — the half of this library that needs no Nuxeo.
 *
 * ## Why there is a second config rather than a second glob
 *
 * `project.json` explains at length that the live target is called `integration`, not `test`,
 * so that no `-t test` invocation can reach specs requiring a server CI does not have. That
 * reasoning is intact and this config is what keeps it intact: the two `include` patterns are
 * **disjoint by construction**, not by an exclusion list someone has to remember to extend.
 *
 *   vitest.config.mts       ->  *.integration.spec.ts   live Nuxeo, `integration` target
 *   vitest.unit.config.mts  ->  *.unit.spec.ts          no Nuxeo,   `test` target
 *
 * A file cannot match both patterns, so a live spec cannot arrive in the `test` run by
 * accident of naming, and adding one to this run takes a rename that is visible in a diff.
 *
 * ## What earns a spec a place here
 *
 * `integration-preflight.ts` and `preflight-cli.ts` decide whether the suite is allowed to
 * run at all, and `preflight-cli.ts` decides with which exit code. Under the `integration`
 * target neither is ever exercised on CI — the target does not run there — so the gate that
 * guards the suite had nothing guarding it. Stubbing `fetch` tests the decision, not the
 * server, which is the line this library's audit draws: the harness's live halves are NOT
 * here, because mocking a `DELETE` against a real repository would test the mock.
 *
 * No `setupFiles`: `vitest.setup.ts` initialises Angular's TestBed for one live spec, and
 * nothing in the unit run has an Angular dependency to initialise.
 */
export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/integration-tests-unit',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'integration-tests-unit',
    watch: false,
    // Under full-suite load a spec can run several seconds. The 5s Vitest default turned
    // that load into failures, so the limit is set for the whole project.
    testTimeout: 30_000,
    globals: true,
    // `node`, matching the live config: the code under test uses `Buffer`, `fetch` and
    // `AbortSignal.timeout`, and none of it touches a DOM.
    environment: 'node',
    include: ['src/**/*.unit.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/integration-tests',
      provider: 'v8' as const,
      // `lcov` explicitly. The Vitest defaults do not include it and the Nx executor swallows
      // `--coverage.reporter`, so without this line `scripts/lcov-merge.mjs` finds no report
      // for this project and SonarCloud reports its files as uncovered — which is
      // indistinguishable from there being no tests at all.
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
      // Vitest 4 leaves a file no spec imports out of the report instead of counting it at 0%,
      // which took `user-fixtures.ts` and `vitest.setup.ts` out of the denominator. Listing them
      // keeps the measurement Vitest 3 made. The live specs are excluded: this run never loads them.
      include: ['src/**/*.ts', 'vitest.setup.ts'],
      exclude: ['src/**/*.spec.ts'],
    },
  },
}));
