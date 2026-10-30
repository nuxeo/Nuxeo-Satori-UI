/**
 * The tracked files `sanitizer-audit.selftest.mjs` perturbs, and crash-safe recovery for them.
 *
 * The selftest proves each audit check can fail by writing the defect **into the real tracked
 * file**, running the audit, and restoring the original. That design is deliberate and stays: a
 * fixture in a temp tree would stop exercising the real type graph, which is the whole point of
 * checks 4 and 5. What this module adds is recovery after the one failure mode no handler can
 * cover.
 *
 * The selftest already guards a thrown error (`finally`), `SIGINT`, `SIGTERM`, `SIGHUP` and
 * `uncaughtException`. **`SIGKILL` is uncatchable**, and killing a process tree sends exactly
 * that — so stopping a `beta:gate` run mid-control left a perturbed source file on disk. Its own
 * comment said the recovery was "`git checkout` on the paths named in the failure output", and
 * that is unreachable in the case it was written for: a `SIGKILL`ed process prints no failure
 * output, so nothing names the paths. The next person to learn anything was whoever ran the gate
 * afterwards, and what they saw was `sanitizer-audit` failing in a file nowhere near their diff
 * (NXSAT-751).
 *
 * So a marker file records, outside the process, what has been perturbed and how to undo it. The
 * next selftest run reads it and repairs the tree. A marker survives `SIGKILL`, a power loss and a
 * killed container; a signal handler survives none of them.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every tracked path a control may perturb.
 *
 * Exported so three things cannot drift apart: the selftest asserts each `edit()` target is listed
 * here, recovery knows what it may touch, and `sanitizer-audit` knows which of its own findings
 * might be a leftover rather than a real defect. Registering a path is therefore not bookkeeping —
 * `edit()` throws on an unlisted one, so a new perturbation cannot be added without it.
 *
 * `.ai/state/sanitizer-allowlist.json` belongs here for the same reason as the source files, and
 * is the one most worth recovering: a leftover there changes which bypasses the audit treats as
 * accounted for, so the audit stays green while the budget it enforces is wrong. Observed — the
 * first reproduction of NXSAT-751 left `"B": 1` as `"B": 0`.
 */
export const PERTURBED_PATHS = Object.freeze([
  '.ai/state/sanitizer-allowlist.json',
  // The audit perturbs *itself* in one control, to prove a check cannot be silently removed. Easy
  // to miss when surveying what gets touched — a survey of `libs/` and `apps/` finds nine files
  // and this is the eleventh — which is exactly why `edit()` refuses an unlisted path rather than
  // leaving the list to be kept in step by hand.
  'scripts/beta-harness/sanitizer-audit.mjs',
  'libs/features/document-detail/src/lib/document-detail/document-detail.ts',
  'libs/features/document-detail/src/lib/note-editor/note-editor.ts',
  'libs/features/knowledge-discovery/src/lib/kd-citation-dialog/kd-citation-dialog.ts',
  'libs/shared/nuxeo-client/src/index.ts',
  'libs/shared/nuxeo-client/src/lib/utils/navigable-url.ts',
  'libs/shared/nuxeo-client/src/lib/utils/render-trusted-html.ts',
  'libs/shared/nuxeo-client/src/lib/utils/trust-object-url.ts',
  'libs/shared/ui/src/lib/document-viewer/document-viewer.component.html',
  'libs/shared/ui/src/lib/document-viewer/document-viewer.component.ts',
]);

/**
 * Where the marker lives. Gitignored, and deliberately inside `.ai/state/` — beside the allowlist
 * the selftest perturbs, rather than in `os.tmpdir()`, because a marker that a reboot or a tmp
 * sweep can delete is a marker that fails exactly when the machine crashed.
 */
export const MARKER = '.ai/state/.sanitizer-selftest-interrupted.json';

