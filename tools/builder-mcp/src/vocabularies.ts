/**
 * Vocabularies: the directories a `vocabulary` widget lists values from.
 *
 * Only vocabularies' entries are read. A directory is one when its schema is a vocabulary
 * schema: Nuxeo's `vocabulary`, `xvocabulary` (with a parent) and `l10nxvocabulary` (with labels
 * per language), or a schema whose name ends in `vocabulary`, as projects name their own. Other
 * directories hold other things, such as people or groups, and an app builder needs only their
 * names, so their entries are refused.
 */
import { segment, type NuxeoReads } from './nuxeo.ts';
import { entries, isRecord, notFound, record, text } from './shapes.ts';

export const MAX_PAGE_SIZE = 1000;

export interface Directory {
  readonly name: string;
  readonly schema: string | null;
  readonly idField: string | null;
  readonly parent: string | null;
  readonly readOnly: boolean | null;
  readonly vocabulary: boolean;
}

export function isVocabularySchema(schema: string | null): boolean {
  return schema !== null && /vocabulary$/i.test(schema);
}

export async function readDirectories(nuxeo: NuxeoReads): Promise<Directory[]> {
  return entries(await nuxeo.get('/directory'), '/directory')
    .filter(isRecord)
    .map((entry): Directory => {
      const schema = text(entry['schema']);
      return {
        name: text(entry['name']) ?? '',
        schema,
        idField: text(entry['idField']),
        parent: text(entry['parent']),
        readOnly: typeof entry['readOnly'] === 'boolean' ? entry['readOnly'] : null,
        vocabulary: isVocabularySchema(schema),
      };
    })
    .filter((directory) => directory.name !== '')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export async function listVocabularies(nuxeo: NuxeoReads, all: boolean) {
  const directories = await readDirectories(nuxeo);
  const shown = all ? directories : directories.filter((directory) => directory.vocabulary);
  return {
    vocabularies: shown,
    ...(all
      ? {}
      : {
          otherDirectories: directories.length - shown.length,
          note: 'Directories that are not vocabularies are left out; pass all: true to list their names.',
        }),
  };
}

export async function readVocabulary(
  nuxeo: NuxeoReads,
  name: string,
  page: { readonly pageSize: number; readonly pageIndex: number },
) {
  const directories = await readDirectories(nuxeo);
  const directory = directories.find((candidate) => candidate.name === name);
  if (!directory)
    throw notFound(
      'vocabulary',
      name,
      directories.filter((candidate) => candidate.vocabulary).map((candidate) => candidate.name),
    );
  if (!directory.vocabulary)
    throw new Error(
      `"${name}" is a directory with the schema ${directory.schema ?? '(none)'}, not a vocabulary,` +
        ' so its entries are not read here.',
    );
  const answer = record(
    await nuxeo.get(`/directory/${segment(name)}`, {
      query: { pageSize: page.pageSize, currentPageIndex: page.pageIndex },
    }),
    `/directory/${name}`,
  );
  const values = entries(answer, `/directory/${name}`)
    .filter(isRecord)
    .map((entry) => (isRecord(entry['properties']) ? entry['properties'] : {}));
  return {
    vocabulary: directory,
    entries: values,
    page: {
      index: page.pageIndex,
      size: page.pageSize,
      // `-2` means "more than were counted" (AGENTS/11-beta-program.md, section 3), not a total.
      resultsCount: typeof answer['resultsCount'] === 'number' ? answer['resultsCount'] : null,
      hasMore: answer['isNextPageAvailable'] === true,
    },
  };
}
