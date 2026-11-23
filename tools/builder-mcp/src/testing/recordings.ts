/**
 * Recorded Nuxeo answers, and a reader that replays them, so the tools' tests run against what a
 * real server said without one.
 *
 * `record.ts` writes them: it runs the tools' own reads against a live server through
 * {@link RecordingReads}, then trims the large answers to what the tests read. A read the
 * recordings do not hold fails the test that made it, naming the read, rather than answering
 * something made up.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NuxeoError, type NuxeoReads, type ReadOptions } from '../nuxeo.ts';

export const RECORDED = fileURLToPath(new URL('./recorded/', import.meta.url));
export const RECORDED_ORIGIN = 'http://localhost:8080';

/**
 * The only names the recordings keep, every one of them stock Nuxeo: the recorder trims every
 * list the server answers to these, and a test holds the recordings to it. What a kept name holds
 * is kept as the server answered it: a server that overrides `default_search` or adds to `country`
 * puts that in, so record from a stock server and read the diff (README, "Running and testing it").
 */
export const KEPT = {
  types: [
    'Document',
    'Folder',
    'File',
    'Note',
    'Workspace',
    'Domain',
    'DocumentRoute',
    'RouteNode',
  ],
  operations: [
    'Document.Create',
    'Document.Update',
    'Document.FetchByProperty',
    'Repository.Query',
  ],
  /** The stock facets and schemas of those types: a type keeps only these, so a schema a server
   *  adds to File, say, is not kept. A workflow's variables facets are kept besides, when a kept
   *  workflow's own documents name them. */
  facets: [
    'Commentable',
    'DocumentRoute',
    'Downloadable',
    'Folderish',
    'ForceAudit',
    'HasRelatedText',
    'HiddenInNavigation',
    'NXTag',
    'NotCollectionMember',
    'NotFulltextIndexable',
    'Orderable',
    'Publishable',
    'SuperSpace',
    'SystemDocument',
    'Versionable',
  ],
  schemas: [
    'common',
    'document_route_instance',
    'document_route_model',
    'domain',
    'dublincore',
    'facetedTag',
    'file',
    'files',
    'note',
    'publishing',
    'relatedtext',
    'route_node',
    'uid',
    'webcontainer',
  ],
  chains: ['AttachFiles', 'FileManager.ImportWithMetaData'],
  pageProviders: [
    'default_search',
    'advanced_document_content',
    'tree_children',
    'default_document_suggestion',
    'document_content',
  ],
  workflows: ['SerialDocumentReview', 'ParallelDocumentReview'],
  vocabularies: [
    'continent',
    'country',
    'language',
    'nature',
    'topic',
    'subtopic',
    'l10ncoverage',
    'l10nsubjects',
    'WorkflowType',
  ],
};

export interface Recording {
  readonly request: {
    readonly path: string;
    readonly query?: Record<string, string>;
    readonly properties?: string;
  };
  readonly status: number;
  /** The JSON answered, for a 2xx; for anything else, the message the reader gave. */
  readonly body?: unknown;
  readonly message?: string;
  /** What was taken out of the answer, when it was trimmed. */
  readonly trimmed?: string;
}

/** One key per read: the path, the query in a stable order, and the `properties` header. */
export function keyOf(path: string, options: ReadOptions = {}): string {
  const query = Object.entries(options.query ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort();
  return `${path}${query.length ? `?${query.join('&')}` : ''}${
    options.properties !== undefined ? ` [properties: ${options.properties}]` : ''
  }`;
}

export function fileNameOf(key: string): string {
  return `${key.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'root'}.json`;
}

/** Replays the recordings in a folder. */
export class RecordedReads implements NuxeoReads {
  readonly origin = RECORDED_ORIGIN;
  readonly reads: string[] = [];
  readonly #recordings = new Map<string, Recording>();

  constructor(folder = RECORDED) {
    for (const name of readdirSync(folder).filter(
      (file) => file.endsWith('.json') && file !== 'manifest.json',
    )) {
      const recording = JSON.parse(readFileSync(join(folder, name), 'utf8')) as Recording;
      const { path, query, properties } = recording.request;
      this.#recordings.set(keyOf(path, { query, properties }), recording);
    }
  }

  async get(path: string, options: ReadOptions = {}): Promise<unknown> {
    const key = keyOf(path, options);
    this.reads.push(key);
    const recording = this.#recordings.get(key);
    if (!recording)
      throw new Error(`Not recorded: ${key}. Run src/testing/record.ts against a server.`);
    if (recording.status < 200 || recording.status >= 300)
      throw new NuxeoError(recording.message ?? `answered ${recording.status}`, recording.status);
    return structuredClone(recording.body);
  }
}

/** Wraps a live reader, keeping every answer it gives, errors with a status included. */
export class RecordingReads implements NuxeoReads {
  readonly origin: string;
  readonly recordings = new Map<string, Recording>();
  readonly #inner: NuxeoReads;

  constructor(inner: NuxeoReads) {
    this.#inner = inner;
    this.origin = inner.origin;
  }

  async get(path: string, options: ReadOptions = {}): Promise<unknown> {
    const request = {
      path,
      ...(options.query
        ? {
            query: Object.fromEntries(
              Object.entries(options.query)
                .filter(([, value]) => value !== undefined)
                .map(([key, value]) => [key, String(value)]),
            ),
          }
        : {}),
      ...(options.properties !== undefined ? { properties: options.properties } : {}),
    };
    try {
      const body = await this.#inner.get(path, options);
      this.recordings.set(keyOf(path, options), {
        request,
        status: 200,
        body: structuredClone(body),
      });
      return body;
    } catch (error) {
      if (error instanceof NuxeoError && error.status !== null)
        this.recordings.set(keyOf(path, options), {
          request,
          status: error.status,
          message: error.message,
        });
      throw error;
    }
  }
}

/**
 * The files that hold any of `secrets`: the account the recordings were made with goes into none
 * of them. Empty secrets match nothing.
 */
export function holdingSecrets(
  files: ReadonlyMap<string, string>,
  secrets: readonly string[],
): string[] {
  // As written, and as JSON escapes it: a password holding a quote or a backslash is stored
  // escaped, and would pass a comparison with the raw string.
  const wanted = secrets
    .filter((secret) => secret !== '')
    .flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]);
  return [...files]
    .filter(([, content]) => wanted.some((secret) => content.includes(secret)))
    .map(([name]) => name);
}
