/**
 * Test-only: section 7's synthetic corpus for M3, the code track: two custom elements, which
 * neither the sample nor the M1 and M2 corpora hold. It is added to "Acme-Claims"
 * (`synthetic-package.ts`) as `syntheticPackage({ bundle: m3CorpusFiles() })`, so that the tests of
 * the earlier phases keep the package they were written for.
 *
 * Both elements are made up for this repository, and neither is copied from any real package. They
 * are written as Studio's custom bundle holds a project's hand-written code: a Polymer `dom-module`
 * in `nuxeo-<project>-custom-bundle.html`, with a template, a `Polymer({ is, behaviors, properties })`
 * definition, Web UI's behaviours, and events fired with `this.fire`.
 *
 * - **`acme-claim-exposure`** shows a claim's properties computed: what is outstanding (its amount
 *   less its reserve), the reserve as a share of the amount, and a warning at or above a threshold.
 *   The Claim's view layout uses it.
 * - **`acme-claim-escalate`** is a button that runs an operation, `Claim.Escalate`, on the claim,
 *   then fires `claim-escalated` and `document-updated`; on a failure it fires `notify`. It shows
 *   only to someone who may write the claim, and never on a closed one. A contribution of the
 *   custom bundle puts it among a document's actions.
 *
 * {@link M3_RECORDS} are the records the harness's check 9 shows each plugin, and
 * {@link M3_OBSERVED} what each element shows on them and asks the server. No Web UI ran to
 * record them: they were worked out by hand from each element's template and script, as a person
 * reading Web UI on the migration server would record them. That is a limit of this corpus, and
 * the documents say so.
 */
import type { ObservedBehaviour } from '../observed';
import { syntheticBundleFiles } from './synthetic-package';

const UI = 'web/nuxeo.war/ui';

/** The custom bundle's path in the synthetic package. */
export const M3_CUSTOM_BUNDLE = `${UI}/nuxeo-Acme-Claims-custom-bundle.html`;

/** The two made-up elements, as the custom bundle defines them. */
export const M3_ELEMENTS = ['acme-claim-exposure', 'acme-claim-escalate'] as const;

export function m3CorpusFiles(): Record<string, string> {
  const base = syntheticBundleFiles();
  const messages = JSON.parse(base['data/i18n/messages.json']) as Record<string, string>;
  return {
    'data/i18n/messages.json': JSON.stringify(
      {
        ...messages,
        'label.claim.outstanding': 'Outstanding',
        'label.claim.reserveRatio': 'Reserve ratio',
        'label.claim.highExposure': 'High exposure',
        'label.claim.escalate': 'Escalate',
        'label.claim.escalateFailed': 'The claim could not be escalated',
      },
      null,
      2,
    ),
    // The Claim's view layout, as M1's corpus writes it, with the first element after its fields.
    [`${UI}/document/claim/nuxeo-claim-view-layout.html`]: base[
      `${UI}/document/claim/nuxeo-claim-view-layout.html`
    ].replace(
      '  </template>\n  <script>',
      '    <acme-claim-exposure document="[[document]]"></acme-claim-exposure>\n  </template>\n  <script>',
    ),
    [M3_CUSTOM_BUNDLE]: `<!--
CUSTOM CODE SPACE
Use this file to put any custom code you want to deploy on top of Studio's automatically generated configuration.
-->
<dom-module id="acme-claim-exposure">
  <template>
    <style>
      :host { display: block; }
      .high { color: var(--nuxeo-warn-text, #b00020); }
    </style>
    <div class="row">
      <span class="label">[[i18n('label.claim.number')]]</span>
      <span class="value">[[document.properties.cl:number]]</span>
    </div>
    <div class="row">
      <span class="label">[[i18n('label.claim.outstanding')]]</span>
      <span class="value">[[_outstanding(document.properties.cl:amount, document.properties.cl:reserve)]]</span>
    </div>
    <div class="row">
      <span class="label">[[i18n('label.claim.reserveRatio')]]</span>
      <span class="value">[[_ratio(document.properties.cl:amount, document.properties.cl:reserve)]]</span>
    </div>
    <template is="dom-if" if="[[_isHigh(document.properties.cl:amount, threshold)]]">
      <span class="high">[[i18n('label.claim.highExposure')]]</span>
    </template>
  </template>
  <script>
    Polymer({
      is: 'acme-claim-exposure',
      behaviors: [Nuxeo.I18nBehavior],
      properties: {
        /** The claim. */
        document: { type: Object },
        /** At or above this amount, the claim is shown as a high exposure. */
        threshold: { type: Number, value: 10000 },
      },
      _outstanding: function (amount, reserve) {
        if (typeof amount !== 'number') return '';
        return (amount - (reserve || 0)).toFixed(2);
      },
      _ratio: function (amount, reserve) {
        if (typeof amount !== 'number' || amount === 0) return '–';
        return Math.round(((reserve || 0) / amount) * 100) + '%';
      },
      _isHigh: function (amount, threshold) {
        return typeof amount === 'number' && amount >= threshold;
      },
    });
  </script>
</dom-module>
<dom-module id="acme-claim-escalate">
  <template>
    <style>
      :host { display: inline-block; }
    </style>
    <nuxeo-operation id="escalate" op="Claim.Escalate" input="[[document.uid]]" params="[[_params(reason)]]"></nuxeo-operation>
    <template is="dom-if" if="[[_canEscalate(document)]]">
      <paper-button id="button" on-tap="_escalate" disabled="[[_running]]">[[i18n('label.claim.escalate')]]</paper-button>
    </template>
  </template>
  <script>
    Polymer({
      is: 'acme-claim-escalate',
      behaviors: [Nuxeo.I18nBehavior, Nuxeo.FiltersBehavior],
      properties: {
        /** The claim. */
        document: { type: Object },
        /** Why it is escalated, as the operation records it. */
        reason: { type: String, value: 'manual' },
        _running: { type: Boolean, value: false },
      },
      _params: function (reason) {
        return { reason: reason };
      },
      _canEscalate: function (document) {
        return !!document && document.state !== 'closed' && this.hasPermission(document, 'Write');
      },
      _escalate: function () {
        this._running = true;
        this.$.escalate
          .execute()
          .then(function (response) {
            this.fire('claim-escalated', { claim: this.document.uid, level: response.properties['cl:level'] });
            this.fire('document-updated');
          }.bind(this))
          .catch(function () {
            this.fire('notify', { message: this.i18n('label.claim.escalateFailed') });
          }.bind(this))
          .then(function () {
            this._running = false;
          }.bind(this));
      },
    });
  </script>
</dom-module>
<nuxeo-slot-content name="claimEscalation" slot="DOCUMENT_ACTIONS" order="30">
  <template><acme-claim-escalate document="[[document]]"></acme-claim-escalate></template>
</nuxeo-slot-content>
`,
  };
}

