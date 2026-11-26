# Embedded panels

A record page's panel inside another system's page: a claim's summary and its data from the core
system, say, beside a customer in a CRM. Phase 7 of the [development plan](development-plan.md),
"embedded panels: web components, and token exchange with the host", and its demo step 2, "the same
panel inside a CRM page". Built on decision F's recommendation ([decisions.md](decisions.md)); its
security review is deferred until the app is finished ([security-reviews.md](security-reviews.md)).

**Installed nowhere.** The panel is proven by its tests and by a steps file against a stand-in
server, `scripts/beta-harness/steps/embedded-panels.mjs`; the server's half,
[`nuxeo-agentic-embedded`](../../nuxeo-agentic-embedded/README.md), by its Java tests.

## The short version

1. **The host's page includes one script** from the Nuxeo server, and writes the element:

   ```html
   <script
     type="module"
     src="https://nuxeo.example.com/nuxeo/agentic-ui/embedded/v1/main.js"
   ></script>
   <nuxeo-record-panel host="crm" record-id="5f1c0e2a-…" cards="claim,payment"></nuxeo-record-panel>
   ```

2. **The panel asks the server for the host's origins,** and goes no further on a page that is not on
   one of them.
3. **It asks its page for a token,** with `postMessage`. The page asks its own server, which exchanges
   its signed assertion of its user for a short-lived Nuxeo token, server to server, and gives the
   panel the token with `postMessage`.
4. **The panel reads the record** through the REST API with the token, in a header, and draws the
   record's page with the layout engine: as that user, with their own permissions, read-only.

## The element

| Attribute   | Required | What                                                                                                                              |
| ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `host`      | Yes      | The host's id, as the server registers it                                                                                         |
| `record-id` | Yes      | The record's id, a Nuxeo document's uid                                                                                           |
| `cards`     | No       | The ids of the cards of the record's `view` layout to show, in that order, separated by commas or spaces; all of them when absent |
| `lang`      | No       | The language, read when the panel starts; the page's `<html lang>` when absent, then English                                      |

The token is never an attribute: an attribute is in the page's markup, which other scripts, the
browser's tools and some frameworks' logs read. The panel's layout is the record type's `view` file,
as the application serves it (`/nuxeo/agentic-ui-config/`): one file for both, so that a change to the
record page is a change to the panel. With `cards`, the panel draws those cards only, in one list,
with no banner, tab or picture preview. An app's deployment layer is not read: the panel has no app.

## The handshake

The panel and its page talk with `postMessage`, and nothing else.

| Message                            | From      | Data                              |
| ---------------------------------- | --------- | --------------------------------- |
| `nuxeo-record-panel:ready`         | The panel | `{ type, panel, host, recordId }` |
| `nuxeo-record-panel:token`         | The page  | `{ type, panel, token }`          |
| `nuxeo-record-panel:token-expired` | The panel | `{ type, panel, host, recordId }` |

`panel` is the panel's own random id, so that a page with several panels answers each. The panel
posts to its own page, at its own origin, and, when the page is framed, to its parent at each of the
host's origins only. **It takes a token only** from its own page or that parent, from an origin the
host's configuration names, for its own id, in the shape of the tokens the server issues. Anything
else, a frame of another origin on the page among them, is ignored and not kept. When the server
refuses its token as expired, it asks again with `token-expired`, and reads the record again with the
fresh one.

A page's side, the whole of it:

```js
window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const { type, panel } = event.data ?? {};
  if (type !== 'nuxeo-record-panel:ready' && type !== 'nuxeo-record-panel:token-expired') return;
  const answer = await fetch('/your-own-server/nuxeo-token', { method: 'POST' }); // your session
  const { token } = await answer.json();
  window.postMessage({ type: 'nuxeo-record-panel:token', panel, token }, window.location.origin);
});
```

## The exchange, on the host's server

The host's own server, never its page, exchanges the token: its client secret and the key it signs
with must not reach a browser, and the endpoint answers no browser (no CORS header).

1. It signs an assertion of the user its page is for: a JSON Web Token with `iss`, its issuer as the
   Nuxeo server registers it; `sub`, its user's id; `aud`, the Nuxeo server's audience
   (`nuxeo.agentic.embedded.audience`, else its `nuxeo.url`); `iat`; `exp`, five minutes later at
   most; and `jti`, a fresh id. With RS256 or ES256, its private key; with HS256, the shared key.
2. It posts it to `/nuxeo/agentic-embedded/v1/token`, authenticated with HTTP Basic, its host id and
   its client secret, as RFC 8693 says:

   ```
   grant_type=urn:ietf:params:oauth:grant-type:token-exchange
   &subject_token=<the assertion>
   &subject_token_type=urn:ietf:params:oauth:token-type:jwt
   ```

3. It gives its page `access_token`, and nothing else; `expires_in` says when it ends.

