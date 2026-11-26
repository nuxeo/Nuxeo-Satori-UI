# Nuxeo Agentic Embedded Panels

The server half of embedded panels: a record page's panel shown inside another system's page, a
CRM's say, signed in as the user of that system. Phase 7 of the business apps
[development plan](../docs/business-apps/development-plan.md), "embedded panels: web components, and
token exchange with the host", built on decision F's recommendation, "exchange in phase 7"
([decision log](../docs/business-apps/decisions.md)). The decision is still open, and the log's note
says what changes if it goes another way. The panel itself, and how a host page uses it, is
[embedded-panels.md](../docs/business-apps/embedded-panels.md).

**Nothing here is installed on any server yet.** It is proven by its Java tests, with no Nuxeo
runtime, and the panel by its own tests and by a steps file against a stand-in
(`scripts/beta-harness/steps/embedded-panels.mjs`). The installation below is for the reviewer.

## The short version

- **A host is registered by the server's administrators,** in a file of `nxserver/config/`: its id,
  how it signs its assertions, the origins of its pages, which of its users map to which Nuxeo users,
  and what its tokens may do. A contribution from a bundle, a package's bundle among them, is refused,
  and the app package pipeline refuses a configuration package that holds one. A Marketplace package
  can still write a file into `nxserver/config/` when it is installed, as for the operations
  allow-list: only the administrators who install it check that.
- **Its secrets are server settings,** in `nuxeo.conf` or the environment, named after its id: the
  client secret it authenticates with, and the key its assertions are verified with. Never in a
  contribution, a page or a URL.
- **The exchange is OAuth 2.0 Token Exchange (RFC 8693):** the host's server authenticates with HTTP
  Basic, its id and its secret, and presents a signed JSON Web Token asserting its user (RFC 7523's
  rules for one); it gets a short-lived token for the Nuxeo user that user maps to. Server to
  server: the endpoint sends no CORS header, so no page can call it.
- **The token is the add-on's own:** a JSON Web Token signed with a key of the add-on's,
  `nuxeo.agentic.embedded.tokenSecret`, never the platform's `nuxeo.jwt.secret`, so that nothing
  else of the platform verifies it. The add-on's authenticator, `AGENTIC_EMBEDDED_AUTH`, signs its
  user in, and only the REST API's authentication chain holds it.
- **A filter holds the token to its host before the REST API sees it,** and the authenticator again:
  its host still registered, its lifetime, its host's origins, the REST API only, reads only unless
  the host allows writes, and never from a URL or a form.
- **Every exchange is audited:** each token issued, for whom and by which host, and each refusal for a
  registered host, in the platform's audit.

## Why an add-on of its own, not `nuxeo-agentic-core`

Decision B's recommendation is `nuxeo-agentic-core` for the runtime essentials and an add-on per
domain module. An embedded panel is neither: most servers embed none. As an add-on, a server that
embeds no panel gets no token endpoint, no filter on its REST API and no open path for the panel's
files, and the security review of the surface has one module to read. If B goes the other way, the
classes and components move into `nuxeo-agentic-core` as they are, and the component's name,
`org.nuxeo.agentic.embedded`, does not change, so no host's contribution does.

## Why a token of the add-on's own, and not the platform's JWT

Nuxeo LTS 2025 has no token exchange. Its OAuth 2.0 provider (`nuxeo-platform-oauth`) grants an
authorisation code, refreshes a token, and has a JWT bearer grant (RFC 7523) that takes any token
the platform's JWT service signed, with `nuxeo.jwt.secret`, and answers one of the provider's own
access tokens, with a refresh token and no scope; the platform's JWT authenticator, `JWT_AUTH`, signs
such a token in on any path its audience allows. A panel's token signed by that service would be
accepted in all three places, and only the first is the REST API. So the exchange is the add-on's,
shaped as RFC 8693, its token is signed with a key of the add-on's own, which nothing else of the
platform verifies, and the add-on's authenticator is the only one that signs it in, in the REST API's
chains. The signing is still the platform's library's, `java-jwt` in `nxserver/lib`. A token key
equal to `nuxeo.jwt.secret`, or to a host's HS256 assertion key, signs and verifies nothing.

