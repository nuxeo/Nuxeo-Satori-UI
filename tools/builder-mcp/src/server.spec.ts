/**
 * The tools as an MCP client calls them: in memory, against the recorded server.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServer } from './server.ts';
import { connect } from './testing/client.ts';
import { RECORDED_ORIGIN, RecordedReads } from './testing/recordings.ts';
import type { WriteRequest } from './package-writes.ts';
import type { PackageRequest } from './validate-package.ts';

describe('createServer', () => {
  it('answers each Nuxeo tool as JSON, naming the server it read', async () => {
    const client = await connect(createServer({ nuxeo: () => new RecordedReads() }));
    try {
      const calls: [string, Record<string, unknown>][] = [
        ['get_content_model', {}],
        ['describe_document_type', { type: 'File' }],
        ['describe_schema', { schema: 'dc' }],
        ['list_page_providers', { query: 'default_' }],
        ['describe_page_provider', { name: 'default_search' }],
        ['list_workflows', {}],
        ['describe_workflow', { name: 'SerialDocumentReview' }],
        ['list_vocabularies', {}],
        ['get_vocabulary', { name: 'continent' }],
        ['list_operations', { query: 'document.', limit: 5 }],
        ['describe_operation', { id: 'Document.Update' }],
      ];
      for (const [tool, args] of calls) {
        const answer = await client.call(tool, args);
        expect(answer.isError, `${tool}: ${answer.text}`).toBe(false);
        expect(answer.json, tool).toMatchObject({ server: RECORDED_ORIGIN });
      }
    } finally {
      await client.close();
    }
  });

  describe("reads a demo kit's own stand-in model, given its package, and says which answered", () => {
    const MOVES = 'business-apps/packages/moves-demo';

    it('answers the model and the page providers from the package, with no server at all', async () => {
      const client = await connect(
        createServer({ nuxeo: { problem: 'No server is configured.' } }),
      );
      try {
        const model = await client.call('get_content_model', { package: MOVES });
        expect(model.isError, model.text).toBe(false);
        expect(model.json).toMatchObject({
          source: 'package',
          package: MOVES,
          model: `${MOVES}/content-model.json`,
          counts: { types: 3 },
        });
        expect(model.json).not.toHaveProperty('server');

        const claim = await client.call('describe_document_type', {
          type: 'DamageClaim',
          package: MOVES,
        });
        expect(claim.isError, claim.text).toBe(false);
        expect(claim.json).toMatchObject({ source: 'package', name: 'DamageClaim' });
        expect(
          (claim.json as { schemas: { name: string }[] }).schemas.map((schema) => schema.name),
        ).toEqual(['common', 'dublincore', 'files', 'damageclaim']);

        const schema = await client.call('describe_schema', { schema: 'dmg', package: MOVES });
        expect(schema.json).toMatchObject({
          source: 'package',
          name: 'damageclaim',
          usedByTypes: ['DamageClaim'],
        });

        const listed = await client.call('list_page_providers', { package: MOVES });
        expect(listed.isError, listed.text).toBe(false);
        expect(listed.json).toMatchObject({ source: 'package', total: 5 });
        expect(
          (listed.json as { pageProviders: { name: string; indexed: boolean }[] }).pageProviders,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'moves_open_claims', indexed: null }),
            expect.objectContaining({ name: 'moves_move_items', indexed: false }),
          ]),
        );

        const items = await client.call('describe_page_provider', {
          name: 'moves_move_items',
          package: MOVES,
        });
        expect(items.isError, items.text).toBe(false);
        expect(items.json).toMatchObject({
          source: 'package',
          defined: `${MOVES}/bundle/OSGI-INF/moves-demo-model.xml`,
          name: 'moves_move_items',
          parameters: { positional: 1 },
          sort: [{ field: 'moveitem:tag', order: 'asc' }],
          pageSize: 50,
          maxPageSize: 100,
        });
        expect(JSON.stringify(items.json)).toContain("ecm:primaryType = 'MoveItem'");

        const open = await client.call('describe_page_provider', {
          name: 'moves_open_claims',
          package: MOVES,
        });
        expect(open.json).toMatchObject({
          source: 'package',
          parameters: { positional: 0 },
          aggregates: [
            { id: 'dmg_state_agg', type: 'terms', field: 'dmg:state' },
            { id: 'dmg_move_agg', type: 'terms', field: 'dmg:move' },
          ],
        });
        // The where clause, unescaped: what the server would run.
        expect(JSON.stringify(open.json)).toContain("dmg:state IN ('Filed', 'In review')");
      } finally {
        await client.close();
      }
    });

    it("answers from the server what the package's own model does not have, and says so", async () => {
      const client = await connect(createServer({ nuxeo: () => new RecordedReads() }));
      try {
        const file = await client.call('describe_document_type', { type: 'File', package: MOVES });
        expect(file.isError, file.text).toBe(false);
        expect(file.json).toMatchObject({
          source: 'server',
          server: RECORDED_ORIGIN,
          name: 'File',
        });
        expect((file.json as { packageNote: string }).packageNote).toContain(
          `${MOVES}'s own model has no document type "File"`,
        );
        const search = await client.call('describe_page_provider', {
          name: 'default_search',
          package: MOVES,
        });
        expect(search.json).toMatchObject({ source: 'server', name: 'default_search' });
        // Without a package, the server answers, as it always did.
        const plain = await client.call('describe_document_type', { type: 'File' });
        expect(plain.json).toMatchObject({ source: 'server', server: RECORDED_ORIGIN });
      } finally {
        await client.close();
      }
    });

    it("answers from the server for a package whose content-model.json describes a server's", async () => {
      // A customer's package with an export beside its bundle, and no type of its own.
      const root = mkdtempSync(join(tmpdir(), 'builder-mcp-reads-'));
      try {
        const pkg = join(root, 'acme-claims');
        mkdirSync(join(pkg, 'bundle', 'META-INF'), { recursive: true });
        writeFileSync(
          join(pkg, 'content-model.json'),
          JSON.stringify({ doctypes: {}, schemas: [] }),
        );
        writeFileSync(join(pkg, 'bundle', 'META-INF', 'MANIFEST.MF'), 'Manifest-Version: 1.0\n');
        const client = await connect(
          createServer({ nuxeo: () => new RecordedReads(), packageRoots: [root] }),
        );
        try {
          const file = await client.call('describe_document_type', { type: 'File', package: pkg });
          expect(file.isError, file.text).toBe(false);
          expect(file.json).toMatchObject({ source: 'server', name: 'File' });
          expect((file.json as { packageNote: string }).packageNote).toContain(
            'ships no stand-in model',
          );
        } finally {
          await client.close();
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('refuses a package that is not one, before reading anything', async () => {
      const client = await connect(
        createServer({ nuxeo: { problem: 'No server is configured.' } }),
      );
      try {
        const outside = await client.call('get_content_model', { package: '../elsewhere' });
        expect(outside.isError).toBe(true);
        expect(outside.text).toContain('package: ../elsewhere has a "." or ".." part');
      } finally {
        await client.close();
      }
    });
  });

  it('answers a refusal as a tool error the agent can read', async () => {
    const client = await connect(createServer({ nuxeo: () => new RecordedReads() }));
    try {
      const missing = await client.call('describe_workflow', { name: 'NoSuchWorkflow' });
      expect(missing.isError).toBe(true);
      expect(missing.text).toContain('The server has no workflow model "NoSuchWorkflow"');
    } finally {
      await client.close();
    }
  });

  it("checks a tool's arguments before running it", async () => {
    const client = await connect(createServer({ nuxeo: () => new RecordedReads() }));
    try {
      // Refused by the argument check, not by a read that happened to fail: the text says which.
      const wrong = await client.call('get_vocabulary', { name: 'continent', pageSize: 5000 });
      expect(wrong).toMatchObject({ isError: true });
      expect(wrong.text).toContain('Invalid arguments for tool get_vocabulary: pageSize');
      const empty = await client.call('describe_document_type', { type: '' });
      expect(empty).toMatchObject({ isError: true });
      expect(empty.text).toContain('Invalid arguments for tool describe_document_type: type');
    } finally {
      await client.close();
    }
  });

  it('passes validate_package its arguments as they were given', async () => {
    const seen: PackageRequest[] = [];
    const client = await connect(
      createServer({
        nuxeo: { problem: 'not needed' },
        validate: async (request) => {
          seen.push(request);
          throw new Error('stopped here');
        },
      }),
    );
    try {
      const answer = await client.call('validate_package', {
        directory: 'business-apps/packages/x',
        allowList: 'allow.json',
        platform: '1.2.3',
      });
      expect(answer).toMatchObject({ isError: true, text: 'stopped here' });
      expect(seen).toEqual([
        { directory: 'business-apps/packages/x', allowList: 'allow.json', platform: '1.2.3' },
      ]);
    } finally {
      await client.close();
    }
  });

  it('takes the folder as package, as the write tools name it, or as directory, not as two', async () => {
    const seen: PackageRequest[] = [];
    const client = await connect(
      createServer({
        nuxeo: { problem: 'not needed' },
        validate: async (request) => {
          seen.push(request);
          throw new Error('stopped here');
        },
        preview: async (request) => {
          seen.push(request);
          throw new Error('stopped here');
        },
      }),
    );
    try {
      const pkg = 'business-apps/packages/x';
      for (const tool of ['validate_package', 'preview_package']) {
        expect(await client.call(tool, { package: pkg })).toMatchObject({
          isError: true,
          text: 'stopped here',
        });
        expect(await client.call(tool, { package: pkg, directory: pkg })).toMatchObject({
          isError: true,
          text: 'stopped here',
        });
        const two = await client.call(tool, {
          package: pkg,
          directory: 'business-apps/packages/y',
        });
        expect(two).toMatchObject({ isError: true });
        expect(two.text).toContain('package and directory name two folders');
        const none = await client.call(tool, {});
        expect(none).toMatchObject({ isError: true });
        expect(none.text).toContain('give the package folder');
      }
      expect(seen).toEqual([
        { directory: pkg },
        { directory: pkg },
        { directory: pkg },
        { directory: pkg },
      ]);
    } finally {
      await client.close();
    }
  });

  it('passes preview_package its arguments as they were given', async () => {
    const seen: PackageRequest[] = [];
    const client = await connect(
      createServer({
        nuxeo: { problem: 'not needed' },
        preview: async (request) => {
          seen.push(request);
          throw new Error('stopped here');
        },
      }),
    );
    try {
      const answer = await client.call('preview_package', {
        directory: 'business-apps/packages/x',
        registered: 'registered.json',
      });
      expect(answer).toMatchObject({ isError: true, text: 'stopped here' });
      expect(seen).toEqual([
        { directory: 'business-apps/packages/x', registered: 'registered.json' },
      ]);
    } finally {
      await client.close();
    }
  });

  it('refuses preview_package when it was given no dev server at all', async () => {
    const client = await connect(createServer({ nuxeo: { problem: 'not needed' } }));
    try {
      const answer = await client.call('preview_package', {
        directory: 'business-apps/packages/payers-claims-demo',
      });
      expect(answer).toMatchObject({ isError: true, text: 'No dev server is configured.' });
    } finally {
      await client.close();
    }
  });

  it('passes each write tool its package and changes as one write request', async () => {
    const seen: WriteRequest[] = [];
    const client = await connect(
      createServer({
        nuxeo: { problem: 'not needed' },
        write: async (request) => {
          seen.push(request);
          throw new Error('stopped here');
        },
      }),
    );
    try {
      const pkg = 'business-apps/packages/x';
      const answers = [
        await client.call('write_package_file', {
          package: pkg,
          path: 'bundle/agentic-ui-config/home.json',
          content: '{}',
        }),
        await client.call('apply_generator', {
          package: pkg,
          generator: 'app-queue',
          options: { id: 'open', pageProvider: 'x_open', pageSize: 20 },
        }),
        await client.call('apply_package_changes', {
          package: pkg,
          changes: [
            { kind: 'write', path: 'bundle/agentic-ui-config/home.json', content: '{}' },
            { kind: 'remove', path: 'bundle/agentic-ui-config/queues/old.json' },
            { kind: 'generator', generator: 'app-registry' },
          ],
        }),
        await client.call('remove_package_file', {
          package: pkg,
          path: 'bundle/agentic-ui-config/queues/old.json',
        }),
      ];
      for (const answer of answers)
        expect(answer).toMatchObject({ isError: true, text: 'stopped here' });
      expect(seen).toEqual([
        {
          package: pkg,
          changes: [{ kind: 'write', path: 'bundle/agentic-ui-config/home.json', content: '{}' }],
        },
        {
          package: pkg,
          changes: [
            {
              kind: 'generator',
              generator: 'app-queue',
              options: { id: 'open', pageProvider: 'x_open', pageSize: 20 },
            },
          ],
        },
        {
          package: pkg,
          changes: [
            { kind: 'write', path: 'bundle/agentic-ui-config/home.json', content: '{}' },
            { kind: 'remove', path: 'bundle/agentic-ui-config/queues/old.json' },
            { kind: 'generator', generator: 'app-registry' },
          ],
        },
        {
          package: pkg,
          changes: [
            { kind: 'remove', path: 'bundle/agentic-ui-config/queues/old.json' },
            { kind: 'generator', generator: 'app-registry' },
          ],
        },
      ]);
    } finally {
      await client.close();
    }
  });

  it('refuses a generator that is not an app generator before running anything', async () => {
    const client = await connect(
      createServer({
        nuxeo: { problem: 'not needed' },
        write: async () => {
          throw new Error('the write ran');
        },
      }),
    );
    try {
      for (const generator of ['config-package', 'extension-library', 'satori-component']) {
        const answer = await client.call('apply_generator', {
          package: 'business-apps/packages/x',
          generator,
        });
        expect(answer.isError, generator).toBe(true);
        expect(answer.text, generator).toContain('Invalid arguments for tool apply_generator');
      }
    } finally {
      await client.close();
    }
  });

  it('refuses every write when the package roots it was given are wrong', async () => {
    const client = await connect(
      createServer({
        nuxeo: { problem: 'not needed' },
        packageRoots: { problem: 'BUILDER_PACKAGE_ROOTS: x is not a folder' },
      }),
    );
    try {
      const answer = await client.call('write_package_file', {
        package: 'business-apps/packages/payers-claims-demo',
        path: 'bundle/agentic-ui-config/home.json',
        content: '{}',
      });
      expect(answer).toMatchObject({
        isError: true,
        text: 'BUILDER_PACKAGE_ROOTS: x is not a folder',
      });
    } finally {
      await client.close();
    }
  });

  it('refuses preview_package, before running anything, when it has no dev server to ask', async () => {
    const client = await connect(
      createServer({
        nuxeo: { problem: 'not needed' },
        devServer: { problem: 'DEV_SERVER_URL names example.com, which is not this machine' },
      }),
    );
    try {
      const answer = await client.call('preview_package', {
        directory: 'business-apps/packages/payers-claims-demo',
      });
      expect(answer).toMatchObject({
        isError: true,
        text: 'DEV_SERVER_URL names example.com, which is not this machine',
      });
    } finally {
      await client.close();
    }
  });
});
