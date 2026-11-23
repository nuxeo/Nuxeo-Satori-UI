import {
  type NuxeoDoctypeDefinition,
  type NuxeoFacetDefinition,
} from '@nuxeo/satori-platform/nuxeo-client';

import { type MainBlobContentModel, typeHoldsMainBlob } from './main-blob-type';

/** The shape `/config/types` answers with, trimmed to what the walk reads. */
const DOCTYPES: Record<string, NuxeoDoctypeDefinition> = {
  Document: {},
  File: { parent: 'Document', schemas: ['common', 'dublincore', 'file', 'files'] },
  Folder: { parent: 'Document', facets: ['Folderish'], schemas: ['common', 'dublincore'] },
  Note: { parent: 'Document', facets: ['Versionable'], schemas: ['common', 'dublincore', 'note'] },
  RentalContract: { parent: 'File' },
  SignedRentalContract: { parent: 'RentalContract' },
  Scan: { parent: 'Document', schemas: ['common', 'file'] },
  CaseFolder: { parent: 'Folder' },
  // `file` reaches these through a facet only: none of them lists it among its own schemas.
  Invoice: { parent: 'Document', facets: ['Versionable', 'Scanned'], schemas: ['common'] },
  SupplierInvoice: { parent: 'Invoice', schemas: ['common', 'supplier'] },
  Ledger: { parent: 'Document', facets: ['Unregistered'], schemas: ['common'] },
};

/**
 * The shape `/config/facets` answers with, trimmed to what the walk reads. A facet that
 * contributes no schema, like `Folderish`, has no `schemas` key at all.
 */
const FACETS: NuxeoFacetDefinition[] = [
  { name: 'Folderish' },
  { name: 'Versionable', schemas: [{ name: 'uid', '@prefix': 'uid' }] },
  {
    name: 'Scanned',
    schemas: [
      { name: 'scan', '@prefix': 'scan' },
      { name: 'file', '@prefix': '' },
    ],
  },
];

const MODEL: MainBlobContentModel = { doctypes: DOCTYPES, facets: FACETS };
const NO_MODEL: MainBlobContentModel = { doctypes: {}, facets: [] };

describe('typeHoldsMainBlob', () => {
  it('holds a main file for the four stock types, with or without a content model', () => {
    for (const type of ['File', 'Audio', 'Picture', 'Video']) {
      expect(typeHoldsMainBlob(type, MODEL)).toBe(true);
      expect(typeHoldsMainBlob(type, NO_MODEL)).toBe(true);
    }
  });

  it('holds a main file for a type that extends File, however deep', () => {
    expect(typeHoldsMainBlob('RentalContract', MODEL)).toBe(true);
    expect(typeHoldsMainBlob('SignedRentalContract', MODEL)).toBe(true);
  });

  it('holds a main file for a type that carries the file schema without extending File', () => {
    expect(typeHoldsMainBlob('Scan', MODEL)).toBe(true);
  });

  it('holds a main file for a type whose own facet contributes the file schema', () => {
    expect(typeHoldsMainBlob('Invoice', MODEL)).toBe(true);
  });

  it('holds a main file for a type that inherits a facet contributing the file schema', () => {
    expect(typeHoldsMainBlob('SupplierInvoice', MODEL)).toBe(true);
  });

  it('needs the facet definitions to see the file schema a facet contributes', () => {
    expect(typeHoldsMainBlob('Invoice', { doctypes: DOCTYPES, facets: [] })).toBe(false);
  });

  it('holds none for types without the file schema anywhere in their ancestry or facets', () => {
    expect(typeHoldsMainBlob('Folder', MODEL)).toBe(false);
    expect(typeHoldsMainBlob('CaseFolder', MODEL)).toBe(false);
    expect(typeHoldsMainBlob('Note', MODEL)).toBe(false);
  });

  it('reads a facet with no schemas key as contributing none', () => {
    const folderish = FACETS.find((facet) => facet.name === 'Folderish');
    expect(folderish).toBeDefined();
    expect(folderish).not.toHaveProperty('schemas');
    expect(() => typeHoldsMainBlob('Folder', MODEL)).not.toThrow();
    expect(typeHoldsMainBlob('Folder', MODEL)).toBe(false);
    // And a facet with no schemas does not stop the search at another that has `file`.
    expect(
      typeHoldsMainBlob('Invoice', {
        doctypes: { Invoice: { facets: ['Folderish', 'Scanned'] } },
        facets: FACETS,
      }),
    ).toBe(true);
  });

  it('reads a facet the facet definitions do not know as contributing none', () => {
    expect(typeHoldsMainBlob('Ledger', MODEL)).toBe(false);
  });

  it('falls back to the stock names when the content model is missing or does not know the type', () => {
    expect(typeHoldsMainBlob('RentalContract', NO_MODEL)).toBe(false);
    expect(typeHoldsMainBlob('Invoice', NO_MODEL)).toBe(false);
    expect(typeHoldsMainBlob('Unknown', MODEL)).toBe(false);
  });

  it('stops on a parent cycle instead of looping', () => {
    const cyclic: Record<string, NuxeoDoctypeDefinition> = {
      A: { parent: 'B', facets: ['Versionable'] },
      B: { parent: 'A', facets: ['Folderish'] },
    };
    expect(typeHoldsMainBlob('A', { doctypes: cyclic, facets: FACETS })).toBe(false);
  });
});
