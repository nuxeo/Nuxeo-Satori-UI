/**
 * What people decide of a migration: the people's half of the report
 * (docs/business-apps/studio-migration.md, sections 6 and 8).
 *
 * The converter writes `report.json`, the same for the same package and the same decisions every
 * time. What people decide is kept beside it, in `decisions.json`, which no conversion writes, so
 * that converting the same package again, after the catalogue has learnt something, loses none of
 * it. The `decisions` command writes the file with an entry for every item a person decides:
 *
 * - **a reported item,** for its `owner` and what they decided, in their own words, `decision`;
 * - **a proposal,** a condition's rule an agent proposes, a card an operation feeds, or a custom
 *   element's plugin (`convert-elements.ts`), for who decided it, `owner`, whether they `accept`
 *   or `reject` it, `decision`, and why, `reason`. What
 *   a proposal guards, a field under the condition, say, takes no decision of its own: it is
 *   written with the rule once the rule is accepted (`convert.ts`, `withVerdicts`), and reported
 *   once it is rejected.
 *
 * A file of decisions is for one build of the package: its name and version, Studio's commit and
 * build time from the bundle's manifest, and the SHA-256 of its bundle (`packageBuildOf`). Each
 * decision copies what it was made on from the report: the item's label, property, outcome, where
 * it was written, its reason and its rule, and the identity of its construct, which says what the
 * construct is rather than where it sits in its file (`constructs.ts`, `identityOf`). A decision
 * whose copy no longer matches the report, or whose construct is another, is not taken.
 * Readiness (section 6) needs a decision taken for every item that takes one, and nothing wrong in
 * the file.
 *
 * **A new build of the package.** `decisions --from` an earlier file of another build of the same
 * package carries each decision by its construct's identity: to the construct of this build of the
 * same identity, when what it was made on is unchanged. One whose construct changed is offered for
 * re-confirmation, its earlier decision beside a blank one; one whose construct is gone, or cannot
 * be told from another of the same identity, is dropped. The file records each, for the report.
 * Never by place: a place in a file can hold another construct in another build.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import type { MigrationReport, ReportEntry, Verdict } from './convert';

export const DECISIONS_FORMAT = 'studio-migration-decisions/2';
/**
 * The format before proposals took decisions and decisions named their construct's identity. Its
 * decisions are taken for the same build, by their item's place, and carried to no other build.
 */
export const DECISIONS_FORMAT_1 = 'studio-migration-decisions/1';

/** Its place in a conversion directory, beside `report.json`. */
export const DECISIONS_FILE = 'decisions.json';

/** What a decision copies from the report entry it was made on, in the order it is written. */
export const PINNED = ['label', 'property', 'outcome', 'to', 'note', 'rule'] as const;
type PinnedKey = (typeof PINNED)[number];
/**
 * What a proposal's decision copies: all but where it was written, which is what accepting it
 * did, and so not what it was made on.
 */
const PROPOSAL_PINNED: readonly PinnedKey[] = ['label', 'property', 'outcome', 'note', 'rule'];

/** How a finding names each copied field. */
const PINNED_WORDS: Readonly<Record<PinnedKey, string>> = {
  label: 'label',
  property: 'property',
  outcome: 'outcome',
  to: 'place it was written to',
  note: 'reason',
  rule: 'rule',
};

/** The keys a decision of a reported item takes, and those a proposal's takes. */
const REPORTED_KEYS: ReadonlySet<string> = new Set([
  'id',
  'identity',
  ...PINNED,
  'owner',
  'decision',
  'earlier',
]);
const PROPOSAL_KEYS: ReadonlySet<string> = new Set([...REPORTED_KEYS, 'reason']);

/** What a person writes in a proposal's `decision`. */
export const ACCEPT = 'accept';
export const REJECT = 'reject';

export interface OwnerDecision extends Pick<ReportEntry, PinnedKey> {
  readonly id: string;
  /** The identity of its construct, as `identityOf` gives it. Absent in a file of format 1. */
  readonly identity?: string;
  /** Who decides it: for a proposal, the person who accepts or rejects it. */
  readonly owner: string;
  /** What they decided, in their words; for a proposal, `accept` or `reject`. */
  readonly decision: string;
  /** For a proposal: why they accept or reject it. */
  readonly reason?: string;
  /** An earlier build's decision of its construct, offered for re-confirmation. */
  readonly earlier?: EarlierDecision;
}

