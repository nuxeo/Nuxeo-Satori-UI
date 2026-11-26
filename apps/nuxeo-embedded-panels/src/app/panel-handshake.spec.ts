import {
  MAX_TOKEN_LENGTH,
  TOKEN,
  isJwtShaped,
  messageTargets,
  originsOf,
  tokenFromMessage,
} from './panel-handshake';

const TOKEN_VALUE = 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJqc21pdGgifQ.c2lnbmF0dXJl';
const PAGE = { name: 'page' };
const PARENT = { name: 'parent' };
const FRAME = { name: 'an iframe the page shows' };

const expected = {
  panel: 'p-1',
  origins: new Set(['https://crm.example.com']),
  sources: [PAGE, PARENT] as readonly unknown[],
};

const message = (overrides: Partial<{ origin: string; source: unknown; data: unknown }> = {}) => ({
  origin: 'https://crm.example.com',
  source: PAGE,
  data: { type: TOKEN, panel: 'p-1', token: TOKEN_VALUE },
  ...overrides,
});

describe('the handshake: a token only from the host page, for this panel', () => {
  it('takes a token from the page, or its parent, on one of the host origins', () => {
    expect(tokenFromMessage(message(), expected)).toBe(TOKEN_VALUE);
    expect(tokenFromMessage(message({ source: PARENT }), expected)).toBe(TOKEN_VALUE);
  });

  it('refuses a message from an origin the configuration does not name', () => {
    for (const origin of ['https://elsewhere.example', 'http://crm.example.com', 'null', '']) {
      expect(tokenFromMessage(message({ origin }), expected), origin).toBeNull();
    }
  });

  it('refuses a message from any other window, such as a frame the page shows', () => {
    expect(tokenFromMessage(message({ source: FRAME }), expected)).toBeNull();
    expect(tokenFromMessage(message({ source: null }), expected)).toBeNull();
  });

  it('refuses a message for another panel, of another type, or that holds no token', () => {
    for (const data of [
      { type: TOKEN, panel: 'p-2', token: TOKEN_VALUE },
      { type: 'nuxeo-record-panel:ready', panel: 'p-1', token: TOKEN_VALUE },
      { type: TOKEN, panel: 'p-1' },
      { type: TOKEN, panel: 'p-1', token: 'not a token' },
      { type: TOKEN, panel: 'p-1', token: `${TOKEN_VALUE}.extra` },
      [TOKEN, 'p-1', TOKEN_VALUE],
      TOKEN_VALUE,
      null,
    ]) {
      expect(tokenFromMessage(message({ data }), expected)).toBeNull();
    }
  });

  it('refuses a token longer than any the server issues', () => {
    const long = `a.${'b'.repeat(MAX_TOKEN_LENGTH)}.c`;
    expect(isJwtShaped(long)).toBe(false);
    expect(isJwtShaped(TOKEN_VALUE)).toBe(true);
  });
});

describe('where the panel posts', () => {
  it('posts to its own page at its own origin, and to a parent only at the host origins', () => {
    const own = { location: { origin: 'https://crm.example.com' } } as unknown as Window;
    (own as unknown as { parent: Window }).parent = own;
    expect(messageTargets(own, expected.origins)).toEqual([
      { target: own, origin: 'https://crm.example.com' },
    ]);

    const parent = {} as Window;
    const framed = {
      location: { origin: 'https://crm.example.com' },
      parent,
    } as unknown as Window;
    expect(
      messageTargets(framed, new Set(['https://crm.example.com', 'https://shell.example.com'])),
    ).toEqual([
      { target: framed, origin: 'https://crm.example.com' },
      { target: parent, origin: 'https://crm.example.com' },
      { target: parent, origin: 'https://shell.example.com' },
    ]);
  });
});

describe('the host origins, as the server answers them', () => {
  it('reads them for the host asked about only', () => {
    expect(originsOf({ host: 'crm', origins: ['https://crm.example.com'] }, 'crm')).toEqual(
      new Set(['https://crm.example.com']),
    );
    expect(originsOf({ host: 'erp', origins: ['https://crm.example.com'] }, 'crm')).toBeNull();
    expect(originsOf({ host: 'crm', origins: [] }, 'crm')).toBeNull();
    expect(originsOf({ host: 'crm', origins: ['javascript:alert(1)', '*'] }, 'crm')).toBeNull();
    expect(originsOf(null, 'crm')).toBeNull();
  });
});
