/**
 * Deliberate breakages of a conversion: the negative controls of
 * docs/business-apps/studio-migration.md, section 7, for the checks the harness runs.
 *
 * Each mutation breaks one thing, and names the check that must then fail. The harness's tests
 * apply every one of them, to the made-up test package and to the sample's conversion, and the
 * `mutate` command applies one to a copy of a conversion: a deliberately broken conversion, which
 * the harness refuses, saying why. A mutation that finds nothing of its kind to break, such as a
 * conditional field in a package with no conditions, says so and writes nothing.
 *
 * The controls of the report's decisions (`DECISION_MUTATIONS`) break the conversion's
 * `decisions.json` against its report instead, in one way each: a decision's owner or what was
 * decided taken off, the report changed under a decision, or an entry added that must not be
 * taken. No check fails then: readiness, which holds that file to the report, must name what broke
 * among what stands in the way.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import { actionIdOf, appIdOf, labelsPath, placed } from './app-files';
import { fieldOf, layoutFields } from './app-walk';
import { digestsOf } from './approval';
import {
  convert,
  labelsOf,
  recordedAllowList,
  recordedVerdicts,
  type Conversion,
  type ConvertedTheme,
  type ReportEntry,
  type Verdict,
} from './convert';
import { slotEntry, type Catalogue } from './catalogue';
import { menuEntryId } from './convert-home';
import { buttonAction } from './convert-slots';
import { holdDecisions, type DecisionsBuild } from './decisions';
import type { Inventory, SlotContribution } from './inventory';
import { slotRegistry } from './slot-registry';
import type { StudioPackage } from './studio-package';

export interface Mutation {
  readonly name: string;
  readonly description: string;
  /** The check that must fail once it is applied. */
  readonly caughtBy: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10;
  /**
   * Breaks the conversion. A control that writes what the package's own Web UI leaves out, such as
   * a disabled button, reads that from the package too, and refuses without it.
   */
  readonly apply: (
    conversion: Conversion,
    source?: MutationSource,
  ) => {
    readonly conversion: Conversion;
    readonly changed: string;
  };
}

/** The package a conversion was made from, for the controls that read it. */
export interface MutationSource {
  readonly pkg: StudioPackage;
  readonly inventory: Inventory;
  readonly catalogue: Catalogue;
}

export class MutationError extends Error {
  override readonly name = 'MutationError';
}

type Json = Record<string, unknown>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The conversion with one file of its app definition replaced. */
const withFile = (conversion: Conversion, path: string, content: unknown): Conversion => ({
  ...conversion,
  app: { ...conversion.app, [path]: content },
});

const firstLocale = (conversion: Conversion): [string, Readonly<Record<string, string>>] => {
  const labels = labelsOf(conversion);
  const locale = Object.keys(labels)
    .sort()
    .find((name) => Object.keys(labels[name]).length > 0);
  if (locale === undefined) throw new MutationError('the conversion has no translation to break');
  return [locale, labels[locale]];
};

const withLabels = (
  conversion: Conversion,
  locale: string,
  labels: Readonly<Record<string, string>>,
): Conversion => withFile(conversion, labelsPath(locale), { version: 2, labels });

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

/** The layout files, in path order. */
const layouts = (conversion: Conversion): string[] =>
  Object.keys(conversion.app)
    .filter((path) => path.startsWith('layouts/'))
    .sort();

/**
 * The first field entry, in path order, that `pick` accepts, with a copy of its file in which to
 * change it: `entry` is the copy's own entry, so changing it changes the copy.
 */
function findField(
  conversion: Conversion,
  pick: (entry: unknown, path: string) => boolean,
  paths: readonly string[] = layouts(conversion),
): { path: string; file: Json; holder: unknown[]; index: number } | null {
  for (const path of paths) {
    const file = clone(conversion.app[path]) as Json;
    for (const shown of layoutFields(file)) {
      if (!pick(shown.entry, path)) continue;
      const parts = shown.at.split('.');
      const index = Number(parts.pop());
      let holder: unknown = file;
      for (const part of parts)
        holder = Array.isArray(holder) ? holder[Number(part)] : (holder as Json)[part];
      return { path, file, holder: holder as unknown[], index };
    }
  }
  return null;
}

/**
 * The properties the report says were converted into a file: a control that breaks one of them
 * breaks something the conversion claims, never a field it reports and the check excuses.
 */
const convertedInto = (conversion: Conversion, path: string): Set<string> =>
  new Set(
    conversion.report.constructs
      .filter(
        (entry) =>
          entry.kind === 'layout-field' && entry.outcome === 'converted' && entry.to === path,
      )
      .flatMap((entry) => (entry.property ? [entry.property] : [])),
  );

/**
 * Prefixes of the platform's own schemas, which check 3 cannot hold to the package without a
 * server. A guess: on a conversion whose first converted field outside them is still the
 * platform's, check 3 stays partial rather than failing, and the tests would show it.
 */
const PLATFORM_PREFIXES = ['dc', 'common', 'uid', 'file', 'files', 'note', 'picture', 'thumbnail'];

/** A rule the conversion carries: the file, the object holding it and where it sits. */
export interface RuleHolder {
  readonly path: string;
  readonly file: Json;
  readonly holder: Json;
  readonly at: string;
}

/**
 * Every rule the conversion carries, each in its own copy of its file: on a layout field, an
 * action, a home card, a menu entry or a queue.
 */
