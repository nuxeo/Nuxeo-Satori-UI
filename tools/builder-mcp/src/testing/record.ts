#!/usr/bin/env node
/**
 * Records a live Nuxeo's answers for the unit tests, and is the recorded run of every Nuxeo tool:
 *
 *   NUXEO_USER=<user> NUXEO_PASS=<password> node tools/builder-mcp/src/testing/record.ts [--check]
 *
 * It runs each tool's own reads (the functions the server calls) against the server NUXEO_URL
 * names, and prints one line per tool: what it answered, or why it failed. With `--check` it stops
 * there; without, it writes the answers to `recorded/`, replacing what is there, trimmed to what the
 * tests read (`TRIMS`). Every trim says what it took out, in the recording and in `manifest.json`.
 *
 * Exit codes: 0, every scenario answered as expected; 1, one did not; 2, no credentials.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isThisMachine, readTarget } from '../config.ts';
import { describeSchema, describeType, readContentModel, summarise } from '../model.ts';
import { NuxeoReader, type NuxeoReads } from '../nuxeo.ts';
import { describeOperation, listOperations, readOperations } from '../operations.ts';
import { describePageProvider, listPageProviders } from '../page-providers.ts';
import { isRecord } from '../shapes.ts';
import { listVocabularies, readVocabulary } from '../vocabularies.ts';
import { describeWorkflow, listWorkflows } from '../workflows.ts';
import {
  KEPT,
  RECORDED,
  RecordingReads,
  fileNameOf,
  holdingSecrets,
  type Recording,
} from './recordings.ts';

interface Scenario {
  readonly tool: string;
  readonly run: (nuxeo: NuxeoReads) => Promise<unknown>;
  /** A scenario that must fail, and the text its error must hold. */
  readonly refusedWith?: string;
}

const SCENARIOS: Scenario[] = [
  {
    tool: 'get_content_model',
    run: async (nuxeo) => summarise(await readContentModel(nuxeo)).counts,
  },
  {
    tool: 'describe_document_type File',
    run: async (nuxeo) => describeType(await readContentModel(nuxeo), 'File'),
  },
  {
    tool: 'describe_schema dc',
    run: async (nuxeo) => describeSchema(await readContentModel(nuxeo), 'dc'),
  },
  { tool: 'list_page_providers', run: (nuxeo) => listPageProviders(nuxeo, undefined) },
  ...KEPT.pageProviders.map((name) => ({
    tool: `describe_page_provider ${name}`,
    run: (nuxeo: NuxeoReads) => describePageProvider(nuxeo, name),
  })),
  {
    tool: 'describe_page_provider (unknown)',
    run: (nuxeo) => describePageProvider(nuxeo, 'no_such_provider'),
    refusedWith: 'has no page provider',
  },
  { tool: 'list_workflows', run: (nuxeo) => listWorkflows(nuxeo) },
  ...KEPT.workflows.map((name) => ({
    tool: `describe_workflow ${name}`,
    run: (nuxeo: NuxeoReads) => describeWorkflow(nuxeo, name),
  })),
  {
    tool: 'describe_workflow (unknown)',
    run: (nuxeo) => describeWorkflow(nuxeo, 'NoSuchWorkflow'),
    refusedWith: 'has no workflow model',
  },
  { tool: 'list_vocabularies', run: (nuxeo) => listVocabularies(nuxeo) },
  {
    tool: 'get_vocabulary continent',
    run: (nuxeo) => readVocabulary(nuxeo, 'continent', { pageSize: 100, pageIndex: 0 }),
  },
  {
    tool: 'get_vocabulary country, a page of 5',
    run: (nuxeo) => readVocabulary(nuxeo, 'country', { pageSize: 5, pageIndex: 1 }),
  },
  {
    tool: 'list_operations Document',
    run: async (nuxeo) =>
      listOperations(await readOperations(nuxeo), { query: 'document.', limit: 5 }),
  },
  {
    tool: 'describe_operation Document.Update',
    run: async (nuxeo) => describeOperation(await readOperations(nuxeo), 'Document.Update'),
  },
];

