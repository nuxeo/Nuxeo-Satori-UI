/**
 * The verification harness: the ten checks of docs/business-apps/studio-migration.md, section 6,
 * run over a package and its conversion.
 *
 * Phase M0 runs the three that need no server: 1 (nothing dropped), 4 (labels) and 8 (theme).
 * The other seven say they did not run, and why. None of them passes for not having run. A
 * migration is ready only when all ten pass, nothing is pending, and every reported item has an
 * owner, so an M0 run is never ready, and says what stands in the way.
 */
import { mapThemeProperty, type Catalogue } from './catalogue';
import { contrastRatio, parseColour } from './colour';
import { constructsOf, countsOf } from './constructs';
import { EXPLAINED, OUTCOMES, readCatalogue, type Conversion, type ReportEntry } from './convert';
import type { Inventory } from './inventory';
import { secondCount } from './second-count';
import type { StudioPackage } from './studio-package';
import { resolveThemeProperty } from './theme';

export type CheckStatus = 'pass' | 'fail' | 'not run';

export interface CheckResult {
  readonly number: number;
  readonly name: string;
  readonly status: CheckStatus;
  /** What failed, one line each. Empty for a pass. */
  readonly findings: readonly string[];
  /** For a check that did not run: why, and which phase runs it. */
  readonly reason?: string;
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

const NOT_RUN: Readonly<Record<number, readonly [string, string]>> = {
  2: [
    'Fields',
    'It compares converted layouts, which need layout version 2 (phase 1) and the converter of M1',
  ],
  3: ['Model', 'It reads the migration server, which M1 sets up'],
  5: ['Conditions', 'It runs truth tables in Web UI on the migration server, in M2'],
  6: ['What people see', 'It opens both apps on the migration server, in M1'],
  7: ['What the server is asked', 'It records both apps’ requests on the migration server, in M1'],
  9: ['Plugins', 'It tests the plugins that replace custom elements, in M3'],
  10: [
    'Package',
    "It runs the package pipeline's checks, which come with the app definition schemas",
  ],
};

export function runHarness(input: HarnessInput): HarnessResult {
  const checks: CheckResult[] = [];
  for (let number = 1; number <= 10; number++) {
    if (number === 1) checks.push(result(1, 'Nothing dropped', nothingDropped(input)));
    else if (number === 4) checks.push(result(4, 'Labels', labels(input)));
    else if (number === 8) checks.push(result(8, 'Theme', theme(input)));
    else {
      const [name, reason] = NOT_RUN[number];
      checks.push({ number, name, status: 'not run', findings: [], reason });
    }
  }

  const entries = input.conversion.report.constructs ?? [];
  const pending = entries.filter((entry) => entry.outcome === 'pending').length;
  const unowned = entries.filter((entry) => entry.outcome === 'reported' && !entry.owner).length;
  const proposed = entries.filter((entry) => entry.outcome === 'proposed').length;
  const blockers = [
    ...checks
      .filter((check) => check.status === 'fail')
      .map((check) => `check ${check.number} failed`),
    ...checks
      .filter((check) => check.status === 'not run')
      .map((check) => `check ${check.number} did not run`),
    ...(pending ? [`${pending} constructs are pending a later phase`] : []),
    ...(proposed ? [`${proposed} proposals wait for a person to accept or reject them`] : []),
    ...(unowned ? [`${unowned} reported items have no owner`] : []),
  ];
  return { checks, ready: blockers.length === 0, blockers };
}

function result(number: number, name: string, findings: string[]): CheckResult {
  return { number, name, status: findings.length === 0 ? 'pass' : 'fail', findings };
}

/**
 * Check 1. Every construct of the package is in the report once, with an outcome, and with a
 * reason where the outcome needs one; nothing in the report is invented; and the two counts of
 * the package agree.
 */
export function nothingDropped({ pkg, inventory, conversion }: HarnessInput): string[] {
  const findings: string[] = [];
  const constructs = constructsOf(inventory);

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
    findings.push(
      `coverage is ${Math.floor((accounted / constructs.length) * 1000) / 10}%, not 100%`,
    );
  }
  return findings;
}

/** Check 4. Every translation of the package is in the conversion, in its language, word for word. */
export function labels({ pkg, inventory, conversion }: HarnessInput): string[] {
  const findings: string[] = [];
  const expected = new Map<string, Map<string, unknown>>();
  for (const translations of inventory.translations) {
    const texts = readCatalogue(pkg, translations.path);
    const locale = expected.get(translations.locale) ?? new Map<string, unknown>();
    for (const key of translations.keys)
      locale.set(key, Object.hasOwn(texts, key) ? texts[key] : undefined);
    expected.set(translations.locale, locale);
  }
  for (const [locale, texts] of expected) {
    const converted = conversion.labels[locale];
    if (!converted) {
      findings.push(`labels/${locale}.json is missing, with all ${texts.size} of its translations`);
      continue;
    }
    for (const [key, text] of texts) {
      if (typeof text !== 'string') continue;
      if (!Object.hasOwn(converted, key)) findings.push(`labels/${locale}.json: ${key} is missing`);
      else if (converted[key] !== text) {
        findings.push(
          `labels/${locale}.json: ${key} reads ${JSON.stringify(converted[key])}, not ${JSON.stringify(text)}`,
        );
      }
    }
    for (const key of Object.keys(converted)) {
      if (!texts.has(key))
        findings.push(`labels/${locale}.json: ${key} is not a translation of the package`);
    }
  }
  for (const locale of Object.keys(conversion.labels)) {
    if (!expected.has(locale))
      findings.push(`labels/${locale}.json: the package has no ${locale} translations`);
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
