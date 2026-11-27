import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_DEV_SERVER_URL,
  DEFAULT_NUXEO_URL,
  readDevServer,
  readPackageRoots,
  readTarget,
  serverEnvironment,
} from './config.ts';

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

describe('readPackageRoots', () => {
  const repository = mkdtempSync(join(tmpdir(), 'builder-mcp-roots-'));
  const fallback = join(repository, 'business-apps', 'packages');
  mkdirSync(fallback, { recursive: true });
  mkdirSync(join(repository, 'customer-apps'));
  afterAll(() => rmSync(repository, { recursive: true, force: true }));

  it('is business-apps/packages/ alone when unset or empty', () => {
    expect(readPackageRoots({}, repository, fallback)).toEqual([fallback]);
    expect(readPackageRoots({ BUILDER_PACKAGE_ROOTS: ' ' }, repository, fallback)).toEqual([
      fallback,
    ]);
  });

  it('replaces it with the folders it names, from the repository unless absolute', () => {
    expect(
      readPackageRoots({ BUILDER_PACKAGE_ROOTS: 'customer-apps' }, repository, fallback),
    ).toEqual([join(repository, 'customer-apps')]);
    expect(
      readPackageRoots(
        { BUILDER_PACKAGE_ROOTS: ['customer-apps', fallback].join(delimiter) },
        repository,
        fallback,
      ),
    ).toEqual([join(repository, 'customer-apps'), fallback]);
  });

  it('refuses a folder that does not exist, and one that holds the repository', () => {
    for (const [value, why] of [
      ['no-such-folder', 'is not a folder'],
      [repository, 'holds the repository'],
      [dirname(repository), 'holds the repository'],
    ]) {
      const result = readPackageRoots({ BUILDER_PACKAGE_ROOTS: value }, repository, fallback);
      expect('problem' in result && result.problem, value).toContain(why);
    }
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a folder of the repository reached through a link, which would skip its checks',
    () => {
      const elsewhere = mkdtempSync(join(tmpdir(), 'builder-mcp-roots-link-'));
      try {
        symlinkSync(repository, join(elsewhere, 'checkout'));
        const result = readPackageRoots(
          { BUILDER_PACKAGE_ROOTS: join(elsewhere, 'checkout', 'customer-apps') },
          repository,
          fallback,
        );
        expect('problem' in result && result.problem).toContain(
          'is a folder of the repository by another spelling, or through a link',
        );
      } finally {
        rmSync(elsewhere, { recursive: true, force: true });
      }
    },
  );
});

describe('serverEnvironment: what call.ts starts the server with', () => {
  it("gives the server what it reads and what Node needs, and nothing else of the shell's", () => {
    const shell = {
      ...CREDENTIALS,
      NUXEO_URL: 'http://localhost:8080',
      DEV_SERVER_URL: 'http://localhost:4200',
      BUILDER_PACKAGE_ROOTS: 'business-apps/packages',
      PATH: '/usr/bin',
      TMPDIR: '/tmp',
      LANG: 'en_US.UTF-8',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/company-ca.pem',
      // What a shell holds for other things: another service's settings, a cloud profile.
      OTHER_TOOL_SETTING: 'for another tool',
      AWS_PROFILE: 'default',
      HOME: '/home/someone',
      NODE_OPTIONS: '--require ./elsewhere.js',
      UNSET: undefined,
    };
    expect(serverEnvironment(shell)).toEqual({
      ...CREDENTIALS,
      NUXEO_URL: 'http://localhost:8080',
      DEV_SERVER_URL: 'http://localhost:4200',
      BUILDER_PACKAGE_ROOTS: 'business-apps/packages',
      PATH: '/usr/bin',
      TMPDIR: '/tmp',
      LANG: 'en_US.UTF-8',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/company-ca.pem',
    });
  });

  it('gives no credential the shell does not hold', () => {
    expect(serverEnvironment({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
  });
});
