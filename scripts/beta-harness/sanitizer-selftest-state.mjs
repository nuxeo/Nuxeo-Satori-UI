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
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
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
  'libs/shared/ui/src/lib/document-viewer/document-viewer.component.html',
  'libs/shared/ui/src/lib/document-viewer/document-viewer.component.ts',
  // Deliberately absent: `libs/shared/nuxeo-client/src/lib/utils/trust-object-url.ts`. It is named
  // all over the selftest, but only ever as a **key inside the allowlist JSON**
  // (`j.sites[CHECK1_SITE]`) — the file itself is never perturbed. It was registered here from a
  // survey of string literals, which is the same over-matching that first missed
  // `sanitizer-audit.mjs`; the drift control now reads the `edit()` call sites instead and caught
  // it as a stale entry (review of PR 521).
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
 * Replace a file's contents without ever leaving it half written.
 *
 * `writeFileSync` truncates in place, so a kill during the write leaves bytes that match neither
 * the original nor the perturbation — and recovery can then only refuse the file, which is the one
 * outcome that needs a human. Used for the tracked files as well as the marker: temp file, flush,
 * rename, so the file is either entirely the old content or entirely the new one (review of PR 521).
 */
export function writeFileAtomic(abs, text) {
  const tmp = `${abs}.${process.pid}.selftest-tmp`;
  // The mode is carried across. A rename replaces the inode, so the new file keeps the temp
  // file's default permissions and the old file's are gone — which silently stripped the
  // executable bit from `sanitizer-audit.mjs`, a shebang script that was 755. Caught by the mode
  // change in the commit that introduced atomic replacement, not by any test (review of PR 521).
  let mode;
  try {
    mode = statSync(abs).mode;
  } catch {
    mode = undefined;
  }
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, text, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (mode !== undefined) chmodSync(tmp, mode);
  renameSync(tmp, abs);
}

/** Every perturbed state recorded for a path, tolerating the single-string form of an old marker. */
const writtenHashes = (entry) =>
  Array.isArray(entry.writtenSha256) ? entry.writtenSha256 : [entry.writtenSha256];

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
    // **Every** perturbed state this path has held is kept, not just the pending one. A control
    // may perturb the same file twice (`edit(KD_CITATION, …)` is called twice in a row), and
    // replacing the hash meant a kill between those two writes left bytes matching neither
    // recorded state — so recovery refused the selftest's own perturbation and asked a human to
    // sort out a file it had itself written (review of PR 521).
    const known = new Set(inherited[relPath] ? writtenHashes(inherited[relPath]) : []);
    known.add(sha256(written));
    paths[relPath] = {
      original: inherited[relPath]?.original ?? original,
      originalSha256: sha256(inherited[relPath]?.original ?? original),
      writtenSha256: [...known].filter(Boolean),
    };
  }
  if (Object.keys(paths).length === 0) {
    removeMarker(root);
    return;
  }

  writeFileAtomic(
    join(root, MARKER),
    `${JSON.stringify(
      { pid: process.pid, startedAt: existing?.startedAt ?? new Date().toISOString(), paths },
      null,
      2,
    )}\n`,
  );
}

/**
 * Write a marker holding **exactly** these entries, replacing whatever is there.
 *
 * For the case where a run is giving up on some paths and has restored the rest: the records it
 * still needs are the refused ones, and keeping the restored ones would make the next run report
 * files that are already fine. Distinct from {@link writeMarker}, which merges, because merging is
 * right while perturbations are accumulating and wrong when narrowing to what a human must handle.
 *
 * @param {string} root
 * @param {Map<string, { original: string, written: string }>} entries
 */
export function retainMarker(root, entries) {
  if (entries.size === 0) {
    removeMarker(root);
    return;
  }
  const paths = {};
  for (const [relPath, { original, written }] of entries) {
    paths[relPath] = {
      original,
      originalSha256: sha256(original),
      writtenSha256: [sha256(written)],
    };
  }
  writeFileAtomic(
    join(root, MARKER),
    `${JSON.stringify(
      { pid: process.pid, startedAt: new Date().toISOString(), refusedAt: new Date().toISOString(), paths },
      null,
      2,
    )}\n`,
  );
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
    if (writtenHashes(entry).includes(digest)) {
      writeFileAtomic(abs, entry.original);
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

  // **A refused path keeps its record.** The marker holds the only copy of that file's `original`,
  // and when the run began on a file the developer had already edited without committing, that
  // copy is the only copy anywhere — git has the committed content, not theirs. Deleting the
  // marker on the way past therefore destroyed exactly what a refusal exists to protect. My first
  // reasoning for deleting it — "a refused path no longer holds our bytes, so no later run could
  // act on it" — was true about restoring and wrong about keeping (review of PR 521).
  if (refused.length === 0) {
    removeMarker(root);
  } else {
    const kept = Object.fromEntries(refused.filter((p) => marker.paths[p]).map((p) => [p, marker.paths[p]]));
    writeFileAtomic(
      join(root, MARKER),
      `${JSON.stringify({ ...marker, paths: kept, refusedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  }
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