export function ruleHolders(conversion: Conversion): RuleHolder[] {
  const found: RuleHolder[] = [];
  const listed = (path: string, key: string) => {
    const entries = (conversion.app[path] as Json | undefined)?.[key];
    if (!Array.isArray(entries)) return;
    entries.forEach((entry, index) => {
      if (!isRecord(entry) || !('visibleWhen' in entry)) return;
      const file = clone(conversion.app[path]) as Json;
      found.push({
        path,
        file,
        holder: (file[key] as Json[])[index],
        at: `${key}.${index}.visibleWhen`,
      });
    });
  };
  for (const path of Object.keys(conversion.app).sort()) {
    if (path.startsWith('layouts/') || path.startsWith('tasks/')) {
      // A tab's rule and a card's: `tabs.1.visibleWhen`, `cards.2.visibleWhen`.
      const content = conversion.app[path];
      const holders: string[] = [];
      const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
      const cardsAt = (cards: unknown, at: string): void =>
        listOf(cards).forEach((card, index) => {
          if (isRecord(card) && 'visibleWhen' in card) holders.push(`${at}cards.${index}`);
        });
      if (isRecord(content)) {
        cardsAt(content['cards'], '');
        listOf(content['tabs']).forEach((tab, index) => {
          if (!isRecord(tab)) return;
          if ('visibleWhen' in tab) holders.push(`tabs.${index}`);
          cardsAt(tab['cards'], `tabs.${index}.`);
        });
      }
      for (const at of holders) {
        const file = clone(content) as Json;
        const holder = at
          .split('.')
          .reduce<unknown>(
            (value, key) =>
              isRecord(value) || Array.isArray(value) ? (value as Json)[key] : undefined,
            file,
          );
        if (isRecord(holder)) found.push({ path, file, holder, at: `${at}.visibleWhen` });
      }
      for (const shown of layoutFields(conversion.app[path] as Json)) {
        if (!isRecord(shown.entry) || !('visibleWhen' in shown.entry)) continue;
        const file = clone(conversion.app[path]) as Json;
        // The same entry in the copy, by its place: `cards.0.fields.3`, `tabs.1.cards.0.fields.2`.
        const entry = shown.at
          .split('.')
          .reduce<unknown>(
            (at, key) => (isRecord(at) || Array.isArray(at) ? (at as Json)[key] : undefined),
            file,
          );
        if (isRecord(entry))
          found.push({ path, file, holder: entry, at: `${shown.at}.visibleWhen` });
      }
    }
    if (path === 'actions.json') listed(path, 'actions');
    if (path === 'home.json') listed(path, 'cards');
    if (path === 'navigation.json') listed(path, 'entries');
    if (path.startsWith('queues/') && isRecord(conversion.app[path])) {
      const file = clone(conversion.app[path]) as Json;
      if ('visibleWhen' in file) found.push({ path, file, holder: file, at: 'visibleWhen' });
    }
  }
  return found;
}

const findRule = (conversion: Conversion): RuleHolder | null => ruleHolders(conversion)[0] ?? null;

/** The entry as an object, so that a key can be set on it. */
const asObject = (entry: unknown): Json =>
  typeof entry === 'string' ? { field: entry } : (entry as Json);

