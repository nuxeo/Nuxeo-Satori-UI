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
import { createHash } from 'node:crypto';
import { isRecord } from '@agentic-ui/shared/app-definition';
import { actionIdOf, appIdOf, labelsPath, placed } from './app-files';
import { fieldOf, layoutFields } from './app-walk';
import { labelsOf, type Conversion, type ConvertedTheme, type ReportEntry } from './convert';
import { slotEntry, type Catalogue } from './catalogue';
import { menuEntryId } from './convert-home';
import { buttonAction } from './convert-slots';
import { holdDecisions, type DecisionsBuild } from './decisions';
import type { Inventory, SlotContribution } from './inventory';
import { elementSource, PLUGIN_FILE } from './plugin';
import type { PluginSource } from './plugins';
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
  readonly caughtBy: 'decisions';
}

/**
 * The conversion's decisions, copied, and the first of them readiness takes that names an owner
 * and what they decided: one whose breakage readiness must then see.
 */
function decided(conversion: Conversion): { file: Json; items: Json[]; item: Json } {
  const file = conversion.decisions === undefined ? undefined : clone(conversion.decisions);
  if (!isRecord(file) || !Array.isArray(file['decisions']))
    throw new MutationError(
      'the conversion has no decisions.json to break: `decisions` writes one, for a person to fill in',
    );
  const items = file['decisions'] as Json[];
  // Held to the build the file itself names: a control breaks a decision, not the file's build.
  const { taken } = holdDecisions(
    conversion.report,
    conversion.decisions,
    file['package'] as DecisionsBuild,
  );
  const item = items.find((candidate) => {
    const decision = isRecord(candidate) ? taken.get(String(candidate['id'])) : undefined;
    return Boolean(decision?.owner.trim() && decision.decision.trim());
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

export function mutation(name: string): Mutation | DecisionMutation | null {
  return (
    MUTATIONS.find((candidate) => candidate.name === name) ??
    DECISION_MUTATIONS.find((candidate) => candidate.name === name) ??
    null
  );
}

/**
 * What a control of check 9 breaks: the conversion, and the plugins of the package's custom
 * elements, each as check 9 reads it (`plugins.ts`). A control changes a copy, never a library on
 * disk: the harness's tests run a broken plugin from a copy of its files.
 */
export interface PluginSubject {
  readonly conversion: Conversion;
  readonly plugins: readonly PluginSource[];
  readonly source: MutationSource;
}

/**
 * The controls of check 9 (docs/business-apps/studio-migration.md, section 7): a plugin that
 * writes data as HTML, drops a value, fails its own tests or bypasses the app's HTTP service; a
 * conversion that puts an element's code into configuration, or leaves an element out of its
 * report; and more. `needsRun` says the check sees it only by running the plugin, its tests or what
 * it shows: the harness's tests run those, and hold the others to the files alone. They are not
 * among `mutate`'s, which breaks a conversion's directory and never a plugin.
 */
export interface PluginMutation {
  readonly name: string;
  readonly description: string;
  readonly caughtBy: 9;
  readonly needsRun: boolean;
  readonly apply: (subject: PluginSubject) => {
    readonly subject: PluginSubject;
    readonly changed: string;
  };
}

/** The first plugin, by its library, with a file `pick` finds, and that file's path and text. */
function pluginFile(
  subject: PluginSubject,
  pick: (path: string, text: string) => boolean,
  what: string,
): { plugin: PluginSource; path: string; text: string } {
  const plugins = [...subject.plugins].sort((a, b) => a.library.localeCompare(b.library));
  for (const plugin of plugins)
    for (const [path, text] of Object.entries(plugin.files).sort(([a], [b]) => a.localeCompare(b)))
      if (pick(path, text)) return { plugin, path, text };
  throw new MutationError(`no plugin of the conversion has ${what}`);
}

/** The subject with one file of one plugin replaced. */
function withPluginFile(
  subject: PluginSubject,
  plugin: PluginSource,
  path: string,
  text: string,
): PluginSubject {
  return {
    ...subject,
    plugins: subject.plugins.map((candidate) =>
      candidate === plugin
        ? { ...candidate, files: { ...candidate.files, [path]: text } }
        : candidate,
    ),
  };
}

const isTemplate = (path: string): boolean => path.startsWith('src/lib/') && path.endsWith('.html');
const isShippedCode = (path: string): boolean =>
  path.startsWith('src/lib/') && path.endsWith('.ts') && !path.endsWith('.spec.ts');
/** A spec of the element's behaviour: not the registration's, which the command writes whole. */
const isBehaviourSpec = (path: string): boolean =>
  path.startsWith('src/lib/') && path.endsWith('.spec.ts') && path !== 'src/lib/extensions.spec.ts';
/** `{{ value() }}` in a template: a value it shows, not one of its texts. */
const VALUE = /\{\{(?!\s*text\()\s*([^}]+?)\s*\}\}/;
/** An element that shows a value and nothing else: `<span class="value">{{ number() }}</span>`. */
const SHOWS_VALUE = /(<([a-z][\w-]*)([^>]*)>)\s*\{\{(?!\s*text\()\s*([^}]+?)\s*\}\}\s*(<\/\2>)/;

export const PLUGIN_MUTATIONS: readonly PluginMutation[] = [
  {
    name: 'plugin-writes-html',
    description: 'Make a plugin write a value it shows as HTML, with [innerHTML]',
    caughtBy: 9,
    needsRun: false,
    apply: (subject) => {
      const { plugin, path, text } = pluginFile(
        subject,
        (file, content) => isTemplate(file) && SHOWS_VALUE.test(content),
        'a template showing a value',
      );
      const match = SHOWS_VALUE.exec(text) as RegExpExecArray;
      return {
        subject: withPluginFile(
          subject,
          plugin,
          path,
          text.replace(SHOWS_VALUE, '<$2$3 [innerHTML]="$4"></$2>'),
        ),
        changed: `wrote ${match[4]} as HTML in ${plugin.library}/${path}`,
      };
    },
  },
  {
    name: 'plugin-drops-value',
    description: 'Take a value the element shows out of its plugin',
    caughtBy: 9,
    needsRun: true,
    apply: (subject) => {
      const { plugin, path, text } = pluginFile(
        subject,
        (file, content) => isTemplate(file) && VALUE.test(content),
        'a template showing a value',
      );
      const match = VALUE.exec(text) as RegExpExecArray;
      return {
        subject: withPluginFile(subject, plugin, path, text.replace(VALUE, '')),
        changed: `took ${match[1]} out of ${plugin.library}/${path}`,
      };
    },
  },
  {
    name: 'plugin-test-fails',
    description: "Make one of a plugin's own tests expect another value",
    caughtBy: 9,
    needsRun: true,
    apply: (subject) => {
      const expected = /\.toBe\((['"])/;
      const { plugin, path, text } = pluginFile(
        subject,
        (file, content) => isBehaviourSpec(file) && expected.test(content),
        'a test of its behaviour',
      );
      return {
        subject: withPluginFile(
          subject,
          plugin,
          path,
          text.replace(expected, '.toBe($1not what it shows: '),
        ),
        changed: `changed what a test of ${plugin.library}/${path} expects`,
      };
    },
  },
  {
    name: 'plugin-todo-left',
    description: "Leave one of a plugin's tests still to write",
    caughtBy: 9,
    needsRun: true,
    apply: (subject) => {
      const close = /\n\}\);\s*$/;
      const { plugin, path, text } = pluginFile(
        subject,
        (file, content) => isBehaviourSpec(file) && close.test(content),
        'a test of its behaviour',
      );
      const broken = text.replace(
        close,
        "\n  it.todo('does what the element does when it is given no record');\n});\n",
      );
      return {
        subject: withPluginFile(subject, plugin, path, broken),
        changed: `left a test of ${plugin.library}/${path} to write`,
      };
    },
  },
  {
    name: 'plugin-bypasses-http',
    description:
      "Make a plugin's request go through an HttpClient of its own, past the app's service",
    caughtBy: 9,
    needsRun: false,
    apply: (subject) => {
      const api = /inject\(\s*NuxeoApiBase\s*\)/;
      const { plugin, path, text } = pluginFile(
        subject,
        (file, content) => isShippedCode(file) && api.test(content),
        "a request through the app's service",
      );
      const broken = `import { HttpClient } from '@angular/common/http';\n${text.replace(api, 'inject(HttpClient)')}`;
      return {
        subject: withPluginFile(subject, plugin, path, broken),
        changed: `made ${plugin.library}/${path} send its request with an HttpClient of its own`,
      };
    },
  },
  {
    name: 'plugin-asks-other-operation',
    description: 'Make a plugin run another operation than its element runs',
    caughtBy: 9,
    needsRun: true,
    apply: (subject) => {
      const operations = subject.source.inventory.customElements.flatMap((element) =>
        element.operations.map((operation) => operation.operation),
      );
      const named = (content: string): string | undefined =>
        operations.find((operation) => content.includes(`'${operation}'`));
      const { plugin, path, text } = pluginFile(
        subject,
        (file, content) => isShippedCode(file) && named(content) !== undefined,
        "an element's operation",
      );
      const operation = named(text) as string;
      return {
        subject: withPluginFile(
          subject,
          plugin,
          path,
          text.replace(`'${operation}'`, `'${operation}.Other'`),
        ),
        changed: `made ${plugin.library}/${path} run ${operation}.Other, not ${operation}`,
      };
    },
  },
  {
    name: 'plugin-runs-eval',
    description: 'Make a plugin run text as code, with eval',
    caughtBy: 9,
    needsRun: false,
    apply: (subject) => {
      const { plugin, path, text } = pluginFile(subject, isShippedCode, 'code of its own');
      const broken = `${text}\nexport function evaluate(text: string): unknown {\n  return eval(text);\n}\n`;
      return {
        subject: withPluginFile(subject, plugin, path, broken),
        changed: `added eval to ${plugin.library}/${path}`,
      };
    },
  },
  {
    name: 'plugin-binds-nuxeo-src',
    description: "Make a plugin bind a document's file to an image's [src]",
    caughtBy: 9,
    needsRun: false,
    apply: (subject) => {
      const { plugin, path, text } = pluginFile(subject, isTemplate, 'a template');
      const broken = `${text}<img [src]="document()?.properties?.['file:content']" alt="" />\n`;
      return {
        subject: withPluginFile(subject, plugin, path, broken),
        changed: `bound a file to [src] in ${plugin.library}/${path}`,
      };
    },
  },
  {
    name: 'plugin-third-party-api',
    description: "Put a type of another package in a plugin's public API",
    caughtBy: 9,
    needsRun: false,
    apply: (subject) => {
      const { plugin, path, text } = pluginFile(
        subject,
        (file) => file === 'src/index.ts',
        'a public API',
      );
      const broken = `${text}export type { Observable as PluginStream } from 'rxjs';\n`;
      return {
        subject: withPluginFile(subject, plugin, path, broken),
        changed: `exported a type of rxjs from ${plugin.library}/${path}`,
      };
    },
  },
  {
    name: 'plugin-from-changed-element',
    description: 'Hold a plugin written from another definition of its element',
    caughtBy: 9,
    needsRun: false,
    apply: (subject) => {
      const { plugin, path, text } = pluginFile(
        subject,
        (file) => file === PLUGIN_FILE,
        `a ${PLUGIN_FILE}`,
      );
      const metadata = JSON.parse(text) as Json;
      metadata['definition'] = createHash('sha256').update('another definition').digest('hex');
      return {
        subject: withPluginFile(subject, plugin, path, `${JSON.stringify(metadata, null, 2)}\n`),
        changed: `made ${plugin.library}/${path} name another definition of ${String(metadata['element'])}`,
      };
    },
  },
  {
    name: 'plugin-registers-more',
    description: 'Make a plugin register a rule of its own beside its component',
    caughtBy: 9,
    needsRun: true,
    apply: (subject) => {
      const components = /\n(\s*)components: \{/;
      const { plugin, path, text } = pluginFile(
        subject,
        (file, content) => file === 'src/lib/extensions.ts' && components.test(content),
        'a registration of its component',
      );
      const broken = text.replace(
        components,
        "\n$1rules: { 'acme.rules.alwaysAllowed': () => true },\n$1components: {",
      );
      return {
        subject: withPluginFile(subject, plugin, path, broken),
        changed: `made ${plugin.library}/${path} register a rule beside its component`,
      };
    },
  },
  {
    name: 'plugin-own-test-config',
    description: "Change how a plugin's tests are run, in its own Vite configuration",
    caughtBy: 9,
    needsRun: false,
    apply: (subject) => {
      const setup = /setupFiles: \[[^\]]*\]/;
      const { plugin, path, text } = pluginFile(
        subject,
        (file, content) => file === 'vite.config.mts' && setup.test(content),
        'a Vite configuration',
      );
      return {
        subject: withPluginFile(
          subject,
          plugin,
          path,
          text.replace(setup, "setupFiles: ['src/test-setup.ts', 'src/fake-server.ts']"),
        ),
        changed: `added a setup file to ${plugin.library}/${path}`,
      };
    },
  },
  {
    name: 'code-in-configuration',
    description: "Put a custom element's code into the conversion's configuration",
    caughtBy: 9,
    needsRun: false,
    apply: (subject) => {
      const { conversion, source } = subject;
      const element = source.inventory.customElements[0];
      if (!element) throw new MutationError('the package has no custom element to copy');
      const path = layouts(conversion).find((candidate) => candidate.endsWith('/view.layout.json'));
      if (path === undefined)
        throw new MutationError('the conversion has no record page to put it on');
      const file = clone(conversion.app[path]) as Json;
      const cards = Array.isArray(file['cards']) ? (file['cards'] as unknown[]) : [];
      // As a template computation, the shape a lazy conversion would give it.
      cards.push({
        id: element.name,
        label: element.name,
        fields: [
          {
            id: `${element.name}-markup`,
            computed: { fn: 'core.template', args: [elementSource(source.pkg, element)] },
          },
        ],
      });
      file['cards'] = cards;
      return {
        subject: { ...subject, conversion: withFile(conversion, path, file) },
        changed: `put the code of ${element.name} into app/${path}`,
      };
    },
  },
  {
    name: 'drop-element-entry',
    description: 'Leave a custom element out of the report',
    caughtBy: 9,
    needsRun: false,
    apply: (subject) => {
      const { conversion } = subject;
      const entry = conversion.report.constructs.find(
        (candidate) => candidate.kind === 'custom-element',
      );
      if (!entry) throw new MutationError('the report lists no custom element to leave out');
      return {
        subject: {
          ...subject,
          conversion: withEntries(
            conversion,
            conversion.report.constructs.filter((candidate) => candidate !== entry),
          ),
        },
        changed: `left ${entry.id} out of the report`,
      };
    },
  },
];
