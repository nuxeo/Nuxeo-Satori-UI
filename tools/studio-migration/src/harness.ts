/**
 * The verification harness: the ten checks of docs/business-apps/studio-migration.md, section 6,
 * run over a package and its conversion.
 *
 * Phase M1 runs nine of them. Five run in full without a server: 1 (nothing dropped), 2
 * (fields), 4 (labels), 8 (theme) and 10 (package). Four have a half that needs the migration
 * server, with Web UI and the new app on it: 3 (model), 5 (conditions), 6 (what people see) and
 * 7 (what the server is asked). Their other half runs here, and each says what it did not run. A
 * check whose findings are empty but which did not run whole is `partial`, never a pass. Check 9
 * (`check-plugins.ts`), M3's, holds each custom element's plugin to the element: its scan runs on
 * the files, and its tests, gates and values run when `check` is given `--run-plugins`. Lab mode
 * (`lab-cli.ts`) runs what it can of the server halves, against a real server, and never through
 * this file's result.
 *
 * A migration is ready only when all ten pass, nothing is pending, every proposal is accepted or
 * rejected by someone named, for a reason, and the conversion was made with those decisions, every
 * reported item has an owner and a decision, in the conversion's `decisions.json`
 * (`decisions.ts`), with nothing wrong in that file, and a person has approved the report and its
 * decisions as they are now (`approval.ts`). So an M1 run is never ready, and says what stands in
 * the way.
 */
import { mapThemeProperty, type Catalogue } from './catalogue';
import { checkConditions } from './check-conditions';
import { checkFields } from './check-fields';
import { checkModel } from './check-model';
import { checkPlugins } from './check-plugins';
import { checkPackage } from './check-package';
import { checkRequests } from './check-requests';
import { checkSeen } from './check-seen';
import { contrastRatio, parseColour } from './colour';
import { holdApproval } from './approval';
import { constructsOf, countsOf, identitiesOf } from './constructs';
import { holdDecisions, madeOtherwise } from './decisions';
import {
  EXPLAINED,
  OUTCOMES,
  labelsOf,
  platformVersion,
  packageBuildOf,
  readCatalogue,
  recordedVerdicts,
  reportDiffers,
  studioBuildOf,
  withVerdicts,
  type Conversion,
  type MigrationReport,
  type ReportEntry,
} from './convert';
import type { Inventory } from './inventory';
import { pluginFilesOf, type PluginsInput } from './plugins';
import { secondCount } from './second-count';
import type { StudioPackage } from './studio-package';
import { resolveThemeProperty } from './theme';

/**
 * `partial`: the part that needs no server found nothing, and the rest did not run. It is not a
 * pass, and it blocks readiness as a check that did not run does.
 */
export type CheckStatus = 'pass' | 'fail' | 'partial' | 'not run';

export interface CheckResult {
  readonly number: number;
  readonly name: string;
  readonly status: CheckStatus;
  /** What failed, one line each. Empty for a pass. */
  readonly findings: readonly string[];
  /** For a check that did not run, whole or in part: what did not, why, and what runs it. */
  readonly reason?: string;
}

/** What one check found, and the part of it that did not run, if any. */
export interface CheckOutcome {
  readonly findings: readonly string[];
  readonly rest?: string;
}

export interface HarnessResult {
  readonly checks: readonly CheckResult[];
  readonly ready: boolean;
  /** Why the migration is not ready, one line each. */
  readonly blockers: readonly string[];
}

export interface HarnessInput {
  readonly pkg: StudioPackage;
  readonly inventory: Inventory;
  readonly catalogue: Catalogue;
  readonly conversion: Conversion;
  /** The deployment's allow-list of operations, which check 10 holds actions to. */
  readonly allowList?: ReadonlySet<string>;
  /**
   * True when no allow-list was given, so `allowList` is the one the conversion's own report
   * recorded. Check 10 then cannot speak for the deployment's, and says so.
   */
  readonly allowListFromReport?: boolean;
  /** The platform version `app.json`'s range must hold; the platform's own when left out. */
  readonly platformVersion?: string;
  /**
   * The plugins of the package's custom elements, for check 9: their files, read from the
   * repository, and, once run, their tests, gates and what they showed (`plugins.ts`).
   */
  readonly plugins?: PluginsInput;
}

