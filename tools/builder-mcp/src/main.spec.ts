/**
 * The real entry point, `node src/main.ts`, over stdio, as an MCP client starts it: Node strips
 * the types, nothing is built first.
 */
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnServer } from './testing/client.ts';
import { PIPELINE_TESTS_RUN } from './testing/unzip.ts';
import { REPO_ROOT } from './validate-package.ts';

const ENTRY = fileURLToPath(new URL('./main.ts', import.meta.url));
const NUXEO_TOOLS = [
  'get_content_model',
  'describe_document_type',
  'describe_schema',
  'list_page_providers',
  'describe_page_provider',
  'list_workflows',
  'describe_workflow',
  'list_vocabularies',
  'get_vocabulary',
  'list_operations',
  'describe_operation',
];
const WRITE_TOOLS = [
  'write_package_file',
  'remove_package_file',
  'apply_generator',
  'apply_package_changes',
];

/** The environment without any Nuxeo setting or package root, so each test says which it gives. */
function environment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ['NUXEO_URL', 'NUXEO_USER', 'NUXEO_PASS', 'BUILDER_PACKAGE_ROOTS'])
    delete env[key];
  return { ...env, ...extra };
}

describe('the server over stdio', () => {
  it('starts with no credentials, lists its tools, and says why the Nuxeo ones refuse', async () => {
    const client = await spawnServer(ENTRY, environment());
    try {
      const listed = await client.request('tools/list');
      const tools = (
        listed.result as { tools: { name: string; annotations?: Record<string, boolean> }[] }
      ).tools;
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        [...NUXEO_TOOLS, ...WRITE_TOOLS, 'preview_package', 'validate_package'].sort(),
      );
      const writers = ['preview_package', 'validate_package', ...WRITE_TOOLS];
      for (const tool of tools) {
        // Every Nuxeo tool only reads; validate_package builds a zip, if only in a temporary
        // folder; preview_package replaces what the dev folder served, and the write tools a
        // package's files.
        expect(tool.annotations?.['readOnlyHint'], tool.name).toBe(!writers.includes(tool.name));
        expect(tool.annotations?.['destructiveHint'], tool.name).toBe(
          tool.name === 'preview_package' || WRITE_TOOLS.includes(tool.name),
        );
      }
      const refused = await client.call('get_content_model');
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('NUXEO_USER and NUXEO_PASS must both be set');
      expect(client.stderr()).toContain('the Nuxeo tools will refuse');
    } finally {
      await client.close();
    }
  });

  it.skipIf(!PIPELINE_TESTS_RUN)('validates a package without any Nuxeo setting', async () => {
    const client = await spawnServer(ENTRY, environment());
    try {
      const checked = await client.call('validate_package', {
        directory: 'business-apps/packages/payers-claims-demo',
      });
      expect(checked.isError).toBe(false);
      expect(checked.json).toMatchObject({ passed: true, findings: [], refusedAt: null });
    } finally {
      await client.close();
    }
  });

  it.skipIf(!PIPELINE_TESTS_RUN)(
    'runs a generator for a write, in the package roots BUILDER_PACKAGE_ROOTS names',
    async () => {
      const roots = mkdtempSync(join(tmpdir(), 'builder-mcp-main-'));
      const pkg = join(roots, 'contracts-demo');
      cpSync(join(REPO_ROOT, 'business-apps', 'packages', 'contracts-demo'), pkg, {
        recursive: true,
        filter: (source) => !source.endsWith(`${sep}dist`),
      });
      const client = await spawnServer(ENTRY, environment({ BUILDER_PACKAGE_ROOTS: roots }));
      try {
        const queue = await client.call('apply_generator', {
          package: pkg,
          generator: 'app-queue',
          options: { id: 'all-contracts', pageProvider: 'contracts_up_for_renewal' },
        });
        expect(queue.isError, queue.text).toBe(false);
        expect(queue.json).toMatchObject({ written: true, validation: { passed: true } });
        expect(
          existsSync(join(pkg, 'bundle', 'agentic-ui-config', 'queues', 'all-contracts.json')),
        ).toBe(true);
        // The default root is replaced, not added to: the kit in the repository is out of scope.
        const kit = await client.call('write_package_file', {
          package: 'business-apps/packages/contracts-demo',
          path: 'bundle/agentic-ui-config/home.json',
          content: '{}',
        });
        expect(kit.isError).toBe(true);
        expect(kit.text).toContain('is not a package folder directly inside');
      } finally {
        await client.close();
        rmSync(roots, { recursive: true, force: true });
      }
    },
  );

  describe('against a server whose account stops being accepted', () => {
    let meAnswers = 0;
    const nuxeo = createServer((request: IncomingMessage, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      if (request.url === '/nuxeo/api/v1/me') {
        // Accepted once; then, as after a password change on a server with anonymous access,
        // answered as the guest.
        meAnswers++;
        response.end(
          JSON.stringify(
            meAnswers === 1
              ? { id: 'builder', isAnonymous: false }
              : { id: 'Anonymous', isAnonymous: true },
          ),
        );
      } else response.end(JSON.stringify({ 'entity-type': 'workflows', entries: [] }));
    });
    let origin = '';
    beforeAll(async () => {
      await new Promise<void>((done) => nuxeo.listen(0, '127.0.0.1', done));
      origin = `http://127.0.0.1:${(nuxeo.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((done) => nuxeo.close(() => done())));

    it('checks who it runs as on every call, not only the first', async () => {
      const client = await spawnServer(
        ENTRY,
        environment({
          NUXEO_URL: origin,
          NUXEO_USER: 'builder',
          NUXEO_PASS: 'not-a-real-password',
        }),
      );
      try {
        expect((await client.call('list_workflows')).isError).toBe(false);
        const second = await client.call('list_workflows');
        expect(second.isError).toBe(true);
        expect(second.text).toContain('the anonymous guest, not as builder');
      } finally {
        await client.close();
      }
      expect(meAnswers).toBe(2);
    });
  });

  describe('against a server that answers as its guest', () => {
    const requests: { method: string; url: string; authorization: boolean }[] = [];
    const nuxeo = createServer((request: IncomingMessage, response) => {
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: typeof request.headers.authorization === 'string',
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ 'entity-type': 'user', id: 'Anonymous', isAnonymous: true }));
    });
    let origin = '';
    beforeAll(async () => {
      await new Promise<void>((done) => nuxeo.listen(0, '127.0.0.1', done));
      origin = `http://127.0.0.1:${(nuxeo.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((done) => nuxeo.close(() => done())));

    it('reads nothing, having asked only who it runs as, with GET and its credentials', async () => {
      const client = await spawnServer(
        ENTRY,
        environment({
          NUXEO_URL: origin,
          NUXEO_USER: 'builder',
          NUXEO_PASS: 'not-a-real-password',
        }),
      );
      try {
        for (const tool of ['get_content_model', 'list_operations', 'list_workflows']) {
          const refused = await client.call(tool);
          expect(refused.isError, tool).toBe(true);
          expect(refused.text).toContain('the anonymous guest, not as builder');
          expect(refused.text).not.toContain('not-a-real-password');
        }
      } finally {
        await client.close();
      }
      expect(requests.length).toBeGreaterThan(0);
      expect(requests).toEqual(
        requests.map(() => ({ method: 'GET', url: '/nuxeo/api/v1/me', authorization: true })),
      );
    });
  });
});
