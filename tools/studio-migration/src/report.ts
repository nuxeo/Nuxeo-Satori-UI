/**
 * A migration's report as docs/business-apps/studio-migration.md, section 8, lays it out, for the
 * person who approves it:
 *
 * - **the header:** the package given and its version, Studio's branch, commit and build time,
 *   the platform the package targets and the one the app asks for, the converter, and the
 *   allow-list the harness held the actions to, the deployment's or the one the conversion
 *   recorded. Check 1 says whether the report is of that package;
 * - **the summary:** the package's constructs by kind and outcome, with how many reported ones are
 *   decided, and the coverage, which must be 100%;
 * - **what the harness found:** its ten checks and the verdict, with what stands in the way;
 * - **the decisions needed:** every reported item with its owner and what they decided, every
 *   proposal with who accepted or rejected it and why, or that it waits, and, for decisions carried
 *   from an earlier build of the package, which were carried, offered for re-confirmation or
 *   dropped;
 * - **the approval:** who approved the report and its decisions, and when, or why there is none
 *   that holds;
 * - **what the harness found, file by file:** each finding under the file of the conversion it
 *   names, or of the package, or under none (`fileOfFinding`);
 * - **each file of the package:** what its constructs became, and what the harness found in the
 *   files of the conversion they became.
 *
 * The counts are of the package's constructs as the inventory reads them, each with the outcome of
 * its first entry in the report, so that an entry the report leaves out is counted `missing`
 * rather than not at all. The coverage is check 1's. Lab mode takes the screenshots, beside its
 * own report; this one does not take them in yet.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import { holdApproval } from './approval';
import { constructsOf, identitiesOf, type ConstructKind } from './constructs';
import {
  OUTCOMES,
  packageBuildOf,
  studioBuildOf,
  type Conversion,
  type Outcome,
  type ReportEntry,
} from './convert';
import { holdDecisions, LEGIBLE, type CarriedFrom, type EarlierDecision } from './decisions';
import { coverage, runHarness, type CheckResult, type HarnessInput } from './harness';
import type { FileKind } from './inventory';

/** A construct's place in the summary: an outcome, or not an outcome at all. */
export type Tally = Outcome | 'not an outcome' | 'missing';

export interface KindCount {
  readonly kind: ConstructKind | 'all';
  readonly total: number;
  /** How many have each tally. */
  readonly tallies: Readonly<Record<Tally, number>>;
  /** Of the reported ones, how many have a decision taken, with an owner and what they decided. */
  readonly decided: number;
  /** Of the proposed ones, how many a person accepted, and how many they rejected. */
  readonly accepted: number;
  readonly rejected: number;
}

/** A proposal, and what a person decided of it. */
export interface ProposalItem {
  readonly id: string;
  readonly label: string;
  readonly file: string;
  readonly note: string;
  /** The rule it proposes, for a condition's. */
  readonly rule?: unknown;
  /**
   * `accepted` or `rejected` by someone named, for a reason; `waiting` for a person; `follows`
   * for what a condition's proposal guards, which is decided with the condition's.
   */
  readonly status: 'accepted' | 'rejected' | 'waiting' | 'follows';
  readonly owner: string | null;
  readonly reason: string | null;
  /** What the conversion was made with, and where an accepted one was written. */
  readonly applied?: 'accept' | 'reject';
  readonly to?: string;
}

/** A decision of an earlier build offered again, beside the item of this build it is of. */
export interface ReconfirmItem {
  readonly id: string;
  readonly label: string;
  readonly earlier: EarlierDecision;
  /** True once a person filled the decision beside it, and it is taken. */
  readonly confirmed: boolean;
}

/** The findings of one file, of the conversion or of the package, or of none. */
export interface FileFindings {
  /** The file, `app/…` or `themes/…` of the conversion, or a package file; `null` for none. */
  readonly file: string | null;
  readonly of: 'conversion' | 'package' | 'none';
  /** For a file of the conversion: the package's files whose constructs it holds. */
  readonly from: readonly string[];
  readonly findings: readonly { readonly check: number; readonly line: string }[];
}

export interface ApprovalSummary {
  readonly approved: boolean;
  readonly by: string | null;
  readonly at: string | null;
  /** Why it does not hold, one line each: none, void, or not an approval. */
  readonly findings: readonly string[];
}

export interface ReportedItem {
  readonly id: string;
  readonly label: string;
  readonly file: string;
  readonly note: string;
  readonly to?: string;
  /** `null` when no decision is taken for it, or its decision names no one. */
  readonly owner: string | null;
  /** `null` when no decision is taken for it, or it says nothing decided. */
  readonly decision: string | null;
}