/**
 * A decision of an earlier build whose construct changed: what it was made on then, and what it
 * decided, for a person to confirm again, by filling in the decision beside it, or not.
 */
export interface EarlierDecision {
  /** The earlier build's bundle, by its SHA-256. */
  readonly bundle: string;
  readonly owner: string;
  readonly decision: string;
  readonly reason?: string;
  /** What it copied from that build's report. */
  readonly madeOn: Pick<ReportEntry, PinnedKey>;
  /** Which of those this build's report gives otherwise, in words. */
  readonly changed: readonly string[];
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
const FILE_KEYS: ReadonlySet<string> = new Set([
  'format',
  'package',
  'decisions',
  'shared',
  'carriedFrom',
]);

/** The identities a build cannot tell apart, for its file to name, when it has any. */
function sharedOf(shared: ReadonlySet<string>): { readonly shared?: readonly string[] } {
  return shared.size > 0 ? { shared: [...shared].sort() } : {};
}

/** What a file carried from an earlier build of the package says it did, for the report. */
export interface CarriedFrom {
  readonly package: DecisionsBuild;
  /** The items of this build that took their earlier decision, by id. */
  readonly carried: readonly string[];
  /** The items offered for re-confirmation, by id: their construct changed. */
  readonly reconfirm: readonly string[];
  /** The earlier decisions carried to nothing, each with why. */
  readonly dropped: readonly DroppedDecision[];
}

export interface DroppedDecision {
  /** Its item's id in the earlier build. */
  readonly id: string;
  readonly identity: string | null;
  readonly label: string | null;
  readonly owner: string | null;
  readonly decision: string | null;
  readonly why: string;
}

export interface DecisionsFile {
  readonly format: typeof DECISIONS_FORMAT;
  readonly package: DecisionsBuild;
  readonly decisions: readonly OwnerDecision[];
  /**
   * The identities this build holds more than once, alike: a decision of one is carried to no
   * other build, where which one it was made on cannot be told.
   */
  readonly shared?: readonly string[];
  readonly carriedFrom?: CarriedFrom;
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
  /**
   * What people decided of the proposals, by id: each accepted or rejected, by someone named, for
   * a reason. Only these are written, or reported, by the converter.
   */
  readonly verdicts: ReadonlyMap<string, Verdict>;
  /**
   * The proposals that wait for a person: those with no decision taken, and those that follow a
   * condition's proposal, which stay proposed until the conversion is made with its decision.
   */
  readonly waiting: number;
  /** Proposals accepted or rejected with no one's name, or no reason. */
  readonly unsigned: number;
  /** What the file says it carried from an earlier build, when it was written so. */
  readonly carriedFrom?: CarriedFrom;
  /** True when none of the file is taken: of another format or build, or with no list. */
  readonly notTaken?: true;
}

/** What a file of decisions gives for a report, before anything is counted. */
interface Reading {
  /** Why the whole file is not taken, if it is not. */
  readonly refused?: string;
  readonly findings: readonly string[];
  readonly taken: ReadonlyMap<string, OwnerDecision>;
  /** Decisions that held but for what they were made on: what the report gives otherwise. */
  readonly moved: ReadonlyMap<
    string,
    {
      readonly item: Record<string, unknown>;
      readonly changed: readonly PinnedKey[];
      /** Its line among the findings. */
      readonly finding: string;
    }
  >;
}

/**
 * The decisions, as `raw` gives them, held to the report, to the build of the package given, and
 * to the identities of its constructs, by id (`identityOf`): `raw` is `decisions.json` as read,
 * or `undefined` when the conversion has none, which leaves every item without a decision.
 */
export function holdDecisions(
  report: MigrationReport,
  raw: unknown,
  build: DecisionsBuild,
  identities: ReadonlyMap<string, string>,
): HeldDecisions {
  const reading: Reading =
    raw === undefined
      ? { findings: [], taken: new Map(), moved: new Map() }
      : readDecisions(report, raw, DECISIONS_FILE, build, identities);
  let unowned = 0;
  let undecided = 0;
  for (const entry of decidedEntries(report, 'reported')) {
    const decision = reading.taken.get(entry.id);
    if (!saysSomething(decision?.owner)) unowned++;
    else if (!saysSomething(decision?.decision)) undecided++;
  }
  const verdicts = new Map<string, Verdict>();
  let waiting = 0;
  let unsigned = 0;
  // Only a proposal of its own waits for a person. What a condition's proposal guards takes no
  // decision (`readDecisions` takes none): it follows the condition's, which waits, or which the
  // conversion was made without (`madeOtherwise`).
  for (const entry of decidedEntries(report, 'proposed')) {
    const decision = reading.taken.get(entry.id);
    const verdict = decision?.decision.trim();
    if (verdict !== ACCEPT && verdict !== REJECT) {
      waiting++;
      continue;
    }
    if (!saysSomething(decision?.owner) || !saysSomething(decision?.reason)) {
      unsigned++;
      continue;
    }
    verdicts.set(entry.id, {
      accepted: verdict === ACCEPT,
      ...(entry.rule !== undefined ? { rule: entry.rule } : {}),
      owner: decision?.owner ?? '',
      reason: decision?.reason ?? '',
    });
  }
  // What a file carried from another build says it did, when the file is taken at all.
  const carriedFrom =
    isRecord(raw) && !reading.refused ? carriedFromOf(raw['carriedFrom']) : undefined;
  return {
    findings: reading.refused ? [reading.refused, ...reading.findings] : reading.findings,
    taken: reading.taken,
    unowned,
    undecided,
    verdicts,
    waiting,
    unsigned,
    ...(carriedFrom ? { carriedFrom } : {}),
    ...(reading.refused ? { notTaken: true as const } : {}),
  };
}

/**
 * The proposals the conversion was made with another decision of than `verdicts` gives: what it
 * wrote, or did not, is not what was decided, and it is converted again with the decisions.
 */
export function madeOtherwise(
  report: MigrationReport,
  verdicts: ReadonlyMap<string, Verdict>,
): ReportEntry[] {
  return decidedEntries(report, 'proposed').filter((entry) => {
    const verdict = verdicts.get(entry.id);
    const now = verdict ? (verdict.accepted ? ACCEPT : REJECT) : undefined;
    return entry.applied !== now;
  });
}

/**
 * True when nothing of the decisions stands in the way: every item decided, every proposal
 * accepted or rejected by someone named for a reason, nothing in the file not taken, and the
 * conversion made with those decisions. `approve` refuses otherwise.
 */
export function everyDecisionMade(report: MigrationReport, held: HeldDecisions): boolean {
  return (
    held.waiting === 0 &&
    held.unsigned === 0 &&
    held.unowned === 0 &&
    held.undecided === 0 &&
    held.findings.length === 0 &&
    madeOtherwise(report, held.verdicts).length === 0
  );
}

export interface CarriedDecisions {
  readonly file: DecisionsFile;
  /** How many earlier decisions it carried. */
  readonly carried: number;
  /** Each earlier decision that said something and was not carried, and why. */
  readonly notCarried: readonly string[];
  /** How many of those it offers for re-confirmation, beside a blank decision. */
  readonly reconfirm: number;
  /** How many entries are left to fill in. */
  readonly blank: number;
  /** The earlier build, when it is another build of the package, carried by identity. */
  readonly otherBuild?: string;
}

/**
 * The file the `decisions` command writes for a report of the package `build` names: an entry for
 * every reported item and every proposal a person decides, in the report's order, with what it
 * was made on. Each takes its decision from `earlier`, a file written for an earlier conversion,
 * where that one still holds for this report: of the same build, by its item; of another build of
 * the package, by its construct's identity (above). `shared` are the identities this build cannot
 * tell apart (`sharedIdentities`), to which nothing is carried from another build.
 */
export function decisionsFor(
  report: MigrationReport,
  build: DecisionsBuild,
  identities: ReadonlyMap<string, string>,
  shared: ReadonlySet<string>,
  earlier?: { readonly raw: unknown; readonly file: string },
): CarriedDecisions {
  const entries = [...decidedEntries(report, 'reported'), ...decidedEntries(report, 'proposed')];
  // In the report's order.
  const order = new Map(firstEntries(report).map((entry, index) => [entry.id, index]));
  entries.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const blankOf = (entry: ReportEntry): OwnerDecision => ({
    id: entry.id,
    ...(identities.has(entry.id) ? { identity: identities.get(entry.id) as string } : {}),
    ...pinnedOf(entry),
    owner: '',
    decision: '',
    ...(entry.outcome === 'proposed' ? { reason: '' } : {}),
  });
  if (!earlier) {
    const decisions = entries.map(blankOf);
    return {
      file: { format: DECISIONS_FORMAT, package: { ...build }, decisions, ...sharedOf(shared) },
      carried: 0,
      notCarried: [],
      reconfirm: 0,
      blank: unfilled(decisions),
    };
  }
  const { raw, file } = earlier;
  const refused = earlierRefusal(raw, file, build);
  if (refused !== null) throw new DecisionsError(refused);
  const given = isRecord(raw) && isRecord(raw['package']) ? raw['package'] : {};
  const sameBuild = BUILD_KEYS.every((key) => (given[key] ?? null) === build[key]);
  return sameBuild
    ? carrySameBuild(report, build, identities, shared, entries, blankOf, raw, file)
    : carryOtherBuild(
        build,
        identities,
        shared,
        entries,
        blankOf,
        raw as Record<string, unknown>,
        file,
        given,
      );
}

/**
 * Why an earlier file of decisions cannot be carried to the package `build` names, or `null`
 * when it can: it is no file of decisions, it is of another package, or it is a file of the first
 * format of another build, whose items are their places alone.
 */
export function earlierRefusal(raw: unknown, file: string, build: DecisionsBuild): string | null {
  const format = isRecord(raw) ? raw['format'] : undefined;
  if (format !== DECISIONS_FORMAT && format !== DECISIONS_FORMAT_1)
    return `${file} is not a ${DECISIONS_FORMAT} file, so none of it is taken`;
  const given = isRecord(raw) && isRecord(raw['package']) ? raw['package'] : {};
  const sameBuild = BUILD_KEYS.every((key) => (given[key] ?? null) === build[key]);
  if (!sameBuild && (given['name'] !== build.name || format === DECISIONS_FORMAT_1))
    return (
      `${file} is for ${describeBuild(given)}, and the package given is ${describeBuild({ ...build })}, so none of it is taken` +
      (given['name'] === build.name
        ? `: a ${DECISIONS_FORMAT_1} file names each item by its place alone, which another build can give another construct`
        : '')
    );
  if (!isRecord(raw) || !Array.isArray(raw['decisions']))
    return `${file} holds no list of decisions, so none of it is taken`;
  return null;
}

/**
 * An entry that says nothing has nothing to carry, and nothing to lose: it is passed over. One that
 * holds an earlier build's decision offered for re-confirmation is not: the offer is carried.
 */
const silent = (item: unknown): boolean => silentEntry(item);

function carrySameBuild(
  report: MigrationReport,
  build: DecisionsBuild,
  identities: ReadonlyMap<string, string>,
  shared: ReadonlySet<string>,
  entries: readonly ReportEntry[],
  blankOf: (entry: ReportEntry) => OwnerDecision,
  raw: unknown,
  file: string,
): CarriedDecisions {
  const reading = readDecisions(report, raw, file, build, identities, silent);
  if (reading.refused) throw new DecisionsError(reading.refused);
  let carried = 0;
  let reconfirm = 0;
  const decisions = entries.map((entry): OwnerDecision => {
    const before = reading.taken.get(entry.id);
    // An offer no one has confirmed yet is offered again, as it was.
    if (before?.earlier && ![before.owner, before.decision, before.reason].some(saysSomething)) {
      reconfirm++;
      return { ...blankOf(entry), earlier: before.earlier };
    }
    if (before) {
      carried++;
      return {
        ...blankOf(entry),
        owner: before.owner,
        decision: before.decision,
        ...(entry.outcome === 'proposed' ? { reason: before.reason ?? '' } : {}),
      };
    }
    const moved = reading.moved.get(entry.id);
    if (!moved) return blankOf(entry);
    reconfirm++;
    return {
      ...blankOf(entry),
      earlier: offerOf(moved.item) ?? earlierOf(moved.item, build.bundle, moved.changed),
    };
  });
  // One whose item changed is offered for re-confirmation, and says so, rather than to decide it.
  const offered = new Map([...reading.moved.values()].map((moved) => [moved.finding, moved]));
  // What an earlier carry from another build did stays said, for the report.
  const carriedFrom = isRecord(raw) ? carriedFromOf(raw['carriedFrom']) : undefined;
  return {
    file: {
      format: DECISIONS_FORMAT,
      package: { ...build },
      decisions,
      ...sharedOf(shared),
      ...(carriedFrom ? { carriedFrom } : {}),
    },
    carried,
    notCarried: reading.findings.map((line) => {
      const moved = offered.get(line);
      return moved
        ? `${file}: ${String(moved.item['id'])} was made on another ${moved.changed.map((key) => PINNED_WORDS[key]).join(' and ')} than the report gives now, so it is offered for re-confirmation, beside it`
        : line;
    }),
    reconfirm,
    blank: unfilled(decisions),
  };
}

function carryOtherBuild(
  build: DecisionsBuild,
  identities: ReadonlyMap<string, string>,
  shared: ReadonlySet<string>,
  entries: readonly ReportEntry[],
  blankOf: (entry: ReportEntry) => OwnerDecision,
  raw: Record<string, unknown>,
  file: string,
  given: Readonly<Record<string, unknown>>,
): CarriedDecisions {
  if (!Array.isArray(raw['decisions']))
    throw new DecisionsError(`${file} holds no list of decisions, so none of it is taken`);
  const all = raw['decisions'] as unknown[];
  const items = all.filter((item) => !silent(item));
  // The identities the earlier build could not tell apart: as its file says, and any it names
  // twice, said something or not.
  const earlierShared = new Set(
    Array.isArray(raw['shared'])
      ? raw['shared'].filter((identity): identity is string => typeof identity === 'string')
      : [],
  );
  const from = describeBuild(given);
  const earlierBundle = typeof given['bundle'] === 'string' ? given['bundle'] : '';
  // This build's items, by their construct's identity.
  const byIdentity = new Map<string, ReportEntry>();
  for (const entry of entries) {
    const identity = identities.get(entry.id);
    if (identity !== undefined && !shared.has(identity)) byIdentity.set(identity, entry);
  }
  // An identity the earlier file decides twice cannot say which decision is meant.
  const times = new Map<string, number>();
  for (const item of all)
    if (isRecord(item) && typeof item['identity'] === 'string')
      times.set(item['identity'], (times.get(item['identity']) ?? 0) + 1);

  const notCarried: string[] = [];
  const dropped: DroppedDecision[] = [];
  const carriedTo = new Map<string, Record<string, unknown>>();
  const offered = new Map<string, { item: Record<string, unknown>; changed: PinnedKey[] }>();
  const drop = (item: unknown, why: string): void => {
    const record = isRecord(item) ? item : {};
    const text = (key: string): string | null =>
      typeof record[key] === 'string' ? (record[key] as string) : null;
    dropped.push({
      id: text('id') ?? '',
      identity: text('identity'),
      label: text('label'),
      owner: text('owner'),
      decision: text('decision'),
      why,
    });
    notCarried.push(`${file}: ${text('id') ?? 'a decision that names no item'} ${why}`);
  };
  for (const item of items) {
    if (!isRecord(item) || typeof item['id'] !== 'string' || item['id'] === '') {
      drop(item, 'names no item, so it is not carried');
      continue;
    }
    const identity = item['identity'];
    if (typeof identity !== 'string' || identity === '') {
      drop(item, "names no construct's identity, so it is carried to no other build");
      continue;
    }
    if ((times.get(identity) ?? 0) > 1) {
      drop(
        item,
        `is one of ${times.get(identity)} decisions of one construct, and which is meant cannot be told, so none is carried`,
      );
      continue;
    }
    if (earlierShared.has(identity)) {
      drop(
        item,
        'is of a construct the earlier build held more than once, alike, so which one it was made on cannot be told, and it is not carried: decide it again',
      );
      continue;
    }
    if (shared.has(identity)) {
      drop(
        item,
        'is of a construct this build holds more than once, alike, so which one it was made on cannot be told, and it is not carried: decide each again',
      );
      continue;
    }
    const entry = byIdentity.get(identity);
    if (!entry) {
      drop(
        item,
        'is of a construct this build no longer holds, or no longer asks a decision of, so it is dropped',
      );
      continue;
    }
    const proposal = entry.outcome === 'proposed';
    const keys = proposal ? PROPOSAL_KEYS : REPORTED_KEYS;
    const extra = Object.keys(item).filter((key) => !keys.has(key) && key !== 'reason');
    const notText = (['owner', 'decision', 'reason'] as const).filter(
      (key) => item[key] !== undefined && typeof item[key] !== 'string',
    );
    if (extra.length > 0 || notText.length > 0) {
      drop(
        item,
        `holds ${[...extra, ...notText].join(', ')}, which a decision does not take as it is, so it is not carried`,
      );
      continue;
    }
    // An offer no one confirmed is offered again, its earlier decision as it was offered.
    if (offerOf(item)) {
      offered.set(entry.id, { item, changed: [] });
      continue;
    }
    const changed = (proposal ? PROPOSAL_PINNED : PINNED).filter(
      (key) => !same(item[key], entry[key]),
    );
    if (changed.length > 0) offered.set(entry.id, { item, changed });
    else carriedTo.set(entry.id, item);
  }
  let carried = 0;
  const decisions = entries.map((entry): OwnerDecision => {
    const item = carriedTo.get(entry.id);
    if (item) {
      carried++;
      return {
        ...blankOf(entry),
        owner: (item['owner'] as string | undefined) ?? '',
        decision: (item['decision'] as string | undefined) ?? '',
        ...(entry.outcome === 'proposed'
          ? { reason: (item['reason'] as string | undefined) ?? '' }
          : {}),
      };
    }
    const moved = offered.get(entry.id);
    if (!moved) return blankOf(entry);
    const again = offerOf(moved.item);
    notCarried.push(
      again
        ? `${file}: ${String(moved.item['id'])} was offered for re-confirmation there, and no one confirmed it, so it is offered again, beside ${entry.id}`
        : `${file}: ${String(moved.item['id'])} was made on another ${moved.changed.map((key) => PINNED_WORDS[key]).join(' and ')} than this build's report gives ${entry.id}, so it is offered for re-confirmation, beside it`,
    );
    return {
      ...blankOf(entry),
      earlier: again ?? earlierOf(moved.item, earlierBundle, moved.changed),
    };
  });
  const reconfirmIds = decisions.filter((item) => item.earlier).map((item) => item.id);
  return {
    file: {
      format: DECISIONS_FORMAT,
      package: { ...build },
      decisions,
      ...sharedOf(shared),
      carriedFrom: {
        package: buildOf(given),
        carried: [...carriedTo.keys()],
        reconfirm: reconfirmIds,
        dropped,
      },
    },
    carried,
    notCarried,
    reconfirm: reconfirmIds.length,
    otherBuild: from,
    blank: unfilled(decisions),
  };
}

function earlierOf(
  item: Readonly<Record<string, unknown>>,
  bundle: string,
  changed: readonly PinnedKey[],
): EarlierDecision {
  const madeOn: Record<string, unknown> = {};
  for (const key of PINNED) if (item[key] !== undefined) madeOn[key] = item[key];
  return {
    bundle,
    owner: typeof item['owner'] === 'string' ? item['owner'] : '',
    decision: typeof item['decision'] === 'string' ? item['decision'] : '',
    ...(typeof item['reason'] === 'string' ? { reason: item['reason'] } : {}),
    madeOn: madeOn as Pick<ReportEntry, PinnedKey>,
    changed: changed.map((key) => PINNED_WORDS[key]),
  };
}

/** How many of the decisions are still to fill in: spaces alone are nothing. */
export function unfilled(
  decisions: readonly Pick<OwnerDecision, 'owner' | 'decision' | 'reason' | 'outcome'>[],
): number {
  return decisions.filter((item) => {
    if (item.outcome !== 'proposed')
      return !saysSomething(item.owner) || !saysSomething(item.decision);
    const decision = typeof item.decision === 'string' ? item.decision.trim() : '';
    return (
      !saysSomething(item.owner) ||
      (decision !== ACCEPT && decision !== REJECT) ||
      !saysSomething(item.reason)
    );
  }).length;
}

export class DecisionsError extends Error {
  override readonly name = 'DecisionsError';
}

/** Whether an owner or a decision says anything: text that is not only spaces. */
function saysSomething(value: unknown): boolean {
  return typeof value === 'string' && legible(value);
}

/** A letter or a digit. */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** Hangul fillers: Unicode counts them letters, and they show nothing. */
const FILLERS = /[\u115f\u1160\u3164\uffa0]/gu;

/**
 * Whether a text says something a person can read: a letter or a digit that shows. Spaces alone,
 * or characters that show nothing, such as a zero-width space or a Hangul filler, say nothing, and
 * name no one.
 */
export function legible(text: string): boolean {
  return LETTER_OR_DIGIT.test(text.replace(FILLERS, ''));
}

/**
 * The earlier decision an entry offers for re-confirmation, when no one has confirmed it yet:
 * carried on as it was offered, never as the blank beside it.
 */
function offerOf(item: Readonly<Record<string, unknown>>): EarlierDecision | undefined {
  return isRecord(item['earlier']) &&
    ![item['owner'], item['decision'], item['reason']].some(saysSomething)
    ? (item['earlier'] as unknown as EarlierDecision)
    : undefined;
}

/** An entry that says nothing has nothing to carry, and nothing to lose, unless it is an offer. */
function silentEntry(item: unknown): boolean {
  if (!isRecord(item) || item['earlier'] !== undefined) return false;
  return [item['owner'], item['decision'], item['reason']].every(
    (value) => value === undefined || (typeof value === 'string' && !legible(value)),
  );
}

/** The first entry of each id, in the report's order: an id listed twice is its first entry's. */
function firstEntries(report: MigrationReport): ReportEntry[] {
  const seen = new Set<string>();
  return (Array.isArray(report.constructs) ? report.constructs : []).filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/**
 * The entries a person decides, of one kind, in the report's order: the reported items, or the
 * proposals that take a decision of their own.
 */
function decidedEntries(report: MigrationReport, kind: 'reported' | 'proposed'): ReportEntry[] {
  return firstEntries(report).filter((entry) =>
    kind === 'reported'
      ? entry.outcome === 'reported'
      : entry.outcome === 'proposed' && entry.proposal === true,
  );
}

function pinnedOf(entry: ReportEntry): Pick<ReportEntry, PinnedKey> {
  const pinned: Record<string, unknown> = {};
  const keys = entry.outcome === 'proposed' ? PROPOSAL_PINNED : PINNED;
  for (const key of keys) if (entry[key] !== undefined) pinned[key] = entry[key];
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

/** A build as a file names it, each of its five keys a text or `null`. */
function buildOf(given: Readonly<Record<string, unknown>>): DecisionsBuild {
  const text = (key: string): string | null =>
    typeof given[key] === 'string' ? (given[key] as string) : null;
  return {
    name: text('name') ?? '',
    version: text('version') ?? '',
    commit: text('commit'),
    buildTime: text('buildTime'),
    bundle: text('bundle') ?? '',
  };
}

/** What a file says it carried from an earlier build, when it is of that shape. */
function carriedFromOf(value: unknown): CarriedFrom | undefined {
  if (!isRecord(value) || !isRecord(value['package'])) return undefined;
  const ids = (list: unknown): string[] =>
    Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  const dropped = Array.isArray(value['dropped'])
    ? value['dropped'].filter(isRecord).map((item): DroppedDecision => ({
        id: typeof item['id'] === 'string' ? item['id'] : '',
        identity: typeof item['identity'] === 'string' ? item['identity'] : null,
        label: typeof item['label'] === 'string' ? item['label'] : null,
        owner: typeof item['owner'] === 'string' ? item['owner'] : null,
        decision: typeof item['decision'] === 'string' ? item['decision'] : null,
        why: typeof item['why'] === 'string' ? item['why'] : '',
      }))
    : [];
  return {
    package: buildOf(value['package']),
    carried: ids(value['carried']),
    reconfirm: ids(value['reconfirm']),
    dropped,
  };
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
  identities: ReadonlyMap<string, string>,
  passOver: (item: unknown) => boolean = () => false,
): Reading {
  const none: Reading = { findings: [], taken: new Map(), moved: new Map() };
  const format = isRecord(raw) ? raw['format'] : undefined;
  if (!isRecord(raw) || (format !== DECISIONS_FORMAT && format !== DECISIONS_FORMAT_1)) {
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
  // A file of the first format names no identity: its items are their places alone.
  const named = format === DECISIONS_FORMAT;

  const entries = new Map<string, ReportEntry>();
  for (const entry of firstEntries(report)) entries.set(entry.id, entry);
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
  const moved = new Map<
    string,
    { item: Record<string, unknown>; changed: readonly PinnedKey[]; finding: string }
  >();
  const reported = new Set<string>();
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
      if (!reported.has(id)) findings.push(`${file}: ${id} is decided ${count} times`);
      reported.add(id);
      return;
    }
    const entry = entries.get(id);
    const proposal = entry?.outcome === 'proposed';
    const extra = Object.keys(item).filter(
      (key) => !(proposal ? PROPOSAL_KEYS : REPORTED_KEYS).has(key),
    );
    if (extra.length > 0) {
      findings.push(`${file}: ${id} holds ${extra.join(', ')}, which a decision does not take`);
      return;
    }
    if (!entry) {
      findings.push(`${file}: ${id} is not in the report`);
      return;
    }
    if (entry.outcome === 'proposed' && entry.proposal !== true) {
      findings.push(
        `${file}: ${id} is proposed only because the condition it shows under is, and takes no decision of its own: decide the condition's proposal, and it follows`,
      );
      return;
    }
    if (entry.outcome !== 'reported' && entry.outcome !== 'proposed') {
      findings.push(
        `${file}: ${id} is ${String(entry.outcome)} in the report, and only a reported item or a proposal takes a decision`,
      );
      return;
    }
    // Its construct: the one of that identity, never another the place now holds.
    if (named || item['identity'] !== undefined) {
      const identity = identities.get(id);
      if (item['identity'] !== identity) {
        findings.push(
          `${file}: ${id} was made on another construct than the package holds there now, whose identity is ${identity ?? 'none'}, not ${typeof item['identity'] === 'string' ? item['identity'] : 'none'}, so it is not taken: decide it again`,
        );
        return;
      }
    }
    const notText = (['owner', 'decision', 'reason'] as const).filter(
      (key) => item[key] !== undefined && typeof item[key] !== 'string',
    );
    if (notText.length > 0) {
      findings.push(`${file}: ${id}: its ${notText.join(' and ')} is not text`);
      return;
    }
    const changed = (proposal ? PROPOSAL_PINNED : PINNED).filter(
      (key) => !same(item[key], entry[key]),
    );
    if (changed.length > 0) {
      const finding = `${file}: ${id} was made on another ${changed.map((key) => PINNED_WORDS[key]).join(' and ')} than the report gives now, so it is not taken: decide it again`;
      findings.push(finding);
      moved.set(id, { item, changed, finding });
      return;
    }
    if (proposal) {
      const verdict = typeof item['decision'] === 'string' ? item['decision'].trim() : '';
      if (verdict !== '' && verdict !== ACCEPT && verdict !== REJECT) {
        findings.push(
          `${file}: ${id}: its decision is ${JSON.stringify(item['decision'])}, and a proposal is decided "${ACCEPT}" or "${REJECT}"`,
        );
        return;
      }
      // Accepting writes what is proposed: a proposal of nothing the converter can write cannot be.
      // A custom element's plugin is the one proposal the converter writes nothing of: an agent
      // writes it, check 9 holds it, and accepting it is what readiness and the approval need.
      if (verdict === ACCEPT && entry.rule === undefined && entry.kind !== 'custom-element') {
        findings.push(
          `${file}: ${id} proposes nothing the converter can write yet, so it cannot be accepted: reject it, with your reason, or leave it for the mapping agent`,
        );
        return;
      }
    }
    taken.set(id, {
      id,
      ...(typeof item['identity'] === 'string' ? { identity: item['identity'] } : {}),
      ...pinnedOf(entry),
      owner: (item['owner'] as string | undefined) ?? '',
      decision: (item['decision'] as string | undefined) ?? '',
      ...(proposal ? { reason: (item['reason'] as string | undefined) ?? '' } : {}),
      ...(isRecord(item['earlier'])
        ? { earlier: item['earlier'] as unknown as EarlierDecision }
        : {}),
    });
  });
  return { findings, taken, moved };
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
