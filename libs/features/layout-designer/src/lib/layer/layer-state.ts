/**
 * An app's deployment layer as the server answers it for one file (`LayerService` in
 * `nuxeo-agentic-core`): the package's version, the live one and the draft, the versions kept, the
 * trail, and what the administrator asking may do. Read tolerantly, as every answer of the server's
 * is, and strictly where the designer would act on it.
 */
import type { Finding } from '@agentic-ui/shared/app-definition';

/** The format of the server's answers, `LayerService.FORMAT`. */
export const LAYER_FORMAT = 'nuxeo-agentic-ui-layer/1';

/** The changes the server takes, `LayerService.ACTIONS`. */
export type LayerAction = 'save' | 'submit' | 'approve' | 'rollback' | 'discard';

/** One version of the file the layer has published, its content left out of the list. */
export interface LayerVersion {
  readonly version: number;
  /** `approved`, through a draft and its approval, or `rollback`, restoring `from`. */
  readonly kind: string;
  readonly at: string;
  readonly authors: readonly string[];
  readonly submittedBy: string | null;
  readonly approvedBy: string | null;
  /** The version a rollback restored, or `null`. */
  readonly from: number | null;
  /** Who rolled back to it, for a rollback; its makers and approver are the version it restores. */
  readonly restoredBy: string | null;
}

export interface LayerLive extends LayerVersion {
  readonly content: unknown;
}

export interface LayerDraft {
  readonly content: unknown;
  readonly authors: readonly string[];
  readonly savedBy: string;
  readonly savedAt: string;
  /** The live version it was made on; 0 for the package's file. */
  readonly basedOn: number;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
}

export interface LayerTrailLine {
  readonly at: string;
  readonly by: string;
  readonly action: string;
  readonly revision: number;
  readonly version: number | null;
}

/** What the server says the administrator asking may do. It is not the control: the server is. */
export interface LayerPermissions {
  readonly write: boolean;
  readonly approve: boolean;
  /** Why they may not approve, in the server's words, or `null`. */
  readonly approveRefused: string | null;
  readonly selfApproval: boolean;
}

export interface LayerState {
  readonly app: string;
  readonly path: string;
  /** The revision every change names, and raises. */
  readonly revision: number;
  /** The package's file at this path, or `null` when the package has none. */
  readonly package: { readonly content: unknown } | null;
  readonly live: LayerLive | null;
  /** What a rollback puts back at once: the version live before this one, or 0 for the package. */
  readonly previous: number;
  readonly draft: LayerDraft | null;
  readonly versions: readonly LayerVersion[];
  readonly trail: readonly LayerTrailLine[];
  /** Whether the package's file has changed since the live version, or the draft, was made on it. */
  readonly packageChanged: boolean;
  readonly permissions: LayerPermissions;
}

/** A refusal of the server's, with what it said. */
export interface LayerRefusal {
  readonly status: number;
  readonly error: string;
  readonly message: string;
  readonly findings: readonly Finding[];
  /** The file as it is now, for a change made on a revision that is no longer its. */
  readonly state: LayerState | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

const names = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];

function readVersion(raw: unknown): LayerVersion | null {
  if (!isRecord(raw)) return null;
  const version = whole(raw['version']);
  const at = text(raw['at']);
  if (version === null || version === 0 || at === null) return null;
  return {
    version,
    kind: text(raw['kind']) ?? 'approved',
    at,
    authors: names(raw['authors']),
    submittedBy: text(raw['submittedBy']),
    approvedBy: text(raw['approvedBy']),
    from: whole(raw['from']),
    restoredBy: text(raw['restoredBy']),
  };
}

function readDraft(raw: unknown): LayerDraft | null {
  if (!isRecord(raw) || !('content' in raw)) return null;
  const savedBy = text(raw['savedBy']);
  const savedAt = text(raw['savedAt']);
  const basedOn = whole(raw['basedOn']);
  if (savedBy === null || savedAt === null || basedOn === null) return null;
  return {
    content: raw['content'],
    authors: names(raw['authors']),
    savedBy,
    savedAt,
    basedOn,
    submittedBy: text(raw['submittedBy']),
    submittedAt: text(raw['submittedAt']),
  };
}

function readTrail(raw: unknown): LayerTrailLine | null {
  if (!isRecord(raw)) return null;
  const at = text(raw['at']);
  const by = text(raw['by']);
  const action = text(raw['action']);
  const revision = whole(raw['revision']);
  if (at === null || by === null || action === null || revision === null) return null;
  return { at, by, action, revision, version: whole(raw['version']) };
}

