import { labelLanguagesOf, readAppRegistry, type RegistryApp } from './app-registry-file';

const appJson = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 2,
  id,
  label: 'Claims',
  labelKey: 'payers.app.claims',
  packageVersion: '0.2.0',
  platform: '>=0.2.0 <1.0.0',
  groups: ['claims-adjusters'],
  ...extra,
});

/** An app.json named by its key alone. */
const withoutLabel = (app: Record<string, unknown>): Record<string, unknown> => {
  const { label: _label, ...rest } = app;
  return rest;
};

const entry = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  url: `apps/${id}/`,
  component: 'nuxeo.config.payers-claims-demo',
  bundle: 'nuxeo.config.payers-claims-demo',
  source: 'agentic-ui-config/app.json',
  files: ['app.json', 'home.json', 'labels/en.json'],
  content: appJson(id),
  ...extra,
});

const listing = (apps: unknown[], diagnostics: unknown[] = []): Record<string, unknown> => ({
  format: 'nuxeo-agentic-ui-config/1',
  layer: 'apps',
  apps,
  diagnostics,
});

describe('readAppRegistry', () => {
  it('reads each app the registry lists, in its order, with its name and files', () => {
    const read = readAppRegistry(
      listing([
        entry('payers-claims'),
        entry('staff-directory', { content: withoutLabel(appJson('staff-directory')) }),
      ]),
    );

    expect('invalid' in read).toBe(false);
    if ('invalid' in read) return;
    expect(read.apps.map((app) => app.id)).toEqual(['payers-claims', 'staff-directory']);
    expect(read.apps[0]).toEqual({
      id: 'payers-claims',
      label: 'Claims',
      labelKey: 'payers.app.claims',
      url: 'apps/payers-claims/',
      files: ['app.json', 'home.json', 'labels/en.json'],
      content: appJson('payers-claims'),
    });
    expect(read.apps[1]?.label).toBeNull();
    expect(read.refused).toEqual([]);
  });

  it.each([
    ['null', null],
    ['a list', []],
    ['another format', { ...listing([]), format: 'nuxeo-agentic-ui-config/2' }],
    ['another layer', { ...listing([]), layer: 'layouts' }],
    ['no apps', { format: 'nuxeo-agentic-ui-config/1', layer: 'apps' }],
  ])('is not the listing when the body is %s', (_, raw) => {
    expect('invalid' in readAppRegistry(raw)).toBe(true);
  });

  /** app-definition-v2.md, section 12: any finding in app.json refuses the app, unknown keys too. */
  it.each([
    ['no id', { ...entry('x'), id: undefined }, 'it has no id'],
    ['an id that is not one', entry('Payers'), 'it has no id'],
    [
      'another address',
      entry('payers-claims', { url: 'apps/other/' }),
      'not listed as the registry',
    ],
    ['files that are not paths', entry('payers-claims', { files: ['home.json', 3] }), 'not listed'],
    ['no app.json', entry('payers-claims', { content: null }), 'not listed'],
    [
      'another app’s app.json',
      entry('payers-claims', { content: appJson('cases') }),
      'another app',
    ],
    [
      'an unknown key',
      entry('payers-claims', { content: appJson('payers-claims', { colour: 'red' }) }),
      'colour',
    ],
    [
      'no groups',
      entry('payers-claims', { content: appJson('payers-claims', { groups: [] }) }),
      'groups',
    ],
    [
      'no name',
      entry('payers-claims', {
        content: (({ labelKey: _key, ...rest }) => rest)(withoutLabel(appJson('payers-claims'))),
      }),
      'needs a "label" or a "labelKey"',
    ],
    [
      'a version other than 2',
      entry('payers-claims', { content: appJson('payers-claims', { version: 1 }) }),
      'version',
    ],
  ])('refuses an app with %s, and lists the others', (_, refused, reason) => {
    const read = readAppRegistry(listing([refused, entry('staff-directory')]));

    if ('invalid' in read) throw new Error(read.invalid);
    expect(read.apps.map((app) => app.id)).toEqual(['staff-directory']);
    expect(read.refused).toHaveLength(1);
    expect(read.refused[0]).toContain(reason);
  });

  it('refuses an app listed twice, keeping the first', () => {
    const read = readAppRegistry(
      listing([entry('payers-claims'), entry('payers-claims', { files: ['app.json'] })]),
    );

    if ('invalid' in read) throw new Error(read.invalid);
    expect(read.apps).toHaveLength(1);
    expect(read.apps[0]?.files).toContain('home.json');
    expect(read.refused).toEqual(['the app "payers-claims": it is listed twice']);
  });

  it('refuses an app whose platform range leaves out the version it is given', () => {
    const read = readAppRegistry(listing([entry('payers-claims')]), '1.0.0');

    if ('invalid' in read) throw new Error(read.invalid);
    expect(read.apps).toEqual([]);
    expect(read.refused[0]).toContain('platform');
  });

  it('reads the diagnostics, with the app each is about, and skips what is not one', () => {
    const read = readAppRegistry(
      listing(
        [],
        [
          {
            level: 'error',
            code: 'unreadable',
            message: 'gone',
            app: 'payers-claims',
            source: 'agentic-ui-config/queues/gone.json',
          },
          { level: 'warning', code: 'invalid-contribution', message: 'no id' },
          { code: 'x' },
          'not one',
        ],
      ),
    );

    if ('invalid' in read) throw new Error(read.invalid);
    expect(read.diagnostics).toEqual([
      {
        level: 'error',
        code: 'unreadable',
        message: 'gone',
        app: 'payers-claims',
        source: 'agentic-ui-config/queues/gone.json',
      },
      { level: 'warning', code: 'invalid-contribution', message: 'no id', app: null, source: '' },
    ]);
  });
});

describe('labelLanguagesOf', () => {
  it('lists the languages of the labels files the registry serves for the app', () => {
    const app = {
      files: ['app.json', 'labels/en.json', 'labels/pt-BR.json', 'queues/labels.json'],
    } as unknown as RegistryApp;

    expect(labelLanguagesOf(app)).toEqual(['en', 'pt-BR']);
    expect(labelLanguagesOf(null)).toEqual([]);
  });
});
