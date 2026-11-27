# @agentic-ui/acme-claim-exposure

The Layer 2 plugin of the custom element `acme-claim-exposure`, from the custom bundle of
Acme-Claims 1.0.0 (`web/nuxeo.war/ui/nuxeo-Acme-Claims-custom-bundle.html`), written by the Studio
migration's code track (`npm run studio-migration -- plugin`, M3 in
[docs/business-apps/studio-migration.md](../../../docs/business-apps/studio-migration.md)).

It registers one component, `acme.components.claimExposure`, and nothing else. It is inert until an
app adds its provider, and the component shows only where a manifest places it.

## Built in from the template

Until decision 5 proves signed, pinned plugins loaded at run time, a plugin is built into the
customer's app from the template. Add one line to the fork's `app.config.ts`:

```ts
import { provideAcmeClaimExposurePlugin } from '@agentic-ui/acme-claim-exposure';
// providers: [ ..., provideAcmeClaimExposurePlugin() ]
```

## Where it shows

In Web UI, the package used it in: `web/nuxeo.war/ui/document/claim/nuxeo-claim-view-layout.html`.
Where the plugin shows in the app is a person's call, made when they accept it: a manifest
entry naming the component, in a slot that draws components (docs/extension-reference.md:
`tabs`, `documentView`, `sidebar`, or a route).

## The element it replaces

Its interface, as a plugin: inputs `document`, `threshold`; outputs none.
Behaviours it used: `Nuxeo.I18nBehavior`.

As the package defines it, quoted for the person who writes the plugin. It is never run, and
none of it is copied into the plugin's code:

```html
<dom-module id="acme-claim-exposure">
  <template>
    <style>
      :host {
        display: block;
      }
      .high {
        color: var(--nuxeo-warn-text, #b00020);
      }
    </style>
    <div class="row">
      <span class="label">[[i18n('label.claim.number')]]</span>
      <span class="value">[[document.properties.cl:number]]</span>
    </div>
    <div class="row">
      <span class="label">[[i18n('label.claim.outstanding')]]</span>
      <span class="value"
        >[[_outstanding(document.properties.cl:amount, document.properties.cl:reserve)]]</span
      >
    </div>
    <div class="row">
      <span class="label">[[i18n('label.claim.reserveRatio')]]</span>
      <span class="value"
        >[[_ratio(document.properties.cl:amount, document.properties.cl:reserve)]]</span
      >
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
```

## Check 9

Before a person accepts it, the harness holds it to the element: its own tests pass, with no
`it.todo` left; it passes lint, test, build and typecheck; a scan finds no unsafe pattern; and it
shows the same values as the element on the same records, from the observed behaviour.

```bash
npm run studio-migration -- check <package.zip> <conversion> --run-plugins --observed <observed.json>
```
