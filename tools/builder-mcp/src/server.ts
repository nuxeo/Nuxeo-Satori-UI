/**
 * The Builder kit's MCP server: its tools, each a read of the configured Nuxeo server, a run of
 * the package pipeline, or a write to a package that the pipeline passed first. Phase 3 of
 * docs/business-apps/development-plan.md.
 *
 * Publishing a package to pre-production, the plan's fourth job, is not here yet (README, "Not
 * here yet"). Previewing it in dev mode is `preview_package`.
 */
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod';
import {
  describeSchema,
  describeType,
  readContentModel,
  summarise,
  type ContentModel,
} from './model.ts';
import type { NuxeoReads } from './nuxeo.ts';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  describeOperation,
  listOperations,
  readOperations,
} from './operations.ts';
import {
  OWN_MODEL,
  definedIn,
  listPackagePageProviders,
  readPackageSource,
  type PackageSource,
} from './package-model.ts';
import {
  APP_GENERATORS,
  DEFAULT_PACKAGE_ROOT,
  MAX_CHANGES,
  MAX_FILE_BYTES,
  writePackage,
  type Change,
  type WriteRequest,
  type WriteResult,
} from './package-writes.ts';
import { describeDefinition, describePageProvider, listPageProviders } from './page-providers.ts';
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
  /**
   * The folders the write tools may write a package in, or why they cannot; config.ts reads them.
   * Default: `business-apps/packages/`.
   */
  readonly packageRoots?: readonly string[] | { readonly problem: string };
  readonly write?: (request: WriteRequest) => Promise<WriteResult>;
}

