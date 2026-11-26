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
  and what its tokens may do. A contribution from a bundle, a package's among them, is refused, and
  the package pipeline refuses a package that holds one.
- **Its secrets are server settings,** in `nuxeo.conf` or the environment, named after its id: the
  client secret it authenticates with, and the key its assertions are verified with. Never in a
  contribution, a page or a URL.
- **The exchange is OAuth 2.0 Token Exchange (RFC 8693):** the host's server authenticates with HTTP
  Basic, its id and its secret, and presents a signed JSON Web Token asserting its user (RFC 7523's
  rules for one); it gets a short-lived token for the Nuxeo user that user maps to. Server to
  server: the endpoint sends no CORS header, so no page can call it.
- **The token is the platform's own:** signed by Nuxeo's JWT service with `nuxeo.jwt.secret`, and
  signed in by Nuxeo's own JWT authenticator, `JWT_AUTH`, which the REST API's chain already holds,
  only on a path that starts with its audience, the REST API's.
- **A filter holds the token to its host before the REST API sees it:** its host still registered,
  its lifetime, its host's origins, the REST API only, reads only unless the host allows writes, and
  never from a URL or a form.
- **Every exchange is audited:** each token issued, for whom and by which host, and each refusal for a
  registered host, in the platform's audit.

## Why an add-on of its own, not `nuxeo-agentic-core`

Decision B's recommendation is `nuxeo-agentic-core` for the runtime essentials and an add-on per
domain module. An embedded panel is neither: most servers embed none. As an add-on, a server that
embeds no panel gets no token endpoint, no filter on its REST API and no open path for the panel's
files, and the security review of the surface has one module to read. If B goes the other way, the
classes and components move into `nuxeo-agentic-core` as they are, and the component's name,
`org.nuxeo.agentic.embedded`, does not change, so no host's contribution does.

## Why the platform's JWT, and not a token of the add-on's own

Nuxeo LTS 2025 has no token exchange: its OAuth 2.0 provider (`nuxeo-platform-oauth`) grants an
authorisation code and refreshes a token, and its tokens carry no scope. It does have a JWT service
and an authenticator for its tokens, in the REST API's chain, which checks a token's audience against
the request's path. So the exchange is the add-on's, shaped as RFC 8693, and the token is the
platform's: no authentication plugin of the add-on's, no change to an authentication chain, and a
token the platform already knows how to refuse when it has expired or is not its own. What the
platform's token cannot say, its host and its scope, is two claims of its, which the filter enforces.

Checked against the local LTS 2025.10.18 server's own jars, not by a run: `JWTAuthenticator` reads a
token from `Authorization: Bearer` or an `access_token` parameter, verifies it with
`JWTService.verifyToken`, takes its `sub`, and, when it has an `aud`, signs it in only on a request
path that starts with it; its plugin is stateless, so it creates no session; `/nuxeo/api/v1/` is
forwarded to `/site/api/v1/` (the API forward servlet), where the authentication filter runs, so the
audience is `site/api/v1`; and `JWTService.newBuilder()` takes its subject from the user signed in,
so the add-on builds as the system user and gives the user's name.

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

| Setting                                    | Or, in the environment              | What                                                                                                                           |
| ------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `nuxeo.agentic.embedded.<id>.clientSecret` | `NUXEO_EMBEDDED_<ID>_CLIENT_SECRET` | The secret the host authenticates with: 32 to 512 letters, digits, `.`, `_`, `~` or `-`                                        |
| `nuxeo.agentic.embedded.<id>.assertionKey` | `NUXEO_EMBEDDED_<ID>_ASSERTION_KEY` | For HS256, the shared key, at least 32 bytes; for RS256 (2048 bits or more) and ES256 (P-256), the public key, X.509 in base64 |
| `nuxeo.agentic.embedded.audience`          |                                     | The `aud` a host's assertions must name: this server. `nuxeo.url` when unset                                                   |
| `nuxeo.agentic.embedded.token.path`        |                                     | The path a token is valid on, below the context path. `site/api/v1` by default                                                 |
| `nuxeo.jwt.secret`                         |                                     | The platform's own, which its JWT service signs with. Unset, no token is issued                                                |

