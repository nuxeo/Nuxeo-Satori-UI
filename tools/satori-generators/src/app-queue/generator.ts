import { formatFiles, type Tree } from '@nx/devkit';

import {
  addLabels,
  appContributionSaid,
  contributeApp,
  humanize,
  ID,
  isRecord,
  listOption,
  pageProvidersOf,
  parseJson,
  readAppPackage,
  schemaFor,
  writeDesignedJson,
  XPATH,
  type AppPackage,
  type PackagePageProvider,
} from '../app-package/package-files';

export interface AppQueueSchema {
  package: string;
  id: string;
  pageProvider: string;
  columns?: string | string[];
  label?: string;
  sort?: string;
  pageSize?: number;
  facets?: string | string[];
  force?: boolean;
}

/** A task form's variables: no queue's record has them. */
const VARIABLE = 'var:';

/** A page provider's name, as a queue writes it. */
const PAGE_PROVIDER = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

/** An aggregate's id, as a queue's facet names it (`queue.schema.json`). */
const AGGREGATE = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

/** A facet `--facets` gives: its aggregate, and the property it groups by, when that is known. */
interface Facet {
  readonly aggregate: string;
  readonly property?: string;
}

/** A facet's name, a label key of the app's: one text for an aggregate, in every queue. */
const facetKey = (pkg: AppPackage, aggregate: string): string => `${pkg.appId}.facet.${aggregate}`;

/**
 * A facet's name in English: the property its aggregate groups by, made readable; else the
 * aggregate's id read as `app-model` writes one, `<prefix>_<name>_agg`, for its `<name>`.
 */
function facetText({ aggregate, property }: Facet): string {
  if (property !== undefined) return humanize(property.slice(property.indexOf(':') + 1));
  const name = aggregate.replace(/_agg$/, '');
  return humanize(name.includes('_') ? name.slice(name.indexOf('_') + 1) : name);
}

/** Why a page provider of the package's own has no aggregate a facet names: what it defines. */
function defined(provider: PackagePageProvider): string {
  if (provider.aggregates.length > 0)
    return `it defines ${provider.aggregates
      .map(({ id, property }) => (property === undefined ? id : `${id} (${property})`))
      .join(', ')}`;
  return provider.repository
    ? 'it reads the repository, which answers none. A facet needs a page provider of the search index that defines the aggregate, as app-model --aggregates writes one'
    : 'it defines none';
}

/**
 * `--facets` as the aggregates the queue's facets name, in the order given. Each is an aggregate's
 * id or a property, `<prefix>:<name>`. On a page provider of the package's own, `provider`, as a
 * demo kit's stand-in model defines one, each is held to its aggregates, and a property is the one
 * aggregate it defines on that property; anything else is refused, naming the aggregates it does
 * define, as the pipeline would refuse the queue. On the server's page provider, which nothing
 * here can read, an id is taken as written, and a property is refused: only the page provider's
 * definition says which aggregate groups by it.
 */