/** WCAG 2.1 AA, success criterion 1.4.3: the least contrast for text. */
export const TEXT_CONTRAST = 4.5;

/** Text tokens over the backgrounds they are drawn on in the app, checked when a theme sets both. */
export const CONTRAST_PAIRS: readonly (readonly [string, string])[] = [
  ['--mat-sys-on-primary', '--mat-sys-primary'],
  ['--mat-sys-on-surface', '--mat-sys-surface'],
  ['--mat-sys-on-surface', '--mat-sys-surface-container-lowest'],
  ['--mat-sys-on-surface-variant', '--mat-sys-surface'],
  ['--mat-sys-primary', '--mat-sys-surface'],
  ['--mat-sys-error', '--mat-sys-surface'],
];

const CHECKS: readonly (readonly [
  number,
  string,
  ((input: HarnessInput) => CheckOutcome) | string,
])[] = [
  [1, 'Nothing dropped', (input) => ({ findings: nothingDropped(input) })],
  [2, 'Fields', checkFields],
  [3, 'Model', checkModel],
  [4, 'Labels', (input) => ({ findings: labels(input) })],
  [5, 'Conditions', checkConditions],
  [6, 'What people see', checkSeen],
  [7, 'What the server is asked', checkRequests],
  [8, 'Theme', (input) => ({ findings: theme(input) })],
  [9, 'Plugins', checkPlugins],
  [10, 'Package', checkPackage],
];

export function runHarness(given: HarnessInput): HarnessResult {
  const input = completed(given);
  const checks: CheckResult[] = CHECKS.map((check) => runOne(check, input));

  // An id listed twice is read by its first entry, as the decisions and the report read it.
  const entries = firstEntries(input.conversion.report.constructs ?? []);
  const pending = entries.filter((entry) => entry.outcome === 'pending').length;
  const build = packageBuildOf(input.pkg);
  const { unowned, undecided, findings, verdicts, waiting, unsigned } = holdDecisions(
    input.conversion.report,
    input.conversion.decisions,
    build,
    identitiesOf(given.inventory),
  );
  // A proposal the conversion was made with another decision of than decisions.json gives now:
  // what it wrote, or did not, is not what was decided.
  const otherwise = madeOtherwise(input.conversion.report, verdicts);
  // The report is the converter's, for this package and the decisions it records: one that says
  // otherwise of a construct, a proposal relabelled converted say, was edited or is out of date.
  const differs = reportDiffers(given.conversion, given.pkg, given.inventory, given.catalogue);
  // A reason that names the allow-list is the conversion's, so a decision made on it rests on the
  // list the conversion was made with.
  const recorded = [...(input.conversion.report.allowList ?? [])].sort();
  const deployment = [...(input.allowList ?? [])].sort();
  const otherList =
    !input.allowListFromReport && JSON.stringify(recorded) !== JSON.stringify(deployment);
  const blockers = [
    ...checks
      .filter((check) => check.status === 'fail')
      .map((check) => `check ${check.number} failed`),
    ...checks
      .filter((check) => check.status === 'partial')
      .map((check) => `check ${check.number} ran only in part`),
    ...checks
      .filter((check) => check.status === 'not run')
      .map((check) => `check ${check.number} did not run`),
    ...(pending ? [`${pending} constructs are pending a later phase`] : []),
    ...(differs.length > 0
      ? [
          `report.json says otherwise than the converter of ${differs.length} of the package's constructs, such as ${differs[0].id}, its ${differs[0].key}: convert the package again, as migrate does`,
        ]
      : []),
    ...(waiting
      ? [
          `${waiting} ${waiting === 1 ? 'proposal waits' : 'proposals wait'} for a person to accept or reject ${waiting === 1 ? 'it' : 'them'}`,
        ]
      : []),
    ...(unsigned
      ? [
          `${unsigned} ${unsigned === 1 ? 'proposal is' : 'proposals are'} accepted or rejected with no one's name, or no reason`,
        ]
      : []),
    ...(otherwise.length > 0
      ? [
          `the conversion was made with ${otherwise.length} of its proposals decided otherwise than decisions.json decides them now, such as ${otherwise[0].id}: convert it again with the decisions, as migrate --from does`,
        ]
      : []),
    ...(unowned
      ? [`${unowned} reported ${unowned === 1 ? 'item has' : 'items have'} no owner`]
      : []),
    ...(undecided
      ? [
          `${undecided} reported ${undecided === 1 ? 'item has' : 'items have'} an owner but no decision`,
        ]
      : []),
    // What is wrong with decisions.json: a decision it holds that the harness does not take.
    ...findings,
    ...(otherList
      ? [
          `the conversion was made with the allow-list ${recorded.join(', ') || 'none'}, not the deployment's, ${deployment.join(', ') || 'none'}: convert it again with the deployment's`,
        ]
      : []),
    // Last: a person approves the report once nothing else of the decisions is in the way.
    ...holdApproval(input.conversion, build, pluginFilesOf(input.plugins)).findings,
  ];
  return { checks, ready: blockers.length === 0, blockers };
}

