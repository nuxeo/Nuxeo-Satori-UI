/**
 * A Nuxeo server's content model, read live, for the package pipeline
 * (docs/business-apps/package-pipeline.md): what `app-package.mjs --model-server` holds layouts to,
 * and what `app-package-model.mjs` writes to a file for `--model`.
 *
 * The result is `{ doctypes, facets, schemas }`, which `readContentModel` in
 * `libs/shared/app-definition` reads, `NuxeoContentModel`'s shape:
 *
 * - `doctypes`, from `/api/v1/config/types`;
 * - `facets`, `/api/v1/config/facets`;
 * - `schemas`, each read on its own from `/api/v1/config/schemas/<name>` with
 *   `fetch-schema: fields`, because the list `/api/v1/config/schemas` answers leaves out every
 *   field's constraints, and with them the directory a property is bound to.
 *
 * Credentials are the caller's, from the environment (`nuxeo-credentials.mjs`), and go in an
 * `Authorization` header only: never in the address, and never over plain HTTP to another machine.
 * A redirect is refused rather than followed, so that the header goes nowhere it was not sent.
 * No message here carries them.
 */
import {
  basicAuthorization,
  NUXEO_PASS_ENV,
  NUXEO_USER_ENV,
} from './beta-harness/nuxeo-credentials.mjs';

/** How long one request may take. A model is a few hundred kilobytes. */
const TIMEOUT_MS = 30_000;
/** How many schemas are read at once: a hundred, one by one, would be slow; all at once, rude. */
const PARALLEL = 8;
/** The most one answer may hold. A whole model is well under a megabyte; one schema, kilobytes. */
const MAX_BYTES = 16 * 1024 * 1024;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The server's address, `https://<host>/nuxeo`, made into the base the endpoints are under, or
 * what is wrong with it.
 *
 * @param {string} server
 * @returns {{ base: string } | { problem: string }}
 */
export function serverBase(server) {
  let url;
  try {
    url = new URL(server);
  } catch {
    // Not echoed: an address that does not parse may still hold a password, `user:pass@host:x`.
    return { problem: 'it is not an address, such as https://<host>/nuxeo' };
  }
  if (url.username || url.password)
    return { problem: 'the address carries credentials: they come from NUXEO_USER and NUXEO_PASS' };
  if (url.search || url.hash)
    return { problem: "the address is the server's, such as https://<host>/nuxeo, with no query" };
  // Only names that are this machine wherever the command runs: `<name>.localhost` is left to
  // the resolver, which need not answer loopback.
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    return {
      problem:
        'credentials are sent over HTTPS only, or over HTTP to this machine: the address is ' +
        `${url.protocol}//${url.host}`,
    };
  return { base: `${url.origin}${url.pathname.replace(/\/+$/, '')}` };
}

/**
 * The content model `server` answers, or a thrown `Error` saying which read failed and how.
 *
 * @param {string} server the server's address, such as `http://localhost:8080/nuxeo`
 * @param {{ username: string, password: string }} credentials
 * @param {{ fetch?: typeof globalThis.fetch, maxBytes?: number }} [options] `fetch`, and the most
 *   one answer may hold, for the tests
 * @returns {Promise<{ doctypes: object, facets: unknown[], schemas: unknown[] }>}
 */
export async function readServerModel(
  server,
  credentials,
  { fetch = globalThis.fetch, maxBytes = MAX_BYTES } = {},
) {
  const where = serverBase(server);
  if (where.problem) throw new Error(where.problem);
  const headers = { Authorization: basicAuthorization(credentials), Accept: 'application/json' };
  // The first read that fails stops the others: no more requests carry the credentials once the
  // model can no longer be read whole.
  const stop = new AbortController();
  const read = async (path, extra = {}) => {
    const url = `${where.base}/api/v1/config/${path}`;
    try {
      let response;
      try {
        response = await fetch(url, {
          headers: { ...headers, ...extra },
          redirect: 'error',
          signal: AbortSignal.any([stop.signal, AbortSignal.timeout(TIMEOUT_MS)]),
        });
      } catch (error) {
        // `fetch failed` says nothing; its cause says why, by a code when it is an AggregateError.
        const cause = error.cause?.code ?? (error.cause?.message || error.message);
        throw new Error(`GET ${url} failed: ${cause}`);
      }
      if (response.status !== 200)
        throw new Error(`GET ${url} answered ${response.status}, not 200`);
      const tooLarge = () => new Error(`GET ${url} answered more than ${maxBytes} bytes`);
      if (Number(response.headers.get('content-length')) > maxBytes) {
        await response.body?.cancel();
        throw tooLarge();
      }
      // Counted in bytes as they arrive, and stopped at the cap: with no Content-Length, reading
      // the whole body first would hold all of it before the check.
      const chunks = [];
      let total = 0;
      const reader = response.body?.getReader();
      try {
        for (;;) {
          const chunk = await reader?.read();
          if (!chunk || chunk.done) break;
          total += chunk.value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw tooLarge();
          }
          chunks.push(chunk.value);
        }
      } catch (error) {
        if (total > maxBytes) throw error;
        throw new Error(`GET ${url} was not read whole: ${error.message}`);
      }
      try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        throw new Error(`GET ${url} did not answer JSON`);
      }
    } catch (error) {
      stop.abort();
      throw error;
    }
  };

  const [types, facets, list] = await Promise.all([read('types'), read('facets'), read('schemas')]);
  if (!isRecord(types) || !isRecord(types.doctypes))
    throw new Error('config/types did not answer { doctypes }');
  if (!Array.isArray(facets)) throw new Error('config/facets did not answer a list');
  if (!Array.isArray(list)) throw new Error('config/schemas did not answer a list');
  const names = list.map((schema) => (isRecord(schema) ? schema.name : undefined));
  if (!names.every((name) => typeof name === 'string' && name !== ''))
    throw new Error('config/schemas answered a schema with no name');

  const schemas = new Array(names.length);
  let next = 0;
  const worker = async () => {
    while (next < names.length && !stop.signal.aborted) {
      const index = next++;
      const schema = await read(`schemas/${encodeURIComponent(names[index])}`, {
        'fetch-schema': 'fields',
      });
      if (!isRecord(schema) || schema.name !== names[index] || !isRecord(schema.fields)) {
        stop.abort();
        throw new Error(`config/schemas/${names[index]} did not answer that schema`);
      }
      schemas[index] = schema;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, names.length) }, worker));
  return { doctypes: types.doctypes, facets, schemas };
}

/**
 * The environment without `NUXEO_USER` and `NUXEO_PASS`, for a child process that needs neither:
 * the validator and the builder read files, not servers.
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function withoutCredentials(env) {
  const rest = { ...env };
  delete rest[NUXEO_USER_ENV];
  delete rest[NUXEO_PASS_ENV];
  return rest;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
