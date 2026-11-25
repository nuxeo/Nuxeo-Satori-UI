/**
 * The validator as the server runs it, on every write to an app's deployment layer: the designer's
 * draft of a layout file or a queue (docs/business-apps/app-definition-v2.md, section 10, "The
 * deployment layer").
 *
 * It is this library's own `validateFile`, the pipeline's check of one file of a package, given what
 * the designer gives it: a layout file in the mode its path names, held to the server's content
 * model, and a queue held to the app's own actions. Nothing here is a second validator.
 *
 * `server-validator-build.mjs` bundles this file, and what it imports, into one script that
 * `nuxeo-agentic-core` runs in the server's JavaScript engine, Nashorn
 * (`nuxeo-agentic-core/src/main/resources/agentic-ui-validator/validator.js`). It is not exported
 * from the library's index: nothing in the browser needs it. The script and the findings it gives
 * for a set of files are held to this source by `server-validator.spec.ts`, and the server's run of
 * the same files to the same findings by `DeploymentValidatorParityTest`.
 *
 * Plain data in and out, as JSON text, so that the server passes no Java object into the script.
 */
import type { Finding } from './lib/checker';
import { readContentModel } from './lib/content-model';
import { placeFile, validateFile } from './lib/package';
import { PACKAGED_REGISTRIES, isRecord, withRegistered } from './lib/registries';

/** What the server asks about one file. */
export interface DeploymentFileRequest {
  /** The file's path below the app's root: `layouts/<Type>/<mode>.layout.json` or `queues/<id>.json`. */
  readonly path: string;
  /** The file, parsed. */
  readonly content: unknown;
  /** The server's content model, `{ doctypes, facets, schemas }`, as `/api/v1/config` answers it. */
  readonly model: unknown;
  /** The app's `app.json`, parsed, or `null`. */
  readonly app?: unknown;
  /** The app's `actions.json`, parsed, or `null` when its package has none. */
  readonly actions?: unknown;
  /** What the deployment registers in code beyond the platform's own, as `--registered` says it. */
  readonly registered?: {
    readonly rules?: readonly string[];
    readonly rowActions?: readonly string[];
    readonly bulkActions?: readonly string[];
  };
}

/**
 * The validator's findings, or why the file was not checked at all: a path that is no file of the
 * deployment layer, or a content model that cannot be read. Either refuses the write.
 */
export type DeploymentFileAnswer =
  { readonly findings: readonly Finding[] } | { readonly refused: string };

/** The files a deployment layer may hold: a record page, an edit or a create form, and a queue. */
const LAYER_MODES = ['view', 'edit', 'create'];

const idList = (value: unknown): readonly string[] | null =>
  value === undefined
    ? []
    : Array.isArray(value) && value.every((id) => typeof id === 'string' && id !== '')
      ? (value as string[])
      : null;

/** One file's findings, as the pipeline would give them for the file in its package. */
export function validateDeploymentFile(request: DeploymentFileRequest): DeploymentFileAnswer {
  if (!isRecord(request) || typeof request.path !== 'string')
    return { refused: 'the request names no file' };
  const placed = placeFile(request.path);
  if (
    placed === null ||
    placed.root !== '' ||
    !(
      (placed.file.kind === 'layout' && LAYER_MODES.includes(placed.file.mode)) ||
      placed.file.kind === 'queue'
    )
  )
    return {
      refused: `${request.path} is not a file of a deployment layer: layouts/<Type>/<view, edit or create>.layout.json or queues/<id>.json`,
    };
  const read = readContentModel(request.model);
  if (read.model === undefined)
    return {
      refused: `the server's content model cannot be read, so the file cannot be held to it: ${read.problems[0]}`,
    };
  const registered = isRecord(request.registered) ? request.registered : {};
  const rules = idList(registered['rules']);
  const rowActions = idList(registered['rowActions']);
  const bulkActions = idList(registered['bulkActions']);
  if (rules === null || rowActions === null || bulkActions === null)
    return { refused: 'what the deployment registers is a list of ids of each kind' };
  const findings = validateFile(
    placed.file,
    request.content,
    {
      app: request.app ?? undefined,
      actions: request.actions ?? undefined,
      assets: new Set<string>(),
    },
    {
      registries: withRegistered(PACKAGED_REGISTRIES, { rules, rowActions, bulkActions }),
      model: read.model,
    },
  );
  return { findings };
}

/** The script's one entry point, JSON text in and out: what Nashorn calls. */
export function validate(request: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(request);
  } catch {
    return JSON.stringify({ refused: 'the request is not JSON' });
  }
  return JSON.stringify(validateDeploymentFile(parsed as DeploymentFileRequest));
}