export interface FileSummary {
  readonly path: string;
  readonly kind: FileKind;
  readonly tallies: Readonly<Partial<Record<Tally, number>>>;
  /** Where its converted constructs went, each place once. */
  readonly became: readonly string[];
  /**
   * What the harness found in the files of the conversion its constructs went to, or naming it:
   * the lines of `byFile` that are its.
   */
  readonly found: readonly {
    readonly check: number;
    readonly file: string;
    readonly line: string;
  }[];
}

export interface MigrationSummary {
  readonly header: {
    readonly package: {
      readonly name: string;
      readonly version: string;
      readonly bundle: string;
      readonly targetPlatform: string | null;
      readonly targetPlatformName: string | null;
    };
    readonly studio: {
      readonly branch: string | null;
      readonly commit: string | null;
      readonly buildTime: string | null;
    };
    /** `app.json`'s id and platform range, `null` where the conversion has none. */
    readonly app: { readonly id: string | null; readonly platform: string | null };
    readonly converter: { readonly name: string; readonly version: string; readonly phase: string };
    /** The operations the harness held the actions to, and whose list it was. */
    readonly allowList: {
      readonly operations: readonly string[];
      readonly from: 'deployment' | 'conversion';
    };
  };
  readonly kinds: readonly KindCount[];
  readonly all: KindCount;
  readonly coverage: {
    readonly accounted: number;
    readonly constructs: number;
    readonly percent: number;
  };
  readonly checks: readonly CheckResult[];
  readonly ready: boolean;
  readonly blockers: readonly string[];
  /** Every reported item, in the report's order, with its owner. */
  readonly reported: readonly ReportedItem[];
  /** What is wrong with `decisions.json`, one line each. */
  readonly decisionFindings: readonly string[];
  /** Every proposal, with what a person decided of it. */
  readonly proposed: readonly ProposalItem[];
  /** For a `decisions.json` carried from an earlier build: what it carried, offered and dropped. */
  readonly carried: {
    readonly from: CarriedFrom['package'];
    readonly carried: number;
    readonly reconfirm: readonly ReconfirmItem[];
    readonly dropped: CarriedFrom['dropped'];
  } | null;
  readonly approval: ApprovalSummary;
  /** What the harness found, file by file. */
  readonly byFile: readonly FileFindings[];
  readonly files: readonly FileSummary[];
}

export const TALLIES: readonly Tally[] = [...OUTCOMES, 'not an outcome', 'missing'];

