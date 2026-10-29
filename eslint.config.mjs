import { lstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import nx from '@nx/eslint-plugin';

const require = createRequire(import.meta.url);

const SATORI_SCOPE = '@hylandsoftware';
const SATORI_LINT_ENTRY = `${SATORI_SCOPE}/satori-lint/eslint`;

// The Satori lint layer has to survive its own package being absent, because two builds delete
// the whole `@hylandsoftware` scope from `node_modules` on purpose before building the Material
// Storybook — `storybook-pages.yml` and ci.yml's `storybook` job — so that a Satori import fails
// the build instead of compiling into a site we publish from a public repository.
//
// Nx loads this file to infer lint targets while it computes the project graph, and that happens
// for *every* `nx run`. So a hard `require` here turned that deliberate deletion into
// `Failed to process project graph: Cannot find module '@hylandsoftware/satori-lint/eslint'`
// and took the Storybook build down with it. It did exactly that, on the two pushes to `main` of
// 2026-10-28. The require had landed on 2026-10-25, while the publishing workflow was pointed at
// a deleted branch and so never ran.
//
// ci.yml did not catch it either, and the reason is worth getting right because the obvious one
// is wrong: it is NOT that this file reaches no affected-based job. `nx show projects --affected
// --files eslint.config.mjs` returns every project in the workspace, 32 of 32, so the storybook
// job does build on a change here.
//
// It missed it for the same warm-graph reason the deploy later passed by accident. That job
// resolved what it needed with `nx show projects --affected` while `@hylandsoftware` was still
// installed, which caches the project graph; the build step then moved the scopes away and
// `nx run` reused the cached graph without re-reading this file. A green storybook build
// therefore proved nothing about the guard below.
//
// That is history, not the current shape: ci.yml's build step now computes its graph cold, after
// the scopes are removed, so it does exercise this guard — see the step itself rather than
// trusting this sentence. The fixtures in `scripts/eslint-config-satori-lint.selftest.mjs` are
// still the direct proof, and remain the only one that does not depend on a workflow's step
// order staying as it is.
//
// Absent is tolerated. Broken is not — silently dropping these rules on a half-installed package
// would be worse than failing, because lint would pass wider than it should and say nothing.
//
// The error cannot tell you which you have. Node reports `MODULE_NOT_FOUND`, with this specifier
// in the message, for at least three different situations: the scope is not installed; the
// package is installed but its `./eslint` export points at a file that is not there; and the
// package directory exists but has lost both its manifest and its entry point. Interrogating
// `error.code`, or the message, or probing `./package.json` separately, each answers "absent" for
// some state that is really broken. All of that was measured, not argued — and two such guards
// were written and discarded here before this one.
//
// So do not decode the error at all. Exactly ONE absence is legitimate: the whole
// `@hylandsoftware` scope removed from `node_modules`, which is what the token-free builds create
// on purpose. Ask that question directly, of the filesystem. One question instead of three
// inferences, and it cannot be fooled by the state of what is inside the scope.
// `lstatSync`, not `existsSync`: `existsSync` follows symlinks, so a dangling scope link — a
// broken linked install — would read as "not installed" and be tolerated. The question is whether
// an entry is THERE, not whether it points at anything.
//
// And only `ENOENT` counts as absent. `EACCES`, `ELOOP`, `ENOTDIR` and the rest fail closed, which
// is the right way round for a check whose whole job is telling a deliberate removal from a broken
// tree: an unreadable tree is not a deliberate removal. That makes the predicate total — either an
// entry is found, or it is reported missing, or something else is wrong — and the three guards this
// replaced each fell to a state outside what they modelled.
function scopeIsInstalled() {
  return (require.resolve.paths(SATORI_LINT_ENTRY) ?? []).some((dir) => {
    try {
      lstatSync(join(dir, SATORI_SCOPE));
      return true;
    } catch (error) {
      return error?.code !== 'ENOENT';
    }
  });
}

function resolveSatoriLint() {
  try {
    return require.resolve(SATORI_LINT_ENTRY);
  } catch (error) {
    // Anything other than a plain not-found, or a not-found while the scope is sitting right
    // there, is a broken install rather than a deliberately removed one.
    if (error?.code !== 'MODULE_NOT_FOUND' || scopeIsInstalled()) throw error;
    console.warn(
      `[eslint.config] ${SATORI_LINT_ENTRY} is not installed — Satori lint rules are OFF for this run. ` +
        `Expected in the token-free builds that remove ${SATORI_SCOPE}; a surprise anywhere else.`,
    );
    return null;
  }
}

const satoriLintPath = resolveSatoriLint();
// Loaded outside the try above on purpose, so an error thrown from inside satori-lint propagates
// instead of being read as the package being absent.
const satoriLint = satoriLintPath === null ? null : require(satoriLintPath);

// A rule may only be named once its plugin is registered, so the override goes with the layer
// that brings the plugin in rather than standing on its own.
//
// Gated on `satoriLintPath`, NOT on `satoriLint` being truthy. The only tolerated state is the
// resolution failure handled above; everything else must speak up. An entry that resolves and
// then exports `null`, `undefined` or `false` is a broken package, and a truthiness check here
// would quietly give it the same empty layer as a deliberate removal — without even the warning,
// since that is printed on the resolve path. This way `satoriLint.configs` throws on it, which is
// what should happen.
const satoriLintLayers =
  satoriLintPath === null
    ? []
    : [
        ...satoriLint.configs['flat/recommended'],
        {
          files: ['**/*.html'],
          rules: {
            // The remaining Material font icons are tracked by `npm run satori:check` — 6 as of
            // 2026-10-28, and five of those are deliberate, so this is a warning by choice rather
            // than a migration waiting to finish. `docs/satori-adoption-dashboard.md` has the
            // per-icon verdicts.
            '@hylandsoftware/satori-lint/eslint/no-material-font-icons': 'warn',
          },
        },
      ];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  ...satoriLintLayers,
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