The cost is the REST API's two chains, `RestAPI` and `Automation`, which the platform replaces whole:
the add-on contributes both again, as LTS 2025.10.18 resolves them (`nuxeo-platform-login-token` sets
both, after `nuxeo-automation-server` and `nuxeo-rest-api-server`), with its own plugin last
(`embedded-panels-auth-contrib.xml`), and requires all three. Both, because the platform takes the
first chain whose pattern matches the request's address, in no set order, and an operation's address
on the REST API matches both. The `Automation` chain's pattern also matches the old
`/nuxeo/site/automation/` and any address with "automation" in it; the authenticator signs a panel's
token in only below `api/v1/`, as the guard says. An upgrade that changes either chain, and any
configuration of a server's that replaces one, must list `AGENTIC_EMBEDDED_AUTH`: the component logs
an error at start when either chain the server resolves lacks it, and `EmbeddedXmlTest` holds the
contribution to the 2025.10.18 chains. And the plugin's interface, `NuxeoAuthenticationPlugin`, has
Jakarta servlet types on LTS 2025 and `javax` ones in the 11.5 artifacts the module builds against:
the module compiles against a copy of the 2025 interface, kept out of its jar, which
`PanelTokenAuthenticatorTest` holds to the 2025 signatures and the Marketplace workflow checks the jar
for.

Checked against the local LTS 2025.10.18 server's own jars, not by a run: the OAuth 2.0 provider's
token endpoint and its JWT bearer grant (`NuxeoOAuth2Servlet`); the two chains and their patterns,
`(.*)/api/v.*` and `(.*)/automation.*`, matched against the request's address; that a stateless plugin
keeps no session for the identity it gives (`NuxeoAuthenticationFilter.needSessionSaving`); and that
`/nuxeo/api/v1/` is forwarded to `/site/api/v1/` (the API forward servlet), where the authentication
filter runs.

## The contribution

```xml
<component name="nuxeo.config.crm-host" version="1.0">
  <require>org.nuxeo.agentic.embedded</require>
  <extension target="org.nuxeo.agentic.embedded" point="hosts">
    <host id="crm">
      <assertion algorithm="RS256" issuer="https://crm.example.com" />
      <origin>https://crm.example.com</origin>
      <user subject="u-1042">jsmith</user>
      <group>crm_panel_users</group>
      <allowAdministrators>false</allowAdministrators>
      <scope>read</scope>
      <operation>Connector.Read</operation>
      <tokenLifetime>300</tokenLifetime>
    </host>
  </extension>
</component>
```

| Element               | Required  | Rule                                                                                                                                                       |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | Yes       | 1 to 32 lower-case letters, digits or dashes, starting with a letter: the client id the host authenticates with, and what its settings are named after     |
| `assertion@algorithm` | Yes       | `HS256`, `RS256` or `ES256`: the only one its assertions may be signed with. Never `none`                                                                  |
| `assertion@issuer`    | Yes       | The `iss` its assertions carry                                                                                                                             |
| `origin`              | 1 to 20   | An origin as a browser sends it, `https://host` or `https://host:port`, no path and no wildcard; plain `http` only for `localhost`, `127.0.0.1` or `[::1]` |
| `user`                | 0 to 1000 | `subject`: one of the host's users; the text: the Nuxeo user it maps to                                                                                    |
| `group`               | 0 to 50   | With one or more, a subject no `user` names is taken as a Nuxeo username, of a member of one of these groups only                                          |
| `allowAdministrators` | No        | `true` to let an exchange be for a Nuxeo administrator. `false` by default                                                                                 |
| `scope`               | No        | `read`, always; `write` only if named here and asked for in the exchange                                                                                   |
| `operation`           | 0 to 20   | The Automation operations a token may run, through `automation/<id>`: reads, for a `read` token. `Connector.Read` when none is named                       |
| `tokenLifetime`       | No        | 60 to 900 seconds. 300 by default                                                                                                                          |

