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
 * - **the decisions needed:** every reported item with its owner and what they decided, and every
 *   proposal, which waits for a person;
 * - **each file:** what its constructs became. What the harness found is not split by file: its
 *   findings name the conversion's files, and are given whole.
 *
 * The counts are of the package's constructs as the inventory reads them, each with the outcome of
 * its first entry in the report, so that an entry the report leaves out is counted `missing`
 * rather than not at all. The coverage is check 1's. Screenshots wait for the migration server.
 */
import { constructsOf, type ConstructKind } from './constructs';
import { OUTCOMES, packageBuildOf, studioBuildOf, type Outcome, type ReportEntry } from './convert';
import { holdDecisions } from './decisions';
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
  /** Every proposal: a person accepts or rejects it, which no command records yet. */
  readonly proposed: readonly Pick<ReportedItem, 'id' | 'label' | 'file' | 'note'>[];
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
  const held = holdDecisions(report, conversion.decisions, packageBuildOf(pkg));
  const isDecided = (id: string): boolean => {
    const taken = held.taken.get(id);
    return Boolean(taken?.owner.trim() && taken.decision.trim());
  };

  const count = (kind: KindCount['kind'], ids: readonly string[]): KindCount => {
    const tallies = Object.fromEntries(TALLIES.map((tally) => [tally, 0])) as Record<Tally, number>;
    let decided = 0;
    for (const id of ids) {
      const tally = tallyOf(id);
      tallies[tally]++;
      if (tally === 'reported' && isDecided(id)) decided++;
    }
    return { kind, total: ids.length, tallies, decided };
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
        owner: taken?.owner.trim() ? taken.owner : null,
        decision: taken?.decision.trim() ? taken.decision : null,
      };
    });
  const proposed = entries
    .filter((entry) => entry.outcome === 'proposed' && first.get(entry.id) === entry)
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      file: entry.file,
      note: entry.note ?? '',
    }));

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
    return { path: file.path, kind: file.kind, tallies, became };
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
    files,
  };
}
