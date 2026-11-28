import { loadCatalogue } from './catalogue';
import { inventory } from './inventory';
import { packageModel, readXsd, schemasOfType } from './model';
import { readStudioPackage } from './studio-package';
import { syntheticBundleFiles, syntheticPackage } from './testing/synthetic-package';
import { columnWidget, fieldWidget } from './widgets';

describe("the package's own model", () => {
  const pkg = readStudioPackage(syntheticPackage());
  const model = packageModel(pkg, inventory(pkg));

  it('reads its schemas by prefix, its types, and its page providers', () => {
    expect([...model.schemas.keys()]).toEqual(['cl', 'pt']);
    expect(model.schemas.get('cl')?.name).toBe('claim');
    expect(Object.fromEntries(model.schemas.get('cl')?.fields ?? [])).toEqual({
      number: 'string',
      amount: 'double',
      incidentDate: 'date',
      adjuster: 'string',
      reserve: 'double',
      tags: 'string[]',
    });
    expect([...model.types.keys()]).toEqual(['Claim', 'Party']);
    expect(schemasOfType(model, 'Claim')).toEqual(new Set(['claim']));
    expect(schemasOfType(model, 'File')).toBeNull();
    expect([...model.pageProviders]).toEqual(['claims']);
    expect(model.problems).toEqual([]);
  });

  it("adds the schemas of a type's facets, and of the package types it extends", () => {
    const extended = readStudioPackage(
      syntheticPackage({
        bundle: {
          'OSGI-INF/extensions.xml': syntheticBundleFiles()['OSGI-INF/extensions.xml'].replace(
            '<doctype name="Party" extends="Document"><schema name="party"/></doctype>',
            '<facet name="Insured"><schema name="party"/></facet><doctype name="Party" extends="Claim"><facet name="Insured"/></doctype><doctype name="Folder" append="true"><subtypes><type>Claim</type></subtypes></doctype>',
          ),
        },
      }),
    );
    const read = packageModel(extended, inventory(extended));
    expect(schemasOfType(read, 'Party')).toEqual(new Set(['claim', 'party']));
    // An `append` adds subtypes to the platform's own type: it declares no type of the package.
    expect(read.types.has('Folder')).toBe(false);
  });

  it('records a schema whose file cannot be read, and leaves its fields unknown', () => {
    const broken = readStudioPackage(
      syntheticPackage({ bundle: { 'data/schemas/claim.xsd': '<xs:schema' } }),
    );
    const read = packageModel(broken, inventory(broken));
    expect(read.schemas.get('cl')?.read).toBe(false);
    expect(read.problems).toEqual([
      "the schema claim's file, data/schemas/claim.xsd, cannot be read",
    ]);
  });

  it("maps XSD's types as Nuxeo does, lists included", () => {
    const xs = (body: string) =>
      Object.fromEntries(
        readXsd(
          `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:nxs="urn:x">${body}</xs:schema>`,
        ) ?? [],
      );
    expect(
      xs(`
        <xs:complexType name="content"><xs:sequence><xs:element name="name" type="xs:string"/></xs:sequence></xs:complexType>
        <xs:complexType name="blobList"><xs:sequence><xs:element name="item" type="nxs:content" maxOccurs="unbounded"/></xs:sequence></xs:complexType>
        <xs:simpleType name="dateList"><xs:list itemType="xs:date"/></xs:simpleType>
        <xs:complexType name="address"><xs:sequence><xs:element name="city" type="xs:string"/></xs:sequence></xs:complexType>
        <xs:element name="count" type="xs:integer"/>
        <xs:element name="when" type="xs:dateTime"/>
        <xs:element name="flag" type="xs:boolean"/>
        <xs:element name="file" type="nxs:content"/>
        <xs:element name="files" type="nxs:blobList"/>
        <xs:element name="dates" type="nxs:dateList"/>
        <xs:element name="home" type="nxs:address"/>
        <xs:element name="code"><xs:simpleType><xs:restriction base="xs:long"/></xs:simpleType></xs:element>`),
    ).toEqual({
      count: 'long',
      when: 'date',
      flag: 'boolean',
      file: 'blob',
      files: 'blob[]',
      dates: 'string[]',
      home: 'complex',
      code: 'long',
    });
    expect(readXsd(undefined)).toBeNull();
    expect(readXsd('<not-closed')).toBeNull();
  });
});

describe('the widget each element becomes', () => {
  const catalogue = loadCatalogue();

  it('follows layout-v2.md, section 10', () => {
    const widget = (element: string, attributes: Record<string, string> = {}) =>
      fieldWidget(catalogue, element, attributes);
    expect(widget('nuxeo-input')).toEqual({ widget: null });
    expect(widget('div')).toEqual({ widget: null });
    expect(widget('nuxeo-textarea')).toEqual({ widget: 'long-text' });
    expect(widget('nuxeo-date-picker')).toEqual({ widget: 'date' });
    expect(widget('nuxeo-date', { format: 'relative' })).toEqual({ widget: 'relative-date' });
    expect(widget('nuxeo-user-suggestion')).toEqual({ widget: 'user' });
    expect(widget('nuxeo-user-suggestion', { 'search-type': 'GROUP_TYPE' })).toEqual({
      widget: 'group',
    });
    expect(widget('nuxeo-directory-suggestion', { 'directory-name': 'nature' })).toEqual({
      widget: 'vocabulary',
      parameters: { directory: 'nature' },
    });
    expect(widget('nuxeo-document-suggestion')).toEqual({ widget: 'document-link' });
    expect(widget('nuxeo-tag')).toEqual({ widget: 'chips' });
    // Not fields: the viewer is the record page's own preview, and an unknown element is reported.
    expect(widget('nuxeo-document-viewer')).toBeNull();
    expect(widget('acme-gauge')).toBeNull();
    expect(widget('constructor')).toEqual({ widget: null });
  });

  it("reads a list column's widget from what its template holds", () => {
    const column = (elements: string[], dateFormat: string | null = null, formatsDate = false) =>
      columnWidget({
        name: null,
        field: 'x:y',
        sortBy: null,
        elements,
        dateFormat,
        formatsDate,
        conditional: false,
        conditions: [],
      });
    expect(column(['nuxeo-user-tag'])).toBe('user');
    expect(column(['nuxeo-date'], 'relative')).toBe('relative-date');
    expect(column(['nuxeo-date'])).toBe('date');
    expect(column([], null, true)).toBe('date');
    expect(column(['nuxeo-tag'])).toBe('chips');
    expect(column(['nuxeo-document-thumbnail'])).toBeNull();
  });
});
