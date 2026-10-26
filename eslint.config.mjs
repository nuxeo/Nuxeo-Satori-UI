import { createRequire } from 'node:module';
import nx from '@nx/eslint-plugin';

const require = createRequire(import.meta.url);
const satoriLint = require('@hylandsoftware/satori-lint/eslint');

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  ...satoriLint.configs['flat/recommended'],
  {
    files: ['**/*.html'],
    rules: {
      // 513 Material font icons → Satori SVG icons is a separate migration tracked by
      // `npm run satori:icons`. Warn so lint stays green while SDSC tracks progress.
      '@hylandsoftware/satori-lint/eslint/no-material-font-icons': 'warn',
    },
  },
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vitest.config.*.timestamp*',
      '**/vite.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          // The identity guard is one `.mjs` module shared by the Node harnesses and the e2e
          // fixtures (NXSAT-643), so both sides reject the same answers. `scripts/` is not an Nx
          // project, so the e2e import is "external"; allowed by exact path, not by directory.
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            '^(\\.\\./)+scripts/beta-harness/identity-guard\\.mjs$',
          ],
          // `sourceTag: '*'` -> `onlyDependOnLibsWithTags: ['*']` — Nx's scaffolded
          // default — was here until 2026-08-24. The rule was `error` the whole time and
          // could not reject a single edge, so CLAUDE.md's "Never cross-feature imports —
          // shared logic goes in `libs/shared/`" had no enforcement at all. It was being
          // violated four times: `browse` and `document-detail` both reached into
          // `features/collections` for the permission dialogs, and `libs/shared/drawers`
          // depended on `features/assets` and `features/search` — a shared library
          // depending on features, the arrow pointing the wrong way.
          //
          // Four projects were also untagged, which under a real constraint set is
          // indistinguishable from "may not be depended on". They are tagged now.
          //
          // Verified by reverting one import and watching lint go red before trusting it.
          depConstraints: [
            // Apps and the customer template are leaves: everything may depend on them,
            // they may depend on anything. An app composing features is the point.
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:data-access',
                'type:util',
                'type:extension',
                'type:publishable',
              ],
            },
            // A feature may use shared building blocks and may NOT use another feature.
            // Two features needing the same component means the component is shared, and
            // the fix is to move it — which is what happened to the permission dialogs.
            {
              sourceTag: 'scope:features',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:core', 'type:testing'],
            },
            // Shared code must not depend on a feature. This is the direction that makes
            // a shared library un-shareable, and it is the one `libs/shared/drawers` got
            // backwards while re-exporting two feature components and being imported by
            // nobody.
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:core', 'type:testing'],
            },
            // The lowest layer. `libs/core` underpins shared code, so it may not reach up.
            {
              sourceTag: 'scope:core',
              onlyDependOnLibsWithTags: ['scope:core'],
            },
            // The live-Nuxeo integration harness. It issues `DELETE /nuxeo/api/v1/path/…` and
            // `Document.Trash`, so it may read the platform it drives and **nothing may depend
            // on it**: no rule above lists `type:integration-test`, which is what makes it
            // undependable. That is the whole point of the tag, and it is stated here rather
            // than left as an absence for someone to read as an oversight and "fix".
            //
            // It was tagged `['scope:shared', 'type:integration-test']`, and Nx permits a
            // dependency when *any* tag matches, so `scope:shared` let every feature library
            // import it while `type:integration-test` appeared in no rule at all.
            //
            // A source rule is required, not optional: with no matching `sourceTag` Nx reports
            // `projectWithoutTagsCannotHaveDependencies` and the harness could not import the
            // platform services it is built on.
            {
              sourceTag: 'type:integration-test',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:core', 'type:testing'],
            },
            // A customer extension library must see only what a customer sees: the
            // published platform entry points. **This rule cannot enforce that**, and the
            // limitation is worth stating rather than papering over.
            //
            // `tsconfig.base.json` maps `@nuxeo/satori-platform/extensions` to
            // `libs/shared/extensions/src/index.ts`, so in the project graph the supported
            // specifier and a raw `@agentic-ui/shared-extensions` are the *same edge* to
            // the *same* project. A tag constraint sees projects, not specifiers, so it
            // cannot distinguish them — `type:publishable` alone rejected all five of
            // `acme-extensions`' entirely legitimate imports.
            //
            // What does enforce it is `libs/platform/guardrails/check-extension-library.mjs`
            // check 2, which works on the specifier text and fails any import that is not
            // one of the six published entry points. It runs against this very library in
            // the `customer-guardrails` gate. So the guarantee holds; it is just not this
            // rule's to make.
            {
              sourceTag: 'type:extension',
              onlyDependOnLibsWithTags: ['type:publishable', 'scope:shared', 'type:testing'],
            },
            // The published package's own entry points wrap the shared libraries.
            {
              sourceTag: 'type:publishable',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:core', 'type:testing'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-duplicate-imports': 'error',
      // Angular 22 made OnPush the default. NXSAT-670 gave every component an explicit Eager
      // strategy to preserve Angular 21 behaviour, which is exactly what this rule forbids —
      // 126 errors across 11 projects, and no other error class. Adopting OnPush is separate
      // work, one surface at a time with tests (docs/angular-22-migration.md). Revisit by
      // 2027-06-30: delete this line and the rule reports every component still to convert.
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',
    },
  },
];