function facetsOf(
  value: string | readonly string[],
  pageProvider: string,
  provider: PackagePageProvider | undefined,
): Facet[] {
  const items = listOption(value);
  if (items.length === 0) {
    throw new Error(
      "--facets names no aggregate: give each by its id or by its property, separated by commas, or leave --facets out to keep the queue's own.",
    );
  }
  const named = `the page provider "${pageProvider}"${provider ? `, defined in ${provider.component},` : ''}`;
  const facets = items.map((item): Facet => {
    if (XPATH.test(item)) {
      if (provider === undefined) {
        throw new Error(
          `--facets: "${item}" is a property, and only a page provider's definition says which of its aggregates groups by it: ${pageProvider} is not one of the package's own page providers, so it is the server's, which nothing here reads. Give the aggregate's id, which describe_page_provider lists.`,
        );
      }
      const on = provider.aggregates.filter(({ property }) => property === item);
      if (on.length === 1) return { aggregate: on[0].id, property: item };
      throw new Error(
        on.length > 1
          ? `--facets: ${named} has ${on.length} aggregates on ${item}, ${on.map(({ id }) => id).join(', ')}: give the one meant by its id.`
          : `--facets: ${named} has no aggregate on ${item}: ${defined(provider)}.`,
      );
    }
    if (!AGGREGATE.test(item)) {
      throw new Error(
        `--facets: "${item}" is neither an aggregate's id nor a property, <prefix>:<name>.`,
      );
    }
    if (provider === undefined) return { aggregate: item };
    const found = provider.aggregates.find(({ id }) => id === item);
    if (found === undefined) {
      throw new Error(`--facets: ${named} has no aggregate "${item}": ${defined(provider)}.`);
    }
    return { aggregate: found.id, property: found.property };
  });
  const twice = facets.find(
    (facet, index) => facets.findIndex(({ aggregate }) => aggregate === facet.aggregate) !== index,
  );
  if (twice !== undefined) throw new Error(`--facets names ${twice.aggregate} twice.`);
  return facets;
}

/**
 * Write a queue, `queues/<id>.json` (docs/business-apps/app-definition-v2.md, section 4): a page
 * provider's records, with columns, a sort, a page size and facets. Its name is a label key, with
 * its English text added to `labels/en.json`.
 *
 * The page provider must exist on the server, and nothing here can see the server: read it first
 * with the Builder MCP server's `describe_page_provider`, which says how many parameters it takes.
 * Given the package, `describe_page_provider` reads a demo kit's own page provider from it, which no
 * server has until the kit is installed.
 * A queue has no open record, so a parameter is a literal, written by hand. The pipeline holds its
 * columns and sort to the type a page provider of the package's own lists, when its NXQL says
 * (package-pipeline.md, section 2); on the server's page provider, a column the listed records do
 * not have is found only when the queue is drawn.
 *
 * **`--facets`** writes the queue's facets, `{ "aggregate", "labelKey" }` each, with each name's
 * English text in `labels/en.json`: aggregates of the page provider, by their ids or by the
 * properties they group by, `claim:status` for `claim_status_agg` as `app-model --aggregates`
 * names them (`facetsOf`). On a page provider of the package's own, which is what the pipeline
 * holds a facet to, its definition is read from the package (`pageProvidersOf`), and an aggregate
 * it does not define is refused. Written again with `--force`, `--facets` replaces the queue's
 * facets, a facet on an aggregate it had keeping its `widget`; without `--facets`, the queue keeps
 * its own.
 *
 * Row and bulk actions and `visibleWhen` are the next edit; `app-action --queue` adds a package
 * action to it.
 */