/**
 * Checks as `check` prints them, one line each with what it found: the harness's report format,
 * which lab mode prints its checks in too.
 */
export function checkResultLines(checks: readonly CheckResult[]): string[] {
  const lines: string[] = [];
  for (const check of checks) {
    const head = `${String(check.number).padStart(2)}  ${check.name.padEnd(26)}`;
    if (check.status === 'not run') lines.push(`${head} not run: ${check.reason}`);
    else if (check.status === 'partial') lines.push(`${head} partial: ${check.reason}`);
    else lines.push(`${head} ${check.status === 'pass' ? 'pass' : 'FAIL'}`);
    for (const finding of check.findings) lines.push(`      - ${finding}`);
    if (check.status === 'fail' && check.reason) lines.push(`      Not run: ${check.reason}`);
  }
  return lines;
}

/** The first entry of each id, in the report's order. */
function firstEntries(entries: readonly ReportEntry[]): ReportEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/**
 * One check, as {@link runHarness} runs it, or `undefined` for a number the harness has no check
 * of. Each check reads only its input, so this is the check {@link runHarness} reports: a spec
 * asking what one check finds runs that check, not the ten.
 */
export function runCheck(given: HarnessInput, number: number): CheckResult | undefined {
  const check = CHECKS.find(([candidate]) => candidate === number);
  return check && runOne(check, completed(given));
}

/**
 * The input with what was left out filled in: the report's allow-list, the platform's version;
 * and the inventory with what people decided of the proposals, as the report records the
 * conversion was made with (`recordedVerdicts`), so that each check holds an accepted rule where
 * the converter writes it, and one nobody accepted where it writes nothing. Readiness holds what
 * the report records to `decisions.json`, and the report to the converter (`runHarness`).
 */
function completed(given: HarnessInput): HarnessInput {
  return {
    ...given,
    inventory: withVerdicts(given.inventory, recordedVerdicts(given.conversion.report)),
    allowList: given.allowList ?? new Set(given.conversion.report.allowList ?? []),
    allowListFromReport: given.allowList === undefined,
    platformVersion: given.platformVersion ?? platformVersion(),
  };
}

function runOne([number, name, run]: (typeof CHECKS)[number], input: HarnessInput): CheckResult {
  if (typeof run === 'string')
    return { number, name, status: 'not run', findings: [], reason: run };
  const outcome = run(input);
  const status: CheckStatus =
    outcome.findings.length > 0 ? 'fail' : outcome.rest ? 'partial' : 'pass';
  return {
    number,
    name,
    status,
    findings: outcome.findings,
    ...(outcome.rest ? { reason: outcome.rest } : {}),
  };
}

/**
 * Check 1. The report is of the package given, its name, version and Studio build; every
 * construct of the package is in it once, with an outcome, and with a reason where the outcome
 * needs one; nothing in it is invented; and the two counts of the package agree.
 */
