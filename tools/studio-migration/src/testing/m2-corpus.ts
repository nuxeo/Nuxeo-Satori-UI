/**
 * Test-only: section 7's synthetic corpus for M2's task forms, tabs and layout blocks, which
 * neither the sample nor the M1 corpus holds. It is added to "Acme-Claims"
 * (`synthetic-package.ts`) as `syntheticPackage({ bundle: m2CorpusFiles() })`, on a type of its own,
 * Policy, and a workflow of its own, ClaimReview, so that M1's tests keep the package they were
 * written for.
 *
 * Task layouts follow Web UI's own (`nuxeo-web-ui/elements/workflow/serialdocumentreview/`): a
 * `dom-module` per step, in `ui/workflow/<workflow>/nuxeo-<step>-layout.html`, both names in lower
 * case, with fields bound to `task.variables.<name>`. Tabs follow Web UI's own contributions to
 * `DOCUMENT_VIEWS_ITEMS` and `DOCUMENT_VIEWS_PAGES` (`nuxeo-web-ui-bundle.html`). Layout blocks
 * follow the documentation's Studio Designer tutorial: an element with `Nuxeo.LayoutBehavior`,
 * used by its name with `document="[[document]]"`. No package in hand shows the folder Studio
 * writes blocks to, so these sit in a folder of no known kind, `ui/acme-blocks/`.
 *
 * It holds the traps a converter must not fall for:
 *
 * - a task layout's field bound to the document, which Web UI gives as an id alone, and one under
 *   a test of that document;
 * - a task layout whose workflow the package names in no schema, so its file's case is unknown;
 * - a block used without the document, a block inside a block, and a block used nowhere;
 * - a tab on every type, a tab whose condition does not convert, a tab with no page, a page with
 *   no tab, and a tab on a type the package writes no view layout of.
 */

const UI = 'web/nuxeo.war/ui';

const block = (element: string, body: string, schema = 'policy'): string => `<!--
\`${element}\`
@group Nuxeo UI
@element ${element}
-->
<dom-module id="${element}">
  <template>
    <style include="nuxeo-styles"></style>
${body}
  </template>
  <script>
    Polymer({
      is: '${element}',
      behaviors: [Nuxeo.LayoutBehavior],
      properties: {
        /**
         * @schema ${schema}
         */
        document: { type: Object },
      },
    });
  </script>
</dom-module>`;

