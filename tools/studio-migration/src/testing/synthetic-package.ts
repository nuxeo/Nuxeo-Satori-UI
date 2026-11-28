/**
 * Test-only: a fictional Studio package, "Acme-Claims", in the format of a real one.
 *
 * Customer packages stay out of this public repository (decision J in
 * docs/business-apps/decisions.md), so the tests use this instead. It follows the shape of the
 * sample described in docs/business-apps/studio-migration.md, section 2, and adds what a parser
 * must not be fooled by: a slot contribution and a dashboard card inside comments, a card shown
 * twice, a Polymer mixin in the theme, and a translation in a second language.
 *
 * For M1's conversion it also holds what the sample lacks (section 7's synthetic corpus): a field
 * a button and a list column that show only under a condition, a date in a view layout, a user picker in an edit
 * form, an operation button with parameters, and a dashboard list with a query parameter. Since the
 * edit form is written in version 2, which names its widget, the metadata layout holds a user tag,
 * which version 1 cannot show as one: written, and reported.
 */
import { writeZip } from './zip-writer';

export const SYNTHETIC_BUNDLE = 'Acme-Claims-1.0.0.jar';

const UI = 'web/nuxeo.war/ui';

export function syntheticBundleFiles(): Record<string, string> {
  return {
    'META-INF/MANIFEST.MF':
      'Manifest-Version: 1.0\nBundle-SymbolicName: studio.extensions.Acme-Claims\n',
    'OSGI-INF/deployment-fragment.xml': `<?xml version="1.0"?>
<fragment version="1"><install><unzip from="\${bundle.fileName}" to="/" prefix="web"><include>web/nuxeo.war/**</include></unzip></install></fragment>`,
    'OSGI-INF/extensions.xml': `<?xml version="1.0"?>
<component name="studio.extensions.Acme-Claims" version="1.0.0">
  <extension target="org.nuxeo.ecm.core.schema.TypeService" point="schema">
    <schema name="claim" prefix="cl" src="data/schemas/claim.xsd"/>
    <schema name="party" prefix="pt" src="data/schemas/party.xsd"/>
  </extension>
  <extension target="org.nuxeo.ecm.core.schema.TypeService" point="doctype">
    <doctype name="Claim" extends="File"><schema name="claim"/></doctype>
    <doctype name="Party" extends="Document"><schema name="party"/></doctype>
  </extension>
  <extension target="org.nuxeo.ecm.platform.query.api.PageProviderService" point="providers">
    <coreQueryPageProvider name="claims"><pattern>SELECT * FROM Claim</pattern></coreQueryPageProvider>
  </extension>
</component>`,
    'data/schemas/claim.xsd': `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:nxs="http://www.nuxeo.org/ecm/project/schemas/Acme-Claims/claim">
  <xs:simpleType name="stringList"><xs:list itemType="xs:string"/></xs:simpleType>
  <xs:element name="number" type="xs:string"/>
  <xs:element name="amount" type="xs:double"/>
  <xs:element name="incidentDate" type="xs:date"/>
  <xs:element name="adjuster" type="xs:string"/>
  <xs:element name="reserve" type="xs:double"/>
  <xs:element name="tags" type="nxs:stringList"/>
</xs:schema>`,
    'data/schemas/party.xsd': '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"/>',
    'data/i18n/messages.json': JSON.stringify(
      {
        'label.claim.number': 'Claim number',
        'label.claim.amount': 'Amount',
        'label.search.claims': 'Claims',
      },
      null,
      2,
    ),
    'data/i18n/messages-fr.json': JSON.stringify(
      {
        'label.claim.number': 'Numéro de sinistre',
        'label.claim.amount': 'Montant',
        'label.search.claims': 'Sinistres',
      },
      null,
      2,
    ),
    'data/i18n/messages.properties': 'label.claim.number=Claim number\n',
    [`${UI}/document/claim/nuxeo-claim-view-layout.html`]: `<dom-module id="nuxeo-claim-view-layout">
  <template>
    <style include="nuxeo-styles"></style>
    <div role="widget"><label>Claim number</label><div name="number">[[document.properties.cl:number]]</div></div>
    <div role="widget"><label>Amount</label><div name="amount">[[document.properties.cl:amount]]</div></div>
    <nuxeo-date role="widget" datetime="[[document.properties.cl:incidentDate]]" label="Incident date"></nuxeo-date>
    <nuxeo-filter document="[[document]]" type="Claim">
      <template><div role="widget"><label>Reserve</label><div name="reserve">[[document.properties.cl:reserve]]</div></div></template>
    </nuxeo-filter>
    <template is="dom-if" if="[[hasFacet(document, 'Versionable')]]">
      <div role="widget"><label>Tags</label><div name="tags">[[document.properties.cl:tags]]</div></div>
    </template>
  </template>
  <script>
    Polymer({ is: 'nuxeo-claim-view-layout', behaviors: [Nuxeo.LayoutBehavior],
      properties: { /** @doctype Claim */ document: { type: Object } } });
  </script>
</dom-module>`,
    [`${UI}/document/claim/nuxeo-claim-edit-layout.html`]: `<dom-module id="nuxeo-claim-edit-layout">
  <template>
    <nuxeo-input role="widget" value="{{document.properties.cl:number}}" label="Claim number" type="text" required></nuxeo-input>
    <nuxeo-date-picker role="widget" value="{{document.properties.cl:incidentDate}}" label="Incident date"></nuxeo-date-picker>
    <nuxeo-user-suggestion role="widget" value="{{document.properties.cl:adjuster}}" label="Adjuster"></nuxeo-user-suggestion>
  </template>
  <script>
    Polymer({ is: 'nuxeo-claim-edit-layout', behaviors: [Nuxeo.LayoutBehavior],
      properties: { /** @doctype Claim */ document: { type: Object } } });
  </script>
</dom-module>`,
    [`${UI}/document/claim/nuxeo-claim-metadata-layout.html`]: `<dom-module id="nuxeo-claim-metadata-layout">
  <template>
    <div role="widget"><label>Title</label><div name="title">[[document.properties.dc:title]]</div></div>
    <div role="widget"><label>Claim number</label><div name="number">[[document.properties.cl:number]]</div></div>
    <nuxeo-filter document="[[document]]" user="[[user]]" group="adjusters">
      <template>
        <div role="widget"><label>Reserve</label><div name="reserve">[[document.properties.cl:reserve]]</div></div>
      </template>
    </nuxeo-filter>
    <nuxeo-user-tag role="widget" user="[[document.properties.cl:adjuster]]" label="Adjuster"></nuxeo-user-tag>
  </template>
  <script>
    Polymer({ is: 'nuxeo-claim-metadata-layout', behaviors: [Nuxeo.LayoutBehavior],
      properties: { /** @doctype Claim */ document: { type: Object } } });
  </script>
</dom-module>`,
    [`${UI}/search/claims/nuxeo-claims-search-form.html`]: `<dom-module id="nuxeo-claims-search-form">
  <template>
    <nuxeo-input role="widget" value="{{params.cl_number}}" label="Claim number" name="cl_number"></nuxeo-input>
    <nuxeo-directory-suggestion role="widget" value="{{params.cl_status}}" label="Status" directory-name="claim_status"></nuxeo-directory-suggestion>
  </template>
  <script>
    Polymer({
      is: 'nuxeo-claims-search-form',
      behaviors: [Nuxeo.LayoutBehavior],
      properties: {
        /**
         * @search claims
         */
        params: {
          type: Object,
          value: {},
          notify: true,
        },
        aggregations: {
          type: Object,
          value: {},
          notify: true,
        },
      }
    });
  </script>
</dom-module>`,
    [`${UI}/search/claims/nuxeo-claims-search-results.html`]: `<dom-module id="nuxeo-claims-search-results">
  <template>
    <nuxeo-results name="claims" nx-provider="[[nxProvider]]">
      <nuxeo-data-table class="results">
        <nuxeo-data-table-column name="Title" field="dc:title" sort-by="dc:title"></nuxeo-data-table-column>
        <nuxeo-data-table-column name="Amount" field="cl:amount"></nuxeo-data-table-column>
        <nuxeo-data-table-column name="Reserve" field="cl:reserve"><template><nuxeo-filter group="adjusters"><template>[[item.properties.cl:reserve]]</template></nuxeo-filter></template></nuxeo-data-table-column>
      </nuxeo-data-table>
    </nuxeo-results>
  </template>
  <script>
    Polymer({
      is: 'nuxeo-claims-search-results',
      behaviors: [Nuxeo.LayoutBehavior],
      properties: {
        nxProvider: Object,
        sortOptions: {
          type: Array,
          value: []
        },
        _lastIndex: {
            type: Number,
            value: 0,
        },
      },

      attached: function() {
        this.sortOptions = [
          {field: 'dc:title', label: this.i18n('searchResults.sort.field.title'), order: 'asc'},
          {field: 'cl:amount', label: this.i18n('label.claim.amount'), order: 'desc', selected: true}
        ];
      },

      _navigate: function(e) {
        this.fire('navigate', { doc: (e.model || e.detail).item, index: (e.model || e.detail).index });
      },

      _computeTabAndLastIndex(index) {
        let  tabindex = index+1;
        this._lastIndex = this.nxProvider.resultsCount;
        return tabindex.toString();
      },
    });
  </script>
</dom-module>`,
    [`${UI}/nuxeo-Acme-Claims-bundle.html`]: `<!--
STUDIO CODE SPACE
-->
<link rel="import" href="nuxeo-Acme-Claims-custom-bundle.html">
<nuxeo-slot-content name="approveClaim" slot="DOCUMENT_ACTIONS" order="10">
  <template><nuxeo-operation-button icon="icons:check" label="Approve" operation="Claim.Approve" input="[[document]]" params='{"comment": "Approved in Web UI"}'></nuxeo-operation-button></template>
</nuxeo-slot-content>
<nuxeo-slot-content name="closeClaim" slot="DOCUMENT_ACTIONS" order="20">
  <template>
    <nuxeo-filter document="[[document]]" permission="Write, WriteProperties">
      <template><nuxeo-operation-button icon="icons:close" label="Close" operation="Claim.Close" input="[[document]]"></nuxeo-operation-button></template>
    </nuxeo-filter>
  </template>
</nuxeo-slot-content>
<nuxeo-slot-content name="claimsSearch" slot="DRAWER_ITEMS" order="1">
  <template><nuxeo-menu-icon name="claimssearch" label="Claims" icon="icons:search"></nuxeo-menu-icon></template>
</nuxeo-slot-content>
<nuxeo-slot-content name="claimsSearch" slot="DRAWER_PAGES">
  <template><nuxeo-search-form provider="claims" search-name="claims" name="claimssearch"></nuxeo-search-form></template>
</nuxeo-slot-content>
<!-- <nuxeo-slot-content name="retired" slot="USER_MENU"><template><nuxeo-menu-item></nuxeo-menu-item></template></nuxeo-slot-content> -->
<nuxeo-slot-content name="acme" slot="THEMES">
  <template><nuxeo-theme name="acme"></nuxeo-theme></template>
</nuxeo-slot-content>`,
    [`${UI}/nuxeo-Acme-Claims-custom-bundle.html`]: `<!--
CUSTOM CODE SPACE
Use this file to put any custom code you want to deploy on top of Studio's automatically generated configuration.
-->
`,
    [`${UI}/nuxeo-home.html`]: `<dom-module id="nuxeo-home">
  <template>
    <div class="dashboard">
      <nuxeo-card heading="Open claims">
        <nuxeo-page-provider id="open" provider="claims" page-size="20" params='{"queryParams": "open"}'></nuxeo-page-provider>
        <nuxeo-data-table nx-provider="open">
          <nuxeo-data-table-column name="Title"><template><a href$="[[urlFor(item)]]">[[item.title]]</a></template></nuxeo-data-table-column>
          <nuxeo-data-table-column name="Incident"><template><nuxeo-date datetime="[[item.properties.cl:incidentDate]]" format="relative"></nuxeo-date></template></nuxeo-data-table-column>
        </nuxeo-data-table>
      </nuxeo-card>
      <nuxeo-card heading="Open claims">
        <nuxeo-page-provider id="open" provider="claims" page-size="20" params='{"queryParams": "open"}'></nuxeo-page-provider>
        <nuxeo-data-table nx-provider="open">
          <nuxeo-data-table-column name="Title"><template><a href$="[[urlFor(item)]]">[[item.title]]</a></template></nuxeo-data-table-column>
          <nuxeo-data-table-column name="Incident"><template><nuxeo-date datetime="[[item.properties.cl:incidentDate]]" format="relative"></nuxeo-date></template></nuxeo-data-table-column>
        </nuxeo-data-table>
      </nuxeo-card>
      <nuxeo-card heading="My tasks"><nuxeo-tasks-list></nuxeo-tasks-list></nuxeo-card>
      <!-- <nuxeo-card heading="Retired"><nuxeo-tasks-list></nuxeo-tasks-list></nuxeo-card> -->
    </div>
  </template>
</dom-module>`,
    [`${UI}/themes/acme/theme.html`]: `<custom-style>
  <style is="custom-style">
    html {
      /* -- Acme colours -- */
      --nuxeo-primary-color: #00796b;
      --nuxeo-text-default: #1d1d1f;
      --nuxeo-sidebar-background: #102027;
      --paper-input-container: { color: #1d1d1f; };
      --primary-text-color: #1d1d1f;
    }
  </style>
</custom-style>`,
    [`${UI}/themes/acme/logo.png`]: 'not really a PNG',
    'web/nuxeo.war/img/login.jpg': 'not really a JPEG',
    '.metadata/Claim.doc.xml': '<doctype name="Claim"/>',
  };
}

