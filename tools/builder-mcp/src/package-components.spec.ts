import { describe, expect, it } from 'vitest';
import { componentsOf, pageProvidersOf, shipsStandIn } from './package-components.ts';

/** A package's files, by their path inside it. */
const reading =
  (files: Record<string, string>) =>
  (path: string): string | undefined =>
    files[path];

const manifest = (...components: string[]) =>
  `Manifest-Version: 1.0\nBundle-SymbolicName: x\nNuxeo-Component: ${components.join(',\n ')}\n`;

const MODEL = `<component name="x.model">
  <extension target="org.nuxeo.ecm.core.schema.TypeService" point="doctype">
    <doctype name="Claim" extends="Document"><schema name="claim" /></doctype>
  </extension>
  <extension target="org.nuxeo.ecm.platform.query.api.PageProviderService" point="providers">
    <coreQueryPageProvider name="claims_open">
      <pattern quoteParameters="true">SELECT * FROM Document WHERE ecm:primaryType = 'Claim' AND claim:amount &lt; ?</pattern>
      <sort column="claim:filedOn" ascending="false" />
      <pageSize>20</pageSize>
    </coreQueryPageProvider>
    <coreQueryPageProvider name="claims_gone" enabled="no">
      <pattern>SELECT * FROM Document</pattern>
    </coreQueryPageProvider>
    <coreQueryPageProvider name="claims_cdata">
      <pattern><![CDATA[SELECT * FROM Document WHERE dc:title = '<!--' AND dc:description = '-->']]></pattern>
    </coreQueryPageProvider>
  </extension>
</component>`;

describe("a package's components, as the server registers them", () => {
  it('reads the components the manifest names, and none outside bundle/', () => {
    const read = reading({
      'bundle/META-INF/MANIFEST.MF': manifest(
        'OSGI-INF/model.xml',
        '../../secret.xml',
        '/etc/passwd',
        'OSGI-INF/../../outside.xml',
      ),
      'bundle/OSGI-INF/model.xml': MODEL,
      'secret.xml': '<component name="secret" />',
      'outside.xml': '<component name="outside" />',
    });
    expect(componentsOf(read).map((component) => component.path)).toEqual([
      'bundle/OSGI-INF/model.xml',
    ]);
  });

  it('reads each page provider as /search/pp answers it, a disabled one taken away', () => {
    const providers = pageProvidersOf(
      reading({
        'bundle/META-INF/MANIFEST.MF': manifest('OSGI-INF/model.xml'),
        'bundle/OSGI-INF/model.xml': MODEL,
      }),
    );
    // enabled="no" is not "true": the server registers none.
    expect([...providers.keys()]).toEqual(['claims_open', 'claims_cdata']);
    expect(providers.get('claims_open')).toMatchObject({
      component: 'bundle/OSGI-INF/model.xml',
      element: 'coreQueryPageProvider',
      definition: {
        pattern: "SELECT * FROM Document WHERE ecm:primaryType = 'Claim' AND claim:amount < ?",
        sortInfos: [{ sortColumn: 'claim:filedOn', sortAscending: false }],
        pageSize: 20,
      },
    });
    // A comment's opening inside a CDATA section is text, as the server reads it.
    expect(providers.get('claims_cdata')?.definition['pattern']).toBe(
      "SELECT * FROM Document WHERE dc:title = '<!--' AND dc:description = '-->'",
    );
  });

  it('takes a package for a stand-in only with a model and a document type of its own', () => {
    const files = {
      'content-model.json': '{}',
      'bundle/META-INF/MANIFEST.MF': manifest('OSGI-INF/model.xml'),
      'bundle/OSGI-INF/model.xml': MODEL,
    };
    expect(shipsStandIn(reading(files))).toBe(true);
    // A server's export with no type of the package's own behind it.
    expect(shipsStandIn(reading({ ...files, 'bundle/OSGI-INF/model.xml': '<component />' }))).toBe(
      false,
    );
    // A doctype that appends to one the server has is not the package's own.
    expect(
      shipsStandIn(
        reading({
          ...files,
          'bundle/OSGI-INF/model.xml':
            '<component><extension target="org.nuxeo.ecm.core.schema.TypeService" point="doctype"><doctype name="File" append="true"><schema name="x" /></doctype></extension></component>',
        }),
      ),
    ).toBe(false);
    const { 'content-model.json': _, ...noModel } = files;
    expect(shipsStandIn(reading(noModel))).toBe(false);
  });
});