const M1_MUTATIONS: readonly Mutation[] = [
  {
    name: 'drop-translation',
    description: 'Drop one translation from one language',
    caughtBy: 4,
    apply: (conversion) => {
      const [locale, texts] = firstLocale(conversion);
      const [key] = Object.keys(texts);
      const { [key]: _dropped, ...rest } = texts;
      return {
        conversion: withLabels(conversion, locale, rest),
        changed: `dropped ${key} from app/labels/${locale}.json`,
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
        conversion: withLabels(conversion, locale, { ...texts, [key]: `${texts[key]} (changed)` }),
        changed: `changed the text of ${key} in app/labels/${locale}.json`,
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
        to: 'layouts/Invented/view.layout.json',
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
  {
    name: 'other-version',
    description: 'Make the report one of another version of the package',
    caughtBy: 1,
    apply: (conversion) => {
      const { report } = conversion;
      const version = `${report.package.version}.1`;
      return {
        conversion: {
          ...conversion,
          report: { ...report, package: { ...report.package, version } },
        },
        changed: `made the report one of ${report.package.name} ${version}`,
      };
    },
  },
  {
    name: 'drop-field',
    description: 'Drop a field from a converted layout',
    caughtBy: 2,
    apply: (conversion) => {
      const found = findField(conversion, (entry, path) =>
        convertedInto(conversion, path).has(fieldOf(entry) ?? ''),
      );
      if (!found) throw new MutationError('no converted layout has a field to drop');
      const [dropped] = found.holder.splice(found.index, 1);
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `dropped ${fieldOf(dropped)} from app/${found.path}`,
      };
    },
  },
  {
    name: 'date-to-text',
    description: 'Turn a date widget into text, in a layout or a list',
    caughtBy: 2,
    apply: (conversion) => {
      const isDate = (entry: unknown): boolean =>
        isRecord(entry) && (entry['widget'] === 'date' || entry['widget'] === 'relative-date');
      const found = findField(conversion, isDate);
      if (found) {
        (found.holder[found.index] as Json)['widget'] = 'text';
        return {
          conversion: withFile(conversion, found.path, found.file),
          changed: `made ${fieldOf(found.holder[found.index])} a text widget in app/${found.path}`,
        };
      }
      for (const path of Object.keys(conversion.app).sort()) {
        const file = clone(conversion.app[path]);
        const columns = isRecord(file) && Array.isArray(file['columns']) ? file['columns'] : [];
        const column = columns.find(isDate) as Json | undefined;
        if (!column) continue;
        column['widget'] = 'text';
        return {
          conversion: withFile(conversion, path, file),
          changed: `made the column ${fieldOf(column)} a text widget in app/${path}`,
        };
      }
      throw new MutationError('nothing in the conversion shows a date widget');
    },
  },
  {
    name: 'drop-required',
    description: 'Make a required field of a form optional',
    caughtBy: 2,
    apply: (conversion) => {
      const found = findField(conversion, (entry) => isRecord(entry) && entry['required'] === true);
      if (!found) throw new MutationError('no converted form has a required field');
      const entry = found.holder[found.index] as Json;
      delete entry['required'];
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `made ${fieldOf(entry)} optional in app/${found.path}`,
      };
    },
  },
  {
    name: 'rename-field',
    description: "Name a field the package's own schema does not have",
    caughtBy: 3,
    apply: (conversion) => {
      // Dublin Core is the platform's: a field of the package's own schema is what can be held
      // to the package without a server.
      const found = findField(conversion, (entry, path) => {
        const field = fieldOf(entry);
        return (
          field !== null &&
          field.includes(':') &&
          !PLATFORM_PREFIXES.includes(field.slice(0, field.indexOf(':'))) &&
          convertedInto(conversion, path).has(field)
        );
      });
      if (!found)
        throw new MutationError("no converted layout shows a field of the package's own schemas");
      const entry = asObject(found.holder[found.index]);
      const before = entry['field'] as string;
      entry['field'] = `${before}Renamed`;
      found.holder[found.index] = entry;
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `renamed ${before} to ${entry['field']} in app/${found.path}`,
      };
    },
  },
  {
    name: 'slip-free-javascript',
    description: 'Slip a free JavaScript condition into the converted configuration',
    caughtBy: 5,
    apply: (conversion) => {
      const found = findField(conversion, () => true);
      if (!found) throw new MutationError('no converted layout has a field to put a condition on');
      const entry = asObject(found.holder[found.index]);
      entry['visibleWhen'] = "user.isMember('administrators')";
      found.holder[found.index] = entry;
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `made ${entry['field']} in app/${found.path} visible when "user.isMember('administrators')"`,
      };
    },
  },
  {
    name: 'widen-to-everyone',
    description: 'Show a field Web UI shows only under a condition to every user',
    caughtBy: 5,
    apply: (conversion) => {
      const entries = conversion.report.constructs;
      const field = entries.find(
        (entry) =>
          entry.kind === 'layout-field' &&
          entry.outcome === 'pending' &&
          entry.property &&
          /condition/.test(entry.note ?? ''),
      );
      const layout = field && entries.find((entry) => entry.id === `layout:${field.file}#layout`);
      const path = layout?.to?.startsWith('layouts/') ? layout.to : undefined;
      if (!field?.property || !path || !conversion.app[path])
        throw new MutationError('the package has no field shown under a condition');
      const file = clone(conversion.app[path]) as Json;
      const holder = Array.isArray(file['sections']) ? file['sections'] : file['cards'];
      const first = (Array.isArray(holder) ? holder[0] : undefined) as Json | undefined;
      if (!first || !Array.isArray(first['fields']))
        throw new MutationError(`app/${path} has no section or card to add a field to`);
      first['fields'].push(field.property);
      return {
        conversion: withFile(conversion, path, file),
        changed: `added ${field.property}, which Web UI shows only under a condition, to app/${path} for everyone`,
      };
    },
  },
  {
    name: 'invert-rule',
    description: 'Invert the rule a converted condition became',
    caughtBy: 5,
    apply: (conversion) => {
      const found = findRule(conversion);
      if (!found) throw new MutationError('the conversion carries no rule to invert');
      found.holder['visibleWhen'] = { type: 'core.not', parameters: [found.holder['visibleWhen']] };
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `inverted the rule at ${found.at} in app/${found.path}`,
      };
    },
  },
  {
    name: 'drop-rule',
    description: 'Drop the rule of something Web UI shows only under a condition',
    caughtBy: 5,
    apply: (conversion) => {
      const found = findRule(conversion);
      if (!found) throw new MutationError('the conversion carries no rule to drop');
      delete found.holder['visibleWhen'];
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `dropped the rule at ${found.at} in app/${found.path}, showing it to everyone`,
      };
    },
  },
  {
    name: 'widen-column-to-everyone',
    description: 'Show a list column Web UI shows only under a condition to every user',
    caughtBy: 5,
    apply: (conversion) => {
      const entries = conversion.report.constructs;
      const column = entries.find(
        (entry) =>
          entry.kind === 'search-column' &&
          entry.outcome !== 'converted' &&
          entry.property &&
          /condition/.test(entry.note ?? ''),
      );
      const list = column && entries.find((entry) => entry.id === `search:${column.file}#search`);
      const path = list?.to?.startsWith('queues/') ? list.to : undefined;
      if (!column?.property || !path || !conversion.app[path])
        throw new MutationError('the package has no list column shown under a condition');
      const queue = clone(conversion.app[path]) as Json;
      queue['columns'] = [
        ...(Array.isArray(queue['columns']) ? queue['columns'] : []),
        column.property,
      ];
      return {
        conversion: withFile(conversion, path, queue),
        changed: `added the column ${column.property}, which Web UI shows only under a condition, to app/${path} for everyone`,
      };
    },
  },
  {
    name: 'wrong-home-queue',
    description: 'Point a card of the home at another queue',
    caughtBy: 7,
    apply: (conversion) => {
      const home = conversion.app['home.json'];
      const cards = isRecord(home) && Array.isArray(home['cards']) ? home['cards'] : [];
      const queues = Object.keys(conversion.app)
        .filter((path) => path.startsWith('queues/'))
        .map((path) => path.slice('queues/'.length, -'.json'.length));
      const card = cards.find((item) => isRecord(item) && typeof item['queue'] === 'string') as
        Json | undefined;
      const other = queues.find((id) => id !== card?.['queue']);
      if (!card || other === undefined)
        throw new MutationError(
          'the conversion has no home card, or no other queue to point it at',
        );
      const file = clone(home) as Json;
      const target = (file['cards'] as Json[]).find((item) => item['id'] === card['id']) as Json;
      target['queue'] = other;
      return {
        conversion: withFile(conversion, 'home.json', file),
        changed: `pointed ${String(card['id'])} in app/home.json at ${other}, not ${String(card['queue'])}`,
      };
    },
  },
  {
    name: 'drop-menu-entry',
    description: 'Drop an entry of the menu',
    caughtBy: 7,
    apply: (conversion) => {
      const menu = conversion.app['navigation.json'];
      const entries = isRecord(menu) && Array.isArray(menu['entries']) ? menu['entries'] : [];
      if (entries.length === 0) throw new MutationError('the conversion has no menu entry to drop');
      const [dropped, ...rest] = entries as Json[];
      return {
        conversion: withFile(conversion, 'navigation.json', { ...(menu as Json), entries: rest }),
        changed: `dropped ${String(dropped['id'])} from app/navigation.json`,
      };
    },
  },
  {
    name: 'change-label',
    description: 'Change the label of a converted field',
    caughtBy: 6,
    apply: (conversion) => {
      const found = findField(
        conversion,
        (entry) => isRecord(entry) && typeof entry['label'] === 'string',
      );
      if (!found) throw new MutationError('no converted field has a label');
      const entry = found.holder[found.index] as Json;
      entry['label'] = `${entry['label'] as string} (changed)`;
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `changed the label of ${fieldOf(entry)} in app/${found.path}`,
      };
    },
  },
  {
    name: 'wrong-page-provider',
    description: 'Point a list at a different page provider',
    caughtBy: 7,
    apply: (conversion) => {
      const path = Object.keys(conversion.app)
        .sort()
        .find((candidate) => candidate.startsWith('queues/'));
      if (!path) throw new MutationError('the conversion has no list');
      const queue = clone(conversion.app[path]) as Json;
      const before = queue['pageProvider'];
      queue['pageProvider'] = `${String(before)}_other`;
      return {
        conversion: withFile(conversion, path, queue),
        changed: `pointed app/${path} at ${queue['pageProvider']}, not ${String(before)}`,
      };
    },
  },
  {
    name: 'change-parameter',
    description: 'Change one parameter of a list or an action',
    caughtBy: 7,
    apply: (conversion) => {
      for (const path of Object.keys(conversion.app).sort()) {
        const file = clone(conversion.app[path]) as Json;
        if (
          path.startsWith('queues/') &&
          Array.isArray(file['parameters']) &&
          file['parameters'].length > 0
        ) {
          file['parameters'][0] = `${String(file['parameters'][0])}changed`;
          return {
            conversion: withFile(conversion, path, file),
            changed: `changed the first parameter of app/${path} to ${String(file['parameters'][0])}`,
          };
        }
        const actions =
          path === 'actions.json' && Array.isArray(file['actions']) ? file['actions'] : [];
        const action = actions.find(
          (candidate) =>
            isRecord(candidate) &&
            isRecord(candidate['parameters']) &&
            Object.keys(candidate['parameters']).length > 0,
        ) as Json | undefined;
        if (action) {
          const parameters = action['parameters'] as Json;
          const [name] = Object.keys(parameters);
          parameters[name] = `${String(parameters[name])}changed`;
          return {
            conversion: withFile(conversion, path, file),
            changed: `changed the parameter ${name} of ${String(action['id'])} in app/${path}`,
          };
        }
      }
      throw new MutationError('no list or action of the conversion has a parameter');
    },
  },
  {
    name: 'bind-other-operation',
    description: 'Bind a button to a different operation',
    caughtBy: 7,
    apply: (conversion) => {
      const written = conversion.app['actions.json'];
      const file = written === undefined ? undefined : (clone(written) as Json);
      const action = (Array.isArray(file?.['actions']) ? (file['actions'] as Json[]) : []).find(
        (candidate) => typeof candidate['operation'] === 'string',
      );
      if (!file || !action)
        throw new MutationError('the conversion has no action bound to an operation');
      const before = action['operation'] as string;
      // Another operation than the one it runs, or the control would change nothing.
      const other = before === 'Document.Delete' ? 'Document.Trash' : 'Document.Delete';
      action['operation'] = other;
      return {
        conversion: withFile(conversion, 'actions.json', file),
        changed: `bound ${String(action['id'])} to ${other}, not ${before}, in app/actions.json`,
      };
    },
  },
  {
    name: 'unregistered-widget',
    description: 'Name a widget the platform does not have',
    caughtBy: 10,
    apply: (conversion) => {
      const found = findField(conversion, (entry, path) => {
        const file = conversion.app[path];
        return isRecord(file) && file['version'] === 2 && fieldOf(entry) !== null;
      });
      if (!found) throw new MutationError('no converted layout of version 2 has a field');
      const entry = asObject(found.holder[found.index]);
      entry['widget'] = 'signature';
      found.holder[found.index] = entry;
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `gave ${entry['field']} the widget "signature" in app/${found.path}, which is not registered`,
      };
    },
  },
];

