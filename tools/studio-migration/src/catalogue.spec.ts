import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CATALOGUE_DIRECTORY,
  CatalogueError,
  elementEntry,
  loadCatalogue,
  mapThemeProperty,
  slotEntry,
  validate,
  type Catalogue,
} from './catalogue';

/** Every slot the Web UI on the reference server declares, read on 2026-11-22 (slots.json, "source"). */
const WEB_UI_SLOTS = [
  'ADMINISTRATION_MENU',
  'ADMINISTRATION_PAGES',
  'ANALYTICS_ITEMS',
  'ANALYTICS_PAGES',
  'BLOB_ACTIONS',
  'CREATE_POPUP_ITEMS',
  'CREATE_POPUP_PAGES',
  'DOCUMENT_ACTIONS',
  'DOCUMENT_CREATE_ACTIONS',
  'DOCUMENT_INFO_BAR',
  'DOCUMENT_VIEWS_ITEMS',
  'DOCUMENT_VIEWS_PAGES',
  'DRAWER_ITEMS',
  'DRAWER_PAGES',
  'FILE_UPLOAD_ACTIONS',
  'PAGES',
  'PUBLISH_ITEMS',
  'PUBLISH_PAGES',
  'RESULTS_ACTIONS',
  'RESULTS_SELECTION_ACTIONS',
  'THEMES',
  'TRASH_RESULTS_SELECTION_ACTIONS',
  'USER_MENU',
];

/** Material 3's system colour roles: the only tokens a theme property may set. */
const MATERIAL_COLOUR_ROLES = new Set(
  [
    'primary',
    'on-primary',
    'primary-container',
    'on-primary-container',
    'inverse-primary',
    'secondary',
    'on-secondary',
    'secondary-container',
    'on-secondary-container',
    'tertiary',
    'on-tertiary',
    'tertiary-container',
    'on-tertiary-container',
    'error',
    'on-error',
    'error-container',
    'on-error-container',
    'surface',
    'on-surface',
    'surface-variant',
    'on-surface-variant',
    'surface-dim',
    'surface-bright',
    'surface-container-lowest',
    'surface-container-low',
    'surface-container',
    'surface-container-high',
    'surface-container-highest',
    'inverse-surface',
    'inverse-on-surface',
    'outline',
    'outline-variant',
    'shadow',
    'scrim',
  ].map((role) => `--mat-sys-${role}`),
);

