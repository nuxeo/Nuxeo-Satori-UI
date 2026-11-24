/**
 * Who owns each item a migration reports, and what they decided: the people's half of the report
 * (docs/business-apps/studio-migration.md, sections 6 and 8).
 *
 * The converter writes `report.json`, the same for the same package every time. What people
 * decide is kept beside it, in `decisions.json`, which no conversion writes, so that converting
 * again, after the catalogue has learnt something, loses none of it. The `decisions` command writes
 * the file with an entry for every reported item, and a person fills in each `owner` and
 * `decision`.
 *
 * Each decision copies what it was made on from the report: the item's label, property, outcome,
 * where it was written, its reason and its rule. A decision whose copy no longer matches the report
 * was made on something else, and is not taken. Readiness (section 6) needs a decision taken for
 * every reported item, naming an owner and saying what they decided, and nothing wrong in the file.
 *
 * Only a reported item takes a decision. Accepting or rejecting a proposal is not built yet: the
 * converter would have to write what a person accepts, and until it does, a proposal waits.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import type { MigrationReport, ReportEntry } from './convert';

export const DECISIONS_FORMAT = 'studio-migration-decisions/1';

/** Its place in a conversion directory, beside `report.json`. */
export const DECISIONS_FILE = 'decisions.json';

/** What a decision copies from the report entry it was made on, in the order it is written. */
export const PINNED = ['label', 'property', 'outcome', 'to', 'note', 'rule'] as const;
type PinnedKey = (typeof PINNED)[number];

/** How a finding names each copied field. */
const PINNED_WORDS: Readonly<Record<PinnedKey, string>> = {
  label: 'label',
  property: 'property',
  outcome: 'outcome',
  to: 'place it was written to',
  note: 'reason',
  rule: 'rule',
};

const KEYS: ReadonlySet<string> = new Set(['id', ...PINNED, 'owner', 'decision']);

export interface OwnerDecision extends Pick<ReportEntry, PinnedKey> {
  readonly id: string;
  /** Who decides it. */
  readonly owner: string;
  /** What they decided, in their words. */
  readonly decision: string;
}

export interface DecisionsFile {
  readonly format: typeof DECISIONS_FORMAT;
  readonly package: { readonly name: string; readonly version: string };
  readonly decisions: readonly OwnerDecision[];
}

export interface HeldDecisions {
  /** What is wrong with the file, one line each. A decision with a finding is not taken. */
  readonly findings: readonly string[];
  /** Each decision taken, by its item's id: one that holds for the report as it is now. */
  readonly taken: ReadonlyMap<string, OwnerDecision>;
  /** Reported items with no owner: no decision taken for them, or one naming nobody. */
  readonly unowned: number;
  /** Reported items whose decision names an owner and says nothing decided. */
  readonly undecided: number;
}

/** What a file of decisions gives for a report, before anything is counted. */
interface Reading {
  /** Why the whole file is not taken, if it is not. */
  readonly refused?: string;
  readonly findings: readonly string[];
  readonly taken: ReadonlyMap<string, OwnerDecision>;
}

/**
 * The decisions, as `raw` gives them, held to the report: `raw` is `decisions.json` as read, or
 * `undefined` when the conversion has none, which leaves every reported item without an owner.
 */
export function holdDecisions(report: MigrationReport, raw: unknown): HeldDecisions {
  const reading: Reading =
    raw === undefined
      ? { findings: [], taken: new Map() }
      : readDecisions(report, raw, DECISIONS_FILE, { sameVersion: true });
  let unowned = 0;
  let undecided = 0;
  for (const entry of reportedEntries(report)) {
    const decision = reading.taken.get(entry.id);
    if (!decision?.owner.trim()) unowned++;
    else if (!decision.decision.trim()) undecided++;
  }
  return {
    findings: reading.refused ? [reading.refused, ...reading.findings] : reading.findings,
    taken: reading.taken,
    unowned,
    undecided,
  };
}

/**
 * The file the `decisions` command writes for a report: an entry for every reported item, in the
 * report's order, with what it was made on. Each takes its owner and decision from `earlier`, a
 * file written for an earlier conversion of the same package, where that one still holds for this
 * report, and is left blank otherwise. `notCarried` says which of the earlier ones did not carry,
 * and why.
 */
export function decisionsFor(
  report: MigrationReport,
  earlier?: { readonly raw: unknown; readonly file: string },
): {
  readonly file: DecisionsFile;
  readonly carried: number;
  readonly notCarried: readonly string[];
} {
  const reading = earlier
    ? readDecisions(report, earlier.raw, earlier.file, { sameVersion: false })
    : undefined;
  if (reading?.refused) throw new DecisionsError(reading.refused);
  let carried = 0;
  const decisions = reportedEntries(report).map((entry): OwnerDecision => {
    const before = reading?.taken.get(entry.id);
    if (before && (before.owner || before.decision)) carried++;
    return {
      id: entry.id,
      ...pinnedOf(entry),
      owner: before?.owner ?? '',
      decision: before?.decision ?? '',
    };
  });
  return {
    file: {
      format: DECISIONS_FORMAT,
      package: { name: report.package.name, version: report.package.version },
      decisions,
    },
    carried,
    notCarried: reading?.findings ?? [],
  };
}