/** The task forms, in path order. */
const taskForms = (conversion: Conversion): string[] =>
  Object.keys(conversion.app)
    .filter((path) => path.startsWith('tasks/'))
    .sort();

/** The first tab of a view file other than its record page's own, `view`, in a copy of its file. */
function findTab(
  conversion: Conversion,
  pick: (tab: Json) => boolean = () => true,
): { path: string; file: Json; tabs: Json[]; index: number } | null {
  for (const path of layouts(conversion)) {
    const file = clone(conversion.app[path]) as Json;
    const tabs = Array.isArray(file['tabs']) ? (file['tabs'] as Json[]) : [];
    const index = tabs.findIndex((tab) => isRecord(tab) && tab['id'] !== 'view' && pick(tab));
    if (index !== -1) return { path, file, tabs, index };
  }
  return null;
}

/** M2's controls: task forms, tabs and layout blocks (studio-migration.md, section 7). */
const M2_MUTATIONS: readonly Mutation[] = [
  {
    name: 'drop-task-field',
    description: 'Drop a field from a converted task form',
    caughtBy: 2,
    apply: (conversion) => {
      const found = findField(
        conversion,
        (entry) => fieldOf(entry) !== null,
        taskForms(conversion),
      );
      if (!found) throw new MutationError('no converted task form has a field to drop');
      const [dropped] = found.holder.splice(found.index, 1);
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `dropped ${fieldOf(dropped)} from app/${found.path}`,
      };
    },
  },
  {
    name: 'rename-task-variable',
    description: "Name a variable the task's step and workflow do not have",
    caughtBy: 3,
    apply: (conversion) => {
      const found = findField(
        conversion,
        (entry) => fieldOf(entry)?.startsWith('var:') === true,
        taskForms(conversion),
      );
      if (!found) throw new MutationError('no converted task form has a variable to rename');
      const entry = asObject(found.holder[found.index]);
      const before = entry['field'] as string;
      entry['field'] = `${before}Renamed`;
      found.holder[found.index] = entry;
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `renamed ${before} to ${entry['field']} in app/${found.path}`,
      };
    },
  },
  {
    name: 'var-in-layout',
    description: "Put a task's variable into a document's layout, where var: means nothing",
    caughtBy: 10,
    apply: (conversion) => {
      const found = findField(conversion, (entry, path) => {
        const file = conversion.app[path];
        return isRecord(file) && file['version'] === 2 && fieldOf(entry) !== null;
      });
      if (!found) throw new MutationError('no converted layout of version 2 has a field');
      const entry = asObject(found.holder[found.index]);
      const before = entry['field'] as string;
      entry['field'] = `var:${before.slice(before.indexOf(':') + 1)}`;
      found.holder[found.index] = entry;
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `made ${before} the task variable ${entry['field']} in app/${found.path}`,
      };
    },
  },
  {
    name: 'drop-block-card',
    description: "Drop a layout block's card from a converted layout",
    caughtBy: 2,
    apply: (conversion) => {
      const blocks = new Set(
        conversion.report.constructs
          .filter((entry) => entry.kind === 'block-use' && entry.outcome === 'converted')
          .map((entry) => entry.to ?? ''),
      );
      // A card holding a field the report says it converted there, which check 2 then misses.
      const converted = (path: string): Set<string> =>
        new Set(
          conversion.report.constructs
            .filter(
              (entry) =>
                entry.kind === 'block-field' &&
                entry.outcome === 'converted' &&
                (entry.to ?? '').split(', ').includes(path),
            )
            .flatMap((entry) => (entry.property ? [entry.property] : [])),
        );
      for (const path of layouts(conversion)) {
        const file = clone(conversion.app[path]) as Json;
        const holders: { at: string; cards: Json[] }[] = [];
        if (Array.isArray(file['cards']))
          holders.push({ at: 'cards', cards: file['cards'] as Json[] });
        if (Array.isArray(file['sections']))
          holders.push({ at: 'sections', cards: file['sections'] as Json[] });
        (Array.isArray(file['tabs']) ? (file['tabs'] as Json[]) : []).forEach((tab) => {
          if (isRecord(tab) && Array.isArray(tab['cards']))
            holders.push({ at: `tabs.${String(tab['id'])}.cards`, cards: tab['cards'] as Json[] });
        });
        for (const { at, cards } of holders) {
          const index = cards.findIndex(
            (card) =>
              isRecord(card) &&
              blocks.has(`${path} ${at}.${String(card['id'])}`) &&
              Array.isArray(card['fields']) &&
              card['fields'].some((field) => converted(path).has(fieldOf(field) ?? '')),
          );
          if (index === -1) continue;
          const [dropped] = cards.splice(index, 1);
          return {
            conversion: withFile(conversion, path, file),
            changed: `dropped the card ${String(dropped['id'])}, a layout block's, from app/${path}`,
          };
        }
      }
      throw new MutationError("no converted layout has a layout block's card to drop");
    },
  },
  {
    name: 'drop-tab',
    description: 'Drop a tab from a converted view layout',
    caughtBy: 2,
    apply: (conversion) => {
      const found = findTab(conversion);
      if (!found) throw new MutationError('no converted view layout has a tab of the package');
      const [dropped] = found.tabs.splice(found.index, 1);
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `dropped the tab ${String(dropped['id'])} from app/${found.path}`,
      };
    },
  },
  {
    name: 'drop-tab-rule',
    description: 'Show a tab Web UI shows only under a condition to every user',
    caughtBy: 5,
    apply: (conversion) => {
      const found = findTab(conversion, (tab) => 'visibleWhen' in tab);
      if (!found) throw new MutationError('no converted tab carries a rule');
      const tab = found.tabs[found.index];
      delete tab['visibleWhen'];
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `dropped the rule of the tab ${String(tab['id'])} in app/${found.path}, showing it to everyone`,
      };
    },
  },
  {
    name: 'change-tab-label',
    description: 'Change the label of a converted tab',
    caughtBy: 6,
    apply: (conversion) => {
      // A tab whose label the package's own catalogue settles: a literal one may rest on Web UI's.
      const found = findTab(conversion, (tab) => typeof tab['labelKey'] === 'string');
      if (!found) throw new MutationError('no converted tab has a translated label');
      const tab = found.tabs[found.index];
      const before = tab['labelKey'];
      delete tab['labelKey'];
      tab['label'] = 'Something else';
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `labelled the tab ${String(tab['id'])} "Something else", not ${String(before)}, in app/${found.path}`,
      };
    },
  },
  {
    name: 'make-display-editable',
    description: 'Make a field Web UI only shows editable in a converted task form',
    caughtBy: 2,
    apply: (conversion) => {
      const found = findField(
        conversion,
        (entry) => isRecord(entry) && entry['readOnlyWhen'] === 'core.true',
        taskForms(conversion),
      );
      if (!found) throw new MutationError('no converted task form has a read-only field');
      const entry = found.holder[found.index] as Json;
      delete entry['readOnlyWhen'];
      return {
        conversion: withFile(conversion, found.path, found.file),
        changed: `made ${fieldOf(entry)} editable in app/${found.path}`,
      };
    },
  },
  {
    name: 'drop-block-use-entry',
    description: 'Drop a use of a layout block from the report without a word',
    caughtBy: 1,
    apply: (conversion) => {
      const entries = conversion.report.constructs;
      const index = entries.findIndex((entry) => entry.kind === 'block-use');
      if (index === -1) throw new MutationError('the report lists no use of a layout block');
      return {
        conversion: withEntries(conversion, [
          ...entries.slice(0, index),
          ...entries.slice(index + 1),
        ]),
        changed: `dropped ${entries[index].id} from report.json`,
      };
    },
  },
];