describe('the catalogue', () => {
  const catalogue = loadCatalogue();

  it('loads, and is sound', () => {
    expect(validate(catalogue)).toEqual([]);
  });

  it('places every slot Web UI declares, and COLLECTION_ACTIONS, which it only contributes to', () => {
    expect(Object.keys(catalogue.slots).sort()).toEqual(
      [...WEB_UI_SLOTS, 'COLLECTION_ACTIONS'].sort(),
    );
  });

  it('knows exactly the app slots the extension reference lists', () => {
    const reference = readFileSync(join(__dirname, '../../../docs/extension-reference.md'), 'utf8');
    const section = reference.slice(
      reference.indexOf('## 2. Slots'),
      reference.indexOf('### Slots are additive'),
    );
    const listed = [...section.matchAll(/^\| `([A-Za-z-]+)` +\|/gm)].map((match) => match[1]);
    expect(listed.length).toBeGreaterThan(0);
    expect([...catalogue.appSlots].sort()).toEqual(listed.sort());
  });

  it('maps theme properties only to Material colour roles', () => {
    for (const token of Object.values(catalogue.tokens))
      expect(MATERIAL_COLOUR_ROLES).toContain(token);
  });

  describe('mapThemeProperty', () => {
    it('maps a property the map names', () => {
      expect(mapThemeProperty(catalogue, '--nuxeo-primary-color')).toEqual({
        property: '--nuxeo-primary-color',
        token: '--mat-sys-primary',
      });
    });

    it('reports an exact name with its own reason, and a longer name by its family', () => {
      const exact = mapThemeProperty(catalogue, '--nuxeo-button-primary');
      const longer = mapThemeProperty(catalogue, '--nuxeo-button-primary-focu');
      expect(exact).toMatchObject({
        token: null,
        reason: catalogue.reportedProperties['--nuxeo-button-primary'],
      });
      expect(longer).toMatchObject({
        token: null,
        reason: catalogue.reportedProperties['--nuxeo-'],
      });
    });

    it('reports by the nearest family, and anything else by the catch-all', () => {
      expect(mapThemeProperty(catalogue, '--paper-checkbox-unchecked-ink-color')).toMatchObject({
        reason: catalogue.reportedProperties['--paper-'],
      });
      expect(mapThemeProperty(catalogue, '--primary-text-color')).toMatchObject({
        reason: catalogue.reportedProperties['--'],
      });
    });
  });

  // Negative controls: each edit below breaks the catalogue in one way, and each must be caught.
  describe('validate catches', () => {
    const broken = (edit: (copy: Catalogue) => Catalogue): string[] =>
      validate(edit(JSON.parse(JSON.stringify(catalogue)) as Catalogue));

    it('a slot sent to a slot the app does not have', () => {
      expect(
        broken((c) => ({
          ...c,
          slots: { ...c.slots, USER_MENU: { what: 'x', how: 'automatic', slot: 'userMenu' } },
        })),
      ).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/USER_MENU goes to "userMenu", which is not an app slot/),
        ]),
      );
    });

    it('a reported slot that names a target, and a mapped one that names none', () => {
      const problems = broken((c) => ({
        ...c,
        slots: {
          ...c.slots,
          USER_MENU: { what: 'x', how: 'reported', slot: 'navbar' },
          DRAWER_ITEMS: { what: 'x', how: 'automatic' },
        },
      }));
      expect(problems).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/USER_MENU is reported, so it may not name a target/),
          expect.stringMatching(/DRAWER_ITEMS must name exactly one target/),
        ]),
      );
    });

    it('an element with an unknown role or how', () => {
      const problems = broken((c) => ({
        ...c,
        elements: {
          ...c.elements,
          'nuxeo-input': { role: 'widget' as never, how: 'maybe' as never, becomes: 'x' },
        },
      }));
      expect(problems).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/role "widget"/),
          expect.stringMatching(/how "maybe"/),
        ]),
      );
    });

    it('a token that is not a Material system token, and a property both mapped and reported', () => {
      const problems = broken((c) => ({
        ...c,
        tokens: {
          ...c.tokens,
          '--nuxeo-primary-color': '#0066ff',
          '--nuxeo-app-font': '--mat-sys-primary',
        },
      }));
      expect(problems).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/maps to "#0066ff", which is not a --mat-sys-\* token/),
          expect.stringMatching(/--nuxeo-app-font is both mapped and reported/),
        ]),
      );
    });

    it('a reported list with no catch-all, which would leave a property with no reason', () => {
      const problems = broken((c) => {
        const { '--': _dropped, ...rest } = c.reportedProperties;
        return { ...c, reportedProperties: rest };
      });
      expect(problems).toEqual(
        expect.arrayContaining([expect.stringMatching(/needs a "--" entry/)]),
      );
    });

    it('two properties setting the same token', () => {
      const problems = broken((c) => ({
        ...c,
        tokens: { ...c.tokens, '--nuxeo-link-color': '--mat-sys-primary' },
      }));
      expect(problems).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /--nuxeo-primary-color and --nuxeo-link-color both set --mat-sys-primary/,
          ),
        ]),
      );
    });

    it('a script with no shape, and one listed twice', () => {
      const problems = broken((c) => ({
        ...c,
        scripts: [
          ...c.scripts,
          { name: 'no shape', sha256: 'abc', seen: 'x' },
          { ...c.scripts[0], name: 'again' },
        ],
      }));
      expect(problems).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/no shape has no SHA-256/),
          expect.stringMatching(/the shape of again is listed twice/),
        ]),
      );
    });
  });

  it('finds nothing on the prototype for a name a package chose', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(slotEntry(catalogue, name)).toBeNull();
      expect(elementEntry(catalogue, name)).toBeNull();
    }
    expect(mapThemeProperty(catalogue, 'constructor')).toMatchObject({
      token: null,
      reason: catalogue.reportedProperties['--'],
    });
  });

  it('refuses to load a broken catalogue, naming what is wrong', () => {
    const directory = mkdtempSync(join(tmpdir(), 'studio-catalogue-'));
    for (const name of ['slots.json', 'elements.json', 'theme-tokens.json', 'scripts.json']) {
      writeFileSync(join(directory, name), readFileSync(join(CATALOGUE_DIRECTORY, name)));
    }
    const slots = JSON.parse(readFileSync(join(directory, 'slots.json'), 'utf8'));
    slots.slots.DOCUMENT_ACTIONS.slot = 'nowhere';
    writeFileSync(join(directory, 'slots.json'), JSON.stringify(slots));
    expect(() => loadCatalogue(directory)).toThrow(CatalogueError);
    expect(() => loadCatalogue(directory)).toThrow(/DOCUMENT_ACTIONS goes to "nowhere"/);
  });
});
