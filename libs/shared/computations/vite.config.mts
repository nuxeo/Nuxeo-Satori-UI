/// <reference types='vitest' />
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { defineConfig } from 'vitest/config';

/**
 * Pin the time zone the suite runs in. A record's date is a calendar day anchored in UTC, and
 * `today` is read in the reader's zone (src/lib/dates.ts). In UTC the two readings are the same, so
 * no assertion could tell them apart, and CI runners are UTC: `AGENTS/08-bug-patterns.md`, pattern
 * 29. `libs/shared/ui` pins the same zone, the same way.
 *
 * It overrides an inherited `TZ`, so the verdict is the same on every machine. `SATORI_TEST_TZ`
 * asks for another zone, and the test target lists it as an input, so that a run in another zone
 * cannot be answered from the cache. `src/lib/suite-timezone.spec.ts` fails if the pin is lost.
 */
process.env['TZ'] = process.env['SATORI_TEST_TZ'] ?? 'Asia/Calcutta';

// Plain TypeScript and Node: no Angular plugin, no DOM. The path plugin resolves
// `@agentic-ui/shared/app-definition`, the one library this one imports.
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/shared/computations',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'shared-computations',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/shared/computations',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
}));