/** The source a control reads, or a refusal saying how to give it. */
function needSource(source: MutationSource | undefined): MutationSource {
  if (!source)
    throw new MutationError(
      'it reads the package the conversion was made from: give it with --package <package.zip>',
    );
  return source;
}

/**
 * The buttons Web UI's slots leave out for the reason `why` matches, each with the action the
 * converter would have made of it: its id, operation and parameters.
 */
function leftOutButtons(
  source: MutationSource,
  why: RegExp,
): {
  readonly contribution: SlotContribution;
  readonly id: string;
  readonly operation: string;
  readonly parameters: Record<string, unknown> | null;
}[] {
  const registry = slotRegistry(source.inventory);
  const appId = appIdOf(source.pkg);
  return placed(source.inventory.slotContributions).flatMap(({ contribution, overall }) => {
    const decision = registry.dropped.get(contribution);
    const entry = slotEntry(source.catalogue, contribution.slot);
    if (!decision || !why.test(decision.note ?? '') || !entry) return [];
    if (entry.slot !== 'toolbar' && entry.slot !== 'bulk-actions') return [];
    const action = buttonAction(contribution, entry.slot);
    if ('problem' in action) return [];
    return [
      {
        contribution,
        id: actionIdOf(appId, contribution.name, overall),
        operation: action.operation,
        parameters: action.parameters,
      },
    ];
  });
}

/** The actions of a copy of the conversion's `actions.json`, which is made when there is none. */
function actionsOf(conversion: Conversion): { file: Json; actions: Json[] } {
  const file = (clone(conversion.app['actions.json'] ?? { version: 2, actions: [] }) as Json) ?? {};
  if (!Array.isArray(file['actions'])) file['actions'] = [];
  return { file, actions: file['actions'] as Json[] };
}

/**
 * Gives the action a contribution of the same name owns the operation and parameters of the one
 * Web UI left out for `why`: what a converter that kept the wrong one would write.
 */
