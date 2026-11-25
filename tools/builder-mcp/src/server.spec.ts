/**
 * The tools as an MCP client calls them: in memory, against the recorded server.
 */
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
            { kind: 'generator', generator: 'app-registry' },
          ],
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