const check = process.argv.includes('--check');
const read = readTarget(process.env);
if ('problem' in read) {
  process.stderr.write(`${read.problem}\n`);
  process.exit(2);
}
// The recordings are committed to a public repository, so they are made against this machine's
// own server only: a development server elsewhere may hold a customer's model. Refused before any
// request is made. `--check` runs against any server, and writes nothing.
if (!check && !isThisMachine(new URL(read.target.origin).hostname)) {
  process.stdout.write(
    `Nothing recorded: ${read.target.origin} is not this machine. Use --check against it.\n`,
  );
  process.exit(1);
}
const recorder = new RecordingReads(new NuxeoReader(read.target));
/** What is printed, with the account's name and password, should either appear, replaced. */
const say = (line: string) =>
  process.stdout.write(
    `${[read.target.password, read.target.username].reduce((text, secret) => text.split(secret).join('<account>'), line)}\n`,
  );
let failed = 0;
for (const scenario of SCENARIOS) {
  try {
    const result = await scenario.run(recorder);
    if (scenario.refusedWith) {
      failed++;
      say(`FAIL ${scenario.tool}: answered, and was to be refused`);
    } else say(`ok   ${scenario.tool}: ${JSON.stringify(result).slice(0, 160)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (scenario.refusedWith && message.includes(scenario.refusedWith))
      say(`ok   ${scenario.tool}: refused: ${message}`);
    else {
      failed++;
      say(`FAIL ${scenario.tool}: ${message}`);
    }
  }
}
process.stdout.write(
  `${SCENARIOS.length - failed} of ${SCENARIOS.length} scenarios answered as expected.\n`,
);
if (!check && failed === 0)
  write(recorder.recordings, [read.target.username, read.target.password], read.target.origin);
process.exit(failed === 0 ? 0 : 1);

function write(
  recordings: ReadonlyMap<string, Recording>,
  secrets: readonly string[],
  origin: string,
): void {
  const trims: Record<string, string> = {};
  const used = usedNames(recordings);
  const files = new Map<string, string>();
  for (const [key, recording] of recordings) {
    const trimmed = trim(recording, used);
    if (trimmed.trimmed) trims[key] = trimmed.trimmed;
    files.set(fileNameOf(key), `${JSON.stringify(trimmed, null, 2)}\n`);
  }
  // The account the recordings were made with goes into none of them. Only the file is named.
  const holding = holdingSecrets(files, secrets);
  if (holding.length) {
    process.stdout.write(
      `Nothing written: ${holding.join(', ')} would hold NUXEO_USER or NUXEO_PASS.\n`,
    );
    process.exit(1);
  }
  mkdirSync(RECORDED, { recursive: true });
  for (const name of readdirSync(RECORDED))
    if (name.endsWith('.json')) rmSync(join(RECORDED, name));
  for (const [name, content] of files) writeFileSync(join(RECORDED, name), content);
  writeFileSync(
    join(RECORDED, 'manifest.json'),
    `${JSON.stringify(
      {
        recordedAt: new Date().toISOString().slice(0, 10),
        by: 'tools/builder-mcp/src/testing/record.ts',
        server: origin,
        reads: recordings.size,
        trims,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`Wrote ${recordings.size} recordings to ${RECORDED}.\n`);
}

/** The large answers, cut down to what the tests read. Small ones are kept whole. */
function trim(
  recording: Recording,
  used: { facets: Set<string>; schemas: Set<string> },
): Recording {
  const { path } = recording.request;
  const body = recording.body;
  if (path === '/config/types' && isRecord(body) && isRecord(body['doctypes'])) {
    const all = Object.keys(body['doctypes']);
    // Each kept type keeps only its stock facets and schemas.
    const doctypes = Object.fromEntries(
      Object.entries(body['doctypes'])
        .filter(([name]) => KEPT.types.includes(name))
        .map(([name, type]) => [
          name,
          isRecord(type)
            ? {
                ...type,
                facets: (Array.isArray(type['facets']) ? type['facets'] : []).filter((facet) =>
                  KEPT.facets.includes(String(facet)),
                ),
                schemas: (Array.isArray(type['schemas']) ? type['schemas'] : []).filter((schema) =>
                  KEPT.schemas.includes(String(schema)),
                ),
              }
            : type,
        ]),
    );
    return {
      ...recording,
      body: { doctypes, schemas: {} },
      trimmed: `doctypes: ${Object.keys(doctypes).length} of ${all.length} kept (${KEPT.types.join(', ')}), each with its stock facets and schemas only; the flat schemas map, which nothing reads, emptied`,
    };
  }
  if ((path === '/config/facets' || path === '/config/schemas') && Array.isArray(body)) {
    const names = path === '/config/facets' ? used.facets : used.schemas;
    const kept = body.filter(isRecord).filter((entry) => names.has(String(entry['name'])));
    return {
      ...recording,
      body: kept,
      trimmed: `${kept.length} of ${body.length} kept: those the kept types and workflows use`,
    };
  }
  if (path === '/automation' && isRecord(body)) {
    const operations = (Array.isArray(body['operations']) ? body['operations'] : []).filter(
      (entry) => isRecord(entry) && KEPT.operations.includes(String(entry['id'])),
    );
    const chains = (Array.isArray(body['chains']) ? body['chains'] : []).filter(
      (entry) => isRecord(entry) && KEPT.chains.includes(String(entry['id'])),
    );
    return {
      ...recording,
      body: { ...body, operations, chains },
      trimmed: `operations: ${operations.length} of ${Array.isArray(body['operations']) ? body['operations'].length : 0} kept (${KEPT.operations.join(', ')}); chains: ${chains.length} of ${Array.isArray(body['chains']) ? body['chains'].length : 0}`,
    };
  }
  if (path === '/management/page-providers' && Array.isArray(body)) {
    const kept = body.filter(
      (entry) => isRecord(entry) && KEPT.pageProviders.includes(String(entry['name'])),
    );
    return {
      ...recording,
      body: kept,
      trimmed: `${kept.length} of ${body.length} kept: ${KEPT.pageProviders.join(', ')}`,
    };
  }
  if ((path === '/workflowModel' || path === '/directory') && isRecord(body)) {
    // A list of the server's own: only the stock entries the tests name are kept, whatever else
    // the server holds.
    const names = path === '/workflowModel' ? KEPT.workflows : KEPT.vocabularies;
    const all = Array.isArray(body['entries']) ? body['entries'] : [];
    const kept = all.filter((entry) => isRecord(entry) && names.includes(String(entry['name'])));
    return {
      ...recording,
      body: { ...body, entries: kept },
      trimmed: `entries: ${kept.length} of ${all.length} kept: ${names.join(', ')}`,
    };
  }
  if ((path.startsWith('/id/') || path.startsWith('/path/')) && isRecord(body)) {
    // A document keeps what describe_workflow reads: its type, path, facets and the workflow's own
    // properties. Who created or changed it, and when, are left out.
    const properties = isRecord(body['properties']) ? body['properties'] : {};
    const kept = Object.fromEntries(
      Object.entries(properties).filter(([key]) => /^(rnode|docri|var_[A-Za-z0-9_]+):/.test(key)),
    );
    return {
      ...recording,
      body: {
        'entity-type': body['entity-type'],
        type: body['type'],
        path: body['path'],
        facets: body['facets'],
        properties: kept,
      },
      trimmed: `properties: ${Object.keys(kept).length} of ${Object.keys(properties).length} kept (rnode, docri and var_ ones); the document's other keys left out`,
    };
  }
  return recording;
}

/**
 * The facets and schemas the kept types use, and the variables facets the kept workflows' own
 * documents name: no other workflow's facets are kept, whoever's they are.
 */
function usedNames(recordings: ReadonlyMap<string, Recording>): {
  facets: Set<string>;
  schemas: Set<string>;
} {
  const facets = new Set<string>();
  const schemas = new Set<string>();
  for (const recording of recordings.values()) {
    const { path } = recording.request;
    const body = recording.body;
    if (path === '/config/types' && isRecord(body) && isRecord(body['doctypes'])) {
      for (const name of KEPT.types) {
        const type = body['doctypes'][name];
        if (!isRecord(type)) continue;
        for (const facet of Array.isArray(type['facets']) ? type['facets'] : [])
          if (KEPT.facets.includes(String(facet))) facets.add(String(facet));
        for (const schema of Array.isArray(type['schemas']) ? type['schemas'] : [])
          if (KEPT.schemas.includes(String(schema))) schemas.add(String(schema));
      }
    }
    // Only the kept workflows' documents are read, by describe_workflow.
    if ((path.startsWith('/id/') || path.startsWith('/path/')) && isRecord(body)) {
      const properties = isRecord(body['properties']) ? body['properties'] : {};
      for (const key of ['docri:variablesFacet', 'rnode:variablesFacet'])
        if (typeof properties[key] === 'string') facets.add(properties[key]);
    }
  }
  for (const recording of recordings.values()) {
    if (recording.request.path !== '/config/facets' || !Array.isArray(recording.body)) continue;
    for (const facet of recording.body.filter(isRecord))
      if (facets.has(String(facet['name'])))
        for (const schema of Array.isArray(facet['schemas'])
          ? facet['schemas'].filter(isRecord)
          : [])
          schemas.add(String(schema['name']));
  }
  return { facets, schemas };
}
