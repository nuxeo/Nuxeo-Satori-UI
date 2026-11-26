/**
 * What lab mode reads from the server itself, from Node, before and beside the browsers: who the
 * credentials are, each document, the platform's model for check 3, and whether the server serves
 * the Studio package and the new app its conversion. Every read is a `GET` to one origin, with no
 * redirect followed, so nothing is written and nothing is sent anywhere else; the session the
 * server opens is sent back, so that the reads sign in once.
 */
import {
  PACKAGED_WIDGETS,
  propertyTypeOf,
  readContentModel,
  type ContentModel,
} from '@agentic-ui/shared/app-definition';
import { judgeMe } from '../../../scripts/beta-harness/identity-guard.mjs';
import { sameJson } from './app-walk';
import { own } from './catalogue';
import type { PlatformName } from './check-model';
import type { Conversion } from './convert';
import type { LabDocument } from './lab';
import { schemasOfType, type PackageModel } from './model';
import type { StudioPackage } from './studio-package';

export const READ_TIMEOUT_MS = 30_000;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** One answer: its status, and its body as bytes. */
export interface Answer {
  readonly status: number;
  readonly body: Buffer;
}

/** `GET`s to one origin, with the user's header when the reads are given one. */
export interface ServerReads {
  readonly origin: string;
  /** `GET <origin><path>`; `path` starts with `/`. */
  get(path: string, headers?: Readonly<Record<string, string>>): Promise<Answer>;
}

export class LabServerError extends Error {
  override readonly name = 'LabServerError';
}