export function m2CorpusFiles(): Record<string, string> {
  return {
    'OSGI-INF/acme-workflows.xml': `<?xml version="1.0"?>
<component name="studio.extensions.Acme-Claims.workflows" version="1.0.0">
  <extension target="org.nuxeo.ecm.core.schema.TypeService" point="schema">
    <schema name="policy" prefix="po" src="data/schemas/policy.xsd"/>
    <schema name="var_ClaimReview" src="data/schemas/var_ClaimReview.xsd"/>
    <schema name="var_AssessClaim" src="data/schemas/var_AssessClaim.xsd"/>
  </extension>
  <extension target="org.nuxeo.ecm.core.schema.TypeService" point="doctype">
    <doctype name="Policy" extends="Document"><schema name="policy"/></doctype>
  </extension>
</component>`,
    'data/schemas/policy.xsd': `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="number" type="xs:string"/>
  <xs:element name="holder" type="xs:string"/>
  <xs:element name="insured" type="xs:string"/>
  <xs:element name="startDate" type="xs:date"/>
  <xs:element name="premium" type="xs:double"/>
  <xs:element name="terms" type="xs:string"/>
</xs:schema>`,
    'data/schemas/var_ClaimReview.xsd': `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="claimNumber" type="xs:string"/>
</xs:schema>`,
    'data/schemas/var_AssessClaim.xsd': `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="decision" type="xs:string"/>
  <xs:element name="followUp" type="xs:date"/>
  <xs:element name="notes" type="xs:string"/>
  <xs:element name="reviewer" type="xs:string"/>
  <xs:element name="override" type="xs:string"/>
</xs:schema>`,
    'data/i18n/messages.json': JSON.stringify(
      {
        'label.claim.number': 'Claim number',
        'label.claim.amount': 'Amount',
        'label.search.claims': 'Claims',
        'label.task.notes': 'Assessor notes',
        'label.tab.cover': 'Cover',
      },
      null,
      2,
    ),

    // A step of the ClaimReview workflow: the package's var_ schemas give both names' case.
    [`${UI}/workflow/claimreview/nuxeo-assessclaim-layout.html`]: `<!--Claim review - Assess the claim-->
<!--
\`nuxeo-assessclaim-layout\`
@group Nuxeo UI
@element nuxeo-assessclaim-layout
-->
<dom-module id="nuxeo-assessclaim-layout">
  <template>
    <nuxeo-connection user="{{user}}"></nuxeo-connection>
    <nuxeo-directory-suggestion role="widget" label="Decision" directory-name="claim_decision"
      value="{{task.variables.decision}}" min-chars="0" required></nuxeo-directory-suggestion>
    <nuxeo-date-picker role="widget" label="Follow up" value="{{task.variables.followUp}}"></nuxeo-date-picker>
    <nuxeo-textarea role="widget" label="[[i18n('label.task.notes')]]" value="{{task.variables.notes}}"></nuxeo-textarea>
    <nuxeo-select role="widget" label="Priority" selected="{{task.variables.priority}}"></nuxeo-select>
    <div role="widget"><label>Claim</label><div>[[document.properties.cl:number]]</div></div>
    <nuxeo-filter document="[[document]]" type="Claim">
      <template>
        <nuxeo-user-suggestion role="widget" label="Reviewer" value="{{task.variables.reviewer}}"></nuxeo-user-suggestion>
      </template>
    </nuxeo-filter>
    <nuxeo-filter user="[[user]]" group="supervisors">
      <template>
        <nuxeo-input role="widget" label="Override" value="{{task.variables.override}}"></nuxeo-input>
      </template>
    </nuxeo-filter>
  </template>
  <script>
    Polymer({
      is: 'nuxeo-assessclaim-layout',
      behaviors: [Nuxeo.LayoutBehavior],
      properties: {
        /**
         * @schema dublincore
         */
        document: Object,

        /**
         * @task var_assessclaim
         */
        task: Object,
      },
    });
  </script>
</dom-module>`,
    // A step of a workflow the package names in no schema: the case of its file is not known.
    [`${UI}/workflow/legacyreview/nuxeo-task1a2-layout.html`]: `<dom-module id="nuxeo-task1a2-layout">
  <template>
    <nuxeo-textarea role="widget" label="Comment" value="{{task.variables.comment}}"></nuxeo-textarea>
  </template>
  <script>
    Polymer({ is: 'nuxeo-task1a2-layout', behaviors: [Nuxeo.LayoutBehavior],
      properties: { document: Object, /** @task var_task1a2 */ task: Object } });
  </script>
</dom-module>`,

    // Layout blocks.
    [`${UI}/acme-blocks/acme-policy-summary.html`]: block(
      'acme-policy-summary',
      `    <div role="widget"><label>Holder</label><div name="holder">[[document.properties.po:holder]]</div></div>
    <nuxeo-date role="widget" datetime="[[document.properties.po:startDate]]" label="Start"></nuxeo-date>
    <nuxeo-filter document="[[document]]" facet="Versionable">
      <template><div role="widget"><label>Premium</label><div name="premium">[[document.properties.po:premium]]</div></div></template>
    </nuxeo-filter>`,
    ),
    [`${UI}/acme-blocks/acme-policy-terms.html`]: block(
      'acme-policy-terms',
      `    <div role="widget"><label>Terms</label><div name="terms">[[document.properties.po:terms]]</div></div>`,
    ),
    [`${UI}/acme-blocks/acme-policy-cover.html`]: block(
      'acme-policy-cover',
      `    <nuxeo-user-tag role="widget" user="[[document.properties.po:insured]]" label="Insured"></nuxeo-user-tag>
    <div role="widget"><label>Policy number</label><div>[[document.properties.po:number]]</div></div>
    <acme-policy-terms document="[[document]]"></acme-policy-terms>`,
    ),
    [`${UI}/acme-blocks/acme-unused.html`]: block(
      'acme-unused',
      `    <div role="widget"><label>Number</label><div>[[document.properties.po:number]]</div></div>`,
    ),

    // Policy's layouts, which use the blocks.
    [`${UI}/document/policy/nuxeo-policy-view-layout.html`]: `<dom-module id="nuxeo-policy-view-layout">
  <template>
    <div role="widget"><label>Policy number</label><div name="number">[[document.properties.po:number]]</div></div>
    <acme-policy-summary document="[[document]]"></acme-policy-summary>
    <nuxeo-filter document="[[document]]" permission="Write, WriteProperties">
      <template><acme-policy-terms document="[[document]]"></acme-policy-terms></template>
    </nuxeo-filter>
  </template>
  <script>
    Polymer({ is: 'nuxeo-policy-view-layout', behaviors: [Nuxeo.LayoutBehavior],
      properties: { /** @doctype Policy */ document: { type: Object } } });
  </script>
</dom-module>`,
    [`${UI}/document/policy/nuxeo-policy-edit-layout.html`]: `<dom-module id="nuxeo-policy-edit-layout">
  <template>
    <nuxeo-input role="widget" value="{{document.properties.po:number}}" label="Policy number" required></nuxeo-input>
    <acme-policy-summary document="{{document}}"></acme-policy-summary>
  </template>
  <script>
    Polymer({ is: 'nuxeo-policy-edit-layout', behaviors: [Nuxeo.LayoutBehavior],
      properties: { /** @doctype Policy */ document: { type: Object } } });
  </script>
</dom-module>`,
    [`${UI}/document/policy/nuxeo-policy-metadata-layout.html`]: `<dom-module id="nuxeo-policy-metadata-layout">
  <template>
    <div role="widget"><label>Policy number</label><div>[[document.properties.po:number]]</div></div>
    <acme-policy-summary></acme-policy-summary>
  </template>
  <script>
    Polymer({ is: 'nuxeo-policy-metadata-layout', behaviors: [Nuxeo.LayoutBehavior],
      properties: { /** @doctype Policy */ document: { type: Object } } });
  </script>
</dom-module>`,

    // Tabs.
    [`${UI}/nuxeo-Acme-Claims-tabs-bundle.html`]: `<!--
STUDIO CODE SPACE
-->
<nuxeo-slot-content name="policyCoverItem" slot="DOCUMENT_VIEWS_ITEMS" order="20">
  <template>
    <nuxeo-filter document="[[document]]" type="Policy">
      <template><nuxeo-page-item name="cover" label="label.tab.cover"></nuxeo-page-item></template>
    </nuxeo-filter>
  </template>
</nuxeo-slot-content>
<nuxeo-slot-content name="policyCoverPage" slot="DOCUMENT_VIEWS_PAGES" order="20">
  <template>
    <nuxeo-filter document="[[document]]" type="Policy" facet="Versionable">
      <template><acme-policy-cover name="cover" document="[[document]]"></acme-policy-cover></template>
    </nuxeo-filter>
  </template>
</nuxeo-slot-content>
<nuxeo-slot-content name="policyTermsItem" slot="DOCUMENT_VIEWS_ITEMS" order="5">
  <template>
    <nuxeo-filter document="[[document]]" type="Policy">
      <template><nuxeo-page-item name="terms" label="Terms"></nuxeo-page-item></template>
    </nuxeo-filter>
  </template>
</nuxeo-slot-content>
<nuxeo-slot-content name="policyTermsPage" slot="DOCUMENT_VIEWS_PAGES">
  <template>
    <nuxeo-filter document="[[document]]" type="Policy">
      <template><acme-policy-terms name="terms" document="[[document]]"></acme-policy-terms></template>
    </nuxeo-filter>
  </template>
</nuxeo-slot-content>
<nuxeo-slot-content name="everywhereItem" slot="DOCUMENT_VIEWS_ITEMS" order="30">
  <template>
    <nuxeo-filter document="[[document]]" permission="Write, WriteProperties">
      <template><nuxeo-page-item name="everywhere" label="Everywhere"></nuxeo-page-item></template>
    </nuxeo-filter>
  </template>
</nuxeo-slot-content>
<nuxeo-slot-content name="everywherePage" slot="DOCUMENT_VIEWS_PAGES">
  <template><acme-policy-terms name="everywhere" document="[[document]]"></acme-policy-terms></template>
</nuxeo-slot-content>
<nuxeo-slot-content name="archivedItem" slot="DOCUMENT_VIEWS_ITEMS" order="40">
  <template>
    <nuxeo-filter document="[[document]]" type="Policy" path="/default-domain/archive">
      <template><nuxeo-page-item name="archived" label="Archived"></nuxeo-page-item></template>
    </nuxeo-filter>
  </template>
</nuxeo-slot-content>
<nuxeo-slot-content name="archivedPage" slot="DOCUMENT_VIEWS_PAGES">
  <template><acme-policy-terms name="archived" document="[[document]]"></acme-policy-terms></template>
</nuxeo-slot-content>
<nuxeo-slot-content name="partyItem" slot="DOCUMENT_VIEWS_ITEMS" order="50">
  <template>
    <nuxeo-filter document="[[document]]" type="Party">
      <template><nuxeo-page-item name="party" label="Party"></nuxeo-page-item></template>
    </nuxeo-filter>
  </template>
</nuxeo-slot-content>
<nuxeo-slot-content name="partyPage" slot="DOCUMENT_VIEWS_PAGES">
  <template><acme-policy-terms name="party" document="[[document]]"></acme-policy-terms></template>
</nuxeo-slot-content>
<nuxeo-slot-content name="missingItem" slot="DOCUMENT_VIEWS_ITEMS" order="60">
  <template><nuxeo-page-item name="missing" label="Missing"></nuxeo-page-item></template>
</nuxeo-slot-content>
<nuxeo-slot-content name="orphanPage" slot="DOCUMENT_VIEWS_PAGES">
  <template><acme-policy-terms name="orphan" document="[[document]]"></acme-policy-terms></template>
</nuxeo-slot-content>`,
  };
}