At least one `user` or one `group` is required: a host that maps no user is refused. A host that
breaks a rule is not registered, and takes one registered earlier with the same id out with it, so
that a contribution meant to narrow a host does not leave the wider one in force. A later
contribution with the same id replaces it whole, and `enabled="false"` removes it, which ends its
tokens at once.

## The server's settings

| Setting                                    | Or, in the environment              | What                                                                                                                                                                                             |
| ------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nuxeo.agentic.embedded.<id>.clientSecret` | `NUXEO_EMBEDDED_<ID>_CLIENT_SECRET` | The secret the host authenticates with: 32 to 512 letters, digits, `.`, `_`, `~` or `-`                                                                                                          |
| `nuxeo.agentic.embedded.<id>.assertionKey` | `NUXEO_EMBEDDED_<ID>_ASSERTION_KEY` | For HS256, the shared key, at least 32 bytes; for RS256 (2048 bits or more) and ES256 (P-256), the public key, X.509 in base64                                                                   |
| `nuxeo.agentic.embedded.audience`          |                                     | The `aud` a host's assertions must name, and a panel's token names: this server. `nuxeo.url` when unset                                                                                          |
| `nuxeo.agentic.embedded.tokenSecret`       | `NUXEO_EMBEDDED_TOKEN_SECRET`       | The key a panel's token is signed with, HS256: at least 32 bytes, the same on every node; never `nuxeo.jwt.secret`'s value nor a host's HS256 key, which sign nothing. Unset, no token is issued |

`<ID>` is the id in capitals, with dashes as underscores. The names follow from the id and from
nothing else, so a contribution cannot have another of the server's settings used as a host's key.
Each is read at each exchange, and the token key at each request that carries a panel's token.

## How an exchange goes

```
POST /nuxeo/agentic-embedded/v1/token
Authorization: Basic base64(crm:<client secret>)
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=<the host's assertion>
&subject_token_type=urn:ietf:params:oauth:token-type:jwt
```

1. **The host:** registered, enabled, its secret the one the server sets, compared in constant time.
   Else `invalid_client`, 401, the same for an unknown host and a wrong secret.
2. **The request:** a form body of 16 KiB at most, nothing in the address, each parameter once, no
   client secret in the body; the token exchange grant; a JWT subject token; an access token asked
   for, if any; no `actor_token`; an `audience` or `resource`, if any, that is this server; a `scope`
   the host may be given. Else `invalid_request`, `unsupported_grant_type`, `invalid_target` or
   `invalid_scope`, 400.
3. **The assertion** (`AssertionVerifier`): the host's algorithm in its header and no other; its
   signature, by the platform's library; its `iss`, the host's; its `aud`, naming this server; a
   `sub` and a `jti`; an `exp` and an `iat`, five minutes apart at most, not expired, not issued in
   the future, past its `nbf`, with 30 seconds of skew. Else `invalid_grant`.
4. **Its first use** (`KeyValueReplayGuard`): its id kept, by host, in the platform's key-value store
   until it expires, set only if absent. A second use is `invalid_grant`.
5. **The user:** the one a `user` entry maps the subject to, or, with groups, the subject as a
   username, a member of one of them; who exists; who is neither the system user, the anonymous user
   nor a transient one; who is no administrator unless the host allows it. Else `invalid_grant`, with
   one sentence for every case, so that a host learns nothing of the server's users.
6. **The token** (`PanelTokenCodec`): signed HS256 with the add-on's key, with `iss`
   (`nuxeo-agentic-embedded`), `sub`, `aud` (this server), `iat` and `exp` (the same instant plus the
   host's lifetime), `jti`, `nxe_host` and `scope`. A server with no key, or one under 32 bytes, issues
   none: 503.

```json
{
  "access_token": "<the token>",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "read"
}
```

Every answer has `Cache-Control: no-store`. A refusal is RFC 6749, section 5.2's `error` and an
`error_description` of one fixed sentence: never the assertion, a claim of it, or the token.

## What a token may do

`PanelTokenFilter`, on `/api/*` and on `/site/*` for a request and a forward, holds every request
that carries a token whose claims name a host to `PanelTokenGuard`, before the REST API serves it,
whether or not the token's signature is good; and `PanelTokenAuthenticator`, in the REST API's chains,
signs the token's user in only when the same rule lets the request through, so that either one
alone keeps a panel's token to it:

| Refused                                                                                                                                                | Status |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| The token as an `access_token` parameter, in the address or a form body                                                                                | 401    |
| A token not signed with the add-on's key, under an HS256 header, by the add-on, for this server; or expired                                            | 401    |
| A token whose host is not registered, or that lives longer than its host allows                                                                        | 401    |
| An `Origin` the host does not name                                                                                                                     | 403    |
| A path outside `api/v1/`; an address with `;`, an encoded dot, slash, backslash or percent, a doubled slash or a dot segment; a method override header | 403    |
| Anything its scope does not allow (`PanelScope`)                                                                                                       | 403    |

A `read` token may `GET` and `HEAD` documents (`id`, `path`, `repo/<name>/...`), searches, the
content model, vocabularies, users, groups and `me`, and `POST` to `automation/<id>` for the host's
operations. A `write` token may as well `POST`, `PUT` and `DELETE` documents and uploads, and run
the host's operations through a document's `@op`. Neither ever reaches the user's authentication
tokens (`token`), their OAuth tokens (`oauth2`), administration (`management`), an upload's
`execute` or a bulk action, which run an operation of the caller's choosing, or writes users, groups,
vocabularies, the content model or `me`. The rule does not know which operations are reads: a host
that names one that writes lets a `read` token run it, so name reads only. Nuxeo's permissions still
decide what the user may read or change.

## The panel's other address

`GET /nuxeo/agentic-embedded/v1/hosts/<id>` answers the host's origins to a page on one of them,
`{"host": "crm", "origins": [...]}`, which the panel reads before it asks its page for a token. Any
other page gets a 404 with nothing in it, the same for a host that is not registered, which it may
read, so that the panel says it is refused.

## What is in it

| File                                                           | What it is                                                                                                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/java/org/nuxeo/agentic/embedded/`                    | The bundle: the descriptor and its checks (`Host.of`), the exchange, the token's codec, the guard, the scope, the servlet, the filter, the authenticator, and the platform's services behind three interfaces |
| `src/main/java/org/nuxeo/ecm/platform/ui/web/auth/interfaces/` | A compile-time copy of LTS 2025's `NuxeoAuthenticationPlugin`, with Jakarta types, kept out of the jar                                                                                                        |
| `src/main/resources/OSGI-INF/embedded-panels-service.xml`      | The component `org.nuxeo.agentic.embedded`, its service and its `hosts` extension point                                                                                                                       |
| `src/main/resources/OSGI-INF/embedded-panels-auth-contrib.xml` | The authenticator, the REST API's two chains with it last, and the panel's files at `/nuxeo/agentic-ui/embedded/` open to a page signed in to nothing                                                         |
| `src/main/resources/OSGI-INF/deployment-fragment.xml`          | The servlet at `/agentic-embedded/*`, and the filter on `/api/*` and `/site/*`                                                                                                                                |
| `src/test/java/`                                               | 87 tests, with no Nuxeo runtime                                                                                                                                                                               |
| `demo/demo.mjs`                                                | For development only: a stand-in Nuxeo, mirroring this add-on where the panel meets it, and a fictional CRM, `demo/crm/`, that embeds the panel                                                               |
| `demo/Claim.view.layout.json`                                  | The demo's claim page: a claim card, a card from the core system and a notes card                                                                                                                             |

The panel's files are `apps/nuxeo-embedded-panels`, built by the frontend module and served by
`nuxeo-agentic-ui-package` at `/nuxeo/agentic-ui/embedded/v1/`. The demo is described in
[embedded-panels.md](../docs/business-apps/embedded-panels.md#the-demo); nothing builds, packages or
serves it.

## Building it

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # or any JDK 21
mvn -B -f nuxeo-agentic-embedded/pom.xml verify    # 87 tests
```

The root `pom.xml` lists the module. **It has no Marketplace package yet**, which a release needs.

## Installing it on a server, for the review

For the reviewer, after review. Each step changes the server; none was run here.

1. The bundle in `nxserver/bundles/`, and `nuxeo-agentic-ui-package` built from this branch, which
   carries the panel's files.
2. The host's contribution in `nxserver/config/`, as above.
3. In `nuxeo.conf`: `nuxeo.agentic.embedded.tokenSecret`, a random key of its own; the host's
   client secret and assertion key; `nuxeo.agentic.embedded.audience`, or `nuxeo.url`.
4. CORS for the host's origins, the platform's own `corsConfig`, as
   [embedded-panels.md](../docs/business-apps/embedded-panels.md) gives it.
5. Restart.

## Security notes for the review

Deferred until the app is finished, as every security review is
([security-reviews.md](../docs/business-apps/security-reviews.md)). Until it is done, nothing here is
to be relied on outside a development or demonstration server. What a review must check:

- **The trust in a host.** A host's server, with its client secret and its key, can sign in any user
  its contribution maps, without that user's password: that is what the exchange is. Check each
  host's mapping, that administrators stay refused, how the host keeps its secret and its private
  key, and their rotation. Prefer RS256 or ES256, so that the server holds only a public key.
- **The token key.** Whoever holds `nuxeo.agentic.embedded.tokenSecret` can sign a panel's token for
  any user. Check where it is kept, that it is long and random, the same on every node, held by no
  other system. The add-on refuses a key equal to `nuxeo.jwt.secret`, whose tokens the platform
  accepts beyond the REST API, or to a host's HS256 assertion key, which that host holds; it cannot
  tell a key some other system holds.
- **Where the token signs anyone in.** Only the add-on's authenticator verifies it, and only the REST
  API's two chains hold the authenticator; the filter and the authenticator apply the same rule, so
  either keeps the token to its scope. Check, on the deployed server, the two chains as the platform
  resolves them, with the add-on's contribution over the platform's (an upgrade that changes either
  must be followed, and the start's log says when one lacks the plugin), the filter's mapping in
  `web.xml`, and the paths `PanelScope` allows against the REST API of the version deployed.
- **Bundle contributions only.** The server refuses a host from a bundle; a Marketplace package can
  still write a file into `nxserver/config/` when it is installed, as for the operations allow-list.
  Check what each package installs there.
- **Origins are not a control against the token's holder.** The `Origin` check binds a token to its
  host's pages in a browser; a client that holds the token may leave the header out. The lifetime,
  the scope and the user's permissions are what bound such a client.
- **Replay.** The assertion's id is kept in the platform's key-value store: shared by a cluster's
  nodes only where its default store is (SQL, MongoDB or Redis), not with the in-memory one.
- **No rate limit.** The exchange and the hosts' address answer as fast as they are asked, and each
  refusal for a registered host, a wrong secret among them, is an audit entry; put them behind the
  edge's rate limit, as the share links are.
- **The audit.** Each token issued is an entry `agenticEmbeddedTokenIssued`, category
  `agenticEmbedded`, as the user, naming the host, the host's subject, the scope, the token's id and
  its end; each refusal for a registered host, `agenticEmbeddedTokenRefused`, as the system, with a
  fixed reason. A refusal for an unknown host is logged, not audited.

## Not done, and not checked

- **On a server: nothing.** The filter's place in the deployed `web.xml`, the chains the platform
  resolves with the add-on's contribution, the authenticator loaded against the platform's own
  interface, the audit entries and the key-value store's behaviour are Nuxeo's documented behaviour,
  checked against the 2025.10.18 jars' bytecode where they could be, not by a run. The add-on is
  compiled against java-jwt 3.12.0 and calls only what 4.5.0, the server's, has too, by the same
  descriptors.
- **A Marketplace package** for the add-on.
- **Refresh tokens:** the host exchanges again when the panel asks, as `expires_in` says.
- **Revoking one token:** removing or disabling the host ends all of its tokens; one user's cannot be
  ended alone before its lifetime.
- **The shell's token-based sign-in**, decision F's other half.