export class DecisionsError extends Error {
  override readonly name = 'DecisionsError';
}

/** The reported entries of the report, each id once, in the report's order. */
function reportedEntries(report: MigrationReport): ReportEntry[] {
  const seen = new Set<string>();
  return (Array.isArray(report.constructs) ? report.constructs : []).filter((entry) => {
    if (entry.outcome !== 'reported' || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function pinnedOf(entry: ReportEntry): Pick<ReportEntry, PinnedKey> {
  const pinned: Record<string, unknown> = {};
  for (const key of PINNED) if (entry[key] !== undefined) pinned[key] = entry[key];
  return pinned as Pick<ReportEntry, PinnedKey>;
}

/**
 * Reads a file of decisions against a report. Its findings name `file`. With `sameVersion`, the
 * file must be for the report's package at its version, as a conversion's own is; without it, of
 * its name only, as one carried from an earlier conversion is.
 */
function readDecisions(
  report: MigrationReport,
  raw: unknown,
  file: string,
  { sameVersion }: { readonly sameVersion: boolean },
): Reading {
  const none: Reading = { findings: [], taken: new Map() };
  if (!isRecord(raw) || raw['format'] !== DECISIONS_FORMAT) {
    return {
      ...none,
      refused: `${file} is not a ${DECISIONS_FORMAT} file, so none of it is taken`,
    };
  }
  const pkg = isRecord(raw['package']) ? raw['package'] : {};
  const { name, version } = report.package;
  if (pkg['name'] !== name || (sameVersion && pkg['version'] !== version)) {
    return {
      ...none,
      refused: `${file} is for ${String(pkg['name'])} ${String(pkg['version'])}, and the report for ${name} ${version}, so none of it is taken`,
    };
  }
  if (!Array.isArray(raw['decisions'])) {
    return { ...none, refused: `${file} holds no list of decisions, so none of it is taken` };
  }
  const items: readonly unknown[] = raw['decisions'];

  const entries = new Map<string, ReportEntry>();
  for (const entry of Array.isArray(report.constructs) ? report.constructs : [])
    if (!entries.has(entry.id)) entries.set(entry.id, entry);
  const times = new Map<string, number>();
  for (const item of items) {
    if (isRecord(item) && typeof item['id'] === 'string')
      times.set(item['id'], (times.get(item['id']) ?? 0) + 1);
  }

  const findings: string[] = [];
  const taken = new Map<string, OwnerDecision>();
  const named = new Set<string>();
  items.forEach((item, index) => {
    if (!isRecord(item) || typeof item['id'] !== 'string' || item['id'] === '') {
      findings.push(`${file}: decision ${index + 1} names no item`);
      return;
    }
    const id = item['id'];
    const count = times.get(id) ?? 0;
    if (count > 1) {
      // Which of them is meant cannot be told, so none is taken.
      if (!named.has(id)) findings.push(`${file}: ${id} is decided ${count} times`);
      named.add(id);
      return;
    }
    const extra = Object.keys(item).filter((key) => !KEYS.has(key));
    if (extra.length > 0) {
      findings.push(`${file}: ${id} holds ${extra.join(', ')}, which a decision does not take`);
      return;
    }
    const entry = entries.get(id);
    if (!entry) {
      findings.push(`${file}: ${id} is not in the report`);
      return;
    }
    if (entry.outcome !== 'reported') {
      findings.push(
        `${file}: ${id} is ${String(entry.outcome)} in the report, and only a reported item takes a decision` +
          (entry.outcome === 'proposed' ? ': accepting a proposal is not built yet' : ''),
      );
      return;
    }
    const moved = PINNED.filter((key) => !same(item[key], entry[key]));
    if (moved.length > 0) {
      findings.push(
        `${file}: ${id} was decided when the report gave another ${moved.map((key) => PINNED_WORDS[key]).join(' and ')}, so it is not taken: decide it again`,
      );
      return;
    }
    const notText = (['owner', 'decision'] as const).filter(
      (key) => item[key] !== undefined && typeof item[key] !== 'string',
    );
    if (notText.length > 0) {
      findings.push(`${file}: ${id}: its ${notText.join(' and ')} is not text`);
      return;
    }
    taken.set(id, {
      id,
      ...pinnedOf(entry),
      owner: (item['owner'] as string | undefined) ?? '',
      decision: (item['decision'] as string | undefined) ?? '',
    });
  });
  return { findings, taken };
}

/** Whether a copied field says what the report says: both absent, or the same JSON. */
function same(copied: unknown, reported: unknown): boolean {
  return JSON.stringify(copied) === JSON.stringify(reported);
}