const INSTRUCTIONS =
  'Reads one Nuxeo server, the one NUXEO_URL names, validates app definition packages with the' +
  ' package pipeline, and writes to a package only what passes it. Every Nuxeo tool only reads,' +
  ' with GET requests: none writes, runs an operation or starts a workflow. Use the content model' +
  ' tools before writing a layout, so every field is one the type has; describe_page_provider' +
  ' before writing a queue or a related-records card; describe_workflow before a task form. Write' +
  ' every package file with write_package_file, apply_generator or apply_package_changes, never' +
  ' with your own file tools: each validates the package as it would be, writes it only when the' +
  ' pipeline passes with no finding, and otherwise returns the findings and changes nothing. A' +
  ' refused write is the answer: fix what it names, and never rename an id to get a pass.' +
  ' validate_package checks a package as it is. preview_package validates a package and serves it' +
  ' to the local development server, replacing what it served, and returns the addresses to open.';

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
  const roots = dependencies.packageRoots;
  const write =
    dependencies.write ??
    ((request: WriteRequest) => {
      if (roots !== undefined && 'problem' in roots) throw new Error(roots.problem);
      return writePackage(request, { packageRoots: roots });
    });
  const writing = (request: WriteRequest) => answer(() => write(request));
  /** A Nuxeo read, or the reason the server cannot make one. */
  const reading =
    <Args>(read: (reader: NuxeoReads, args: Args) => Promise<unknown>) =>
    (args: Args): Promise<CallToolResult> =>
      answer(async () => {
        if (typeof nuxeo !== 'function') throw new Error(nuxeo.problem);
        const reader = nuxeo();
        return { server: reader.origin, ...asObject(await read(reader, args)) };
      });
  /**
   * A read of the model or of the page providers: from the package's own stand-in model when
   * `package` names one that ships it and `own` finds what was asked there, else from the server.
   * The answer's `source` says which; `packageNote`, why the server answered a package's question.
   */
  const readingModel =
    <Args extends { readonly package?: string }>(
      own: (source: PackageSource, args: Args) => { readonly found: unknown } | string,
      read: (reader: NuxeoReads, args: Args) => Promise<unknown>,
    ) =>
    (args: Args): Promise<CallToolResult> =>
      answer(async () => {
        let packageNote: string | undefined;
        if (args.package !== undefined) {
          if (roots !== undefined && 'problem' in roots) throw new Error(roots.problem);
          const source = readPackageSource(args.package, roots ?? [DEFAULT_PACKAGE_ROOT]);
          if (source.model === null)
            packageNote = `${source.shown} ships no stand-in model, a ${OWN_MODEL} with a component that registers a document type of its own: its types and page providers are the server's.`;
          else {
            const ownAnswer = own(source, args);
            if (typeof ownAnswer !== 'string')
              return {
                source: 'package',
                package: source.shown,
                ...asObject(ownAnswer.found),
              };
            packageNote = ownAnswer;
          }
        }
        if (typeof nuxeo !== 'function')
          throw new Error(packageNote ? `${packageNote} ${nuxeo.problem}` : nuxeo.problem);
        const reader = nuxeo();
        return {
          source: 'server',
          server: reader.origin,
          ...(packageNote ? { packageNote: `${packageNote} So the server answered.` } : {}),
          ...asObject(await read(reader, args)),
        };
      });
  const packageArgumentForReads = z
    .string()
    .min(1)
    .optional()
    .describe(
      "A demo kit's package folder, such as business-apps/packages/moves-demo: when it ships a" +
        ' stand-in model (a content-model.json beside bundle/, as app-model writes), the answer is' +
        " read from it, and its source is 'package'; what it does not have, the server answers." +
        " Leave it out for a package on a server's model.",
    );
  const modelFile = (source: PackageSource) => ({ model: `${source.shown}/${OWN_MODEL}` });

  server.registerTool(
    'get_content_model',
    {
      title: 'Content model',
      description:
        "The server's document types (parent, facets, schemas), facets (their schemas) and schemas" +
        ' (prefix, field count), read from /config/types, /config/facets and /config/schemas.' +
        ' The prefixes are those an app definition writes: Nuxeo reports file, uid and files with an' +
        " empty prefix and addresses them by name. Given a demo kit's package, its own stand-in" +
        ' model instead, which no server has until the kit is installed; source says which answered.',
      inputSchema: z.object({ package: packageArgumentForReads }),
      annotations: READS,
    },
    readingModel(
      (source) => ({
        found: { ...modelFile(source), ...summarise(source.model as ContentModel) },
      }),
      async (reader) => summarise(await readContentModel(reader)),
    ),
  );

  server.registerTool(
    'describe_document_type',
    {
      title: 'Document type',
      description:
        'One document type with every field it has, as <prefix>:<name> with its Nuxeo type, grouped' +
        ' by schema; a schema a facet brings names the facet. Also its ancestors and subtypes.' +
        " Given a demo kit's package, from its own stand-in model when it has the type.",
      inputSchema: z.object({
        type: z.string().min(1).describe('The type name, such as File'),
        package: packageArgumentForReads,
      }),
      annotations: READS,
    },
    readingModel(
      (source, { type }: { type: string; package?: string }) => {
        const model = source.model as ContentModel;
        return model.types.some((candidate) => candidate.name === type)
          ? { found: { ...modelFile(source), ...describeType(model, type) } }
          : `${source.shown}'s own model has no document type "${type}".`;
      },
      async (reader, { type }) => describeType(await readContentModel(reader), type),
    ),
  );

  server.registerTool(
    'describe_schema',
    {
      title: 'Schema',
      description:
        "One schema's fields, by its name or its prefix (dublincore or dc), with the types and" +
        " facets that use it. Given a demo kit's package, from its own stand-in model when it has" +
        ' the schema.',
      inputSchema: z.object({
        schema: z.string().min(1).describe('A schema name or prefix'),
        package: packageArgumentForReads,
      }),
      annotations: READS,
    },
    readingModel(
      (source, { schema }: { schema: string; package?: string }) => {
        const model = source.model as ContentModel;
        return model.schemas.some(
          (candidate) => candidate.name === schema || candidate.prefix === schema,
        )
          ? { found: { ...modelFile(source), ...describeSchema(model, schema) } }
          : `${source.shown}'s own model has no schema "${schema}".`;
      },
      async (reader, { schema }) => describeSchema(await readContentModel(reader), schema),
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
        " related-records card names one of these. Given a demo kit's package, the page providers" +
        ' its own components define instead, which no server has until the kit is installed.',
      inputSchema: z.object({
        query: z.string().optional().describe('Only names containing this, in any case'),
        package: packageArgumentForReads,
      }),
      annotations: READS,
    },
    readingModel(
      (source, { query }: { query?: string; package?: string }) => ({
        found: listPackagePageProviders(source, query),
      }),
      (reader, { query }) => listPageProviders(reader, query),
    ),
  );

  server.registerTool(
    'describe_page_provider',
    {
      title: 'Page provider',
      description:
        "One page provider's definition, from /search/pp/<name>: its pattern or where clause, how" +
        " many parameters (?) a queue's or a card's parameters fill in order, the predicates a" +
        ' search document fills, its sorts, page sizes, quick filters and aggregates (the facets' +
        " a queue can offer). Given a demo kit's package, from the component of its own that" +
        ' defines it, when one does.',
      inputSchema: z.object({
        name: z.string().min(1).describe('The page provider name'),
        package: packageArgumentForReads,
      }),
      annotations: READS,
    },
    readingModel(
      (source, { name }: { name: string; package?: string }) => {
        const provider = source.pageProviders.get(name);
        return provider
          ? {
              found: {
                defined: definedIn(source, provider),
                ...describeDefinition(provider.definition),
              },
            }
          : `${source.shown} defines no page provider "${name}"${source.pageProviders.size > 0 ? `: it defines ${[...source.pageProviders.keys()].join(', ')}` : ''}.`;
      },
      (reader, { name }) => describePageProvider(reader, name),
    ),
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

  const folderArgument = z
    .string()
    .min(1)
    .optional()
    .describe(
      'The package folder, such as business-apps/packages/payers-claims-demo, as the write tools name it',
    );
  const directoryArgument = z
    .string()
    .min(1)
    .optional()
    .describe('The same, under its older name: give package or directory, not both');

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
        package: folderArgument,
        directory: directoryArgument,
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
    (args: FolderArgs) => answer(() => validate(folderRequest(args))),
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
        package: folderArgument,
        directory: directoryArgument,
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
    (args: FolderArgs) => answer(() => preview(folderRequest(args))),
  );

  const packageArgument = z
    .string()
    .min(1)
    .describe(
      'The package folder, directly inside business-apps/packages/ unless the server is configured' +
        ' with other roots, such as business-apps/packages/acme-contracts',
    );
  const pathArgument = z
    .string()
    .min(1)
    .max(512)
    .describe(
      'The file, relative to the package, such as bundle/agentic-ui-config/layouts/Contract/view.layout.json',
    );
  const contentArgument = z
    .string()
    .max(MAX_FILE_BYTES)
    .describe("The file's whole new content: a JSON object of version 2");
  const generatorArgument = z.enum(APP_GENERATORS).describe('The app generator to run');
  const optionsArgument = z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe(
      "The generator's options, named as its schema names them, such as" +
        ' { "type": "Contract", "model": "business-apps/packages/acme-contracts/content-model.json" }.' +
        ' Not package, name or directory, which the package argument gives, and not modelServer:' +
        ' a model is a JSON file inside the repository',
    );
  // Each replaces files in the package, so a client may ask before running one.
  const writes = (idempotent: boolean) => ({
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: idempotent,
    openWorldHint: false,
  });
  const VALIDATED =
    ' The change is made to a staging copy of the package, which the package pipeline checks as' +
    ' validate_package checks a folder alone, as CI does. It is written to the package only when' +
    ' the pipeline passes with no finding; otherwise written is false, the answer holds the' +
    ' findings and the step that refused it, and the package is unchanged. An id the platform or' +
    ' the package does not register, such as a widget, a rule or an operation, is refused so.' +
    ' A written answer may hold warnings: what the package still lacks that no check refuses, such' +
    " as a demo kit's schema with no Properties heading, layout.schema.<schema>, in labels/en.json." +
    ' Nothing is published, and no code of the package runs.';

  server.registerTool(
    'write_package_file',
    {
      title: 'Write a package file, if it validates',
      description:
        "Writes one file of a package's app definition, whole: app.json, home.json," +
        ' navigation.json, actions.json, queues/<id>.json, labels/<language>.json,' +
        ' tasks/<workflow>.<step>.layout.json or layouts/<Type>/<mode>.layout.json, under' +
        ' bundle/agentic-ui-config/. Any other path is refused before anything runs: one that' +
        ' leaves the package or goes through a link, a hidden file, code, an asset, the build' +
        ' allow-list, and the files the generators write (the component, the manifest, package/,' +
        ' build.mjs, content-model.json), for which use apply_generator. A new file the component' +
        ' must name, such as a new queue or home.json, needs app-registry in the same call: use' +
        ' apply_package_changes.' +
        VALIDATED,
      inputSchema: z.object({
        package: packageArgument,
        path: pathArgument,
        content: contentArgument,
      }),
      annotations: writes(true),
    },
    (args: { package: string; path: string; content: string }) =>
      writing({
        package: args.package,
        changes: [{ kind: 'write', path: args.path, content: args.content }],
      }),
  );

  server.registerTool(
    'remove_package_file',
    {
      title: 'Remove a package file, if the result validates',
      description:
        "Takes one file of a package's app definition out, one write_package_file writes," +
        ' but app.json: a queue, a layout, a labels file, a task form, the home, the menu or the' +
        " actions; then runs app-registry, so that the component names it no more, in the app's" +
        ' files or as a layout. A file another names, such as a queue the menu or the home' +
        ' opens, is refused until that one is written without it: use apply_package_changes,' +
        ' with a remove change, for both at once. The generated files (the component, the' +
        ' manifest, package/, build.mjs, content-model.json, the schemas) are the generators' +
        ' to take out, and are refused.' +
        VALIDATED,
      inputSchema: z.object({ package: packageArgument, path: pathArgument }),
      annotations: writes(true),
    },
    (args: { package: string; path: string }) =>
      writing({
        package: args.package,
        changes: [
          { kind: 'remove', path: args.path },
          { kind: 'generator', generator: 'app-registry' },
        ],
      }),
  );

  server.registerTool(
    'apply_generator',
    {
      title: 'Run an app generator, if the result validates',
      description:
        "Runs one of the Builder kit's app generators on a package, as npx nx g" +
        ' ./tools/satori-generators:<generator> would: app-package for a new package, app-layout,' +
        ' app-form, app-queue, app-action, app-registry, or app-model for a demo kit. It runs in a' +
        ' process of its own, on the staging copy, and every file it would write must be inside the' +
        ' package and one a generator writes, or nothing is written. A new demo kit, refused until' +
        ' it has a model and a record page, takes several generators in one call: use' +
        ' apply_package_changes.' +
        VALIDATED,
      inputSchema: z.object({
        package: packageArgument,
        generator: generatorArgument,
        options: optionsArgument,
      }),
      annotations: writes(false),
    },
    (args: { package: string; generator: string; options?: Record<string, unknown> }) =>
      writing({
        package: args.package,
        changes: [{ kind: 'generator', generator: args.generator, options: args.options }],
      }),
  );

  server.registerTool(
    'apply_package_changes',
    {
      title: 'Make several changes to a package, if the result validates',
      description:
        'Makes several changes to one package, in order, each as write_package_file or' +
        ' apply_generator makes one, or a remove, which takes one file of the app definition out,' +
        ' as remove_package_file does, and checks the package once, when they are all made: for' +
        ' steps that would each be refused alone, such as a new demo kit (app-package, then' +
        ' app-model, then app-layout), a hand-written home.json with the app-registry that' +
        ' names it, or a queue given another id: remove its file, write the new one and the menu' +
        ' that names it, then app-registry. All are written, or none.' +
        VALIDATED,
      inputSchema: z.object({
        package: packageArgument,
        changes: z
          .array(
            z.discriminatedUnion('kind', [
              z.object({ kind: z.literal('write'), path: pathArgument, content: contentArgument }),
              z.object({ kind: z.literal('remove'), path: pathArgument }),
              z.object({
                kind: z.literal('generator'),
                generator: generatorArgument,
                options: optionsArgument,
              }),
            ]),
          )
          .min(1)
          .max(MAX_CHANGES)
          .describe('The changes, in the order they are made'),
      }),
      annotations: writes(false),
    },
    (args: { package: string; changes: Change[] }) =>
      writing({ package: args.package, changes: args.changes }),
  );

  return server;
}

/** `validate_package`'s and `preview_package`'s arguments: the folder as `package` or `directory`. */
type FolderArgs = Omit<PackageRequest, 'directory'> & {
  readonly package?: string;
  readonly directory?: string;
};

/**
 * The request a folder's arguments make. The write tools and the readers name the folder
 * `package`, and these two named it `directory` first, so each takes either (P&C kit feedback,
 * item 9); two that disagree are refused rather than one chosen.
 */
function folderRequest({ package: named, directory, ...rest }: FolderArgs): PackageRequest {
  if (named !== undefined && directory !== undefined && named !== directory)
    throw new Error(
      `package and directory name two folders, ${named} and ${directory}: give the package folder once, as package.`,
    );
  const folder = named ?? directory;
  if (folder === undefined)
    throw new Error(
      'package: give the package folder, such as business-apps/packages/acme-contracts.',
    );
  return { ...rest, directory: folder };
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