`<ID>` is the id in capitals, with dashes as underscores. The names follow from the id and from
nothing else, so a contribution cannot have another of the server's settings used as a host's key.
Each is read at each exchange.

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
6. **The token:** the platform's JWT service signs it, with `sub`, `aud` (the token path), `exp`
   (now plus the host's lifetime), `iat`, `jti`, `nxe_host` and `scope`.

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
whether or not the token's signature is good:

| Refused                                                                                                                                                | Status |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| The token as an `access_token` parameter, in the address or a form body                                                                                | 401    |
| A token the platform's JWT service does not verify, or expired                                                                                         | 401    |
| A token whose host is not registered, or that lives longer than its host allows                                                                        | 401    |
| An `Origin` the host does not name                                                                                                                     | 403    |
| A path outside `api/v1/`; an address with `;`, an encoded dot, slash, backslash or percent, a doubled slash or a dot segment; a method override header | 403    |
| Anything its scope does not allow (`PanelScope`)                                                                                                       | 403    |

A `read` token may `GET` and `HEAD` documents (`id`, `path`, `repo/<name>/...`), searches, the
content model, vocabularies, users, groups and `me`, and `POST` to `automation/<id>` for the host's
operations. A `write` token may as well `POST`, `PUT` and `DELETE` documents, uploads and bulk
actions, and run the host's operations through a document's `@op`. Neither ever reaches the user's
authentication tokens (`token`), their OAuth tokens (`oauth2`), administration (`management`), or
writes users, groups, vocabularies, the content model or `me`. Nuxeo's permissions still decide what
the user may read or change.

## The panel's other address

`GET /nuxeo/agentic-embedded/v1/hosts/<id>` answers the host's origins to a page on one of them,
`{"host": "crm", "origins": [...]}`, which the panel reads before it asks its page for a token. Any
other page gets a 404 with nothing in it, the same for a host that is not registered, which it may
read, so that the panel says it is refused.

## What is in it

| File                                                           | What it is                                                                                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/java/org/nuxeo/agentic/embedded/`                    | The bundle: the descriptor and its checks (`Host.of`), the exchange, the guard, the scope, the servlet, the filter, and the platform's services behind four interfaces |
| `src/main/resources/OSGI-INF/embedded-panels-service.xml`      | The component `org.nuxeo.agentic.embedded`, its service and its `hosts` extension point                                                                                |
| `src/main/resources/OSGI-INF/embedded-panels-auth-contrib.xml` | The panel's files at `/nuxeo/agentic-ui/embedded/` open to a page signed in to nothing                                                                                 |
| `src/main/resources/OSGI-INF/deployment-fragment.xml`          | The servlet at `/agentic-embedded/*`, and the filter on `/api/*` and `/site/*`                                                                                         |
| `src/test/java/`                                               | 67 tests, with no Nuxeo runtime                                                                                                                                        |
| `demo/demo.mjs`                                                | For development only: a stand-in Nuxeo, mirroring this add-on where the panel meets it, and a fictional CRM, `demo/crm/`, that embeds the panel                        |
| `demo/Claim.view.layout.json`                                  | The demo's claim page: a claim card, a card from the core system and a notes card                                                                                      |

The panel's files are `apps/nuxeo-embedded-panels`, built by the frontend module and served by
`nuxeo-agentic-ui-package` at `/nuxeo/agentic-ui/embedded/v1/`. The demo is described in
[embedded-panels.md](../docs/business-apps/embedded-panels.md#the-demo); nothing builds, packages or
serves it.

## Building it

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # or any JDK 21
mvn -B -f nuxeo-agentic-embedded/pom.xml verify    # 67 tests
```

The root `pom.xml` lists the module. **It has no Marketplace package yet**, which a release needs.

## Installing it on a server, for the review

For the reviewer, after review. Each step changes the server; none was run here.

1. The bundle in `nxserver/bundles/`, and `nuxeo-agentic-ui-package` built from this branch, which
   carries the panel's files.
2. The host's contribution in `nxserver/config/`, as above.
3. In `nuxeo.conf`: `nuxeo.jwt.secret`, if the server has none; the host's client secret and
   assertion key; `nuxeo.agentic.embedded.audience`, or `nuxeo.url`.
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
- **The platform's JWT secret.** Every token the server's JWT service signs, the panel's and any
  other, is signed with `nuxeo.jwt.secret`. Check where it is kept, that it is long and random, and
  that no other system holds it.
- **The filter is the scope.** The platform's authenticator would sign a panel's token in for any
  request on the REST API; the add-on's filter is what keeps it to reads. Check the filter's mapping
  on the deployed `web.xml`, that every path the authenticator signs it in on passes through it, and
  the read paths `PanelScope` allows against the REST API of the version deployed.
- **Origins are not a control against the token's holder.** The `Origin` check binds a token to its
  host's pages in a browser; a client that holds the token may leave the header out. The lifetime,
  the scope and the user's permissions are what bound such a client.
- **Replay.** The assertion's id is kept in the platform's key-value store: shared by a cluster's
  nodes only where its default store is (SQL, MongoDB or Redis), not with the in-memory one.
- **No rate limit.** The exchange and the hosts' address answer as fast as they are asked; put them
  behind the edge's rate limit, as the share links are.
- **The audit.** Each token issued is an entry `agenticEmbeddedTokenIssued`, category
  `agenticEmbedded`, as the user, naming the host, the host's subject, the scope, the token's id and
  its end; each refusal for a registered host, `agenticEmbeddedTokenRefused`, as the system, with a
  fixed reason. A refusal for an unknown host is logged, not audited.

## Not done, and not checked

- **On a server: nothing.** The filter's place in the deployed `web.xml`, the forward's path as the
  authenticator sees it, the audit entries and the key-value store's behaviour are Nuxeo's documented
  behaviour, checked against the 2025.10.18 jars' bytecode where they could be, not by a run. The
  add-on is compiled against java-jwt 3.12.0 and calls only what 4.5.0, the server's, has too, by
  the same descriptors.
- **A Marketplace package** for the add-on.
- **Refresh tokens:** the host exchanges again when the panel asks, as `expires_in` says.
- **Revoking one token:** removing or disabling the host ends all of its tokens; one user's cannot be
  ended alone before its lifetime.
- **The shell's token-based sign-in**, decision F's other half.
