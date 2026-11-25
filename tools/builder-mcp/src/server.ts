/**
 * The Builder kit's MCP server: its tools, each a read of the configured Nuxeo server or a run
 * of the package pipeline. Phase 3 of docs/business-apps/development-plan.md.
 *
 * Publishing a package to pre-production, the plan's fourth job, is not here yet (README, "Not
 * here yet"). Previewing it in dev mode is `preview_package`.
 */
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { describeSchema, describeType, readContentModel, summarise } from './model.ts';
import type { NuxeoReads } from './nuxeo.ts';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  describeOperation,
  listOperations,
  readOperations,
} from './operations.ts';
import { describePageProvider, listPageProviders } from './page-providers.ts';
import { previewPackage, type Preview, type PreviewOptions } from './preview-package.ts';
import { validatePackage, type PackageCheck, type PackageRequest } from './validate-package.ts';
import { MAX_PAGE_SIZE, listVocabularies, readVocabulary } from './vocabularies.ts';
import { describeWorkflow, listWorkflows } from './workflows.ts';

export const SERVER_NAME = 'nuxeo-builder';
export const SERVER_VERSION = '0.1.0';

export interface ServerDependencies {
  /**
   * A new Nuxeo reader for each tool call, so that each call asks Nuxeo who it runs as before its
   * first read; or why there is none, which every Nuxeo tool then answers with.
   */
  readonly nuxeo: (() => NuxeoReads) | { readonly problem: string };
  readonly validate?: (request: PackageRequest) => Promise<PackageCheck>;
  /** The dev server `preview_package` serves to, or why it cannot; config.ts reads it. */
  readonly devServer?: PreviewOptions['devServer'];
  readonly preview?: (request: PackageRequest) => Promise<Preview>;
}

const INSTRUCTIONS =
  'Reads one Nuxeo server, the one NUXEO_URL names, and validates app definition packages with' +
  ' the package pipeline. Every Nuxeo tool only reads, with GET requests: none writes, runs an' +
  ' operation or starts a workflow. Use the content model tools before writing a layout, so every' +
  ' field is one the type has; describe_page_provider before writing a queue or a related-records' +
  ' card; describe_workflow before a task form; and validate_package after every change to a' +
  ' package. A package that does not pass validate_package is not finished. preview_package' +
  ' validates a package and serves it to the local development server, replacing what it served,' +
  ' and returns the addresses to open.';

/**
 * Every Nuxeo tool reads definitions and changes nothing. The only documents read are a workflow
 * model's own, for its steps, each with its workflow schema only.
 */
