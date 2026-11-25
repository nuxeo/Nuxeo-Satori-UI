/**
 * Who owns each item a migration reports, and what they decided: the people's half of the report
 * (docs/business-apps/studio-migration.md, sections 6 and 8).
 *
 * The converter writes `report.json`, the same for the same package every time. What people
 * decide is kept beside it, in `decisions.json`, which no conversion writes, so that converting
 * the same package again, after the catalogue has learnt something, loses none of it. The
 * `decisions` command writes the file with an entry for every reported item, and a person fills
 * in each `owner` and `decision`.
 *
 * A file of decisions is for one build of the package: its name and version, Studio's commit and
 * build time from the bundle's manifest, and the SHA-256 of its bundle, which tells two builds
 * apart where the manifest records neither (`packageBuildOf`). A construct's id is its place in
 * its file, so another build can give the same id to another construct: decisions are held to the
 * package given, and never taken for another build of it.
 *
 * Each decision also copies what it was made on from the report: the item's label, property,
 * outcome, where it was written, its reason and its rule. A decision whose copy no longer matches
 * the report was made on something else, and is not taken. Readiness (section 6) needs a decision
 * taken for every reported item, naming an owner and saying what they decided, and nothing wrong
 * in the file.
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

/** The build of the package a file of decisions is for (`packageBuildOf`). */
export interface DecisionsBuild {
  readonly name: string;
  readonly version: string;
  readonly commit: string | null;
  readonly buildTime: string | null;
  /** The SHA-256 of the package's bundle, in hexadecimal. */
  readonly bundle: string;
}

const BUILD_KEYS = ['name', 'version', 'commit', 'buildTime', 'bundle'] as const;
const FILE_KEYS: ReadonlySet<string> = new Set(['format', 'package', 'decisions']);

export interface DecisionsFile {
  readonly format: typeof DECISIONS_FORMAT;
  readonly package: DecisionsBuild;
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
 * The decisions, as `raw` gives them, held to the report and to the build of the package given:
 * `raw` is `decisions.json` as read, or `undefined` when the conversion has none, which leaves
 * every reported item without an owner.
 */
export function holdDecisions(
  report: MigrationReport,
  raw: unknown,
  build: DecisionsBuild,
): HeldDecisions {
  const reading: Reading =
    raw === undefined
      ? { findings: [], taken: new Map() }
      : readDecisions(report, raw, DECISIONS_FILE, build);
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
 * The file the `decisions` command writes for a report of the package `build` names: an entry for
 * every reported item, in the report's order, with what it was made on. Each takes its owner and
 * decision from `earlier`, a file written for an earlier conversion of the same build, where that
 * one still holds for this report, and is left blank otherwise. `notCarried` says which of the earlier ones
 * that said something did not carry, and why; `blank` counts the entries left to fill in.
 */
export function decisionsFor(
  report: MigrationReport,
  build: DecisionsBuild,
  earlier?: { readonly raw: unknown; readonly file: string },
): {
  readonly file: DecisionsFile;
  readonly carried: number;
  readonly notCarried: readonly string[];
  readonly blank: number;
} {
  // An entry that says nothing has nothing to carry, and nothing to lose: it is passed over.
  const silent = (item: unknown): boolean =>
    isRecord(item) && ![item['owner'], item['decision']].some(saysSomething);
  const reading = earlier
    ? readDecisions(report, earlier.raw, earlier.file, build, silent)
    : undefined;
  if (reading?.refused) throw new DecisionsError(reading.refused);
  let carried = 0;
  const decisions = reportedEntries(report).map((entry): OwnerDecision => {
    const before = reading?.taken.get(entry.id);
    if (before) carried++;
    return {
      id: entry.id,
      ...pinnedOf(entry),
      owner: before?.owner ?? '',
      decision: before?.decision ?? '',
    };
  });
  return {
    file: { format: DECISIONS_FORMAT, package: { ...build }, decisions },
    carried,
    notCarried: reading?.findings ?? [],
    blank: unfilled(decisions),
  };
}

/** How many of the decisions still have no owner, or nothing decided: spaces alone are none. */
export function unfilled(decisions: readonly Pick<OwnerDecision, 'owner' | 'decision'>[]): number {
  return decisions.filter((item) => !item.owner.trim() || !item.decision.trim()).length;
}

export class DecisionsError extends Error {
  override readonly name = 'DecisionsError';
}

/** Whether an owner or a decision says anything: text that is not only spaces. */
function saysSomething(value: unknown): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined;
}

/**
 * The reported entries of the report, in its order. An id listed twice is its first entry's, as
 * everything else reads it, so it is here only when that first entry is reported.
 */
function reportedEntries(report: MigrationReport): ReportEntry[] {
  const seen = new Set<string>();
  return (Array.isArray(report.constructs) ? report.constructs : []).filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return entry.outcome === 'reported';
  });
}

function pinnedOf(entry: ReportEntry): Pick<ReportEntry, PinnedKey> {
  const pinned: Record<string, unknown> = {};
  for (const key of PINNED) if (entry[key] !== undefined) pinned[key] = entry[key];
  return pinned as Pick<ReportEntry, PinnedKey>;
}

function describeBuild(build: Readonly<Record<string, unknown>>): string {
  const bundle = typeof build['bundle'] === 'string' ? build['bundle'].slice(0, 12) : 'none';
  return (
    `${String(build['name'])} ${String(build['version'])}` +
    (build['commit'] ? `, commit ${String(build['commit'])}` : '') +
    (build['buildTime'] ? `, built ${String(build['buildTime'])}` : '') +
    `, bundle ${bundle}`
  );
}

/**
 * Reads a file of decisions against a report of the package `build` names. Its findings name
 * `file`. An entry `passOver` picks is left out, as if the file did not hold it.
 */
function readDecisions(
  report: MigrationReport,
  raw: unknown,
  file: string,
  build: DecisionsBuild,
  passOver: (item: unknown) => boolean = () => false,
): Reading {
  const none: Reading = { findings: [], taken: new Map() };
  if (!isRecord(raw) || raw['format'] !== DECISIONS_FORMAT) {
    return {
      ...none,
      refused: `${file} is not a ${DECISIONS_FORMAT} file, so none of it is taken`,
    };
  }
  const given = isRecord(raw['package']) ? raw['package'] : {};
  const differs = BUILD_KEYS.some((key) => (given[key] ?? null) !== build[key]);
  if (differs) {
    return {
      ...none,
      refused: `${file} is for ${describeBuild(given)}, and the package given is ${describeBuild({ ...build })}, so none of it is taken`,
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
    if (!passOver(item) && isRecord(item) && typeof item['id'] === 'string')
      times.set(item['id'], (times.get(item['id']) ?? 0) + 1);
  }

  const findings: string[] = [];
  const extraKeys = Object.keys(raw).filter((key) => !FILE_KEYS.has(key));
  if (extraKeys.length > 0) {
    findings.push(`${file} holds ${extraKeys.join(', ')}, which the file does not take`);
  }
  const taken = new Map<string, OwnerDecision>();
  const named = new Set<string>();
  items.forEach((item, index) => {
    if (passOver(item)) return;
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
        `${file}: ${id} was made on another ${moved.map((key) => PINNED_WORDS[key]).join(' and ')} than the report gives now, so it is not taken: decide it again`,
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

/**
 * Whether a copied field says what the report says: both absent, or the same JSON whatever the
 * order of its keys, as an editor that sorts them would leave it.
 */
function same(copied: unknown, reported: unknown): boolean {
  return JSON.stringify(canonical(copied)) === JSON.stringify(canonical(reported));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}