/** The environment flag the selftest sets on the audit it invokes itself. See {@link isLeftover}. */
export const SELFTEST_ENV_FLAG = 'SANITIZER_SELFTEST_RUNNING';

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Record the perturbations currently in force, so a process that dies without running its
 * handlers leaves behind enough to undo them.
 *
 * Stores each file's `original` bytes and a **hash** of the perturbed bytes rather than both
 * copies: recovery only needs to *compare* against what it wrote, and hashing halves a marker that
 * would otherwise hold up to ~470 KB of source. `original` is stored in full because it cannot be
 * recovered any other way — `git checkout` would restore the *index* version, which silently
 * destroys an uncommitted edit the developer already had in the file before the selftest ran.
 *
 * @param {string} root repository root
 * @param {Map<string, { original: string, written: string }>} backups
 */
export function writeMarker(root, backups) {
  if (backups.size === 0) {
    removeMarker(root);
    return;
  }
  const paths = {};
  for (const [relPath, { original, written }] of backups) {
    paths[relPath] = { original, writtenSha256: sha256(written) };
  }
  writeFileSync(
    join(root, MARKER),
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), paths }, null, 2)}\n`,
    'utf8',
  );
}

/** Drop the marker. Safe to call when there is none. */
export function removeMarker(root) {
  rmSync(join(root, MARKER), { force: true });
}

/** The marker a previous run left, or `null`. A marker that will not parse is treated as absent. */
export function readMarker(root) {
  const abs = join(root, MARKER);
  if (!existsSync(abs)) return null;
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.paths ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Undo the perturbations a previous run left behind.
 *
 * Applies the same rule `restoreAll()` applies in-process, and for the same reason: a path is
 * restored **only** while it still holds that run's perturbation. If the bytes differ, something
 * else has written the file since — an IDE save, a `git checkout`, a developer's own fix — and
 * putting back a snapshot taken before that write would destroy work this script has no business
 * touching. Those are reported instead, because a perturbed file left in place is not something to
 * be quiet about either.
 *
 * The marker is removed either way. A path we refused to restore no longer holds our bytes, so no
 * later run could act on it, and keeping the marker would make every subsequent run repeat the
 * same warning about a file nobody is going to repair from it.
 *
 * @returns {{ found: boolean, restored: string[], refused: string[], startedAt: string | null }}
 */
export function recoverPerturbations(root) {
  const marker = readMarker(root);
  if (!marker) return { found: false, restored: [], refused: [], startedAt: null };

  const restored = [];
  const refused = [];
  for (const [relPath, entry] of Object.entries(marker.paths)) {
    if (!PERTURBED_PATHS.includes(relPath)) {
      // A marker naming something the selftest never perturbs is not ours to act on.
      refused.push(relPath);
      continue;
    }
    const abs = join(root, relPath);
    let onDisk;
    try {
      onDisk = readFileSync(abs, 'utf8');
    } catch {
      refused.push(relPath);
      continue;
    }
    if (sha256(onDisk) !== entry.writtenSha256) {
      refused.push(relPath);
      continue;
    }
    writeFileSync(abs, entry.original, 'utf8');
    restored.push(relPath);
  }
  removeMarker(root);
  return { found: true, restored, refused, startedAt: marker.startedAt ?? null };
}

/**
 * Whether an audit finding might be a leftover perturbation rather than a real defect.
 *
 * Used only to add an explanation to the audit's output, never to change its verdict: the audit
 * must keep reporting a finding in one of these files, because the file really does contain the
 * defect at that moment and a gate that repaired the tree out from under itself would be a gate
 * that cannot be trusted to have looked.
 *
 * False while the selftest is the caller — it sets {@link SELFTEST_ENV_FLAG} on the audit it
 * spawns, where a perturbation is the point rather than an accident.
 */
export function isLeftover(findingText, env = process.env) {
  if (env[SELFTEST_ENV_FLAG] === '1') return false;
  return PERTURBED_PATHS.filter((p) => findingText.includes(p));
}
