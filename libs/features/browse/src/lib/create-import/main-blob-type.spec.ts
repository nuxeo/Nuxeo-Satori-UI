import {
  type NuxeoDoctypeDefinition,
  type NuxeoFacetDefinition,
} from '@nuxeo/satori-platform/nuxeo-client';

import { type MainBlobContentModel, typeHoldsMainBlob } from './main-blob-type';

/**
 * The shape `/config/types` answers with, trimmed to what the walk reads. The local Nuxeo lists a
 * type's inherited and facet schemas among its own `schemas`; these leave them out, so each path
 * of the walk — the type's own schemas, its ancestors, its facets — is tested on its own.
 */
const DOCTYPES: Record<string, NuxeoDoctypeDefinition> = {
  Document: {},
  File: { parent: 'Document', schemas: ['common', 'dublincore', 'file', 'files'] },
  Folder: { parent: 'Document', facets: ['Folderish'], schemas: ['common', 'dublincore'] },
  Note: {
    parent: 'Document',
    facets: ['HasRelatedText'],
    schemas: ['common', 'dublincore', 'note'],
  },
  RentalContract: { parent: 'File' },
  SignedRentalContract: { parent: 'RentalContract' },
  Scan: { parent: 'Document', schemas: ['common', 'file'] },
  CaseFolder: { parent: 'Folder' },
  // `file` reaches these through a facet only: none of them lists it among its own schemas.
  Invoice: { parent: 'Document', facets: ['HasRelatedText', 'Scanned'], schemas: ['common'] },
  SupplierInvoice: { parent: 'Invoice', schemas: ['common', 'supplier'] },
  Ledger: { parent: 'Document', facets: ['Unregistered'], schemas: ['common'] },
};

/**
 * The shape `/config/facets` answers with, trimmed to what the walk reads. A facet that
 * contributes no schema, like `Folderish` or `Downloadable`, has no `schemas` key at all. All but
 * `Scanned`, a customer's, are as the local Nuxeo reports them.
 */
const FACETS: NuxeoFacetDefinition[] = [
  { name: 'Folderish' },
  { name: 'Downloadable' },
  { name: 'HasRelatedText', schemas: [{ name: 'relatedtext', '@prefix': '' }] },
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
    const downloadable = FACETS.find((facet) => facet.name === 'Downloadable');
    expect(downloadable).toBeDefined();
    expect(downloadable).not.toHaveProperty('schemas');
    const memo = { doctypes: { Memo: { facets: ['Downloadable'] } }, facets: FACETS };
    expect(() => typeHoldsMainBlob('Memo', memo)).not.toThrow();
    expect(typeHoldsMainBlob('Memo', memo)).toBe(false);
    // And a facet with no schemas does not stop the search at another that has `file`.
    expect(
      typeHoldsMainBlob('Invoice', {
        doctypes: { Invoice: { facets: ['Downloadable', 'Scanned'] } },
        facets: FACETS,
      }),
    ).toBe(true);
  });

  it('reads a facet the facet definitions do not know as contributing none', () => {
    expect(typeHoldsMainBlob('Ledger', MODEL)).toBe(false);
  });

  describe('a folderish type', () => {
    /**
     * As the local Nuxeo reports them: both carry `file` among their own schemas, for their own
     * use, and are containers rather than documents with a main file.
     */
    const CONTAINERS: Record<string, NuxeoDoctypeDefinition> = {
      ...DOCTYPES,
      Workspace: {
        parent: 'Folder',
        facets: ['Folderish', 'NXTag', 'SuperSpace'],
        schemas: [
          'file',
          'webcontainer',
          'publishing',
          'files',
          'common',
          'dublincore',
          'facetedTag',
        ],
      },
      Section: {
        parent: 'Folder',
        facets: ['Folderish', 'NXTag', 'SuperSpace', 'PublishSpace'],
        schemas: ['file', 'common', 'dublincore', 'facetedTag'],
      },
      // Folderish only through an ancestor, with `file` of its own.
      CaseFile: { parent: 'Workspace', schemas: ['common', 'file', 'casefile'] },
      // Folderish of its own, with `file` only through an ancestor.
      ScanBinder: { parent: 'Scan', facets: ['Folderish'] },
      // Folderish, with `file` only through a facet.
      ScannedBinder: { parent: 'Document', facets: ['Folderish', 'Scanned'], schemas: ['common'] },
      // Folderish, and extends File.
      Dossier: { parent: 'File', facets: ['Folderish'] },
    };
    const CONTAINER_MODEL: MainBlobContentModel = { doctypes: CONTAINERS, facets: FACETS };

    it('holds none for Workspace and Section, though each carries the file schema', () => {
      expect(typeHoldsMainBlob('Workspace', CONTAINER_MODEL)).toBe(false);
      expect(typeHoldsMainBlob('Section', CONTAINER_MODEL)).toBe(false);
    });

    it('holds none wherever the Folderish facet and the file schema sit in its ancestry', () => {
      expect(typeHoldsMainBlob('CaseFile', CONTAINER_MODEL)).toBe(false);
      expect(typeHoldsMainBlob('ScanBinder', CONTAINER_MODEL)).toBe(false);
      expect(typeHoldsMainBlob('ScannedBinder', CONTAINER_MODEL)).toBe(false);
    });

    it('holds a main file when it extends one of the stock four', () => {
      expect(typeHoldsMainBlob('Dossier', CONTAINER_MODEL)).toBe(true);
    });

    it('leaves the types that are not folderish as they were', () => {
      expect(typeHoldsMainBlob('RentalContract', CONTAINER_MODEL)).toBe(true);
      expect(typeHoldsMainBlob('Scan', CONTAINER_MODEL)).toBe(true);
      expect(typeHoldsMainBlob('Invoice', CONTAINER_MODEL)).toBe(true);
    });
  });

  it('falls back to the stock names when the content model is missing or does not know the type', () => {
    expect(typeHoldsMainBlob('RentalContract', NO_MODEL)).toBe(false);
    expect(typeHoldsMainBlob('Invoice', NO_MODEL)).toBe(false);
    expect(typeHoldsMainBlob('Unknown', MODEL)).toBe(false);
  });

  it('stops on a parent cycle instead of looping', () => {
    const cyclic: Record<string, NuxeoDoctypeDefinition> = {
      A: { parent: 'B', facets: ['HasRelatedText'] },
      B: { parent: 'A', facets: ['Downloadable'] },
    };
    expect(typeHoldsMainBlob('A', { doctypes: cyclic, facets: FACETS })).toBe(false);
  });
});