export function serverReads(
  origin: string,
  authorization: string | null,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): ServerReads {
  const base = new URL(origin).origin;
  // The session the server opens on the first read, sent back on the next, so that the reads
  // sign in once rather than once each. Only this origin's, and kept for these reads alone.
  const cookies = new Map<string, string>();
  return {
    origin: base,
    async get(path, headers = {}) {
      // A path that does not start with `/` could join the origin as something else, such as
      // `@elsewhere` read as user info; and a URL that left the server would carry the header.
      const url = new URL(`${base}${path}`);
      if (!path.startsWith('/') || url.origin !== base)
        throw new LabServerError(`${path} is not a path on ${base}`);
      let response: Response;
      try {
        response = await fetchImpl(url.href, {
          method: 'GET',
          headers: {
            accept: 'application/json, text/html, */*',
            ...headers,
            ...(authorization === null ? {} : { authorization }),
            ...(cookies.size > 0
              ? { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') }
              : {}),
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        });
      } catch (error) {
        throw new LabServerError(
          `${base}${url.pathname} did not answer: ${(error as Error).message}`,
        );
      }
      for (const set of response.headers.getSetCookie()) {
        const pair = set.slice(0, set.includes(';') ? set.indexOf(';') : set.length);
        const equals = pair.indexOf('=');
        if (equals > 0) cookies.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim());
      }
      return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
    },
  };
}

function json(answer: Answer): unknown {
  try {
    return JSON.parse(answer.body.toString('utf8'));
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Who Nuxeo says the credentials are, or why it does not say they are `username`. */
export async function whoAmI(nuxeo: ServerReads, username: string): Promise<string | null> {
  const answer = await nuxeo.get('/nuxeo/api/v1/me');
  return judgeMe({ status: answer.status, body: json(answer) }, username).problem;
}

/** A document named by its id or its path, as the server answers for it, or why it does not. */
export async function resolveDocument(
  nuxeo: ServerReads,
  reference: string,
): Promise<LabDocument | string> {
  const byPath = reference.startsWith('/');
  if (!byPath && !/^[0-9A-Za-z-]+$/.test(reference))
    return `${reference} is neither a document's id nor its path, which starts with /`;
  const path = byPath
    ? `/nuxeo/api/v1/path${reference.split('/').map(encodeURIComponent).join('/')}`
    : `/nuxeo/api/v1/id/${reference}`;
  const answer = await nuxeo.get(path, { properties: 'dublincore' });
  const body = json(answer);
  if (answer.status !== 200 || !isObject(body) || body['entity-type'] !== 'document')
    return `${reference}: the server answered ${answer.status} for it, not with a document`;
  const text = (key: string): string =>
    typeof body[key] === 'string' ? (body[key] as string) : '';
  return { uid: text('uid'), path: text('path'), type: text('type'), title: text('title') };
}

/** The platform's model, as `/config/types`, `/config/facets` and `/config/schemas` give it. */
export async function serverModel(nuxeo: ServerReads): Promise<ContentModel | string> {
  const [types, facets, schemas] = await Promise.all(
    ['types', 'facets', 'schemas'].map((part) => nuxeo.get(`/nuxeo/api/v1/config/${part}`)),
  );
  for (const [part, answer] of [
    ['types', types],
    ['facets', facets],
    ['schemas', schemas],
  ] as const)
    if (answer.status !== 200) return `/config/${part} answered ${answer.status}`;
  const typesBody = json(types);
  const reading = readContentModel({
    doctypes: isObject(typesBody) ? typesBody['doctypes'] : undefined,
    facets: json(facets),
    schemas: json(schemas),
  });
  return reading.model ?? `the server's model cannot be read: ${reading.problems.join('; ')}`;
}

/**
 * Check 3's server half: each name the conversion rests on the platform for, held to the server's
 * model. A property must be a field of a schema the server has under its prefix, of a type the
 * widget shows, and, on a layout of a type, of one of the type's schemas or of a facet's; a type,
 * a vocabulary and a page provider must exist; a task's variable must be a field of its step's or
 * its workflow's variables schema.
 */
export async function confirmPlatform(
  nuxeo: ServerReads,
  names: readonly PlatformName[],
  packageModel: PackageModel,
): Promise<string[]> {
  const model = await serverModel(nuxeo);
  if (typeof model === 'string') return [`the platform's model could not be read: ${model}`];
  const findings: string[] = [];
  const byPrefix = new Map([...model.schemas.values()].map((schema) => [schema.prefix, schema]));
  const facetSchemas = new Set([...model.facets.values()].flatMap((facet) => facet.schemas));

  /** A type's schemas: the package's own and its platform ancestor's, or the server's. */
  const schemasOf = (type: string): Set<string> | null => {
    const fromPackage = schemasOfType(packageModel, type);
    let ancestor: string | null = type;
    const seen = new Set<string>();
    while (ancestor !== null && packageModel.types.has(ancestor) && !seen.has(ancestor)) {
      seen.add(ancestor);
      ancestor = packageModel.types.get(ancestor)?.extends ?? null;
    }
    const platform = ancestor === null ? undefined : model.types.get(ancestor);
    if (fromPackage === null && platform === undefined) return null;
    return new Set([...(fromPackage ?? []), ...(platform?.schemas ?? [])]);
  };
  const widgetShows = (widget: string | null, type: string): boolean => {
    if (widget === null) return true;
    const definition = own(PACKAGED_WIDGETS, widget);
    return !definition || (definition.accepts as readonly string[]).includes(type);
  };

  for (const name of names) {
    switch (name.kind) {
      case 'property': {
        const colon = name.xpath.indexOf(':');
        const schema = byPrefix.get(name.xpath.slice(0, colon));
        const field = name.xpath.slice(colon + 1);
        const property = schema?.properties.get(field);
        if (!schema) {
          findings.push(
            `${name.where}: the server has no schema of the prefix ${name.xpath.slice(0, colon)}, so ${name.xpath} does not exist`,
          );
          break;
        }
        if (!property) {
          findings.push(
            `${name.where}: the server's schema ${schema.name} has no field ${field}, so ${name.xpath} does not exist`,
          );
          break;
        }
        const type = propertyTypeOf(property);
        if (!widgetShows(name.widget, type))
          findings.push(
            `${name.where}: the ${name.widget} widget does not show ${name.xpath}, which is a ${type} on the server`,
          );
        if (name.type !== null) {
          const schemas = schemasOf(name.type);
          if (schemas !== null && !schemas.has(schema.name) && !facetSchemas.has(schema.name))
            findings.push(
              `${name.where}: the type ${name.type} has no ${schema.name} schema on the server, so it has no ${name.xpath}`,
            );
        }
        break;
      }
      case 'type':
        if (!model.types.has(name.name)) findings.push(`the server has no type ${name.name}`);
        break;
      case 'variable': {
        const variable = name.xpath.slice('var:'.length);
        const holder = [`var_${name.step}`, `var_${name.workflow}`]
          .map((schema) => model.schemas.get(schema))
          .find((schema) => schema?.properties.has(variable));
        if (!holder)
          findings.push(
            `${name.where}: neither var_${name.step} nor var_${name.workflow} on the server has a variable ${variable}, so ${name.xpath} does not exist`,
          );
        else {
          const property = holder.properties.get(variable);
          const type = property ? propertyTypeOf(property) : '';
          if (property && !widgetShows(name.widget, type))
            findings.push(
              `${name.where}: the ${name.widget} widget does not show ${name.xpath}, which is a ${type} on the server`,
            );
        }
        break;
      }
      case 'vocabulary': {
        const answer = await nuxeo.get(
          `/nuxeo/api/v1/directory/${encodeURIComponent(name.name)}?pageSize=1`,
        );
        if (answer.status === 404) findings.push(`the server has no vocabulary ${name.name}`);
        else if (answer.status !== 200)
          findings.push(
            `the vocabulary ${name.name} could not be confirmed: the server answered ${answer.status}`,
          );
        break;
      }
      case 'page provider': {
        // The definition, never a page of results: an unknown name is answered `null`.
        const answer = await nuxeo.get(`/nuxeo/api/v1/search/pp/${encodeURIComponent(name.name)}`);
        const body = json(answer);
        if (answer.status !== 200)
          findings.push(
            `the page provider ${name.name} could not be confirmed: the server answered ${answer.status}`,
          );
        else if (!isObject(body) || body['name'] !== name.name)
          findings.push(`the server has no page provider ${name.name}`);
        break;
      }
    }
  }
  return [...new Set(findings)];
}

/** How many of a set of files a server serves as they are given. */
export interface Served {
  readonly total: number;
  readonly same: number;
  /** The first few that are not, with what was answered. */
  readonly examples: readonly string[];
}

/**
 * Whether Web UI serves the Studio package's own files: each of its bundle's files under
 * `web/nuxeo.war/ui/`, read from `/nuxeo/ui/` and compared byte for byte. Only then does Web UI run
 * the package, which the server halves of checks 5, 6 and 7 hold the conversion to.
 */
export async function servedPackage(
  nuxeo: ServerReads,
  webUi: string,
  pkg: StudioPackage,
): Promise<Served> {
  const root = new URL(webUi).pathname.replace(/\/?$/, '/');
  const files = [...pkg.bundleFiles].filter(([path]) => path.startsWith('web/nuxeo.war/ui/'));
  let same = 0;
  const examples: string[] = [];
  for (const [path, bytes] of files) {
    const served = `${root}${path.slice('web/nuxeo.war/ui/'.length)}`;
    const answer = await nuxeo.get(served);
    if (answer.status === 200 && answer.body.equals(bytes)) same++;
    else if (examples.length < 3)
      examples.push(
        `${served} ${answer.status === 200 ? 'answers other bytes' : `answers ${answer.status}`}`,
      );
  }
  return { total: files.length, same, examples };
}

/**
 * Whether the new app is served the conversion's layout files: each `app/layouts/<Type>/<mode>`
 * read where `npm run config:dev` serves it, `<app>agentic-ui-config/layouts/…`, and compared as
 * JSON.
 */
export async function servedConversion(
  app: ServerReads,
  appUrl: string,
  conversion: Conversion,
): Promise<Served> {
  const root = new URL(appUrl).pathname.replace(/\/?$/, '/');
  const layouts = Object.entries(conversion.app).filter(([path]) =>
    /^layouts\/[^/]+\/[^/]+\.layout\.json$/.test(path),
  );
  let same = 0;
  const examples: string[] = [];
  for (const [path, content] of layouts) {
    const served = `${root}agentic-ui-config/${path.split('/').map(encodeURIComponent).join('/')}`;
    const answer = await app.get(served);
    // Served in an envelope, as the configuration servlet serves it (`lab.ts`, `appLayouts`).
    const body = json(answer);
    const file = isObject(body) && body['layer'] === 'layout' ? body['content'] : body;
    if (answer.status === 200 && sameJson(file, content)) same++;
    else if (examples.length < 3)
      examples.push(
        `${served} ${answer.status === 200 ? 'answers another file' : `answers ${answer.status}`}`,
      );
  }
  return { total: layouts.length, same, examples };
}
