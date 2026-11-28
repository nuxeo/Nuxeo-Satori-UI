/**
 * Test-only: section 7's synthetic corpus for what M2 left over, which neither the sample, the M1
 * corpus nor M2's (`m2-corpus.ts`) holds. Added on top of M2's, as
 * `syntheticPackage({ bundle: { ...m2CorpusFiles(), ...m2LeftoversFiles() } })`, on a type of its
 * own, Vehicle, so that the tests of M1 and M2 keep the packages they were written for:
 *
 * - **tabs whose page is a list:** a page provider and its table, in the element the page is, as a
 *   dashboard card holds one (`nuxeo-home.html`), with the open record as its parameter. No package
 *   in hand shows how Studio writes one, or how a page passes the open record to its page
 *   provider: this is the corpus's form, `params='{"queryParams": "[[document.uid]]"}'`, read as a
 *   dashboard card's `params` are;
 * - **conditions in an edit and a create layout:** a field under a group test, which a document
 *   layout reads through `<nuxeo-connection user="{{user}}">`, and a layout block under a facet
 *   test;
 * - **a condition on a version 1 field:** in the metadata layout, which the app reads in version 1
 *   alone;
 * - **conditions on list columns:** in a search screen's table, itself under a condition, and in a
 *   dashboard card's list, each column's test in its template, as Web UI's columns write theirs;
 * - **a dashboard** with the person's tasks, twice, once under a condition, and a recently viewed
 *   card, as Web UI's stock home has them.
 *
 * It holds the traps a converter must not fall for:
 *
 * - a list whose page provider takes a named parameter, which a list of related records cannot
 *   send, so it would list other records;
 * - a list with a grid view, and a column whose test reads each row's record, `document="[[item]]"`,
 *   which no rule of the open record can decide;
 * - a column of a queue whose test reads a document, where no record is open.
 *
 * Every name is made up.
 */
import { m2CorpusFiles } from './m2-corpus';

const UI = 'web/nuxeo.war/ui';

/** A layout of the Vehicle type, in the generated form M2's corpus writes its layouts in. */
const vehicleLayout = (
  mode: string,
  body: string,
): string => `<dom-module id="nuxeo-vehicle-${mode}-layout">
  <template>
${body}
  </template>
  <script>
    Polymer({ is: 'nuxeo-vehicle-${mode}-layout', behaviors: [Nuxeo.LayoutBehavior],
      properties: { /** @doctype Vehicle */ document: { type: Object } } });
  </script>
</dom-module>`;

/** A tab's item and its page, contributed to Web UI's document page, shown on Vehicle alone. */
const tab = (name: string, order: number, label: string, page: string): string => `
<nuxeo-slot-content name="vehicle-${name}-item" slot="DOCUMENT_VIEWS_ITEMS" order="${order}">
  <template>
    <nuxeo-filter document="[[document]]" type="Vehicle">
      <template><nuxeo-page-item name="${name}" label="${label}"></nuxeo-page-item></template>
    </nuxeo-filter>
  </template>
</nuxeo-slot-content>
<nuxeo-slot-content name="vehicle-${name}-page" slot="DOCUMENT_VIEWS_PAGES">
  <template>
    <nuxeo-filter document="[[document]]" type="Vehicle">
      <template>
${page}
      </template>
    </nuxeo-filter>
  </template>
</nuxeo-slot-content>`;

