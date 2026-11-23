import { describe, expect, it } from 'vitest';
import { DEFAULT_DEV_SERVER_URL, DEFAULT_NUXEO_URL, readDevServer, readTarget } from './config.ts';

const CREDENTIALS = { NUXEO_USER: 'builder', NUXEO_PASS: 'not-a-real-password' };

describe('readTarget', () => {
  it('reads the server and the account from the environment', () => {
    expect(readTarget({ NUXEO_URL: 'https://nuxeo.example.com', ...CREDENTIALS })).toEqual({
      target: {
        origin: 'https://nuxeo.example.com',
        ...{ username: 'builder', password: 'not-a-real-password' },
      },
    });
  });

  it('defaults the server, never the account', () => {
    expect(readTarget(CREDENTIALS)).toEqual({
      target: { origin: DEFAULT_NUXEO_URL, username: 'builder', password: 'not-a-real-password' },
    });
    const without = readTarget({});
    expect('problem' in without && without.problem).toContain('not set: NUXEO_USER, NUXEO_PASS');
  });

  it('counts an empty value as unset, and names only what is missing', () => {
    const result = readTarget({ NUXEO_USER: 'builder', NUXEO_PASS: '' });
    expect('problem' in result && result.problem).toContain('(not set: NUXEO_PASS)');
  });

  it('never repeats a value it was given', () => {
    for (const env of [
      { NUXEO_USER: 'builder', NUXEO_PASS: '' },
      { NUXEO_URL: 'http://nuxeo.example.com', ...CREDENTIALS },
      { NUXEO_URL: 'https://builder:not-a-real-password@nuxeo.example.com', ...CREDENTIALS },
    ]) {
      const result = readTarget(env);
      expect('problem' in result).toBe(true);
      expect(JSON.stringify(result)).not.toContain('not-a-real-password');
    }
  });

  it('refuses plain http to another machine, where Basic authentication travels in clear', () => {
    const result = readTarget({ NUXEO_URL: 'http://nuxeo.example.com', ...CREDENTIALS });
    expect('problem' in result && result.problem).toContain('clear text');
    for (const local of ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080'])
      expect(readTarget({ NUXEO_URL: local, ...CREDENTIALS })).toHaveProperty('target');
    // A name that merely ends in .localhost is the resolver's to place, so it is not trusted.
    expect(readTarget({ NUXEO_URL: 'http://nuxeo.localhost', ...CREDENTIALS })).toHaveProperty(
      'problem',
    );
  });

  it('refuses a URL with a path, a query, credentials or another scheme', () => {
    for (const url of [
      'http://localhost:8080/nuxeo',
      'http://localhost:8080/?a=b',
      'http://localhost:8080/#x',
      'https://user:pass@nuxeo.example.com',
      'ftp://nuxeo.example.com',
      'not a url',
    ])
      expect(readTarget({ NUXEO_URL: url, ...CREDENTIALS }), url).toHaveProperty('problem');
    // A trailing slash is the origin still.
    expect(readTarget({ NUXEO_URL: 'http://localhost:8080/', ...CREDENTIALS })).toEqual({
      target: {
        origin: 'http://localhost:8080',
        username: 'builder',
        password: 'not-a-real-password',
      },
    });
  });
});

describe('readDevServer', () => {
  it("is nx serve's own address when unset or empty", () => {
    expect(readDevServer({})).toBe(DEFAULT_DEV_SERVER_URL);
    expect(readDevServer({ DEV_SERVER_URL: '' })).toBe(DEFAULT_DEV_SERVER_URL);
    expect(readDevServer({ DEV_SERVER_URL: 'http://127.0.0.1:4300/' })).toBe(
      'http://127.0.0.1:4300',
    );
  });

  it('refuses a server elsewhere, a path, credentials or another scheme', () => {
    for (const url of [
      'http://dev.example.com:4200',
      'https://dev.example.com',
      'http://ui.localhost:4200',
      'http://localhost:4200/app',
      'http://localhost:4200/?a=b',
      'http://user:pass@localhost:4200',
      'ftp://localhost:4200',
      'not a url',
    ])
      expect(readDevServer({ DEV_SERVER_URL: url }), url).toHaveProperty('problem');
    const elsewhere = readDevServer({ DEV_SERVER_URL: 'http://dev.example.com:4200' });
    expect(typeof elsewhere !== 'string' && elsewhere.problem).toContain('not this machine');
  });
});