export function summarise(input: HarnessInput): MigrationSummary {
  const { pkg, inventory, conversion } = input;
  const { report } = conversion;
  const result = runHarness(input);
  const entries = Array.isArray(report.constructs) ? report.constructs : [];
  const first = new Map<string, ReportEntry>();
  for (const entry of entries) if (!first.has(entry.id)) first.set(entry.id, entry);

  const constructs = constructsOf(inventory);
  const tallyOf = (id: string): Tally => {
    const entry = first.get(id);
    if (!entry) return 'missing';
    return (OUTCOMES as readonly string[]).includes(entry.outcome)
      ? entry.outcome
      : 'not an outcome';
  };
  const build = packageBuildOf(pkg);
  const held = holdDecisions(report, conversion.decisions, build, identitiesOf(inventory));
  const isDecided = (id: string): boolean => {
    const taken = held.taken.get(id);
    return Boolean(taken && LEGIBLE.test(taken.owner) && LEGIBLE.test(taken.decision));
  };

  const count = (kind: KindCount['kind'], ids: readonly string[]): KindCount => {
    const tallies = Object.fromEntries(TALLIES.map((tally) => [tally, 0])) as Record<Tally, number>;
    let decided = 0;
    let accepted = 0;
    let rejected = 0;
    for (const id of ids) {
      const tally = tallyOf(id);
      tallies[tally]++;
      if (tally === 'reported' && isDecided(id)) decided++;
      const verdict = tally === 'proposed' ? held.verdicts.get(id) : undefined;
      if (verdict?.accepted === true) accepted++;
      if (verdict?.accepted === false) rejected++;
    }
    return { kind, total: ids.length, tallies, decided, accepted, rejected };
  };
  const kinds: KindCount[] = [];
  for (const kind of [...new Set(constructs.map((construct) => construct.kind))]) {
    kinds.push(
      count(
        kind,
        constructs.filter((construct) => construct.kind === kind).map((construct) => construct.id),
      ),
    );
  }
  const all = count(
    'all',
    constructs.map((construct) => construct.id),
  );
  // Check 1's measure: a construct is accounted for once the report lists it.
  const accounted = constructs.filter((construct) => first.has(construct.id)).length;

  const reported = entries
    .filter((entry) => entry.outcome === 'reported' && first.get(entry.id) === entry)
    .map((entry): ReportedItem => {
      const taken = held.taken.get(entry.id);
      return {
        id: entry.id,
        label: entry.label,
        file: entry.file,
        note: entry.note ?? '',
        ...(entry.to !== undefined ? { to: entry.to } : {}),
        owner: taken && LEGIBLE.test(taken.owner) ? taken.owner : null,
        decision: taken && LEGIBLE.test(taken.decision) ? taken.decision : null,
      };
    });
  const proposed = entries
    .filter((entry) => entry.outcome === 'proposed' && first.get(entry.id) === entry)
    .map((entry): ProposalItem => {
      const verdict = held.verdicts.get(entry.id);
      const taken = held.taken.get(entry.id);
      const status: ProposalItem['status'] =
        entry.proposal !== true
          ? 'follows'
          : verdict
            ? verdict.accepted
              ? 'accepted'
              : 'rejected'
            : 'waiting';
      return {
        id: entry.id,
        label: entry.label,
        file: entry.file,
        note: entry.note ?? '',
        ...(entry.rule !== undefined ? { rule: entry.rule } : {}),
        status,
        owner: taken && LEGIBLE.test(taken.owner) ? taken.owner : null,
        reason: taken?.reason !== undefined && LEGIBLE.test(taken.reason) ? taken.reason : null,
        ...(entry.applied !== undefined ? { applied: entry.applied } : {}),
        ...(entry.to !== undefined ? { to: entry.to } : {}),
      };
    });

  const carried = held.carriedFrom
    ? {
        from: held.carriedFrom.package,
        carried: held.carriedFrom.carried.length,
        reconfirm: reconfirmItems(conversion, held, first),
        dropped: held.carriedFrom.dropped,
      }
    : null;
  const approval = holdApproval(conversion, build);
  const byFile = findingsByFile(
    result.checks,
    conversion,
    inventory.files.map((file) => file.path),
  );

  const files = inventory.files.map((file): FileSummary => {
    const own = constructs.filter((construct) => construct.file === file.path);
    const tallies: Partial<Record<Tally, number>> = {};
    for (const construct of own) {
      const tally = tallyOf(construct.id);
      tallies[tally] = (tallies[tally] ?? 0) + 1;
    }
    const became = [
      ...new Set(
        own
          .map((construct) => first.get(construct.id))
          .filter((entry) => entry?.outcome === 'converted' && entry.to)
          .map((entry) => entry?.to ?? ''),
      ),
    ];
    const found = byFile.flatMap((group) =>
      group.file !== null && (group.file === file.path || group.from.includes(file.path))
        ? group.findings.map((finding) => ({ ...finding, file: group.file as string }))
        : [],
    );
    return { path: file.path, kind: file.kind, tallies, became, found };
  });

  const app = conversion.app['app.json'];
  const field = (key: string): string | null => {
    const value =
      typeof app === 'object' && app !== null ? (app as Record<string, unknown>)[key] : null;
    return typeof value === 'string' ? value : null;
  };
  return {
    header: {
      // The package handed in, not the report's word for it: check 1 compares the two.
      package: {
        name: pkg.descriptor.name,
        version: pkg.descriptor.version,
        bundle: pkg.bundlePath,
        targetPlatform: pkg.descriptor.targetPlatform,
        targetPlatformName: pkg.descriptor.targetPlatformName,
      },
      studio: studioBuildOf(pkg),
      app: { id: field('id'), platform: field('platform') },
      converter: report.converter,
      allowList: input.allowList
        ? { operations: [...input.allowList].sort(), from: 'deployment' }
        : { operations: [...(report.allowList ?? [])].sort(), from: 'conversion' },
    },
    kinds,
    all,
    coverage: {
      accounted,
      constructs: constructs.length,
      percent: coverage(accounted, constructs.length),
    },
    checks: result.checks,
    ready: result.ready,
    blockers: result.blockers,
    reported,
    decisionFindings: held.findings,
    proposed,
    carried,
    approval: {
      approved: approval.approved,
      by: approval.approval?.approvedBy ?? null,
      at: approval.approval?.approvedAt ?? null,
      findings: approval.findings,
    },
    byFile,
    files,
  };
}

