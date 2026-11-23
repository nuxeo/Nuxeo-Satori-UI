/**
 * Deliberate breakages of a conversion: the negative controls of
 * docs/business-apps/studio-migration.md, section 7, for the checks the harness runs.
 *
 * Each mutation breaks one thing, and names the check that must then fail. The harness's tests
 * apply every one of them, to the made-up test package and to the sample's conversion, and the
 * `mutate` command applies one to a copy of a conversion: a deliberately broken conversion, which
 * the harness refuses, saying why. A mutation that finds nothing of its kind to break, such as a
 * conditional field in a package with no conditions, says so and writes nothing.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import { labelsPath } from './app-files';
import { fieldOf, layoutFields } from './app-walk';
import { labelsOf, type Conversion, type ConvertedTheme, type ReportEntry } from './convert';

export interface Mutation {
  readonly name: string;
  readonly description: string;
  /** The check that must fail once it is applied. */
  readonly caughtBy: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10;
  readonly apply: (conversion: Conversion) => {
    readonly conversion: Conversion;
    readonly changed: string;
  };
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

/**
 * The first `visibleWhen` a converted file carries, in a layout's fields or an action, with a copy
 * of its file and the object holding it in that copy.
 */
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
    if (path.startsWith('layouts/')) {
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

export function mutation(name: string): Mutation | null {
  return MUTATIONS.find((candidate) => candidate.name === name) ?? null;
}