export default async function appQueueGenerator(tree: Tree, options: AppQueueSchema) {
  const pkg = readAppPackage(tree, options.package);
  if (!ID.test(options.id ?? '')) {
    throw new Error(
      `--id "${options.id}" must be 1 to 64 letters, digits, ".", "_" or "-": it is the queue's file name, which the menu and the home name.`,
    );
  }
  if (!PAGE_PROVIDER.test(options.pageProvider ?? '')) {
    throw new Error(`--pageProvider "${options.pageProvider}" is not a page provider's name.`);
  }
  const columns = listOption(options.columns);
  if (columns.length === 0) columns.push('dc:title', 'dc:modified');
  const badColumn = columns.find((column) => !XPATH.test(column) || column.startsWith(VARIABLE));
  if (badColumn !== undefined) {
    throw new Error(
      `--columns: "${badColumn}" is not a record's property, written <prefix>:<name>${badColumn.startsWith(VARIABLE) ? "; var: names a task form's variable" : ''}.`,
    );
  }
  let sort: { field: string; order: 'asc' | 'desc' } | undefined;
  if (options.sort !== undefined) {
    const match = /^([^:\s]+:[^:\s]+)(?::(asc|desc))?$/.exec(options.sort.trim());
    if (!match || !XPATH.test(match[1]) || match[1].startsWith(VARIABLE)) {
      throw new Error(`--sort "${options.sort}" must be <prefix>:<name>, or <prefix>:<name>:desc.`);
    }
    sort = { field: match[1], order: (match[2] as 'asc' | 'desc' | undefined) ?? 'asc' };
  }
  const pageSize = options.pageSize;
  if (pageSize !== undefined && !(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100)) {
    throw new Error(`--pageSize ${pageSize} must be a whole number from 1 to 100.`);
  }
  const provider = pageProvidersOf(tree, pkg.root).get(options.pageProvider);
  const facets =
    options.facets === undefined
      ? undefined
      : facetsOf(options.facets, options.pageProvider, provider);
  const file = `${pkg.config}/queues/${options.id}.json`;
  const existing = tree.read(file, 'utf-8');
  if (existing !== null && !options.force) {
    throw new Error(`${file} already exists. Pass --force to write it again.`);
  }
  // Written again, the queue keeps what this generator does not write: its parameters, row and
  // bulk actions and visibleWhen, which were written by hand or by app-action, and its sort, page
  // size and facets when they are not given again.
  const previous = existing === null ? {} : parseJson(existing, file);
  if (!isRecord(previous)) throw new Error(`${file} is not a queue to write again.`);

  const labelKey = `${pkg.appId}.queue.${options.id}`;
  // Given, the facets replace the queue's own; a facet on an aggregate it had keeps its widget,
  // which this generator does not write.
  const had = Array.isArray(previous['facets']) ? previous['facets'].filter(isRecord) : [];
  const written = facets?.map(({ aggregate }) => {
    const widget = had.find((facet) => facet['aggregate'] === aggregate)?.['widget'];
    return {
      aggregate,
      labelKey: facetKey(pkg, aggregate),
      ...(typeof widget === 'string' ? { widget } : {}),
    };
  });
  writeDesignedJson(tree, file, {
    $schema: schemaFor(file, 'queue.schema.json'),
    ...previous,
    version: 2,
    labelKey,
    pageProvider: options.pageProvider,
    columns,
    ...(sort ? { sort: [sort] } : {}),
    ...(pageSize !== undefined ? { pageSize } : {}),
    ...(written ? { facets: written } : {}),
  });
  const keptLabels = addLabels(tree, pkg, {
    [labelKey]: options.label?.trim() || humanize(options.id),
    ...Object.fromEntries(
      (facets ?? []).map((facet) => [facetKey(pkg, facet.aggregate), facetText(facet)]),
    ),
  });
  // The queue is a file the app registry serves: named, when the component contributes the app.
  const app = contributeApp(tree, pkg, { create: false });

  await formatFiles(tree);

  const aggregates = (facets ?? []).map(({ aggregate }) => aggregate).join(', ');
  const facetsSaid =
    facets === undefined
      ? ''
      : provider !== undefined
        ? `  Facets:         ${aggregates}, each an aggregate ${provider.component} defines\n`
        : `  Facets:         ${aggregates}, not checked: ${options.pageProvider} is not a page provider of\n` +
          "                  the package's own, and nothing here reads the server's\n";
  const checkFacets =
    facets !== undefined && provider === undefined ? `, and that it defines ${aggregates}` : '';
  return () => {
    console.log(`
Wrote ${file}

  Page provider:  ${options.pageProvider}
  Columns:        ${columns.join(', ')}
${facetsSaid}${keptLabels.length > 0 ? `  Kept the text labels/en.json already had for ${keptLabels.join(', ')}\n` : ''}${appContributionSaid(pkg, app)}
Check that ${options.pageProvider} exists, and how many parameters it takes${checkFacets}, with the Builder MCP
server's describe_page_provider, { "name": "${options.pageProvider}", "package": "${pkg.root}" }:
for a demo kit whose stand-in model defines it, the package answers, else the server. Then:

  npm run app-package -- ${pkg.root} --platform <platform version>
`);
  };
}
