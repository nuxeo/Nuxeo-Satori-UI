import { documentTypeTraits } from './document-type-traits';

describe('documentTypeTraits', () => {
  const defaults = {
    view: 'documentViewer',
    picture: false,
    video: false,
    preview: true,
    sectionIcon: 'folder',
  };

  it('opens a Note on the note editor, and only a Note', () => {
    expect(documentTypeTraits('Note')).toEqual({ ...defaults, view: 'noteEditor' });
  });

  it.each(['File', 'Picture', 'Video', 'Audio', 'Claim'])(
    'opens a %s on the document viewer',
    (type) => {
      expect(documentTypeTraits(type).view).toBe('documentViewer');
    },
  );

  it('marks Picture and Video for their own loading paths, and nothing else', () => {
    expect(documentTypeTraits('Picture')).toEqual({ ...defaults, picture: true });
    expect(documentTypeTraits('Video')).toEqual({ ...defaults, video: true });
    expect(documentTypeTraits('File')).toEqual(defaults);
  });

  it.each(['Collection', 'Folder', 'Workspace', 'Domain', 'Section', 'OrderedFolder'])(
    'asks for no preview of a %s',
    (type) => {
      expect(documentTypeTraits(type)).toEqual({ ...defaults, preview: false });
    },
  );

  it('gives a SectionRoot its own section-tree icon, and keeps its preview', () => {
    expect(documentTypeTraits('SectionRoot')).toEqual({
      ...defaults,
      sectionIcon: 'book',
    });
    expect(documentTypeTraits('Section').sectionIcon).toBe('folder');
  });

  it.each([
    ['a lower-case name', 'note'],
    ['a subtype-looking name', 'PictureBook'],
    ['an Object.prototype member', 'constructor'],
    ['an empty name', ''],
    ['no type', undefined],
    ['a null type', null],
  ])('takes the defaults for %s', (_label, type) => {
    expect(documentTypeTraits(type)).toEqual(defaults);
  });
});
