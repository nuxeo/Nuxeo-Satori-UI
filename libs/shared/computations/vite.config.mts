/// <reference types='vitest' />
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { defineConfig } from 'vitest/config';

/**
 * Every spec runs twice, once in each of these zones: one east of UTC and one west, because each
 * reading of a date can only be seen failing on one side (`AGENTS/08-bug-patterns.md`, pattern 29;
 * `src/lib/zones.testing.ts` says which). The suite supports those two zones and no other, so it
 * does not take `SATORI_TEST_TZ`: its expectations are literals written for each.
 *
 * Each project sets `TZ` in its own forked process. A fork's `process.env.TZ` moves the zone of
 * everything that process runs, its modules' top level included; a worker thread's would not, which
 * is why the pool is named. `src/lib/suite-timezone.spec.ts` fails if a run is in any other zone,
 * or if this list and `zones.testing.ts`'s differ. The list is written here rather than imported,
 * because Vite's native config loader cannot import TypeScript.
 */
const ZONES = ['Asia/Calcutta', 'America/New_York'];

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/shared/computations',
  // Plain TypeScript and Node: no Angular plugin, no DOM. The path plugin resolves
  // `@agentic-ui/shared/app-definition`, the one library this one imports.
  plugins: [nxViteTsPaths()],
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    pool: 'forks' as const,
    projects: ZONES.map((zone) => ({
      extends: true as const,
      test: { name: `shared-computations ${zone}`, env: { TZ: zone } },
    })),
    coverage: {
      reportsDirectory: '../../../coverage/libs/shared/computations',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
}));
