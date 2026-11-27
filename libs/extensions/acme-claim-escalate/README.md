# @agentic-ui/acme-claim-escalate

The Layer 2 plugin of the custom element `acme-claim-escalate`, from the custom bundle of
Acme-Claims 1.0.0 (`web/nuxeo.war/ui/nuxeo-Acme-Claims-custom-bundle.html`), written by the Studio
migration's code track (`npm run studio-migration -- plugin`, M3 in
[docs/business-apps/studio-migration.md](../../../docs/business-apps/studio-migration.md)).

It registers one component, `acme.components.claimEscalate`, and nothing else. It is inert until an
app adds its provider, and the component shows only where a manifest places it.

## Built in from the template

Until decision 5 proves signed, pinned plugins loaded at run time, a plugin is built into the
customer's app from the template. Add one line to the fork's `app.config.ts`:

```ts
import { provideAcmeClaimEscalatePlugin } from '@agentic-ui/acme-claim-escalate';
// providers: [ ..., provideAcmeClaimEscalatePlugin() ]
```

## Where it shows

In Web UI, the package used it in: `web/nuxeo.war/ui/nuxeo-Acme-Claims-custom-bundle.html`.
Where the plugin shows in the app is a person's call, made when they accept it: a manifest
entry naming the component, in a slot that draws components (docs/extension-reference.md:
`tabs`, `documentView`, `sidebar`, or a route).

## The element it replaces

Its interface, as a plugin: inputs `document`, `reason`; outputs `claimEscalated`, `documentUpdated`, `notify`.
Behaviours it used: `Nuxeo.I18nBehavior`, `Nuxeo.FiltersBehavior`.

As the package defines it, quoted for the person who writes the plugin. It is never run, and
none of it is copied into the plugin's code:

```html
<dom-module id="acme-claim-escalate">
  <template>
    <style>
      :host {
        display: inline-block;
      }
    </style>
    <nuxeo-operation
      id="escalate"
      op="Claim.Escalate"
      input="[[document.uid]]"
      params="[[_params(reason)]]"
    ></nuxeo-operation>
    <template is="dom-if" if="[[_canEscalate(document)]]">
      <paper-button id="button" on-tap="_escalate" disabled="[[_running]]"
        >[[i18n('label.claim.escalate')]]</paper-button
      >
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
          .then(
            function (response) {
              this.fire('claim-escalated', {
                claim: this.document.uid,
                level: response.properties['cl:level'],
              });
              this.fire('document-updated');
            }.bind(this),
          )
          .catch(
            function () {
              this.fire('notify', { message: this.i18n('label.claim.escalateFailed') });
            }.bind(this),
          )
          .then(
            function () {
              this._running = false;
            }.bind(this),
          );
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
