/**
 * The tools as an MCP client calls them: in memory, against the recorded server.
 */
import { describe, expect, it } from 'vitest';
import { createServer } from './server.ts';
import { connect } from './testing/client.ts';
import { RECORDED_ORIGIN, RecordedReads } from './testing/recordings.ts';
import type { PackageRequest } from './validate-package.ts';

describe('createServer', () => {
  it('answers each Nuxeo tool as JSON, naming the server it read', async () => {
    const client = await connect(createServer({ nuxeo: new RecordedReads() }));
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
    const client = await connect(createServer({ nuxeo: new RecordedReads() }));
    try {
      const missing = await client.call('describe_workflow', { name: 'NoSuchWorkflow' });
      expect(missing.isError).toBe(true);
      expect(missing.text).toContain('The server has no workflow model "NoSuchWorkflow"');
    } finally {
      await client.close();
    }
  });

  it("checks a tool's arguments before running it", async () => {
    const client = await connect(createServer({ nuxeo: new RecordedReads() }));
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
});
