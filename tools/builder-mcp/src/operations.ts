/**
 * Automation operations and chains, with their parameters, from `GET /automation`: what an
 * action of an app definition can run. Nothing here runs one.
 *
 * Which of them a deployment lets an app run is its allow-list's to say (decision 3,
 * docs/business-apps/package-pipeline.md, section 6): an operation the server has is not
 * thereby one a package may name.
 */
import type { NuxeoReads } from './nuxeo.ts';
import { isRecord, list, notFound, record, text, texts, type JsonRecord } from './shapes.ts';

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;

export interface Operation {
  readonly id: string;
  readonly kind: 'operation' | 'chain';
  readonly label: string | null;
  readonly category: string | null;
  readonly description: string | null;
  readonly requires: string | null;
  readonly aliases: readonly string[];
  /** Nuxeo's flat `[input, output, input, output, ...]`, as pairs. */
  readonly signature: readonly { readonly input: string; readonly output: string }[];
  readonly params: readonly Parameter[];
}

export interface Parameter {
  readonly name: string;
  readonly type: string | null;
  readonly required: boolean;
  readonly description: string | null;
  readonly widget: string | null;
  readonly values: readonly unknown[];
}

export async function readOperations(nuxeo: NuxeoReads): Promise<Operation[]> {
  const answer = record(await nuxeo.get('/automation'), '/automation');
  const read = (key: string, kind: Operation['kind']) =>
    list(answer[key] ?? [], `/automation's ${key}`)
      .filter(isRecord)
      .map((entry) => toOperation(entry, kind))
      .filter((operation) => operation.id !== '');
  return [...read('operations', 'operation'), ...read('chains', 'chain')].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

export function listOperations(
  operations: readonly Operation[],
  filter: { readonly category?: string; readonly query?: string; readonly limit: number },
) {
  const query = filter.query?.toLowerCase();
  const matched = operations.filter(
    (operation) =>
      (filter.category === undefined || operation.category === filter.category) &&
      (query === undefined ||
        [operation.id, operation.label, operation.description, ...operation.aliases].some((value) =>
          value?.toLowerCase().includes(query),
        )),
  );
  const categories = new Map<string, number>();
  for (const operation of operations) {
    const category = operation.category ?? '(none)';
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  const returned = matched.slice(0, filter.limit);
  return {
    total: operations.length,
    matched: matched.length,
    returned: returned.length,
    ...(matched.length > returned.length
      ? {
          truncated: `${matched.length - returned.length} more match; narrow the filter or raise limit`,
        }
      : {}),
    categories: [...categories]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, count]) => ({ name, count })),
    operations: returned.map(({ id, kind, label, category }) => ({ id, kind, label, category })),
  };
}

/** One operation or chain, by its id or an alias. */
export function describeOperation(operations: readonly Operation[], id: string): Operation {
  const found =
    operations.find((operation) => operation.id === id) ??
    operations.find((operation) => operation.aliases.includes(id));
  if (!found)
    throw notFound(
      'operation or chain',
      id,
      operations.map((operation) => operation.id),
    );
  return found;
}

function toOperation(entry: JsonRecord, kind: Operation['kind']): Operation {
  const flat = texts(entry['signature']);
  const signature: { input: string; output: string }[] = [];
  for (let index = 0; index + 1 < flat.length; index += 2)
    signature.push({ input: flat[index], output: flat[index + 1] });
  const params = (Array.isArray(entry['params']) ? entry['params'] : [])
    .filter(isRecord)
    .map((param) => ({ param, order: typeof param['order'] === 'number' ? param['order'] : 0 }))
    .sort((a, b) => a.order - b.order)
    .map(({ param }): Parameter => ({
      name: text(param['name']) ?? '',
      type: text(param['type']),
      required: param['required'] === true,
      description: text(param['description']) || null,
      widget: text(param['widget']),
      values: Array.isArray(param['values']) ? param['values'] : [],
    }));
  return {
    id: text(entry['id']) ?? '',
    kind,
    label: text(entry['label']),
    category: text(entry['category']),
    description: text(entry['description']) || null,
    requires: text(entry['requires']),
    aliases: texts(entry['aliases']),
    signature,
    params,
  };
}
