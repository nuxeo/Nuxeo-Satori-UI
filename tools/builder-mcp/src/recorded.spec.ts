/**
 * Every Nuxeo tool against what the local Docker Nuxeo answered, replayed from `testing/recorded/`
 * (README, "Running and testing it"). The reads the tools make are the recorded ones, so a tool
 * that asked for something else would fail here, naming the read.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeSchema, describeType, readContentModel, summarise } from './model.ts';
import { NuxeoError } from './nuxeo.ts';
import { describeOperation, listOperations, readOperations } from './operations.ts';
import { countParameters, describePageProvider, listPageProviders } from './page-providers.ts';
import { RECORDED, RecordedReads, holdingSecrets } from './testing/recordings.ts';
import { listVocabularies, readVocabulary } from './vocabularies.ts';
import { describeWorkflow, listWorkflows } from './workflows.ts';

const nuxeo = () => new RecordedReads();

describe('the content model', () => {
  it('reads all three endpoints, and gives every prefix as an app definition writes it', async () => {
    const reads = nuxeo();
    const model = await readContentModel(reads);
    expect(reads.reads.sort()).toEqual(['/config/facets', '/config/schemas', '/config/types']);
    const summary = summarise(model);
    expect(summary.counts.types).toBeGreaterThan(0);
    const prefix = (name: string) => summary.schemas.find((schema) => schema.name === name)?.prefix;
    expect(prefix('dublincore')).toBe('dc');
    // Nuxeo reports these with an empty prefix and addresses them by name.
    expect(prefix('file')).toBe('file');
    expect(prefix('uid')).toBe('uid');
  });

  it("describes File's fields, with the facet that brings a schema", async () => {
    const file = describeType(await readContentModel(nuxeo()), 'File');
    expect(file.parent).toBe('Document');
    expect(file.ancestors).toEqual(['Document']);
    const fields = file.schemas.flatMap((schema) => schema.fields);
    expect(fields).toContainEqual({ xpath: 'dc:title', type: 'string' });
    expect(fields).toContainEqual({ xpath: 'file:content', type: 'blob' });
    expect(fields.find((field) => field.xpath === 'dc:subjects')?.type).toBe('string[]');
    // Every field of a schema of the type is prefixed with that schema's prefix.
    for (const schema of file.schemas)
      for (const field of schema.fields)
        expect(field.xpath?.startsWith(`${schema.prefix}:`)).toBe(true);
    expect(file).not.toHaveProperty('problems');
  });

  it('keeps a complex field whole, with its subfields by name', async () => {
    const files = describeSchema(await readContentModel(nuxeo()), 'files');
    const list = files.fields.find((field) => field.xpath === 'files:files');
    expect(list?.type).toBe('complex[]');
    expect(list?.fields?.map((field) => field.name)).toContain('file');
  });

  it('finds a schema by its prefix, and says which types use it', async () => {
    const dc = describeSchema(await readContentModel(nuxeo()), 'dc');
    expect(dc.name).toBe('dublincore');
    expect(dc.usedByTypes).toContain('File');
  });

  it('names close candidates for a type it does not have', async () => {
    const model = await readContentModel(nuxeo());
    expect(() => describeType(model, 'file')).toThrow('Close names: File');
  });
});

describe('page providers', () => {
  it('lists their names, marking those the search index answers', async () => {
    const listed = await listPageProviders(nuxeo(), 'default_');
    expect(listed.pageProviders.map((entry) => entry.name)).toContain('default_search');
    expect(listed.matched).toBeLessThanOrEqual(listed.total);
    for (const entry of listed.pageProviders)
      expect(entry.name.toLowerCase()).toContain('default_');
  });

  it('describes default_search: its fixed part, predicates, sorts and aggregates', async () => {
    const search = await describePageProvider(nuxeo(), 'default_search');
    expect(search.query).toHaveProperty('fixedPart');
    expect(search.parameters.positional).toBe(0);
    expect(search.parameters.searchDocumentType).toBe('DefaultSearch');
    expect(search.parameters.predicates).toContainEqual({
      property: 'dc:creator',
      operator: 'IN',
      from: ['default_search:dc_creator'],
    });
    expect(search.aggregates).toContainEqual({
      id: 'dc_nature_agg',
      type: 'terms',
      field: 'dc:nature',
      properties: { size: '10' },
    });
    expect(
      search.aggregates.find((aggregate) => aggregate.id === 'common_size_agg')?.ranges,
    ).toEqual(['tiny', 'small', 'medium', 'big', 'huge']);
    expect(search.quickFilters.map((filter) => filter.name)).toContain('mostRecent');
  });

  it('counts the parameters of a pattern that takes them', async () => {
    const children = await describePageProvider(nuxeo(), 'tree_children');
    expect(children.query).toHaveProperty('pattern');
    expect(children.parameters.positional).toBeGreaterThan(0);
  });

  it('says a page provider is not there, rather than describing nothing', async () => {
    const error = await describePageProvider(nuxeo(), 'no_such_provider').then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(NuxeoError);
    expect((error as NuxeoError).message).toContain(
      'The server has no page provider "no_such_provider"',
    );
  });

  it('counts only the ? outside quoted strings', () => {
    expect(countParameters('ecm:parentId = ? AND dc:title = \'?\' AND x = "?" AND y = ?')).toBe(2);
    expect(countParameters("dc:title = 'it\\'s ?' AND z = ?")).toBe(1);
  });
});

describe('workflows', () => {
  it('lists the models with their variables', async () => {
    const { workflows } = await listWorkflows(nuxeo());
    const serial = workflows.find((workflow) => workflow.name === 'SerialDocumentReview');
    expect(serial?.variables).toEqual(
      expect.arrayContaining(['participants', 'validationOrReview', 'initiatorComment', 'index']),
    );
  });

  it("describes SerialDocumentReview's variables, steps, buttons and task forms", async () => {
    const serial = await describeWorkflow(nuxeo(), 'SerialDocumentReview');
    expect(serial).not.toHaveProperty('problems');
    expect(serial.variables).toEqual(
      expect.arrayContaining([
        { name: 'participants', type: 'string[]', default: [] },
        { name: 'validationOrReview', type: 'string', default: 'validation' },
        { name: 'index', type: 'long', default: 0 },
      ]),
    );
    const validate = serial.nodes.find((node) => node.id === 'Task6d8');
    expect(validate?.title).toBe('Validate the Document');
    expect(validate?.variables).toEqual([{ name: 'comment', type: 'string' }]);
    if (!validate || !('task' in validate) || !validate.task)
      throw new Error('Task6d8 has no task');
    expect(validate.task.buttons.map((button) => button.name)).toEqual(['reject', 'validate']);
    expect(validate.task.form.file).toBe('tasks/SerialDocumentReview.Task6d8.layout.json');
    expect(validate.task.form.fields).toEqual(
      expect.arrayContaining(['var:comment', 'var:participants']),
    );
    expect(validate.transitions.map((transition) => transition.target)).toContain('Task5c1');
    const start = serial.nodes.find((node) => node.start);
    expect(start?.id).toBe('Task375f');
  });

  it('says a workflow model is not there, naming the ones that are', async () => {
    await expect(describeWorkflow(nuxeo(), 'NoSuchWorkflow')).rejects.toThrow(
      'The server has no workflow model "NoSuchWorkflow"',
    );
  });
});

describe('vocabularies', () => {
  it('lists vocabularies only, unless asked for every directory', async () => {
    const only = await listVocabularies(nuxeo(), false);
    expect(only.vocabularies.every((directory) => directory.vocabulary)).toBe(true);
    expect(only.vocabularies.map((directory) => directory.name)).toEqual(
      expect.arrayContaining(['continent', 'country']),
    );
    const all = await listVocabularies(nuxeo(), true);
    expect(all.vocabularies.length).toBe(only.vocabularies.length + only.otherDirectories!);
  });

  it("reads a vocabulary's entries a page at a time", async () => {
    const continents = await readVocabulary(nuxeo(), 'continent', { pageSize: 100, pageIndex: 0 });
    expect(continents.entries.map((entry) => entry['id'])).toContain('europe');
    const countries = await readVocabulary(nuxeo(), 'country', { pageSize: 5, pageIndex: 1 });
    expect(countries.entries).toHaveLength(5);
    expect(countries.page).toMatchObject({ index: 1, size: 5, hasMore: true });
    expect(countries.vocabulary.parent).toBe('continent');
  });

  it('refuses the entries of a directory that is not a vocabulary', async () => {
    // The recorded server lists vocabularies only, so this listing is made up: one vocabulary, and
    // one directory of another schema, whose entries must not be asked for.
    const reads: string[] = [];
    const nuxeo = {
      origin: 'http://localhost:8080',
      get: async (path: string) => {
        reads.push(path);
        if (path !== '/directory') throw new Error(`asked for ${path}`);
        return {
          entries: [
            {
              name: 'continent',
              schema: 'vocabulary',
              idField: 'id',
              parent: null,
              readOnly: false,
            },
            { name: 'people', schema: 'user', idField: 'username', parent: null, readOnly: false },
          ],
        };
      },
    };
    const listed = await listVocabularies(nuxeo, false);
    expect(listed.vocabularies.map((directory) => directory.name)).toEqual(['continent']);
    expect(listed.otherDirectories).toBe(1);
    await expect(readVocabulary(nuxeo, 'people', { pageSize: 5, pageIndex: 0 })).rejects.toThrow(
      'not a vocabulary',
    );
    expect(reads).toEqual(['/directory', '/directory']);
  });
});

describe('operations', () => {
  it('filters operations, and counts every category', async () => {
    const listed = listOperations(await readOperations(nuxeo()), { query: 'document.', limit: 2 });
    expect(listed.returned).toBe(2);
    expect(listed.matched).toBeGreaterThan(2);
    expect(listed).toHaveProperty('truncated');
    expect(listed.categories.reduce((sum, category) => sum + category.count, 0)).toBe(listed.total);
  });

  it('describes Document.Update: its signature and parameters', async () => {
    const update = describeOperation(await readOperations(nuxeo()), 'Document.Update');
    expect(update.kind).toBe('operation');
    expect(update.signature).toContainEqual({ input: 'document', output: 'document' });
    const properties = update.params.find((param) => param.name === 'properties');
    expect(properties).toMatchObject({ required: true });
  });

  it('names close candidates for an operation it does not have', async () => {
    expect(() => describeOperation([], 'Document.Updat')).toThrow('has no operation or chain');
  });
});

describe('the recordings themselves', () => {
  const files = new Map(
    readdirSync(RECORDED)
      .filter((name) => name.endsWith('.json'))
      .map((name) => [name, readFileSync(join(RECORDED, name), 'utf8')] as const),
  );

  it("keep only a document's workflow properties: not who made or changed it", () => {
    const documents = [...files].filter(([name]) => /^(id|path)_/.test(name));
    expect(documents.length).toBeGreaterThan(0);
    for (const [name, content] of documents) {
      const { body } = JSON.parse(content) as { body: { properties: Record<string, unknown> } };
      for (const key of Object.keys(body.properties))
        expect(key, name).toMatch(/^(rnode|docri|var_[A-Za-z0-9_]+):/);
      expect(Object.keys(body).sort(), name).toEqual([
        'entity-type',
        'facets',
        'path',
        'properties',
        'type',
      ]);
    }
  });

  it('are refused when one would hold the account they were made with', () => {
    const made = new Map([
      ['a.json', '{"id": "builder"}'],
      ['b.json', '{"id": "someone"}'],
    ]);
    expect(holdingSecrets(made, ['builder', 'not-a-real-password'])).toEqual(['a.json']);
    expect(holdingSecrets(made, ['', 'nobody'])).toEqual([]);
  });
});