function keepLeftOut(
  conversion: Conversion,
  source: MutationSource | undefined,
  why: RegExp,
  kind: string,
) {
  const { file, actions } = actionsOf(conversion);
  for (const button of leftOutButtons(needSource(source), why)) {
    const action = actions.find(
      (candidate) => isRecord(candidate) && candidate['id'] === button.id,
    );
    if (!action) continue;
    if (
      action['operation'] === button.operation &&
      JSON.stringify(action['parameters'] ?? {}) === JSON.stringify(button.parameters ?? {})
    )
      continue;
    action['operation'] = button.operation;
    if (button.parameters) action['parameters'] = button.parameters;
    else delete action['parameters'];
    return {
      conversion: withFile(conversion, 'actions.json', file),
      changed: `made ${button.id} run what the ${kind} "${button.contribution.name}" runs, ${button.operation} with ${JSON.stringify(button.parameters ?? {})}`,
    };
  }
  throw new MutationError(`the package has no ${kind} button that differs from the one kept`);
}

/** Controls of Web UI's slot registration (`slot-registry.ts`), for actions and the menu. */
const SLOT_MUTATIONS: readonly Mutation[] = [
  {
    name: 'revive-disabled-action',
    description: 'Make an action of a button Web UI shows nothing of, being disabled',
    caughtBy: 7,
    apply: (conversion, source) => {
      const { file, actions } = actionsOf(conversion);
      const button = leftOutButtons(needSource(source), /is disabled/).find(
        (candidate) => !actions.some((action) => isRecord(action) && action['id'] === candidate.id),
      );
      if (!button)
        throw new MutationError('the package has no disabled button to make an action of');
      actions.push({
        id: button.id,
        label: button.contribution.name || button.id,
        operation: button.operation,
        ...(button.parameters ? { parameters: button.parameters } : {}),
      });
      return {
        conversion: withFile(conversion, 'actions.json', file),
        changed: `made the action ${button.id} of the disabled button "${button.contribution.name}"`,
      };
    },
  },
  {
    name: 'keep-replaced-action',
    description: 'Keep a button a later one of the same name replaces, rather than the later one',
    caughtBy: 7,
    apply: (conversion, source) => keepLeftOut(conversion, source, /replaces it/, 'replaced'),
  },
  {
    name: 'keep-outranked-action',
    description: 'Keep a button a higher priority one of the same name outranks',
    caughtBy: 7,
    apply: (conversion, source) =>
      keepLeftOut(conversion, source, /has a higher priority/, 'outranked'),
  },
  {
    name: 'revive-disabled-menu-entry',
    description: 'Make an entry of the menu of one Web UI shows nothing of, being disabled',
    caughtBy: 7,
    apply: (conversion, source) => {
      const { inventory } = needSource(source);
      const registry = slotRegistry(inventory);
      const item = inventory.slotContributions.find(
        (contribution) =>
          contribution.slot === 'DRAWER_ITEMS' &&
          /is disabled/.test(registry.dropped.get(contribution)?.note ?? ''),
      );
      const queue = Object.keys(conversion.app)
        .sort()
        .map((path) => /^queues\/([^/]+)\.json$/.exec(path)?.[1])
        .find((id): id is string => id !== undefined);
      if (!item || !queue)
        throw new MutationError(
          'the package has no disabled menu entry, or the conversion no queue',
        );
      const file = clone(conversion.app['navigation.json'] ?? { version: 2, entries: [] }) as Json;
      if (!Array.isArray(file['entries'])) file['entries'] = [];
      const id = menuEntryId(item);
      (file['entries'] as Json[]).push({ id, queue });
      return {
        conversion: withFile(conversion, 'navigation.json', file),
        changed: `made the menu entry ${id} of the disabled "${item.name}", opening queues/${queue}.json`,
      };
    },
  },
  {
    name: 'change-action-order',
    description: "Move an action from the place Web UI's slot gives it",
    caughtBy: 6,
    apply: (conversion) => {
      const { file, actions } = actionsOf(conversion);
      const action = actions.find(
        (candidate) => isRecord(candidate) && typeof candidate['order'] === 'number',
      );
      if (!action) throw new MutationError('no converted action has an order to change');
      action['order'] = (action['order'] as number) + 1000;
      return {
        conversion: withFile(conversion, 'actions.json', file),
        changed: `moved ${String(action['id'])} to order ${String(action['order'])}`,
      };
    },
  },
];

/** Every control of the checks, M1's and M2's. */
export const MUTATIONS: readonly Mutation[] = [...M1_MUTATIONS, ...M2_MUTATIONS, ...SLOT_MUTATIONS];

/**
 * A control of the decisions: readiness, which holds the conversion's `decisions.json` to its
 * report, must then name what broke among what stands in the way. Each works from a decision the
 * file holds and readiness takes, so the conversion it is given needs one, filled in.
 */
export interface DecisionMutation extends Omit<Mutation, 'caughtBy'> {
  /** `decisions`: readiness names it among the decisions; `approval`: the approval is void. */
  readonly caughtBy: 'decisions' | 'approval';
}

/** The identities a decisions file names, by its items' ids: the file's own word for them. */
function identitiesIn(file: Json): Map<string, string> {
  const items = Array.isArray(file['decisions']) ? (file['decisions'] as unknown[]) : [];
  return new Map(
    items.flatMap((item) =>
      isRecord(item) && typeof item['id'] === 'string' && typeof item['identity'] === 'string'
        ? [[item['id'], item['identity']] as const]
        : [],
    ),
  );
}

/**
 * The conversion's decisions, copied, and the first of them readiness takes for a reported item
 * that names an owner and what they decided: one whose breakage readiness must then see.
 */
function decided(conversion: Conversion): { file: Json; items: Json[]; item: Json } {
  const file = conversion.decisions === undefined ? undefined : clone(conversion.decisions);
  if (!isRecord(file) || !Array.isArray(file['decisions']))
    throw new MutationError(
      'the conversion has no decisions.json to break: `decisions` writes one, for a person to fill in',
    );
  const items = file['decisions'] as Json[];
  // Held to the build the file itself names, and the identities it names: a control breaks a
  // decision, not the file's build.
  const { taken } = holdDecisions(
    conversion.report,
    conversion.decisions,
    file['package'] as DecisionsBuild,
    identitiesIn(file),
  );
  const item = items.find((candidate) => {
    const decision = isRecord(candidate) ? taken.get(String(candidate['id'])) : undefined;
    return Boolean(
      decision?.outcome === 'reported' && decision.owner.trim() && decision.decision.trim(),
    );
  });
  if (!item)
    throw new MutationError('no decision of decisions.json names an owner and what they decided');
  return { file, items, item };
}