export interface SyntheticPackageOptions {
  /** Files to add to the bundle, or to replace in it. */
  readonly bundle?: Record<string, string>;
  /** Bundle files to leave out. */
  readonly without?: readonly string[];
  /** Files to add at the package's root. */
  readonly package?: Record<string, string>;
}

/** The package as a customer hands it over: a ZIP holding the descriptors and the bundle. */
export function syntheticPackage(options: SyntheticPackageOptions = {}): Buffer {
  const bundle = { ...syntheticBundleFiles(), ...options.bundle };
  for (const name of options.without ?? []) delete bundle[name];
  const jar = writeZip(Object.entries(bundle).map(([name, data]) => ({ name, data })));
  return writeZip([
    {
      name: 'package.xml',
      data: `<package type="studio" name="Acme-Claims" version="1.0.0">
  <title>Acme-Claims</title>
  <target-platform><version>[2025.0,2026)</version><name>lts</name></target-platform>
  <dependencies><package>nuxeo-web-ui</package></dependencies>
</package>`,
    },
    {
      name: 'install.xml',
      data: `<install><update file="\${package.root}/${SYNTHETIC_BUNDLE}" todir="\${env.bundles}"/></install>`,
    },
    {
      name: 'studio-registries.json',
      data: JSON.stringify({ doctypes: { Claim: {} }, schemas: {} }),
    },
    { name: SYNTHETIC_BUNDLE, data: jar, method: 0 },
    ...Object.entries(options.package ?? {}).map(([name, data]) => ({ name, data })),
  ]);
}