/** The items offered for re-confirmation: `decisions.json`'s entries that hold `earlier`. */
function reconfirmItems(
  conversion: Conversion,
  held: Pick<ReturnType<typeof holdDecisions>, 'taken' | 'verdicts'>,
  first: ReadonlyMap<string, ReportEntry>,
): ReconfirmItem[] {
  const file = conversion.decisions;
  const items = isRecord(file) && Array.isArray(file['decisions']) ? file['decisions'] : [];
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  return items.flatMap((item: unknown): ReconfirmItem[] => {
    if (!isRecord(item) || typeof item['id'] !== 'string' || !isRecord(item['earlier'])) return [];
    const earlier = item['earlier'];
    const decision = held.taken.get(item['id']);
    // Confirmed once decided again as its kind is: a proposal accepted or rejected, by someone
    // named, for a reason; a reported item owned and decided.
    const confirmed =
      first.get(item['id'])?.outcome === 'proposed'
        ? held.verdicts.has(item['id'])
        : Boolean(decision && LEGIBLE.test(decision.owner) && LEGIBLE.test(decision.decision));
    const changed = Array.isArray(earlier['changed'])
      ? earlier['changed'].filter((word): word is string => typeof word === 'string')
      : [];
    return [
      {
        id: item['id'],
        label: first.get(item['id'])?.label ?? text(item['label']),
        earlier: {
          bundle: text(earlier['bundle']),
          owner: text(earlier['owner']),
          decision: text(earlier['decision']),
          ...(typeof earlier['reason'] === 'string' ? { reason: earlier['reason'] } : {}),
          madeOn: (isRecord(earlier['madeOn'])
            ? earlier['madeOn']
            : {}) as EarlierDecision['madeOn'],
          changed,
        },
        confirmed,
      },
    ];
  });
}

/** A file of the conversion, as a finding or a report entry's `to` names it. */
const CONVERSION_FILE =
  /^(?:app\/)?((?:layouts|tasks|queues|labels)\/[A-Za-z0-9._/-]+?\.json|(?:actions|home|navigation|app)\.json)(?![\w.])|^(themes\/[A-Za-z0-9._/-]+)/;

/** The files of the conversion a report entry's `to` names, each as `app/…` or `themes/…`. */
function filesNamed(to: string): string[] {
  const found = new Set<string>();
  for (const word of to.split(/[\s,]+/)) {
    const match = CONVERSION_FILE.exec(word);
    if (match?.[1]) found.add(`app/${match[1]}`);
    else if (match?.[2]) found.add(match[2]);
  }
  return [...found];
}

/**
 * The file a finding is of: the file of the conversion it starts by naming, as the checks write
 * them (`layouts/…: …`, `app/labels/…: …`, `themes/….json is missing`, or a theme by its name);
 * else a file of the package it names, as check 1's and check 5's own lines do; else none.
 */
export function fileOfFinding(
  line: string,
  conversion: Pick<Conversion, 'themes'>,
  packageFiles: ReadonlySet<string>,
): { readonly file: string; readonly of: 'conversion' | 'package' } | null {
  const named = CONVERSION_FILE.exec(line);
  if (named?.[1]) return { file: `app/${named[1]}`, of: 'conversion' };
  if (named?.[2]) return { file: named[2].replace(/[:,]+$/, ''), of: 'conversion' };
  // Check 8 names a theme by its name.
  const theme = /^([^\s:]+): /.exec(line)?.[1];
  if (theme !== undefined && Object.hasOwn(conversion.themes, theme))
    return { file: `themes/${theme}.json`, of: 'conversion' };
  // A file of the package, alone or in a construct's id, `<kind>:<file>#<key>`.
  for (const word of line.split(/[\s(),]+/)) {
    const path = word.replace(/^[a-z-]+:(?=[^/]*\/)/, '').replace(/[#:].*$/, '');
    if (packageFiles.has(path)) return { file: path, of: 'package' };
  }
  return null;
}

/** What the harness found, grouped by the file each finding is of, in the order first found. */
function findingsByFile(
  checks: readonly CheckResult[],
  conversion: Conversion,
  packageFiles: readonly string[],
): FileFindings[] {
  const inPackage = new Set(packageFiles);
  // The package's files whose constructs each file of the conversion holds, from the report.
  const from = new Map<string, Set<string>>();
  const entries = Array.isArray(conversion.report.constructs) ? conversion.report.constructs : [];
  for (const entry of entries)
    if (typeof entry.to === 'string')
      for (const file of filesNamed(entry.to))
        from.set(file, new Set([...(from.get(file) ?? []), entry.file]));
  const groups = new Map<
    string,
    { file: string | null; of: FileFindings['of']; findings: { check: number; line: string }[] }
  >();
  for (const check of checks)
    for (const line of check.findings) {
      const at = fileOfFinding(line, conversion, inPackage);
      const key = at ? `${at.of} ${at.file}` : 'none';
      const group = groups.get(key) ?? {
        file: at?.file ?? null,
        of: at?.of ?? 'none',
        findings: [],
      };
      group.findings.push({ check: check.number, line });
      groups.set(key, group);
    }
  return [...groups.values()].map((group) => ({
    ...group,
    from: group.of === 'conversion' && group.file ? [...(from.get(group.file) ?? [])].sort() : [],
  }));
}