const withDecisions = (conversion: Conversion, decisions: Json): Conversion => ({
  ...conversion,
  decisions,
});

export const DECISION_MUTATIONS: readonly DecisionMutation[] = [
  {
    name: 'drop-owner',
    description: 'Take the owner off the decision of a reported item',
    caughtBy: 'decisions',
    apply: (conversion) => {
      const { file, item } = decided(conversion);
      item['owner'] = '';
      return {
        conversion: withDecisions(conversion, file),
        changed: `took the owner off ${String(item['id'])}`,
      };
    },
  },
  {
    name: 'drop-decision',
    description: 'Leave the owner of a reported item with nothing decided',
    caughtBy: 'decisions',
    apply: (conversion) => {
      const { file, item } = decided(conversion);
      item['decision'] = '';
      return {
        conversion: withDecisions(conversion, file),
        changed: `emptied the decision on ${String(item['id'])}`,
      };
    },
  },
  {
    name: 'stale-decision',
    description:
      'Change the reason the report gives for a decided item, as a conversion made again would, with its decisions copied beside it',
    caughtBy: 'decisions',
    apply: (conversion) => {
      const { item } = decided(conversion);
      const id = String(item['id']);
      const constructs = conversion.report.constructs.map((entry) =>
        entry.id === id ? { ...entry, note: `${entry.note ?? ''} (changed)` } : entry,
      );
      return {
        conversion: withEntries(conversion, constructs),
        changed: `changed the reason the report gives for ${id}, which decisions.json decided`,
      };
    },
  },
  {
    name: 'decide-unlisted',
    description: 'Decide an item the report does not list',
    caughtBy: 'decisions',
    apply: (conversion) => {
      const { file, items, item } = decided(conversion);
      const id = `${String(item['id'])}-unlisted`;
      items.push({ ...item, id });
      return {
        conversion: withDecisions(conversion, file),
        changed: `decided ${id}, which the report does not list`,
      };
    },
  },
  {
    name: 'decide-converted',
    description: 'Decide an item the report gives as converted',
    caughtBy: 'decisions',
    apply: (conversion) => {
      const { file, items, item } = decided(conversion);
      const entry = conversion.report.constructs.find(
        (candidate) => candidate.outcome === 'converted',
      );
      if (!entry) throw new MutationError('the report converts nothing to decide');
      const { id, kind: _kind, file: _file, ...pinned } = entry;
      items.push({ id, ...pinned, owner: item['owner'], decision: item['decision'] });
      return {
        conversion: withDecisions(conversion, file),
        changed: `decided ${id}, which the report gives as converted`,
      };
    },
  },
  {
    name: 'decide-twice',
    description: 'Decide one reported item twice',
    caughtBy: 'decisions',
    apply: (conversion) => {
      const { file, items, item } = decided(conversion);
      items.push({ ...item, owner: `${String(item['owner'])} (another)` });
      return {
        conversion: withDecisions(conversion, file),
        changed: `decided ${String(item['id'])} a second time, with another owner`,
      };
    },
  },
];

/**
 * The proposals of a conversion, by id, with what the conversion's `decisions.json` decides of
 * each: the conditions' rules, which the converter writes once accepted.
 */
function proposalsOf(
  conversion: Conversion,
  source: MutationSource,
): { readonly id: string; readonly verdict: Verdict | undefined }[] {
  // As the checks hold the conversion: to what its report records it was made with.
  const verdicts = recordedVerdicts(conversion.report);
  return conversion.report.constructs
    .filter(
      (entry) =>
        entry.kind === 'condition' &&
        entry.outcome === 'proposed' &&
        entry.proposal === true &&
        entry.rule !== undefined,
    )
    .map((entry) => ({ id: entry.id, verdict: verdicts.get(entry.id) }));
}

/**
 * The conversion with its app written as the converter writes it when `verdicts` are what people
 * decided, its report and its decisions left as they are: what a converter that wrote other
 * decisions than the file's would leave. Refused when that writes nothing other.
 */
function writtenWith(
  conversion: Conversion,
  source: MutationSource,
  verdicts: ReadonlyMap<string, Verdict>,
  what: string,
): Conversion {
  const app = convert(source.pkg, source.inventory, source.catalogue, {
    allowList: recordedAllowList(conversion),
    verdicts,
  }).app;
  if (JSON.stringify(app) === JSON.stringify(conversion.app))
    throw new MutationError(`${what} writes nothing in this conversion that it does not hold`);
  return { ...conversion, app };
}

/** What the conversion's decisions accept and reject, by id, as the converter is given them. */
function verdictsOf(proposals: ReturnType<typeof proposalsOf>): Map<string, Verdict> {
  return new Map(proposals.flatMap(({ id, verdict }) => (verdict ? [[id, verdict] as const] : [])));
}

const accepted = (owner: string): Verdict => ({
  accepted: true,
  owner,
  reason: 'as a converter that writes it unaccepted would',
});

/**
 * The controls of the proposals: what is written must be what a person accepted, and nothing
 * else. Each writes the app as the converter would with other decisions than the conversion's
 * `decisions.json` holds, and check 5, which holds the app to the package and that file, must fail.
 * They read the package, as `--package` gives it.
 */
