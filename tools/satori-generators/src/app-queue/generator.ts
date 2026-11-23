import { formatFiles, type Tree } from '@nx/devkit';

import {
  addLabels,
  humanize,
  ID,
  listOption,
  readAppPackage,
  schemaFor,
  writeJson,
  XPATH,
} from '../app-package/package-files';

export interface AppQueueSchema {
  package: string;
  id: string;
  pageProvider: string;
  columns?: string | string[];
  label?: string;
  sort?: string;
  pageSize?: number;
  force?: boolean;
}

/** A page provider's name, as a queue writes it. */
const PAGE_PROVIDER = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

/**
 * Write a queue, `queues/<id>.json` (docs/business-apps/app-definition-v2.md, section 4): a page
 * provider's records, with columns, a sort and a page size. Its name is a label key, with its
 * English text added to `labels/en.json`.
 *
 * The page provider must exist on the server, and nothing here can see the server: read it first
 * with the Builder MCP server's `describe_page_provider`, which says how many parameters it takes.
 * A queue has no open record, so a parameter is a literal, written by hand. Neither the pipeline
 * nor the content model checks its columns yet (package-pipeline.md, section 7), so a column the
 * listed records do not have is found only when the queue is drawn.
 *
 * Row and bulk actions, facets and `visibleWhen` are the next edit; `app-action --queue` adds a
 * package action to it.
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
  const badColumn = columns.find((column) => !XPATH.test(column));
  if (badColumn !== undefined) {
    throw new Error(`--columns: "${badColumn}" is not a property, written <prefix>:<name>.`);
  }
  let sort: { field: string; order: 'asc' | 'desc' } | undefined;
  if (options.sort !== undefined) {
    const match = /^([^:\s]+:[^:\s]+)(?::(asc|desc))?$/.exec(options.sort.trim());
    if (!match || !XPATH.test(match[1])) {
      throw new Error(`--sort "${options.sort}" must be <prefix>:<name>, or <prefix>:<name>:desc.`);
    }
    sort = { field: match[1], order: (match[2] as 'asc' | 'desc' | undefined) ?? 'asc' };
  }
  const pageSize = options.pageSize;
  if (pageSize !== undefined && !(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100)) {
    throw new Error(`--pageSize ${pageSize} must be a whole number from 1 to 100.`);
  }
  const file = `${pkg.config}/queues/${options.id}.json`;
  if (tree.exists(file) && !options.force) {
    throw new Error(`${file} already exists. Pass --force to write it again.`);
  }

  const labelKey = `${pkg.appId}.queue.${options.id}`;
  writeJson(tree, file, {
    $schema: schemaFor(file, 'queue.schema.json'),
    version: 2,
    labelKey,
    pageProvider: options.pageProvider,
    columns,
    ...(sort ? { sort: [sort] } : {}),
    ...(pageSize !== undefined ? { pageSize } : {}),
  });
  const kept = addLabels(tree, pkg, { [labelKey]: options.label?.trim() || humanize(options.id) });

  await formatFiles(tree);

  return () => {
    console.log(`
Wrote ${file}

  Page provider:  ${options.pageProvider}
  Columns:        ${columns.join(', ')}
${kept.length > 0 ? `  Kept the text labels/en.json already had for ${kept.join(', ')}\n` : ''}
Check that ${options.pageProvider} exists, and how many parameters it takes, with the Builder MCP
server's describe_page_provider. Then:

  npm run app-package -- ${pkg.root} --platform <platform version>
`);
  };
}