Every rule the server holds the exchange and the token to is in the
[add-on's README](../../nuxeo-agentic-embedded/README.md#how-an-exchange-goes).

## The server's configuration

The administrators register the host ([the add-on's README](../../nuxeo-agentic-embedded/README.md#the-contribution)),
set its secrets, and let its pages reach the server with the platform's own CORS configuration, in
`nxserver/config/`:

```xml
<component name="nuxeo.config.crm-cors" version="1.0">
  <extension target="org.nuxeo.ecm.platform.web.common.requestcontroller.service.RequestControllerService"
             point="corsConfig">
    <corsConfig name="crm-panels" allowGenericHttpRequests="true"
                allowOrigin="https://crm.example.com" allowSubdomains="false"
                supportedMethods="GET, POST, HEAD, OPTIONS"
                supportedHeaders="Authorization, Content-Type, Accept, properties, enrichers.document, fetch-document, fetch-schema"
                supportsCredentials="false" maxAge="600">
      <pattern>/nuxeo/(api/v1|agentic-ui-config|agentic-ui/embedded)/.*</pattern>
    </corsConfig>
  </extension>
</component>
```

- **`supportsCredentials="false"`:** the panel sends no cookie, ever, so that it never reads as a
  session the user may have on the server.
- **The panel's files** (`/nuxeo/agentic-ui/embedded/`) hold no data and need no sign-in; they may be
  served to any origin, as the demo's stand-in does, since the panel refuses a page its host does not
  name. Naming the host's origins for them too, as above, keeps any other page from loading them.
- **The host's own page** should allow the server in its content security policy: `script-src` and
  `connect-src` for the Nuxeo origin.

## Inside the host's page

- **Its own shadow root.** The element holds a shadow root, and the panel draws in a shadow root of
  its own inside it: the page's styles do not reach the panel, and the panel's do not reach the page.
  `all: initial` on the panel's root stops the properties a page passes down by inheritance; the
  panel's theme, Satori's, is set on its own root.
- **No zone.js:** the panel's Angular application is zoneless, so nothing of the page is patched.
- **The page's address is never read or changed.** A link the layout engine draws, a linked record's,
  opens the record in the application, in a new tab.
- **The system's fonts,** not Satori's: a shadow root's `@font-face` addresses resolve against the
  page, so the panel names none of Satori's families.
- **Satori's icons,** from beside the script, registered without the marks Satori's icon provider
  puts on a document's root element, which in the host's page is the page's.
- **One application per element,** started when it is added to the page and destroyed, with its token,
  when it is removed. About 2.3 MB of script, 580 KB compressed, in one file.

## The demo

Development only: a fictional CRM page and a stand-in Nuxeo server, in
`nuxeo-agentic-embedded/demo/`, which nothing builds, packages or serves.

```bash
npx nx build nuxeo-embedded-panels
node nuxeo-agentic-embedded/demo/demo.mjs
# http://localhost:8094/   the CRM, on an origin the host names: the claim's panel
# http://127.0.0.1:8094/   the same page, on one it does not: refused
EVIDENCE_HEADLESS=1 npm run beta:evidence -- embedded-panels   # the steps file, on ports 18093 and 18094
```

The stand-in mirrors the add-on's rules where the panel meets them, and is not the add-on: the
add-on's Java tests are what prove the exchange and the guard.

## Security notes for the review

Deferred until the app is finished, with the add-on's
([its README](../../nuxeo-agentic-embedded/README.md#security-notes-for-the-review)). What a review of
the panel must check:

- **The token's path.** From the host's server to its page, then by `postMessage` to the panel, held
  in memory for the panel's life, and sent only in `Authorization` to the server's REST API. Check
  that no page, log or analytics script of the host's reads it on the way: the host's page holds it,
  as it holds the user's own session, so the panel is only as safe as the page it is in.
- **The panel's server is its script's.** The server the panel sends the token to is read from its
  script's own address, and only over https or on the loopback interface; no attribute or message
  can name another.
- **The origin checks.** The panel's check of its page's origin, and of each message's, is a check in
  the browser, before the server's. The server's own, the `Origin` header against the host's, is what
  holds against a page that changed the panel's code; neither holds against whoever holds the token
  outside a browser.
- **What the panel draws is the user's.** It reads as the user the token signs in, so Nuxeo's
  permissions decide what it shows. Hiding a card with `cards` is not a control: the token can read
  whatever the user may, within its scope.

## Not done, and not checked

- **On a server: nothing,** nor in another system's real page. The steps file runs the panel in a
  browser against the stand-in.
- **The panel's size:** one file of about 2.3 MB; nothing is split or loaded later yet.
- **Other panels** the architecture names, a record's documents and actions, a drop zone and a task
  list.
- **A page framed by its host's shell,** beyond the parent check: no demo frames the panel's page.