export const PROPOSAL_MUTATIONS: readonly Mutation[] = [
  {
    name: 'write-undecided-proposal',
    description: 'Write a proposal no one has accepted or rejected, as if it were accepted',
    caughtBy: 5,
    apply: (conversion, given) => {
      const source = needSource(given);
      const proposals = proposalsOf(conversion, source);
      const waiting = proposals.filter((proposal) => proposal.verdict === undefined);
      if (waiting.length === 0)
        throw new MutationError('no proposal of the conversion waits for a person to decide it');
      const verdicts = verdictsOf(proposals);
      const rule = conversion.report.constructs.find((entry) => entry.id === waiting[0].id)?.rule;
      verdicts.set(waiting[0].id, { ...accepted('no one'), rule });
      return {
        conversion: writtenWith(conversion, source, verdicts, `accepting ${waiting[0].id}`),
        changed: `wrote what ${waiting[0].id} proposes, which no one has decided, as if it were accepted`,
      };
    },
  },
  {
    name: 'write-rejected-proposal',
    description: 'Write a proposal a person rejected, as if it were accepted',
    caughtBy: 5,
    apply: (conversion, given) => {
      const source = needSource(given);
      const proposals = proposalsOf(conversion, source);
      const rejected = proposals.find((proposal) => proposal.verdict?.accepted === false);
      if (!rejected?.verdict)
        throw new MutationError('no proposal of the conversion is rejected, as its report records');
      const verdicts = verdictsOf(proposals);
      verdicts.set(rejected.id, { ...rejected.verdict, accepted: true });
      return {
        conversion: writtenWith(conversion, source, verdicts, `accepting ${rejected.id}`),
        changed: `wrote what ${rejected.id} proposes, which a person rejected, as if it were accepted`,
      };
    },
  },
  {
    name: 'drop-accepted-proposal',
    description:
      'Leave out what a person accepted, as a conversion made without the decision would',
    caughtBy: 5,
    apply: (conversion, given) => {
      const source = needSource(given);
      const proposals = proposalsOf(conversion, source);
      const accepted = proposals.filter((proposal) => proposal.verdict?.accepted === true);
      if (accepted.length === 0)
        throw new MutationError('no proposal of the conversion is accepted, as its report records');
      // One whose rule a field shows under, a layout's or a task form's, which check 5 holds to be
      // there; an action or a menu entry left out is check 7's.
      for (const accept of accepted) {
        const verdicts = verdictsOf(proposals);
        verdicts.delete(accept.id);
        const without = writtenWith(conversion, source, verdicts, `leaving ${accept.id} undecided`);
        const forms = Object.keys(conversion.app).filter(
          (path) => path.startsWith('layouts/') || path.startsWith('tasks/'),
        );
        if (
          forms.some(
            (path) => JSON.stringify(without.app[path]) !== JSON.stringify(conversion.app[path]),
          )
        )
          return {
            conversion: without,
            changed: `left out what ${accept.id} proposes, which a person accepted, where a field shows under its rule`,
          };
      }
      throw new MutationError(
        'no accepted proposal of the conversion has its rule on a field: check 7 holds an action or a menu entry an accepted rule is written on',
      );
    },
  },
];

/** The conversion's approval, copied, or a refusal saying how to make one. */
function approvalIn(conversion: Conversion): Json {
  if (!isRecord(conversion.approval))
    throw new MutationError(
      'the conversion holds no approval.json to break: a person writes one, with the approve command',
    );
  return clone(conversion.approval);
}

/** The controls of the approval: readiness must say it is void. */
export const APPROVAL_MUTATIONS: readonly DecisionMutation[] = [
  {
    name: 'approve-other-report',
    description: 'Make the approval one of another report than the conversion holds',
    caughtBy: 'approval',
    apply: (conversion) => {
      const approval = approvalIn(conversion);
      const other = {
        ...conversion,
        report: { ...conversion.report, constructs: conversion.report.constructs.slice(1) },
      };
      approval['report'] = digestsOf(other).report;
      return {
        conversion: { ...conversion, approval },
        changed: "made approval.json approve another report, one entry short of the conversion's",
      };
    },
  },
  {
    name: 'change-after-approval',
    description:
      'Change what a reported item was decided after the report was approved, as an edit of decisions.json would',
    caughtBy: 'approval',
    apply: (conversion) => {
      approvalIn(conversion);
      const { file, item } = decided(conversion);
      item['decision'] = `${String(item['decision'])} (changed after the approval)`;
      return {
        conversion: withDecisions(conversion, file),
        changed: `changed the decision on ${String(item['id'])} after the report was approved`,
      };
    },
  },
];

/**
 * The controls of carrying decisions to a new build of the package: a decision must be held to
 * the construct it was made on, and to what it was made on. Readiness must name what broke.
 */
export const CARRY_MUTATIONS: readonly DecisionMutation[] = [
  {
    name: 'carry-to-other-construct',
    description:
      "Carry a decision to another construct of the report, with that one's reason, as a carry by place would",
    caughtBy: 'decisions',
    apply: (conversion) => {
      const { file, items, item } = decided(conversion);
      const index = items.findIndex(
        (candidate) =>
          isRecord(candidate) &&
          candidate !== item &&
          candidate['outcome'] === 'reported' &&
          candidate['identity'] !== item['identity'],
      );
      if (index === -1)
        throw new MutationError('decisions.json decides no other reported item to carry it to');
      const other = items[index];
      items[index] = {
        ...other,
        identity: item['identity'],
        owner: item['owner'],
        decision: item['decision'],
      };
      return {
        conversion: withDecisions(conversion, file),
        changed: `carried the decision on ${String(item['id'])} to ${String(other['id'])}, another construct`,
      };
    },
  },
  {
    name: 'carry-changed-silently',
    description:
      'Carry the decision of a construct that changed in the new build, as it was made, rather than offer it for re-confirmation',
    caughtBy: 'decisions',
    apply: (conversion) => {
      const file = conversion.decisions === undefined ? undefined : clone(conversion.decisions);
      const items =
        isRecord(file) && Array.isArray(file['decisions']) ? (file['decisions'] as Json[]) : [];
      const index = items.findIndex(
        (candidate) => isRecord(candidate) && isRecord(candidate['earlier']),
      );
      if (!isRecord(file) || index === -1)
        throw new MutationError(
          'no decision of decisions.json is offered for re-confirmation: carry decisions from another build of the package, one of whose decided constructs changed, first',
        );
      const {
        earlier,
        owner: _owner,
        decision: _decision,
        reason: _reason,
        ...entry
      } = items[index];
      const before = earlier as Json;
      items[index] = {
        id: entry['id'],
        identity: entry['identity'],
        ...(before['madeOn'] as Json),
        owner: before['owner'],
        decision: before['decision'],
        ...(typeof before['reason'] === 'string' ? { reason: before['reason'] } : {}),
      };
      return {
        conversion: withDecisions(conversion, file),
        changed: `carried the earlier decision on ${String(entry['id'])}, whose construct changed, as it was made`,
      };
    },
  },
];

export function mutation(name: string): Mutation | DecisionMutation | null {
  return (
    [...MUTATIONS, ...PROPOSAL_MUTATIONS].find((candidate) => candidate.name === name) ??
    [...DECISION_MUTATIONS, ...CARRY_MUTATIONS, ...APPROVAL_MUTATIONS].find(
      (candidate) => candidate.name === name,
    ) ??
    null
  );
}