/** A file's state as the server answers it, or `null` when the answer is not one. */
export function readLayerState(raw: unknown): LayerState | null {
  if (!isRecord(raw) || raw['format'] !== LAYER_FORMAT) return null;
  const app = text(raw['app']);
  const path = text(raw['path']);
  const revision = whole(raw['revision']);
  const permissions = raw['permissions'];
  if (app === null || path === null || revision === null || !isRecord(permissions)) return null;
  const packaged = raw['package'];
  const liveVersion = readVersion(raw['live']);
  const live =
    liveVersion && isRecord(raw['live']) && 'content' in raw['live']
      ? { ...liveVersion, content: raw['live']['content'] }
      : null;
  return {
    app,
    path,
    revision,
    package: isRecord(packaged) && 'content' in packaged ? { content: packaged['content'] } : null,
    live,
    previous: whole(raw['previous']) ?? 0,
    draft: readDraft(raw['draft']),
    versions: (Array.isArray(raw['versions']) ? raw['versions'] : []).flatMap((each) => {
      const version = readVersion(each);
      return version ? [version] : [];
    }),
    trail: (Array.isArray(raw['trail']) ? raw['trail'] : []).flatMap((each) => {
      const line = readTrail(each);
      return line ? [line] : [];
    }),
    packageChanged: raw['packageChanged'] === true,
    permissions: {
      write: permissions['write'] === true,
      approve: permissions['approve'] === true,
      approveRefused: text(permissions['approveRefused']),
      selfApproval: permissions['selfApproval'] === true,
    },
  };
}

/** A refusal's body, as the server writes one, with the status it came with. */
export function readLayerRefusal(status: number, raw: unknown): LayerRefusal {
  const body = isRecord(raw) ? raw : {};
  const findings = (Array.isArray(body['findings']) ? body['findings'] : []).flatMap(
    (finding): Finding[] =>
      isRecord(finding) &&
      typeof finding['path'] === 'string' &&
      typeof finding['message'] === 'string' &&
      (finding['kind'] === 'structure' ||
        finding['kind'] === 'unknown' ||
        finding['kind'] === 'parameter')
        ? [{ path: finding['path'], kind: finding['kind'], message: finding['message'] }]
        : [],
  );
  return {
    status,
    error: text(body['error']) ?? 'refused',
    message: text(body['message']) ?? `HTTP ${status}`,
    findings,
    state: readLayerState(body['state']),
  };
}

/** One difference between two versions of a file: where, and whether it was added, removed or changed. */
export interface LayerDifference {
  /** Where, as the validator writes a place: `cards[1].fields[0]`; empty for the file as a whole. */
  readonly path: string;
  readonly change: 'added' | 'removed' | 'changed';
}

/** The most differences listed between two versions; the rest are counted. */
export const MAX_DIFFERENCES = 200;

const join = (path: string, key: string | number): string =>
  typeof key === 'number' ? `${path}[${key}]` : path === '' ? key : `${path}.${key}`;

/**
 * Where `after` differs from `before`, key by key and item by item, as JSON compares: an object's
 * keys in `before`'s order, then those only `after` has; an array's items by their place. The
 * first {@link MAX_DIFFERENCES}, and how many there are in all.
 */
export function layerDifferences(
  before: unknown,
  after: unknown,
): { readonly differences: readonly LayerDifference[]; readonly total: number } {
  const differences: LayerDifference[] = [];
  let total = 0;
  const add = (path: string, change: LayerDifference['change']): void => {
    total++;
    if (differences.length < MAX_DIFFERENCES) differences.push({ path, change });
  };
  const visit = (a: unknown, b: unknown, path: string): void => {
    if (Array.isArray(a) && Array.isArray(b)) {
      const length = Math.max(a.length, b.length);
      for (let index = 0; index < length; index++) {
        if (index >= b.length) add(join(path, index), 'removed');
        else if (index >= a.length) add(join(path, index), 'added');
        else visit(a[index], b[index], join(path, index));
      }
      return;
    }
    if (isRecord(a) && isRecord(b)) {
      for (const key of Object.keys(a)) {
        if (!(key in b)) add(join(path, key), 'removed');
        else visit(a[key], b[key], join(path, key));
      }
      for (const key of Object.keys(b)) if (!(key in a)) add(join(path, key), 'added');
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) add(path, 'changed');
  };
  if (before === undefined && after !== undefined) add('', 'added');
  else if (before !== undefined && after === undefined) add('', 'removed');
  else visit(before, after, '');
  return { differences, total };
}
