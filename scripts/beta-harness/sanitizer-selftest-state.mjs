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
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Record the perturbations in force, so a process that dies without running its handlers leaves
 * behind enough to undo them.
 *
 * **Write-ahead.** Callers record the intent *before* replacing the tracked file, so there is no
 * window where a perturbation exists with no record of it. That costs nothing in safety because
 * the marker names both states: {@link recoverPerturbations} compares what is on disk against the
 * perturbed hash **and** the original hash, so a record whose write never landed is recognised as
 * already-clean rather than restored over or reported as a conflict (review of PR 521).
 *
 * Stores each file's `original` bytes and a **hash** of the perturbed bytes rather than both
 * copies: recovery only needs to *compare* against what it wrote, and hashing halves a marker that
 * would otherwise hold up to ~470 KB of source. `original` is kept in full because nothing else
 * can supply it — `git checkout` restores the *index* version, silently destroying an uncommitted
 * edit the developer already had in that file before the selftest ran.
 *
 * **Atomic.** Written to a sibling temp file, flushed, then renamed over the marker. A plain
 * `writeFileSync` truncates in place, so a kill mid-write would destroy the saved originals of
 * every *earlier* file still perturbed — losing exactly what the marker exists to protect. Merged
 * with any entry already on disk that this process does not know about, so a second writer cannot
 * drop the first one's record (review of PR 521).
 *
 * @param {string} root repository root
 * @param {Map<string, { original: string, written: string }>} backups
 */
export function writeMarker(root, backups) {
  const existing = readMarker(root);
  const inherited = existing && 'paths' in existing ? existing.paths : {};
  const paths = { ...inherited };
  for (const [relPath, { original, written }] of backups) {
    paths[relPath] = { original, originalSha256: sha256(original), writtenSha256: sha256(written) };
  }
  if (Object.keys(paths).length === 0) {
    removeMarker(root);
    return;
  }

  const abs = join(root, MARKER);
  const tmp = `${abs}.${process.pid}.tmp`;
  const body = `${JSON.stringify(
    { pid: process.pid, startedAt: existing?.startedAt ?? new Date().toISOString(), paths },
    null,
    2,
  )}\n`;
  // Flushed before the rename, or the rename can be durable while the bytes it points at are not —
  // which is the power-loss case this file claims to cover, so it has to actually hold.
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, body, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, abs);
}

/** Drop the marker. Safe to call when there is none. */
export function removeMarker(root) {
  rmSync(join(root, MARKER), { force: true });
}

/**
 * The marker a previous run left: `null` when there is none, `{ unreadable }` when there is one
 * that cannot be used, otherwise its contents.
 *
 * An unreadable marker is **not** reported as a clean start. It is the signature of a kill during
 * the write, which is precisely when something is most likely to be perturbed — so treating it as
 * absent would hide the one case the marker exists for. It is also never deleted, so whoever reads
 * the warning still has it (review of PR 521).
 */
export function readMarker(root) {
  const abs = join(root, MARKER);
  if (!existsSync(abs)) return null;
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (err) {
    return { unreadable: `could not be read: ${err.message}` };
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !parsed.paths || typeof parsed.paths !== 'object') {
      return { unreadable: 'does not describe any perturbed paths' };
    }
    return parsed;
  } catch (err) {
    return { unreadable: `is not valid JSON (${err.message}) — most likely a kill mid-write` };
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
  if (!marker) return { found: false, restored: [], refused: [], alreadyClean: [], startedAt: null };
  if ('unreadable' in marker) {
    // Left in place deliberately: it is evidence, and deleting it would take away the only record
    // of what might still be perturbed.
    return {
      found: true,
      restored: [],
      refused: [],
      alreadyClean: [],
      startedAt: null,
      unreadable: marker.unreadable,
    };
  }

  const restored = [];
  const refused = [];
  const alreadyClean = [];
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
    const digest = sha256(onDisk);
    if (digest === entry.writtenSha256) {
      writeFileSync(abs, entry.original, 'utf8');
      restored.push(relPath);
      continue;
    }
    // The write-ahead window: the record landed and the perturbation did not. Nothing to undo, and
    // reporting it as a conflict would send a reader looking for a problem that does not exist.
    // `originalSha256` is read from the entry where present, and derived otherwise, so a marker
    // written before that field existed still recovers (review of PR 521).
    if (digest === (entry.originalSha256 ?? sha256(entry.original))) {
      alreadyClean.push(relPath);
      continue;
    }
    refused.push(relPath);
  }
  removeMarker(root);
  return { found: true, restored, refused, alreadyClean, startedAt: marker.startedAt ?? null };
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