export function m2LeftoversFiles(): Record<string, string> {
  const messages = JSON.parse(m2CorpusFiles()['data/i18n/messages.json']) as Record<string, string>;
  return {
    'OSGI-INF/acme-vehicles.xml': `<?xml version="1.0"?>
<component name="studio.extensions.Acme-Claims.vehicles" version="1.0.0">
  <extension target="org.nuxeo.ecm.core.schema.TypeService" point="schema">
    <schema name="vehicle" prefix="ve" src="data/schemas/vehicle.xsd"/>
  </extension>
  <extension target="org.nuxeo.ecm.core.schema.TypeService" point="doctype">
    <doctype name="Vehicle" extends="Document"><schema name="vehicle"/></doctype>
  </extension>
  <extension target="org.nuxeo.ecm.platform.query.api.PageProviderService" point="providers">
    <coreQueryPageProvider name="vehicle_claims"><pattern>SELECT * FROM Claim WHERE ecm:parentId = ?</pattern></coreQueryPageProvider>
    <coreQueryPageProvider name="vehicle_inspections"><pattern>SELECT * FROM Document WHERE ecm:parentId = :vehicleId</pattern></coreQueryPageProvider>
    <coreQueryPageProvider name="vehicle_documents"><pattern>SELECT * FROM Document WHERE ecm:parentId = ?</pattern></coreQueryPageProvider>
    <coreQueryPageProvider name="vehicles"><pattern>SELECT * FROM Vehicle</pattern></coreQueryPageProvider>
  </extension>
</component>`,
    'data/schemas/vehicle.xsd': `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="plate" type="xs:string"/>
  <xs:element name="make" type="xs:string"/>
  <xs:element name="registered" type="xs:date"/>
  <xs:element name="mileage" type="xs:long"/>
  <xs:element name="notes" type="xs:string"/>
  <xs:element name="keeper" type="xs:string"/>
  <xs:element name="inspector" type="xs:string"/>
</xs:schema>`,
    'data/i18n/messages.json': JSON.stringify(
      { ...messages, 'label.tab.claims': 'Claims on this vehicle' },
      null,
      2,
    ),

    // Vehicle's layouts. A document layout is given only its document: the group tests read the
    // user its nuxeo-connection writes.
    [`${UI}/document/vehicle/nuxeo-vehicle-view-layout.html`]: vehicleLayout(
      'view',
      `    <div role="widget"><label>Plate</label><div name="plate">[[document.properties.ve:plate]]</div></div>
    <div role="widget"><label>Make</label><div name="make">[[document.properties.ve:make]]</div></div>
    <nuxeo-date role="widget" datetime="[[document.properties.ve:registered]]" label="Registered"></nuxeo-date>`,
    ),
    [`${UI}/document/vehicle/nuxeo-vehicle-edit-layout.html`]: vehicleLayout(
      'edit',
      `    <nuxeo-connection user="{{user}}"></nuxeo-connection>
    <nuxeo-input role="widget" value="{{document.properties.ve:plate}}" label="Plate" required></nuxeo-input>
    <nuxeo-input role="widget" value="{{document.properties.ve:make}}" label="Make"></nuxeo-input>
    <nuxeo-filter user="[[user]]" group="inspectors">
      <template><nuxeo-input role="widget" value="{{document.properties.ve:mileage}}" label="Mileage" required></nuxeo-input></template>
    </nuxeo-filter>
    <nuxeo-filter document="[[document]]" facet="Versionable">
      <template><acme-vehicle-keeper document="{{document}}"></acme-vehicle-keeper></template>
    </nuxeo-filter>`,
    ),
    [`${UI}/document/vehicle/nuxeo-vehicle-create-layout.html`]: vehicleLayout(
      'create',
      `    <nuxeo-connection user="{{user}}"></nuxeo-connection>
    <nuxeo-input role="widget" value="{{document.properties.ve:plate}}" label="Plate" required></nuxeo-input>
    <nuxeo-filter user="[[user]]" group="inspectors">
      <template><nuxeo-user-suggestion role="widget" value="{{document.properties.ve:inspector}}" label="Inspector"></nuxeo-user-suggestion></template>
    </nuxeo-filter>`,
    ),
    [`${UI}/document/vehicle/nuxeo-vehicle-metadata-layout.html`]: vehicleLayout(
      'metadata',
      `    <nuxeo-connection user="{{user}}"></nuxeo-connection>
    <div role="widget"><label>Plate</label><div>[[document.properties.ve:plate]]</div></div>
    <nuxeo-filter user="[[user]]" group="inspectors">
      <template><div role="widget"><label>Mileage</label><div>[[document.properties.ve:mileage]]</div></div></template>
    </nuxeo-filter>`,
    ),
    // A layout block the edit layout uses under a condition.
    [`${UI}/acme-blocks/acme-vehicle-keeper.html`]: `<!--
\`acme-vehicle-keeper\`
@group Nuxeo UI
@element acme-vehicle-keeper
-->
<dom-module id="acme-vehicle-keeper">
  <template>
    <style include="nuxeo-styles"></style>
    <nuxeo-user-suggestion role="widget" value="{{document.properties.ve:keeper}}" label="Keeper"></nuxeo-user-suggestion>
    <nuxeo-textarea role="widget" value="{{document.properties.ve:notes}}" label="Notes"></nuxeo-textarea>
  </template>
  <script>
    Polymer({
      is: 'acme-vehicle-keeper',
      behaviors: [Nuxeo.LayoutBehavior],
      properties: {
        /**
         * @schema vehicle
         */
        document: { type: Object },
      },
    });
  </script>
</dom-module>`,

    // Tabs whose page is a list.
    [`${UI}/nuxeo-Acme-Claims-vehicles-bundle.html`]: `<!--
STUDIO CODE SPACE
-->${tab(
      'claims',
      20,
      'label.tab.claims',
      `        <div name="claims">
          <nuxeo-page-provider id="claimsProvider" provider="vehicle_claims" page-size="20" params='{"queryParams": "[[document.uid]]"}' sort='{"dc:modified": "desc"}'></nuxeo-page-provider>
          <nuxeo-data-table nx-provider="claimsProvider">
            <nuxeo-data-table-column name="Title"><template>[[item.title]]</template></nuxeo-data-table-column>
            <nuxeo-data-table-column name="Amount" field="cl:amount"></nuxeo-data-table-column>
            <nuxeo-data-table-column name="Incident"><template><nuxeo-date datetime="[[item.properties.cl:incidentDate]]" format="relative"></nuxeo-date></template></nuxeo-data-table-column>
            <nuxeo-data-table-column name="Reserve" field="cl:reserve"><template><nuxeo-filter user="[[user]]" group="adjusters"><template>[[item.properties.cl:reserve]]</template></nuxeo-filter></template></nuxeo-data-table-column>
          </nuxeo-data-table>
        </div>`,
    )}${tab(
      'inspections',
      30,
      'Inspections',
      `        <div name="inspections">
          <nuxeo-page-provider id="inspectionsProvider" provider="vehicle_inspections" params='{"vehicleId": "[[document.uid]]"}'></nuxeo-page-provider>
          <nuxeo-data-table nx-provider="inspectionsProvider">
            <nuxeo-data-table-column name="Title"><template>[[item.title]]</template></nuxeo-data-table-column>
          </nuxeo-data-table>
        </div>`,
    )}${tab(
      'documents',
      40,
      'Documents',
      `        <div name="documents">
          <nuxeo-page-provider id="documentsProvider" provider="vehicle_documents" params='{"queryParams": "[[document.uid]]"}'></nuxeo-page-provider>
          <nuxeo-data-table nx-provider="documentsProvider">
            <nuxeo-data-table-column name="Title"><template>[[item.title]]</template></nuxeo-data-table-column>
            <nuxeo-data-table-column name="Summary" field="dc:description"><template><nuxeo-filter document="[[item]]" facet="Versionable"><template>[[item.properties.dc:description]]</template></nuxeo-filter></template></nuxeo-data-table-column>
          </nuxeo-data-table>
          <nuxeo-data-grid nx-provider="documentsProvider"></nuxeo-data-grid>
        </div>`,
    )}`,

    // A search screen whose table, and two of whose columns, show only under a condition.
    [`${UI}/search/vehicles/nuxeo-vehicles-search-form.html`]: `<dom-module id="nuxeo-vehicles-search-form">
  <template>
    <nuxeo-input role="widget" value="{{params.ve_plate}}" label="Plate" name="ve_plate"></nuxeo-input>
  </template>
  <script>
    Polymer({
      is: 'nuxeo-vehicles-search-form',
      behaviors: [Nuxeo.LayoutBehavior],
      properties: {
        /**
         * @search vehicles
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
    [`${UI}/search/vehicles/nuxeo-vehicles-search-results.html`]: `<dom-module id="nuxeo-vehicles-search-results">
  <template>
    <nuxeo-connection user="{{user}}"></nuxeo-connection>
    <nuxeo-filter user="[[user]]" group="fleet">
      <template>
        <nuxeo-results name="vehicles" nx-provider="[[nxProvider]]">
          <nuxeo-data-table class="results">
            <nuxeo-data-table-column name="Plate" field="ve:plate" sort-by="ve:plate"></nuxeo-data-table-column>
            <nuxeo-data-table-column name="Make" field="ve:make"></nuxeo-data-table-column>
            <nuxeo-data-table-column name="Mileage" field="ve:mileage"><template><nuxeo-filter user="[[user]]" group="inspectors"><template>[[item.properties.ve:mileage]]</template></nuxeo-filter></template></nuxeo-data-table-column>
            <nuxeo-data-table-column name="Notes" field="ve:notes"><template><nuxeo-filter document="[[item]]" facet="Versionable"><template>[[item.properties.ve:notes]]</template></nuxeo-filter></template></nuxeo-data-table-column>
          </nuxeo-data-table>
        </nuxeo-results>
      </template>
    </nuxeo-filter>
  </template>
  <script>
    Polymer({
      is: 'nuxeo-vehicles-search-results',
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
          {field: 've:plate', label: this.i18n('searchResults.sort.field.title'), order: 'asc', selected: true}
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

    // The dashboard: the M1 corpus's cards, then the recently viewed card, a list with a column
    // under a condition, and the person's tasks again, under a condition of its own.
    [`${UI}/nuxeo-home.html`]: `<dom-module id="nuxeo-home">
  <template>
    <nuxeo-connection user="{{user}}"></nuxeo-connection>
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
      <nuxeo-card heading="Recently viewed">
        <nuxeo-document-storage name="nuxeo-recent-documents" documents="{{recentDocuments}}"></nuxeo-document-storage>
        <nuxeo-data-table items="[[recentDocuments]]">
          <nuxeo-data-table-column name="Title"><template>[[item.title]]</template></nuxeo-data-table-column>
        </nuxeo-data-table>
      </nuxeo-card>
      <nuxeo-card heading="Fleet">
        <nuxeo-page-provider id="fleet" provider="vehicles" page-size="10"></nuxeo-page-provider>
        <nuxeo-data-table nx-provider="fleet">
          <nuxeo-data-table-column name="Plate"><template>[[item.properties.ve:plate]]</template></nuxeo-data-table-column>
          <nuxeo-data-table-column name="Mileage"><template><nuxeo-filter user="[[user]]" group="inspectors"><template>[[item.properties.ve:mileage]]</template></nuxeo-filter></template></nuxeo-data-table-column>
          <nuxeo-data-table-column name="Notes"><template><nuxeo-filter document="[[item]]" facet="Versionable"><template>[[item.properties.ve:notes]]</template></nuxeo-filter></template></nuxeo-data-table-column>
        </nuxeo-data-table>
      </nuxeo-card>
      <nuxeo-filter user="[[user]]" group="supervisors">
        <template><nuxeo-card heading="Team tasks"><nuxeo-tasks-list></nuxeo-tasks-list></nuxeo-card></template>
      </nuxeo-filter>
      <!-- <nuxeo-card heading="Retired"><nuxeo-tasks-list></nuxeo-tasks-list></nuxeo-card> -->
    </div>
  </template>
</dom-module>`,
  };
}

/** The made-up package with M2's corpus and this one: everything M2 converts, its leftovers too. */
export function m2AllFiles(): Record<string, string> {
  return { ...m2CorpusFiles(), ...m2LeftoversFiles() };
}
