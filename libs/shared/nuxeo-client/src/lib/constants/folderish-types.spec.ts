import { FOLDERISH_TYPES } from './folderish-types';

/**
 * The dashboard and search open a result by type: a type in this set opens in browse at its
 * path, anything else opens its record page. A wrong entry either way sends a click to a page
 * that cannot show the document.
 */
describe('FOLDERISH_TYPES', () => {
  it.each([
    'Domain',
    'Folder',
    'OrderedFolder',
    'Workspace',
    'WorkspaceRoot',
    'SectionRoot',
    'Section',
    'TemplateRoot',
  ])('opens a %s in browse, as a container', (type) => {
    expect(FOLDERISH_TYPES.has(type)).toBe(true);
  });

  it.each(['File', 'Note', 'Picture', 'Video', 'Audio'])(
    'opens a %s on its record page, as a document',
    (type) => {
      expect(FOLDERISH_TYPES.has(type)).toBe(false);
    },
  );

  it('leaves a Collection out: it opens on the collections page, which callers check first', () => {
    expect(FOLDERISH_TYPES.has('Collection')).toBe(false);
  });

  it('matches a type name exactly, as Nuxeo spells it', () => {
    expect(FOLDERISH_TYPES.has('folder')).toBe(false);
    expect(FOLDERISH_TYPES.has('Folder ')).toBe(false);
  });

  it('holds exactly the eight container types', () => {
    expect(FOLDERISH_TYPES.size).toBe(8);
  });
});
