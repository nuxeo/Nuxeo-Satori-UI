import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/shared/testing',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'testing',
    watch: false,
    globals: true,
    // `passWithNoTests: true` was here while the library had no specs of its own, so that the
    // `test` target `review-guardrails.mjs` requires would not fail on "no test files found".
    // `nuxeo-fixtures.spec.ts` removed the reason for it, and leaving it would mean deleting
    // that spec produced a green run over nothing — the failure mode this whole branch is
    // about. Without it the deletion is immediately red. `review-guardrails.mjs` asks for the
    // flag only while a project has no specs at all, so it will say so if that day comes.
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/shared/testing',
      provider: 'v8' as const,
      // `lcov` explicitly, as in every other project's config. The Vitest defaults omit it
      // and the Nx executor swallows `--coverage.reporter`, so without this line
      // `scripts/lcov-merge.mjs` finds nothing for this project and SonarCloud reports the
      // fixtures as uncovered however many specs run against them.
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
    },
  },
}));