/** A claim as Nuxeo's REST API returns it, with every property of its schemas, null when unset. */
function claim(
  uid: string,
  state: string,
  properties: {
    readonly number: string;
    readonly amount: number | null;
    readonly reserve: number | null;
  },
  permissions: readonly string[],
): Record<string, unknown> {
  return {
    'entity-type': 'document',
    uid,
    type: 'Claim',
    state,
    title: properties.number,
    facets: [],
    properties: {
      'dc:title': properties.number,
      'cl:number': properties.number,
      'cl:amount': properties.amount,
      'cl:incidentDate': null,
      'cl:adjuster': null,
      'cl:reserve': properties.reserve,
      'cl:tags': [],
    },
    contextParameters: { permissions },
  };
}

/** The records check 9 shows each plugin: made up, and of the corpus's Claim type. */
export const M3_RECORDS: readonly Record<string, unknown>[] = [
  claim('claim-cl-1001', 'open', { number: 'CL-1001', amount: 12000, reserve: 3000 }, [
    'Read',
    'Write',
    'Everything',
  ]),
  claim('claim-cl-1002', 'open', { number: 'CL-1002', amount: 2500.5, reserve: 500 }, ['Read']),
  claim('claim-cl-1003', 'closed', { number: 'CL-1003', amount: 0, reserve: null }, [
    'Read',
    'Write',
  ]),
  claim('claim-cl-1004', 'open', { number: 'CL-1004', amount: null, reserve: null }, [
    'Read',
    'Write',
  ]),
];

/**
 * What each element shows on {@link M3_RECORDS}, and what clicking it asks the server, worked out
 * by hand from its template and script with the corpus's English texts: no Web UI ran. Each
 * element's property is given another value than its default on one record at least, so that the
 * plugin's input is held too, and an event fired with no detail has `{}`, as Polymer's `fire` gives.
 */
export const M3_OBSERVED: ObservedBehaviour = {
  format: 'studio-migration-observed/1',
  locale: 'en',
  records: M3_RECORDS,
  elements: {
    'acme-claim-exposure': {
      inputs: {},
      records: [
        {
          record: 'claim-cl-1001',
          shows: 'Claim number CL-1001 Outstanding 9000.00 Reserve ratio 25% High exposure',
        },
        // Under a lower threshold than the element's 10000, the warning shows.
        {
          record: 'claim-cl-1002',
          inputs: { threshold: 2000 },
          shows: 'Claim number CL-1002 Outstanding 2000.50 Reserve ratio 20% High exposure',
        },
        {
          record: 'claim-cl-1003',
          shows: 'Claim number CL-1003 Outstanding 0.00 Reserve ratio –',
        },
        {
          record: 'claim-cl-1004',
          shows: 'Claim number CL-1004 Outstanding Reserve ratio –',
        },
      ],
    },
    'acme-claim-escalate': {
      inputs: {},
      records: [
        {
          record: 'claim-cl-1001',
          shows: 'Escalate',
          clicks: [
            {
              button: 'Escalate',
              answer: { 'entity-type': 'document', properties: { 'cl:level': 2 } },
              asks: {
                operation: 'Claim.Escalate',
                input: 'doc:claim-cl-1001',
                params: { reason: 'manual' },
              },
              fires: [
                {
                  event: 'claim-escalated',
                  detail: { claim: 'claim-cl-1001', level: 2 },
                },
                { event: 'document-updated', detail: {} },
              ],
            },
          ],
        },
        // No Write permission, and closed: Web UI's dom-if leaves the button out.
        { record: 'claim-cl-1002', shows: '' },
        { record: 'claim-cl-1003', shows: '' },
        // With the page's own reason, and a server that refuses.
        {
          record: 'claim-cl-1004',
          inputs: { reason: 'audit' },
          shows: 'Escalate',
          clicks: [
            {
              button: 'Escalate',
              failure: 500,
              asks: {
                operation: 'Claim.Escalate',
                input: 'doc:claim-cl-1004',
                params: { reason: 'audit' },
              },
              fires: [{ event: 'notify', detail: { message: 'The claim could not be escalated' } }],
            },
          ],
        },
      ],
    },
  },
};
