# Satori rename sweep (NXSAT-639)

## 1. Scope and design

`node scripts/rename-satori.mjs` plans a repository-wide migration from
`@nuxeo-satori/platform` to `@nuxeo/satori-platform`. It is dry-run by default.
NXSAT-639 ships the tool; NXSAT-640 applies the reviewed plan in a separate change.

The planner reads tracked files, including hidden agent instructions, package metadata,
secondary-entry paths, the API snapshot, docs, generator templates, acme-extensions,
and the nuxeo-satori-template application. It derives local path replacements from
tracked filenames: `adf-hx` becomes `satori`, and filenames beginning with `hxp-`
(or `_hxp-` Sass partials) become `nxs-` (or `_nxs-`). It updates references to those
segments, extensionless imports and stems in text files. The legacy routes
`browse-adf-hx` and `search-adf-hx` become `browse-satori` and `search-satori`.
Owned hash routes in absolute loopback-app URLs (`localhost`, `127.0.0.1`, and `::1`)
also change; unrelated URL paths, query parameters, and third-party hosts remain intact.

Only selectors declared locally in TypeScript are candidates for `hxp-` to `nxs-`
replacement. Their declarations, markup and matching CSS selectors change together,
including BEM element (`__`) and modifier (`--`) suffixes on owned selector and path tokens.
This is repository tooling (extensibility Layer 3), with no new runtime API, dependency,
extension ID, endpoint, or UI. A blanket text replacement was rejected because it
would also rename upstream packages and selectors the repository does not own.

## 2. Exclusions

- CHANGELOG files and directories at any depth, case insensitive: history stays intact.
- The codemod and its self-test: their old-name rules and fixtures must remain runnable.
- This migration guide (`docs/rename-sweep.md`): historical mappings and measurements stay intact.
- Untracked files, symlinks, submodules and binary files containing a NUL byte.
- Upstream `@alfresco` package names and external HTTP(S) URLs, except the owned
  loopback-app hash routes described above.
- `Hxp` / `AdfHx` TypeScript class names and `--hxp-*` theme tokens. These are distinct
  contracts; this script does not replace them just because a selector changes.

## 3. Review a dry run

Run from the repository root on Node 20; no npm packages, Docker or Nuxeo instance
are needed by this script or its tests.

```sh
node scripts/rename-satori.mjs --dry-run --ref origin/integration/nxsat-308 --report /tmp/integration-rename.json
node scripts/rename-satori.mjs --dry-run --ref 2f57bf708e791560a05f81e0db696d687b330659 --report /tmp/wave3-rename.json
node --test scripts/rename-satori.selftest.mjs
```

`--ref` reads an immutable Git tree without switching branches or writing its files.
Omit it to inspect tracked files in the current working tree, including local edits
and skipping files deleted locally without staging.
Working-tree reads reject a symlinked repository root or symlinked directory ancestors
of tracked files, including Windows junctions. Immutable Git-tree reads do not follow
working-tree paths.
`--root` selects another repository. Keep reports outside the checkout. Report paths
are compared case-insensitively on every platform as a conservative source-protection
check, including Windows and macOS installations with case-insensitive filesystems.
Canonical paths and filesystem identity also reject symbolic-link directory aliases
and existing hard-link aliases to tracked sources.
Combining `--write` and `--dry-run` is rejected in either order.
A report contains the resolved commit, exclusions, every old/new file path, and every
changed line with its original and replacement text. Without `--report`, those edits
are printed to stdout. `secondRunChanges` checks the planned transformed tree again;
this is a virtual check, not a claim that the integration migration was applied.

The wave3 branch was merged by PR #414 and deleted. When that ref is unavailable,
use its exact merged head, `2f57bf708e791560a05f81e0db696d687b330659`, from the
second parent of integration's merge `44882d3ed`.

The final capture on integration commit `735dbea26d56054604dbdb9571180f0610ec08ba`
and that wave3 head each proposed **711 changed files, 146 moves and 2,254 changed
lines**. Both planned second runs had zero changes. These are baseline measurements,
not expected counts after subsequent merges. Re-run after NXSAT-638 merges and again
immediately before NXSAT-640 applies the migration.

Both baselines contain five selector collisions: `hxp-column-picker`, `hxp-domain-hint`,
`hxp-folder-header`, `hxp-icon`, and `hxp-spinner` would duplicate existing `nxs-`
selectors. Dry run succeeds so the report can be reviewed, but lists these as
`blockers`. Write mode refuses a plan with any blocker before modifying files.
The cleanup must remove the overlapping legacy declarations or supply a separately
reviewed naming decision; this script does not invent new public selector names.

## 4. Apply and prove idempotence (NXSAT-640)

Use a clean disposable worktree with no concurrent editors or other writers. Review the complete dry-run report and resolve every
blocker first. Write mode reads the working tree and cannot be combined with `--ref`.
Before writing, it verifies that every source still matches the plan and that no move
would overwrite an existing destination, including an untracked file. It repeats the
source check for each mutation and creates move destinations exclusively so a newly
occupied destination cannot be overwritten. It checks a moved source again before
deleting it and checks an opened in-place source before writing.
Source and destination paths are checked for symlinked ancestors before preflight
accesses and repeated around each mutation. The resolved repository root is pinned,
and applying through a symlinked root or a path outside the repository is rejected.

Application is not transactional: a filesystem error or concurrent edit detected
mid-apply may leave earlier changes and a generated move destination in place.
The byte checks do not lock other writers across the remaining check/write or
check/delete intervals. Stop other writers before applying and inspect any partial
result before retrying in a disposable worktree.

```sh
node scripts/rename-satori.mjs --report /tmp/reviewed-rename.json
node scripts/rename-satori.mjs --write
# Stage the migration so Git tracks moved files; inspect the staged diff before committing.
git add -A
node scripts/rename-satori.mjs --write
# No additional change after the second run:
git diff --stat
```

The second write must report zero files, moves and changed lines, and the final
`git diff --stat` must be empty. The first migration remains in the staged diff.
The self-test performs this sequence in throwaway repositories and checks the staged
diff is unchanged, the moved files exist, and CHANGELOG bytes remain intact.
After applying, run the integration branch's full lint, test, build and API-surface
gates: mechanical rename idempotence is not a runtime compatibility verdict.