const READS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function createServer(dependencies: ServerDependencies): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  const { nuxeo } = dependencies;
  const validate = dependencies.validate ?? validatePackage;
  const devServer = dependencies.devServer ?? { problem: 'No dev server is configured.' };
  const preview =
    dependencies.preview ?? ((request: PackageRequest) => previewPackage(request, { devServer }));
  /** A Nuxeo read, or the reason the server cannot make one. */
  const reading =
    <Args>(read: (reader: NuxeoReads, args: Args) => Promise<unknown>) =>
    (args: Args): Promise<CallToolResult> =>
      answer(async () => {
        if (typeof nuxeo !== 'function') throw new Error(nuxeo.problem);
        const reader = nuxeo();
        return { server: reader.origin, ...asObject(await read(reader, args)) };
      });

  server.registerTool(
    'get_content_model',
    {
      title: 'Content model',
      description:
        "The server's document types (parent, facets, schemas), facets (their schemas) and schemas" +
        ' (prefix, field count), read from /config/types, /config/facets and /config/schemas.' +
        ' The prefixes are those an app definition writes: Nuxeo reports file, uid and files with an' +
        ' empty prefix and addresses them by name.',
      annotations: READS,
    },
    reading(async (reader) => summarise(await readContentModel(reader))),
  );

  server.registerTool(
    'describe_document_type',
    {
      title: 'Document type',
      description:
        'One document type with every field it has, as <prefix>:<name> with its Nuxeo type, grouped' +
        ' by schema; a schema a facet brings names the facet. Also its ancestors and subtypes.',
      inputSchema: z.object({ type: z.string().min(1).describe('The type name, such as File') }),
      annotations: READS,
    },
    reading(async (reader, { type }: { type: string }) =>
      describeType(await readContentModel(reader), type),
    ),
  );

  server.registerTool(
    'describe_schema',
    {
      title: 'Schema',
      description:
        "One schema's fields, by its name or its prefix (dublincore or dc), with the types and" +
        ' facets that use it.',
      inputSchema: z.object({ schema: z.string().min(1).describe('A schema name or prefix') }),
      annotations: READS,
    },
    reading(async (reader, { schema }: { schema: string }) =>
      describeSchema(await readContentModel(reader), schema),
    ),
  );

  server.registerTool(
    'list_page_providers',
    {
      title: 'Page providers',
      description:
        "The names of the server's page providers, from Nuxeo's management API, which needs an" +
        ' administrator, each marked indexed when the search index answers it: an index lags, so' +
        ' a list that must show a write just made should not use one. A queue or a' +
        ' related-records card names one of these.',
      inputSchema: z.object({
        query: z.string().optional().describe('Only names containing this, in any case'),
      }),
      annotations: READS,
    },
    reading((reader, { query }: { query?: string }) => listPageProviders(reader, query)),
  );

  server.registerTool(
    'describe_page_provider',
    {
      title: 'Page provider',
      description:
        "One page provider's definition, from /search/pp/<name>: its pattern or where clause, how" +
        " many parameters (?) a queue's or a card's parameters fill in order, the predicates a" +
        ' search document fills, its sorts, page sizes, quick filters and aggregates (the facets' +
        ' a queue can offer).',
      inputSchema: z.object({ name: z.string().min(1).describe('The page provider name') }),
      annotations: READS,
    },
    reading((reader, { name }: { name: string }) => describePageProvider(reader, name)),
  );

  server.registerTool(
    'list_workflows',
    {
      title: 'Workflow models',
      description: "The server's workflow models, with their variables' names.",
      annotations: READS,
    },
    reading((reader) => listWorkflows(reader)),
  );

  server.registerTool(
    'describe_workflow',
    {
      title: 'Workflow model',
      description:
        "One workflow model: its variables with types and defaults, and each step's task (buttons," +
        ' directive, layout), variables, and transitions with their conditions and chains. A task' +
        ' step also names the task form file it would have and the var: fields that form can edit' +
        ' (docs/business-apps/app-definition-v2.md, section 6).',
      inputSchema: z.object({
        name: z.string().min(1).describe('The workflow model name, such as SerialDocumentReview'),
      }),
      annotations: READS,
    },
    reading((reader, { name }: { name: string }) => describeWorkflow(reader, name)),
  );

  server.registerTool(
    'list_vocabularies',
    {
      title: 'Vocabularies',
      description:
        "The server's vocabularies: the directories with a vocabulary schema, which a vocabulary" +
        ' widget lists values from. Other directories are counted, not named.',
      annotations: READS,
    },
    reading((reader) => listVocabularies(reader)),
  );

  server.registerTool(
    'get_vocabulary',
    {
      title: 'Vocabulary entries',
      description:
        "One vocabulary's entries (id, label, parent, obsolete, ordering), a page at a time. Only" +
        ' vocabularies are read: another directory is refused.',
      inputSchema: z.object({
        name: z.string().min(1).describe('The vocabulary name, such as country'),
        pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().describe('Default 100'),
        pageIndex: z.number().int().min(0).optional().describe('From 0. Default 0'),
      }),
      annotations: READS,
    },
    reading((reader, args: { name: string; pageSize?: number; pageIndex?: number }) =>
      readVocabulary(reader, args.name, {
        pageSize: args.pageSize ?? 100,
        pageIndex: args.pageIndex ?? 0,
      }),
    ),
  );

  server.registerTool(
    'list_operations',
    {
      title: 'Automation operations',
      description:
        "The server's Automation operations and chains (id, label, category), filtered, with every" +
        " category and its count. What a package may run is still the deployment allow-list's to" +
        ' say (decision 3).',
      inputSchema: z.object({
        category: z.string().optional().describe('Only this category, exactly'),
        query: z
          .string()
          .optional()
          .describe('Only those whose id, label, description or alias contains this'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(`Default ${DEFAULT_LIMIT}`),
      }),
      annotations: READS,
    },
    reading(async (reader, args: { category?: string; query?: string; limit?: number }) =>
      listOperations(await readOperations(reader), { ...args, limit: args.limit ?? DEFAULT_LIMIT }),
    ),
  );

  server.registerTool(
    'describe_operation',
    {
      title: 'Automation operation',
      description:
        'One operation or chain, by id or alias: its description, its signature as input and' +
        ' output pairs, and its parameters with type, whether required, widget and values.',
      inputSchema: z.object({ id: z.string().min(1).describe('Such as Document.Update') }),
      annotations: READS,
    },
    reading(async (reader, { id }: { id: string }) => ({
      operation: describeOperation(await readOperations(reader), id),
    })),
  );

  server.registerTool(
    'validate_package',
    {
      title: 'Validate a package',
      description:
        "Runs the package pipeline's checks, steps 1 to 6 of docs/business-apps/package-pipeline.md," +
        " on a package folder (scripts/app-package.mjs): the builder, the app definition's" +
        ' validation, the version, the build, the zip and its checksum. Given the folder alone, it' +
        ' passes what CI passes, and asCi is true; an allow-list, a registered file or another' +
        ' platform version change what is checked, and are listed under departsFromCi. A package' +
        ' that ships a stand-in model is held to its own content-model.json, as in CI; one on a' +
        " server's model is held to none, for which npm run app-package takes --model. Returns" +
        ' whether it passed, each finding with its file and place, and the step that refused it.' +
        ' The zip is built in a temporary folder and removed; nothing is published. Paths are' +
        ' relative to the repository, and must be inside it.',
      inputSchema: z.object({
        directory: z.string().min(1).describe('Such as business-apps/packages/payers-claims-demo'),
        allowList: z
          .string()
          .optional()
          .describe(
            'The deployment allow-list file, { "operations": [...] }. Without it every operation is refused',
          ),
        registered: z
          .string()
          .optional()
          .describe(
            'A file of what the deployment registers in code: rules, rowActions, bulkActions, actions, modules',
          ),
        platform: z
          .string()
          .min(1)
          .optional()
          .describe("The platform version to hold app.json's range to. Default: libs/platform's"),
      }),
      // Not read-only: it builds a zip, if only in a temporary folder it removes, and runs the
      // pipeline's processes. A client may ask before running it, and should be free to.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args: PackageRequest) => answer(() => validate(args)),
  );

  server.registerTool(
    'preview_package',
    {
      title: 'Preview a package in dev mode',
      description:
        'Validates a package folder as validate_package does, then serves it to the local' +
        ' development server (npx nx serve nuxeo-ui) through npm run config:dev: its layouts,' +
        ' home, menu, queues, labels and task forms, written into' +
        ' apps/nuxeo-ui/public/agentic-ui-config/, replacing what was served before. A package' +
        ' that does not pass is not served. Returns the address to open first and each page,' +
        ' the files it could not serve and why (app.json, actions.json, modules, assets), and' +
        ' whether the dev server answers every file as it was written, which it is given a few' +
        ' seconds to do; one it still does not answer needs a restart. Writes nothing but that' +
        " folder and, while it runs, a folder of its own in the package's dist/. Paths are" +
        ' relative to the repository, and must be inside it.',
      inputSchema: z.object({
        directory: z.string().min(1).describe('Such as business-apps/packages/payers-claims-demo'),
        allowList: z
          .string()
          .optional()
          .describe('As validate_package: the deployment allow-list file'),
        registered: z
          .string()
          .optional()
          .describe('As validate_package: what the deployment registers in code'),
        platform: z
          .string()
          .min(1)
          .optional()
          .describe("As validate_package. Default: libs/platform's"),
      }),
      // It replaces what the dev folder served, so a client may ask before running it.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args: PackageRequest) => answer(() => preview(args)),
  );

  return server;
}

/** A tool's answer as JSON text, or its error as a tool error the agent can read and act on. */
async function answer(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await run(), null, 2) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    };
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { result: value };
}
