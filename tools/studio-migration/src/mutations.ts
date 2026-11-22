/**
 * Deliberate breakages of a conversion: the negative controls of
 * docs/business-apps/studio-migration.md, section 7, for the checks phase M0 runs.
 *
 * Each mutation breaks one thing, and names the check that must then fail. The harness's tests
 * apply every one of them, and the `mutate` command applies one to a copy of a conversion, which
 * is the phase 0 demo: a deliberately broken conversion, which the harness refuses, saying why.
 * The controls section 7 lists for checks that do not run yet (fields, rules, operations) arrive
 * with those checks.
 */
import type { Conversion, ConvertedTheme, ReportEntry } from './convert';

export interface Mutation {
  readonly name: string;
  readonly description: string;
  /** The check that must fail once it is applied. */
  readonly caughtBy: 1 | 4 | 8;
  readonly apply: (conversion: Conversion) => {
    readonly conversion: Conversion;
    readonly changed: string;
  };
}

export class MutationError extends Error {
  override readonly name = 'MutationError';
}

const firstLocale = (conversion: Conversion): [string, Readonly<Record<string, string>>] => {
  const locale = Object.keys(conversion.labels)
    .sort()
    .find((name) => Object.keys(conversion.labels[name]).length > 0);
  if (locale === undefined) throw new MutationError('the conversion has no translation to break');
  return [locale, conversion.labels[locale]];
};

const themeWith = (conversion: Conversion, token: string): [string, ConvertedTheme] => {
  const name = Object.keys(conversion.themes)
    .sort()
    .find((theme) => Object.hasOwn(conversion.themes[theme].tokens, token));
  if (name === undefined) throw new MutationError(`no theme of the conversion sets ${token}`);
  return [name, conversion.themes[name]];
};

const withEntries = (conversion: Conversion, constructs: readonly ReportEntry[]): Conversion => ({
  ...conversion,
  report: { ...conversion.report, constructs },
});

export const MUTATIONS: readonly Mutation[] = [
  {
    name: 'drop-translation',
    description: 'Drop one translation from one language',
    caughtBy: 4,
    apply: (conversion) => {
      const [locale, texts] = firstLocale(conversion);
      const [key] = Object.keys(texts);
      const { [key]: _dropped, ...rest } = texts;
      return {
        conversion: { ...conversion, labels: { ...conversion.labels, [locale]: rest } },
        changed: `dropped ${key} from labels/${locale}.json`,
      };
    },
  },
  {
    name: 'change-translation',
    description: 'Change the words of one translation',
    caughtBy: 4,
    apply: (conversion) => {
      const [locale, texts] = firstLocale(conversion);
      const [key] = Object.keys(texts);
      return {
        conversion: {
          ...conversion,
          labels: {
            ...conversion.labels,
            [locale]: { ...texts, [key]: `${texts[key]} (changed)` },
          },
        },
        changed: `changed the text of ${key} in labels/${locale}.json`,
      };
    },
  },
  {
    name: 'wrong-primary-token',
    description: "Map the theme's primary colour to the wrong token",
    caughtBy: 8,
    apply: (conversion) => {
      const [name, theme] = themeWith(conversion, '--mat-sys-primary');
      const { '--mat-sys-primary': primary, ...rest } = theme.tokens;
      return {
        conversion: {
          ...conversion,
          themes: {
            ...conversion.themes,
            [name]: { ...theme, tokens: { ...rest, '--mat-sys-secondary': primary } },
          },
        },
        changed: `moved the primary colour, ${primary}, from --mat-sys-primary to --mat-sys-secondary in themes/${name}.json`,
      };
    },
  },
  {
    name: 'invent-token',
    description: 'Set a token that no property of the theme sets',
    caughtBy: 8,
    apply: (conversion) => {
      const name = Object.keys(conversion.themes).sort()[0];
      if (name === undefined) throw new MutationError('the conversion has no theme to break');
      const theme = conversion.themes[name];
      return {
        conversion: {
          ...conversion,
          themes: {
            ...conversion.themes,
            [name]: { ...theme, tokens: { ...theme.tokens, '--mat-sys-tertiary': '#123456' } },
          },
        },
        changed: `set --mat-sys-tertiary in themes/${name}.json, which no property sets`,
      };
    },
  },
  {
    name: 'drop-asset',
    description: "Leave out one of a theme's files, such as its logo",
    caughtBy: 8,
    apply: (conversion) => {
      const [path] = Object.keys(conversion.assets).sort();
      if (path === undefined) throw new MutationError('the conversion has no theme file to break');
      const { [path]: _dropped, ...rest } = conversion.assets;
      return { conversion: { ...conversion, assets: rest }, changed: `left out ${path}` };
    },
  },
  {
    name: 'change-asset',
    description: "Change one byte of one of a theme's files",
    caughtBy: 8,
    apply: (conversion) => {
      const [path] = Object.keys(conversion.assets).sort();
      if (path === undefined) throw new MutationError('the conversion has no theme file to break');
      const changed = Buffer.from(conversion.assets[path]);
      if (changed.length === 0)
        throw new MutationError(`${path} is empty, so it has no byte to change`);
      changed[0] ^= 0xff;
      return {
        conversion: { ...conversion, assets: { ...conversion.assets, [path]: changed } },
        changed: `changed the first byte of ${path}`,
      };
    },
  },
  {
    name: 'drop-report-entry',
    description: 'Drop a layout from the report without a word',
    caughtBy: 1,
    apply: (conversion) => {
      const entries = conversion.report.constructs;
      const dropped = entries.find((entry) => entry.kind === 'layout') ?? entries[0];
      if (!dropped) throw new MutationError('the report lists nothing to drop');
      return {
        conversion: withEntries(
          conversion,
          entries.filter((entry) => entry !== dropped),
        ),
        changed: `dropped ${dropped.id} from report.json`,
      };
    },
  },
  {
    name: 'invent-report-entry',
    description: 'List a layout the package does not have',
    caughtBy: 1,
    apply: (conversion) => {
      const file = 'web/nuxeo.war/ui/document/invented/nuxeo-invented-view-layout.html';
      const invented: ReportEntry = {
        id: `layout:${file}#layout`,
        kind: 'layout',
        file,
        label: 'an invented layout',
        outcome: 'converted',
        to: 'layouts/invented.json',
      };
      return {
        conversion: withEntries(conversion, [...conversion.report.constructs, invented]),
        changed: `added ${invented.id} to report.json`,
      };
    },
  },
  {
    name: 'unexplained-report',
    description: 'Report something without saying why',
    caughtBy: 1,
    apply: (conversion) => {
      const entries = conversion.report.constructs;
      const target = entries.find((entry) => entry.outcome === 'reported');
      if (!target) throw new MutationError('the report has no reported item to break');
      const { note: _note, ...bare } = target;
      return {
        conversion: withEntries(
          conversion,
          entries.map((entry) => (entry === target ? bare : entry)),
        ),
        changed: `removed the reason from ${target.id} in report.json`,
      };
    },
  },
];

export function mutation(name: string): Mutation | null {
  return MUTATIONS.find((candidate) => candidate.name === name) ?? null;
}