export function nothingDropped({ pkg, inventory, conversion }: HarnessInput): string[] {
  const findings: string[] = [];
  const constructs = constructsOf(inventory);

  // Construct ids are places in files, so a report of another build can hold the same ids for
  // other constructs, and the decisions made on it with them.
  const of = conversion.report.package as Partial<MigrationReport['package']> | undefined;
  const { name, version } = pkg.descriptor;
  if (of?.name !== name || of?.version !== version) {
    findings.push(
      `the report is of ${String(of?.name)} ${String(of?.version)}, not of the package given, ${name} ${version}`,
    );
  }
  const studio = studioBuildOf(pkg);
  const recorded = conversion.report.studio as Partial<MigrationReport['studio']> | undefined;
  if (recorded?.commit !== studio.commit || recorded?.buildTime !== studio.buildTime) {
    const build = (of: Partial<MigrationReport['studio']> | undefined): string =>
      `${of?.commit ? `commit ${of.commit}` : 'no commit'} and ${of?.buildTime ? `build time ${of.buildTime}` : 'no build time'}`;
    findings.push(
      `the report records Studio's ${build(recorded)}, and the package's manifest ${build(studio)}`,
    );
  }

  const first = countsOf(constructs);
  const second = secondCount(pkg, inventory);
  for (const key of [...new Set([...first.keys(), ...second.keys()])].sort()) {
    const parsed = first.get(key) ?? 0;
    const scanned = second.get(key) ?? 0;
    if (parsed !== scanned) {
      const [kind, ...file] = key.split(' ');
      findings.push(
        `the two counts disagree on ${file.join(' ')}: the parser finds ${parsed} ${kind}, the text holds ${scanned}`,
      );
    }
  }

  const entries = Array.isArray(conversion.report.constructs) ? conversion.report.constructs : [];
  const byId = new Map<string, ReportEntry[]>();
  for (const entry of entries) byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry]);
  for (const construct of constructs) {
    const listed = byId.get(construct.id) ?? [];
    if (listed.length === 0)
      findings.push(`dropped: ${construct.label}, in ${construct.file} (${construct.id})`);
    if (listed.length > 1) findings.push(`listed ${listed.length} times: ${construct.id}`);
    const [entry] = listed;
    if (entry && (entry.kind !== construct.kind || entry.file !== construct.file)) {
      findings.push(`${construct.id}: the report places it as ${entry.kind} in ${entry.file}`);
    }
  }
  const known = new Set(constructs.map((construct) => construct.id));
  for (const entry of entries) {
    if (!known.has(entry.id))
      findings.push(`the report lists ${entry.id}, which the package does not hold`);
    if (!(OUTCOMES as readonly string[]).includes(entry.outcome)) {
      findings.push(`${entry.id}: "${entry.outcome}" is not an outcome`);
    }
    if (EXPLAINED.has(entry.outcome) && !entry.note?.trim()) {
      findings.push(`${entry.id}: it is ${entry.outcome} without a reason`);
    }
  }
  const accounted = constructs.filter(
    (construct) => (byId.get(construct.id) ?? []).length > 0,
  ).length;
  if (constructs.length > 0 && accounted < constructs.length) {
    findings.push(`coverage is ${coverage(accounted, constructs.length)}%, not 100%`);
  }
  return findings;
}

/**
 * The share of a package's constructs its report accounts for, as a percentage rounded down to a
 * tenth, so that 99.96% is never shown as 100%. A package of no construct is wholly accounted for.
 */
export function coverage(accounted: number, constructs: number): number {
  return constructs === 0 ? 100 : Math.floor((accounted / constructs) * 1000) / 10;
}

/**
 * Check 4. Every translation of the package is in the conversion's labels file of its language,
 * word for word, and nothing else is. One the report reports, with its reason, is accounted for:
 * the labels file refuses a key it cannot hold, or an empty text.
 */
