import { type NuxeoDoctypeDefinition } from '@nuxeo/satori-platform/nuxeo-client';

import { typeHoldsMainBlob } from './main-blob-type';

/** The shape `/config/types` answers with, trimmed to what the walk reads. */
const DOCTYPES: Record<string, NuxeoDoctypeDefinition> = {
  Document: {},
  File: { parent: 'Document', schemas: ['common', 'dublincore', 'file', 'files'] },
  Folder: { parent: 'Document', schemas: ['common', 'dublincore'] },
  Note: { parent: 'Document', schemas: ['common', 'dublincore', 'note'] },
  RentalContract: { parent: 'File' },
  SignedRentalContract: { parent: 'RentalContract' },
  Scan: { parent: 'Document', schemas: ['common', 'file'] },
  CaseFolder: { parent: 'Folder' },
};

describe('typeHoldsMainBlob', () => {
  it('holds a main file for the four stock types, with or without a content model', () => {
    for (const type of ['File', 'Audio', 'Picture', 'Video']) {
      expect(typeHoldsMainBlob(type, DOCTYPES)).toBe(true);
      expect(typeHoldsMainBlob(type, {})).toBe(true);
    }
  });

  it('holds a main file for a type that extends File, however deep', () => {
    expect(typeHoldsMainBlob('RentalContract', DOCTYPES)).toBe(true);
    expect(typeHoldsMainBlob('SignedRentalContract', DOCTYPES)).toBe(true);
  });

  it('holds a main file for a type that carries the file schema without extending File', () => {
    expect(typeHoldsMainBlob('Scan', DOCTYPES)).toBe(true);
  });

  it('holds none for types without the file schema anywhere in their ancestry', () => {
    expect(typeHoldsMainBlob('Folder', DOCTYPES)).toBe(false);
    expect(typeHoldsMainBlob('CaseFolder', DOCTYPES)).toBe(false);
    expect(typeHoldsMainBlob('Note', DOCTYPES)).toBe(false);
  });

  it('falls back to the stock names when the content model is missing or does not know the type', () => {
    expect(typeHoldsMainBlob('RentalContract', {})).toBe(false);
    expect(typeHoldsMainBlob('Unknown', DOCTYPES)).toBe(false);
  });

  it('stops on a parent cycle instead of looping', () => {
    const cyclic: Record<string, NuxeoDoctypeDefinition> = {
      A: { parent: 'B' },
      B: { parent: 'A' },
    };
    expect(typeHoldsMainBlob('A', cyclic)).toBe(false);
  });
});
