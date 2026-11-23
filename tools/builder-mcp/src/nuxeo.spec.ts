import { describe, expect, it } from 'vitest';
import { MAX_RESPONSE_BYTES, NuxeoError, NuxeoReader, segment, type Fetch } from './nuxeo.ts';

const TARGET = {
  origin: 'http://localhost:8080',
  username: 'builder',
  password: 'not-a-real-password',
};
const ME = { 'entity-type': 'user', id: 'builder', isAnonymous: false };

interface Seen {
  readonly url: string;
  readonly init: RequestInit;
}

/** A server that answers from a table, and remembers what it was asked. */
function server(answers: Record<string, () => Response>): { fetch: Fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: async (url, init) => {
      seen.push({ url, init });
      const path = new URL(url).pathname.replace('/nuxeo/api/v1', '');
      const answer = answers[path];
      if (!answer) return json({ message: `no ${path}` }, 404);
      return answer();
    },
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function refusal(promise: Promise<unknown>): Promise<NuxeoError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(NuxeoError);
  return error as NuxeoError;
}

describe('NuxeoReader', () => {
  it('asks who it runs as first, then reads with GET only, as the configured user', async () => {
    const { fetch, seen } = server({
      '/me': () => json(ME),
      '/config/types': () => json({ doctypes: {} }),
    });
    const reader = new NuxeoReader(TARGET, fetch);
    expect(
      await reader.get('/config/types', { properties: '*', query: { a: 1, b: undefined } }),
    ).toEqual({
      doctypes: {},
    });
    expect(seen.map((request) => request.url)).toEqual([
      'http://localhost:8080/nuxeo/api/v1/me',
      'http://localhost:8080/nuxeo/api/v1/config/types?a=1',
    ]);
    const expected = `Basic ${Buffer.from('builder:not-a-real-password').toString('base64')}`;
    for (const { init } of seen) {
      expect(init.method).toBe('GET');
      expect(init.redirect).toBe('manual');
      expect(init.body).toBeUndefined();
      expect((init.headers as Record<string, string>)['authorization']).toBe(expected);
    }
    expect((seen[1].init.headers as Record<string, string>)['properties']).toBe('*');
  });

  it('checks the identity once while it holds', async () => {
    const { fetch, seen } = server({
      '/me': () => json(ME),
      '/directory': () => json({ entries: [] }),
    });
    const reader = new NuxeoReader(TARGET, fetch);
    await reader.get('/directory');
    await reader.get('/directory');
    expect(seen.filter((request) => request.url.endsWith('/me'))).toHaveLength(1);
  });

  it('reads nothing when Nuxeo answers as its anonymous guest', async () => {
    const { fetch, seen } = server({
      '/me': () => json({ id: 'Anonymous', isAnonymous: true }),
      '/config/types': () => json({ doctypes: {} }),
    });
    const error = await refusal(new NuxeoReader(TARGET, fetch).get('/config/types'));
    expect(error.message).toContain('anonymous guest');
    expect(seen).toHaveLength(1);
  });

  it('reads nothing when Nuxeo answers as someone else', async () => {
    const { fetch, seen } = server({
      '/me': () => json({ id: 'someone-else', isAnonymous: false }),
    });
    const error = await refusal(new NuxeoReader(TARGET, fetch).get('/config/types'));
    expect(error.message).toContain('not as builder');
    expect(seen).toHaveLength(1);
  });

  it('asks again after a failed identity check, rather than remembering the failure', async () => {
    let up = false;
    const { fetch, seen } = server({
      '/me': () => (up ? json(ME) : json({ message: 'starting' }, 503)),
      '/directory': () => json({ entries: [] }),
    });
    const reader = new NuxeoReader(TARGET, fetch);
    expect((await refusal(reader.get('/directory'))).message).toContain('answered 503');
    up = true;
    expect(await reader.get('/directory')).toEqual({ entries: [] });
    expect(seen.filter((request) => request.url.endsWith('/me'))).toHaveLength(2);
  });

  it('does not follow a redirect, and says where it pointed', async () => {
    const { fetch, seen } = server({
      '/me': () => json(ME),
      '/automation': () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://elsewhere.example.com/' },
        }),
    });
    const error = await refusal(new NuxeoReader(TARGET, fetch).get('/automation'));
    expect(error.message).toContain('https://elsewhere.example.com/');
    expect(error.message).toContain('not followed');
    expect(seen.every((request) => request.url.startsWith('http://localhost:8080/'))).toBe(true);
  });

  it("gives Nuxeo's own message and the status when a read fails", async () => {
    const { fetch } = server({ '/me': () => json(ME) });
    const error = await refusal(new NuxeoReader(TARGET, fetch).get('/search/pp/nothing'));
    expect(error.status).toBe(404);
    expect(error.message).toBe(
      '/nuxeo/api/v1/search/pp/nothing answered 404: no /search/pp/nothing',
    );
  });

  it('refuses an answer larger than the limit, declared or streamed', async () => {
    const declared = server({
      '/me': () => json(ME),
      '/automation': () => json({}, 200, { 'content-length': String(MAX_RESPONSE_BYTES + 1) }),
    });
    expect(
      (await refusal(new NuxeoReader(TARGET, declared.fetch).get('/automation'))).message,
    ).toContain('more than');
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const streamed = server({
      '/me': () => json(ME),
      '/automation': () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              sent += chunk.byteLength;
              controller.enqueue(chunk);
              if (sent > MAX_RESPONSE_BYTES * 2) controller.close();
            },
          }),
        ),
    });
    expect(
      (await refusal(new NuxeoReader(TARGET, streamed.fetch).get('/automation'))).message,
    ).toContain('more than');
    // It stopped reading at the limit rather than taking all of it in.
    expect(sent).toBeLessThan(MAX_RESPONSE_BYTES * 2);
  });

  it('refuses an answer that is not JSON', async () => {
    const { fetch } = server({ '/me': () => json(ME), '/directory': () => new Response('<html>') });
    expect((await refusal(new NuxeoReader(TARGET, fetch).get('/directory'))).message).toContain(
      'not JSON',
    );
  });

  it('says why nothing answered, and never what the password is', async () => {
    const reader = new NuxeoReader(TARGET, async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error(''), { code: 'ECONNREFUSED' }),
      });
    });
    const error = await refusal(reader.get('/directory'));
    expect(error.message).toContain('ECONNREFUSED');
    expect(error.message).not.toContain('not-a-real-password');
    expect(error.message).not.toContain(
      Buffer.from('builder:not-a-real-password').toString('base64'),
    );
  });

  it('refuses a path that would leave the API', async () => {
    const { fetch, seen } = server({ '/me': () => json(ME) });
    const reader = new NuxeoReader(TARGET, fetch);
    await refusal(reader.get('/../../site/automation'));
    await refusal(reader.get('@elsewhere.example.com/'));
    expect(
      seen.every((request) => request.url.startsWith('http://localhost:8080/nuxeo/api/v1/')),
    ).toBe(true);
  });
});

describe('segment', () => {
  it('encodes a name as one path segment', () => {
    expect(segment('a/b?c#d')).toBe('a%2Fb%3Fc%23d');
    expect(segment('%2e%2e')).toBe('%252e%252e');
  });

  it('refuses the names a URL parser reads as moves up the path', () => {
    for (const name of ['', '.', '..']) expect(() => segment(name)).toThrow(NuxeoError);
  });
});