export function labels({ pkg, inventory, conversion }: HarnessInput): string[] {
  const findings: string[] = [];
  const reported = new Set(
    (conversion.report.constructs ?? [])
      .filter((entry) => entry.outcome === 'reported' && entry.note?.trim())
      .map((entry) => entry.id),
  );
  const expected = new Map<string, Map<string, unknown>>();
  for (const translations of inventory.translations) {
    const texts = readCatalogue(pkg, translations.path);
    const locale = expected.get(translations.locale) ?? new Map<string, unknown>();
    for (const key of translations.keys) {
      if (reported.has(`translation:${translations.path}#${key}`)) continue;
      locale.set(key, Object.hasOwn(texts, key) ? texts[key] : undefined);
    }
    expected.set(translations.locale, locale);
  }
  const converted = labelsOf(conversion);
  for (const [locale, texts] of expected) {
    const file = `app/labels/${locale}.json`;
    const ours = Object.hasOwn(converted, locale) ? converted[locale] : undefined;
    if (!ours) {
      if (texts.size > 0)
        findings.push(`${file} is missing, with all ${texts.size} of its translations`);
      continue;
    }
    for (const [key, text] of texts) {
      if (typeof text !== 'string') continue;
      if (!Object.hasOwn(ours, key)) findings.push(`${file}: ${key} is missing`);
      else if (ours[key] !== text) {
        findings.push(
          `${file}: ${key} reads ${JSON.stringify(ours[key])}, not ${JSON.stringify(text)}`,
        );
      }
    }
    for (const key of Object.keys(ours)) {
      if (!texts.has(key)) findings.push(`${file}: ${key} is not a translation of the package`);
    }
  }
  for (const locale of Object.keys(converted)) {
    if (!expected.has(locale))
      findings.push(`app/labels/${locale}.json: the package has no ${locale} translations`);
  }
  return findings;
}

/**
 * Check 8. Each property with a token in the map sets that token to its own value; nothing sets a
 * token no property gives; text stays readable on the backgrounds the theme sets; and the theme's
 * assets come across unchanged.
 */
export function theme({ pkg, inventory, catalogue, conversion }: HarnessInput): string[] {
  const findings: string[] = [];
  const reported = new Set(
    (conversion.report.constructs ?? [])
      .filter((entry) => entry.outcome === 'reported')
      .map((entry) => entry.id),
  );
  for (const source of inventory.themes) {
    const converted = conversion.themes[source.name];
    const tokens: Readonly<Record<string, string>> = converted?.tokens ?? {};
    const expected = new Map<string, { property: string; value: string }>();
    source.properties.forEach((property, index) => {
      const mapping = mapThemeProperty(catalogue, property.name);
      if (mapping.token === null) return;
      const value = resolveThemeProperty(source.properties, property.name);
      if (value === null) {
        if (!reported.has(`theme-property:${source.path}#${index + 1}`)) {
          findings.push(
            `${source.name}: ${property.name} sets ${mapping.token} to a value that cannot be resolved, and is not reported`,
          );
        }
        return;
      }
      expected.set(mapping.token, { property: property.name, value });
    });
    if (!converted && expected.size > 0) {
      findings.push(
        `themes/${source.name}.json is missing, with the ${expected.size} tokens its properties set`,
      );
      continue;
    }
    for (const [token, { property, value }] of expected) {
      if (!Object.hasOwn(tokens, token))
        findings.push(
          `${source.name}: ${token} is not set, though ${property} sets it to ${value}`,
        );
      else if (tokens[token] !== value) {
        findings.push(
          `${source.name}: ${token} is ${tokens[token]}, but ${property} sets it to ${value}`,
        );
      }
    }
    for (const token of Object.keys(tokens)) {
      if (!expected.has(token))
        findings.push(`${source.name}: ${token} is set, but no property of the theme sets it`);
    }
    for (const [text, background] of CONTRAST_PAIRS) {
      const front = Object.hasOwn(tokens, text) ? parseColour(tokens[text]) : null;
      const back = Object.hasOwn(tokens, background) ? parseColour(tokens[background]) : null;
      if (!front || !back) continue;
      const ratio = contrastRatio(front, back);
      if (ratio < TEXT_CONTRAST) {
        findings.push(
          `${source.name}: ${text} (${tokens[text]}) on ${background} (${tokens[background]}) has a contrast of ${ratio.toFixed(2)}, below the ${TEXT_CONTRAST} WCAG 2.1 AA asks for text`,
        );
      }
    }
    for (const asset of source.assets) {
      const to = `themes/${source.name}/${asset.slice(asset.lastIndexOf('/') + 1)}`;
      if (reported.has(`file:${asset}#file`)) continue;
      const copy = conversion.assets[to];
      // Compared with the package's own bytes, never with anything the conversion says.
      if (!copy) findings.push(`${source.name}: ${to} is missing`);
      else if (!copy.equals(pkg.bundleFiles.get(asset) ?? Buffer.alloc(0))) {
        findings.push(`${source.name}: ${to} differs from ${asset}`);
      }
    }
  }
  return findings;
}
