/**
 * The one way this server talks to Nuxeo: `GET` requests under `<origin>/nuxeo/api/v1/`, as the
 * configured user, and nothing else.
 *
 * - **Read only.** There is no method but `GET`, so no tool can write to the server, run an
 *   Automation operation or start a workflow, however it is asked.
 * - **One server.** Every URL is built from the configured origin and checked against it, and a
 *   redirect is never followed: whoever answers at its destination is not the configured server,
 *   and would be sent nothing more.
 * - **As the configured user.** Before a reader's first read, Nuxeo is asked who the requests run
 *   as (`/me`), and the answer is judged by the harness's identity guard: a server with anonymous
 *   authentication answers a request whose credentials it did not accept `200` as `Anonymous`,
 *   and a model read as the guest is a smaller model that looks complete. The server makes a
 *   reader for each tool call, so each call is checked: a password changed or an account locked
 *   since the last one is found. Node's `fetch` keeps no cookies, so the reads of a call carry
 *   the same header its check was made with.
 * - **Bounded.** A read that takes more than {@link READ_TIMEOUT_MS} or answers more than
 *   {@link MAX_RESPONSE_BYTES} is abandoned with the reason.
 *
 * The password is only ever in the `Authorization` header. No message here includes it.
 */
import { judgeMe } from '../../../scripts/beta-harness/identity-guard.mjs';
import type { NuxeoTarget } from './config.ts';

export const API_PATH = '/nuxeo/api/v1';
export const READ_TIMEOUT_MS = 30_000;
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** A read that did not give an answer, with what Nuxeo said when it said something. */
export class NuxeoError extends Error {
  /** The HTTP status, or `null` when nothing answered or the answer was refused here. */
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'NuxeoError';
    this.status = status;
  }
}

export interface ReadOptions {
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  /** Nuxeo's `properties` header: the schemas a document comes back with. */
  readonly properties?: string;
}

/** The reads every tool makes, so that a test can answer them from recordings. */
export interface NuxeoReads {
  readonly origin: string;
  get(path: string, options?: ReadOptions): Promise<unknown>;
}

export class NuxeoReader implements NuxeoReads {
  readonly origin: string;
  readonly #authorization: string;
  readonly #username: string;
  readonly #fetch: Fetch;
  #identity: Promise<void> | null = null;

  constructor(target: NuxeoTarget, fetchImpl: Fetch = (url, init) => fetch(url, init)) {
    this.origin = target.origin;
    this.#username = target.username;
    this.#authorization = `Basic ${Buffer.from(`${target.username}:${target.password}`).toString('base64')}`;
    this.#fetch = fetchImpl;
  }

  /** `GET /nuxeo/api/v1<path>` as JSON, once Nuxeo has said it answers as the configured user. */
  async get(path: string, options: ReadOptions = {}): Promise<unknown> {
    await this.#verified();
    return this.#read(path, options);
  }

  /** Checked once; a failed check is not remembered, so the next read asks again. */
  #verified(): Promise<void> {
    this.#identity ??= this.#checkIdentity().catch((error: unknown) => {
      this.#identity = null;
      throw error;
    });
    return this.#identity;
  }

  async #checkIdentity(): Promise<void> {
    let answer: { status: number; body: unknown; error?: string };
    try {
      answer = { status: 200, body: await this.#read('/me', {}) };
    } catch (error) {
      if (!(error instanceof NuxeoError)) throw error;
      answer = { status: error.status ?? 0, body: null, error: error.message };
    }
    const { problem } = judgeMe(answer, this.#username);
    if (problem)
      throw new NuxeoError(
        `Nothing was read from ${this.origin}: ${problem}. Check NUXEO_USER and NUXEO_PASS.`,
        null,
      );
  }

  async #read(path: string, options: ReadOptions): Promise<unknown> {
    const url = new URL(`${this.origin}${API_PATH}${path}`);
    // `path` is built here from `segment()`s, so this holds by construction; it is checked anyway,
    // because a URL that left the configured server would carry the password with it.
    if (url.origin !== this.origin || !url.pathname.startsWith(`${API_PATH}/`))
      throw new NuxeoError(`${path} is not a path on ${this.origin}${API_PATH}`, null);
    for (const [key, value] of Object.entries(options.query ?? {}))
      if (value !== undefined) url.searchParams.set(key, String(value));
    const shown = `${url.pathname}${url.search}`;
    const headers: Record<string, string> = {
      authorization: this.#authorization,
      accept: 'application/json',
    };
    if (options.properties !== undefined) headers['properties'] = options.properties;

    let response: Response;
    try {
      response = await this.#fetch(url.href, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
    } catch (error) {
      throw new NuxeoError(
        `${shown} could not be read from ${this.origin}: ${reason(error)}`,
        null,
      );
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      const location = response.headers.get('location');
      throw new NuxeoError(
        `${shown} answered ${response.status}, a redirect${location ? ` to ${location}` : ''},` +
          ' which is not followed: only the configured server is read',
        response.status,
      );
    }
    const text = await readText(response, shown);
    if (!response.ok)
      throw new NuxeoError(
        `${shown} answered ${response.status}${nuxeoMessage(text)}`,
        response.status,
      );
    try {
      return JSON.parse(text);
    } catch {
      throw new NuxeoError(`${shown} answered ${response.status} with something not JSON`, null);
    }
  }
}

/**
 * One path segment, encoded. `.` and `..` are refused rather than encoded: a URL parser treats
 * them, and their percent-encoded spellings, as moves up the path.
 */
export function segment(value: string): string {
  if (value === '' || value === '.' || value === '..')
    throw new NuxeoError(`"${value}" is not a name Nuxeo can be asked for`, null);
  return encodeURIComponent(value);
}

async function readText(response: Response, shown: string): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  const tooLarge = () =>
    new NuxeoError(
      `${shown} answered more than ${MAX_RESPONSE_BYTES} bytes; nothing was read`,
      null,
    );
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof NuxeoError) throw error;
    throw new NuxeoError(`${shown}: the answer could not be read: ${reason(error)}`, null);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Nuxeo's own explanation, from its JSON error body, when it gave one. */
function nuxeoMessage(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string')
      return `: ${body.message}`;
  } catch {
    // Not JSON: the status is the whole answer.
  }
  return '';
}

/** `fetch failed` says little; its cause says "connection refused", often only as a code. */
function reason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (!(cause instanceof Error)) return error.message;
  const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : '';
  const detail = [code, cause.message].filter(Boolean).join(' ') || cause.name;
  return `${error.message} (${detail})`;
}
