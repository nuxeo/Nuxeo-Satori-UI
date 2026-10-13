# ARender (Annotations Viewer) Setup Guide

This guide walks through setting up the ARender document viewer for the Annotations tab in the Nuxeo Angular UI.

> **This guide describes the generic ARender 2023 stack, which the client no longer supports.**
>
> `ARenderService` now asks Nuxeo for the previewer URL via the `nuxeo-arender` addon's
> `Document.ARenderGetPreviewerUrl` operation, and NEV 2026's connector only accepts a
> `documentId` parameter. The `?url=<nxfile-url>` form the stack below is built around is left
> unparsed, so following these steps end to end yields a viewer that loads but cannot open a
> document.
>
> The Docker Compose stack, the nginx auth-proxy sidecar and the `NUXEO_BASIC_AUTH` credential are
> all part of that retired setup. Removing them is tracked separately; the protocol and
> configuration sections below have been corrected so nothing here contradicts the code, but the
> step-by-step stack instructions have not been rewritten for NEV 2026.
>
> For NEV 2026 — local and cloud — see the Confluence page _Nuxeo Enhanced Viewer (NEV) 2026_ and
> NXSAT-301.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (localhost:4200)                                       │
│  ┌──────────────────────┐    ┌────────────────────────────────┐ │
│  │  Angular App         │    │  ARender UI (iframe)           │ │
│  │  Annotations Tab     │───▶│  localhost:9080                │ │
│  └──────────┬───────────┘    └────────────────────────────────┘ │
│             │ /nuxeo proxy                                      │
└─────────────┼───────────────────────────────────────────────────┘
              │
   ┌──────────▼──────────┐
   │  Nuxeo Server       │  ◀─── host port 8080
   │  localhost:8080      │
   └──────────▲──────────┘
              │
┌─────────────┼───────────────────── Docker (nuxeo-net) ──────────┐
│  ┌──────────┴──────────┐                                        │
│  │  nginx auth-proxy   │  Adds Basic Auth header to all         │
│  │  (nuxeo-auth-proxy) │  /nuxeo/* requests toward Nuxeo        │
│  └──────────▲──────────┘                                        │
│             │                                                   │
│  ┌──────────┴──────────┐    ┌──────────────────────────────┐    │
│  │  ARender UI         │───▶│  Document Service Broker     │    │
│  │  (arender-ui:8080)  │    │  (dsb-service:8761)          │    │
│  └─────────────────────┘    └──────────┬───────────────────┘    │
│                                        │                        │
│                    ┌───────────────────┬┴──────────────────┐    │
│                    │                   │                    │    │
│             ┌──────▼──────┐  ┌────────▼───────┐  ┌────────▼──┐ │
│             │  Renderer   │  │  Text Handler  │  │  Converter│ │
│             │  (drn:9091) │  │  (dth:8899)    │  │  (dcv:…)  │ │
│             └─────────────┘  └────────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**How it works:**

**Retired (ARender 2023, what the stack below implements):**

1. The Angular app constructed an ARender URL: `http://localhost:9080/?url=<nxfile-url>`
2. The `nxfile-url` pointed to the nginx auth-proxy inside Docker
3. ARender's `DefaultURLParser` picked up the `url` parameter and asked the broker to fetch it
4. The broker downloaded the blob through the nginx proxy, which injected **one shared** Basic Auth
   credential — so every user's blob fetch reached Nuxeo as the same principal, and Nuxeo's
   per-user permissions never applied to the viewer
5. The broker handed the blob to the rendition microservices

**Current (NEV 2026):**

1. The Angular app calls `Document.ARenderGetPreviewerUrl` on Nuxeo, which returns
   `https://<viewer>/?documentId=<repository>,<uid>,<xpath>,<digest>`. The client cannot build this
   itself — the blob digest is not computable in a browser.
2. The app validates that URL against `viewerOrigin` as an origin allow-list, then frames it
3. NEV's connector parses `documentId` and fetches the blob from Nuxeo **itself**, over OAuth2 as
   the signed-in user, so per-user ACLs apply
4. Annotations are stored as Nuxeo Annotation objects, not in a container volume

## Prerequisites

- **Docker Desktop** (with Docker Compose v2)
- **Nuxeo Server** running on `localhost:8080`
- Access to the Nuxeo private Docker registry (`docker-private-arondor-proxy.packages.nuxeo.com`)

## Step 1: Log in to the Docker Registry

```bash
docker login docker-private-arondor-proxy.packages.nuxeo.com
```

Use your Nuxeo Online Services credentials. If you don't have access, contact your Nuxeo administrator.

## Step 2: Create the Docker Network

ARender containers communicate over a shared Docker network. Create it once:

```bash
docker network create nuxeo-net
```

## Step 3: Configure Nuxeo Credentials

The nginx auth-proxy injects Basic Auth when ARender fetches blobs from Nuxeo. Credentials are loaded from the `NUXEO_BASIC_AUTH` variable in `.env.arender` — **never hardcoded in config files, and never committed**.

`.env.arender` is gitignored, so create it once from the template:

```bash
cp .env.arender.example .env.arender
```

Then generate the base64 value for your own local Nuxeo account and put it in the file:

```bash
echo -n "<username>:<password>" | base64
```

```
NUXEO_BASIC_AUTH=<your-base64-output>
```

If `NUXEO_BASIC_AUTH` is missing or empty, `docker compose` refuses to start the proxy and tells you so, rather than bringing up an nginx that sends a blank `Authorization` header and 401s on every blob.

## Step 4: Verify Nuxeo Port

The proxy forwards requests to `host.docker.internal:8080`. If your Nuxeo runs on a different port, update `nginx-arender-proxy.conf`:

```nginx
proxy_pass http://host.docker.internal:<YOUR_PORT>/nuxeo/;
proxy_set_header Host host.docker.internal:<YOUR_PORT>;
```

## Step 5: Start the ARender Stack

From the project root:

```bash
docker compose -f arender-docker-compose.yml --env-file .env.arender up -d
```

Wait ~20 seconds for all services to initialize. Verify everything is running:

```bash
docker compose -f arender-docker-compose.yml --env-file .env.arender ps
```

You should see 6 containers: `nuxeo-auth-proxy`, `arender-ui`, `dsb-service`, `drn-service`, `dth-service`, `dcv-service`.

## Step 6: Verify the Setup

1. **Check ARender UI** — open http://localhost:9080 in a browser. You should see the ARender viewer (it will show a default demo PDF if no document is specified).

2. **Check nginx proxy** — from inside a container:

   ```bash
   docker exec arender-ui wget -q -O /dev/null --server-response \
     "http://nuxeo-auth-proxy/nuxeo/api/v1/me" 2>&1 | head -5
   ```

   You should see `HTTP/1.1 200`.

3. **Check the Annotations tab** — navigate to any document in the Angular app (`http://localhost:4200/doc/<uid>`) and click the **Annotations** tab. The document should render inside the ARender viewer.

## Stopping the Stack

```bash
docker compose -f arender-docker-compose.yml --env-file .env.arender down
```

Add `-v` to also remove the temporary rendition volume:

```bash
docker compose -f arender-docker-compose.yml --env-file .env.arender down -v
```

## Troubleshooting

### ARender shows the default "ARender.pdf" demo document

The service broker can't fetch the blob. Check:

1. **nginx proxy is running:** `docker ps | grep nuxeo-auth-proxy`
2. **Nuxeo is reachable from Docker:**
   ```bash
   docker exec dsb-service wget -q -O /dev/null --server-response \
     "http://nuxeo-auth-proxy/nuxeo/api/v1/me" 2>&1
   ```
3. **Credentials are correct** in `nginx-arender-proxy.conf`
4. **Service broker whitelist** — `dsb-service` must have `AUTHORIZED_URLS=http://nuxeo-auth-proxy/` in its environment

### "Could not open document" error in ARender

Check the service broker logs:

```bash
docker logs dsb-service 2>&1 | grep -i "error\|forbidden"
```

- **"Forbidden path"** — The `authorized.urls` whitelist doesn't include the proxy URL. Ensure the `AUTHORIZED_URLS` and `authorized.urls` env vars are set on the `service-broker` service in the compose file.

### "Annotations are not available for this document"

The Angular app couldn't construct a blob URL for this document type. ARender annotations are only available for documents with a `file:content` blob (PDFs, Office files, images, etc.). Note-type documents don't have blobs and won't show the ARender viewer.

### Platform mismatch warnings (arm64 / amd64)

The ARender Docker images are built for `linux/amd64`. On Apple Silicon (M1/M2/M3), Docker Desktop runs them under Rosetta emulation. The warnings are cosmetic — the containers work correctly, though slightly slower than native.

### Port conflicts

| Service        | Default Port | Override                                   |
| -------------- | ------------ | ------------------------------------------ |
| ARender UI     | 9080 (host)  | Change `ports` in compose for `ui`         |
| Service Broker | 8761         | Change `ports` for `service-broker`        |
| Renderer       | 9091         | Change `ports` for `document-renderer`     |
| Text Handler   | 8899         | Change `ports` for `document-text-handler` |
| Converter      | 19999        | Change `ports` for `document-converter`    |

If you change the ARender UI port, also update `integrations.arender` in your Layer 0 bootstrap
fragment (see below).

## Angular Configuration

**There is no default. ARender is off unless you configure it.**

`ARENDER_CONFIG` is `InjectionToken<ARenderConfig | null>` and its default factory returns `null`.
It used to compile in `http://localhost:9080` and `http://nuxeo-auth-proxy/nuxeo`, which meant a
shipped build with no configuration pointed the annotation viewer at the _user's own_ machine over
plaintext. Those defaults were removed (Sonar `S5332`), so an unconfigured deployment now shows
"Annotations are not available" on the document's Annotations tab — that placeholder is the expected
state, not a bug.

Configure it in a **Layer 0 bootstrap fragment**, not by providing the token in `app.config.ts`. It is
read before authentication, so a deployment changes it without rebuilding:

| Where            | Path                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| Production URL   | `/nuxeo/agentic-ui-config/bootstrap.json`                            |
| Contributed by   | a `bootstrap` fragment in your configuration package (NXSAT-312)     |
| Under `nx serve` | `/agentic-ui-config/bootstrap.json`, written by `npm run config:dev` |

**Not the runtime manifest.** Those are two different layers, and this document previously named
the wrong one. The runtime manifest is served beside it as `manifest.json`; its schema is
`AppRuntimeManifest` (`navItems`, `actions`, `rules`, `presets`, `featureToggles`, `labels`,
`extensions`) and it has no `integrations` key at all. An operator who put this block there would
see no error and no annotation viewer.

`config-packages/satori-beta/` is a worked example: the package the hosted Beta installs, whose
whole bootstrap fragment is the `integrations.arender` block below. Build it with
`npx nx build satori-beta` and install the zip with `nuxeoctl mp-install`; until a package is
installed, the served `bootstrap.json` has only our `defaults` fragment, which has no
`integrations` key, and the Annotations tab shows the placeholder (NXSAT-301).

The configuration servlet serves the block from your package, after our defaults; nothing is
edited on the server, and the package installs no configuration file, so an upgrade of ours leaves
it alone. Under `nx serve`, pass the fragment to
`npm run config:dev -- --bootstrap <fragment.json>` before the dev server starts. See
`resolveBootstrapConfigUrl` in `app-config.tokens.ts`.

```json
{
  "integrations": {
    "arender": {
      "viewerOrigin": "https://arender.example.com"
    }
  }
}
```

| Property           | Required | Constraints                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewerOrigin`     | yes      | ARender UI as the **browser** sees it. Must be no less secure than the page framing it — see below.                                                                                                                                                                                                                                                                                                                               |
| `nuxeoInternalUrl` | no       | **Vestigial — leave it out.** Addressed the retired sidecar flow. The browser still parses it into `AppARenderConfig`, but nothing uses it under NEV 2026 and it is not validated; the key is kept only because removing it is a breaking change to that published type. A bootstrap fragment is served before authentication, so a value here publishes an internal host name to anyone who can reach the server, for no effect. |

Only `viewerOrigin` is mandatory, and it is validated in two places, so a missing or malformed value
disables ARender rather than half-enabling it:

- `bootstrap-config.ts` yields `null` unless the merged bootstrap config has a non-blank
  `viewerOrigin`.
  A blank value is worse than none: `fetch('')` resolves against the application's own origin, so an
  availability probe would report a viewer that is not deployed — and that same origin would end up
  on the allow-list the server-supplied previewer URL is checked against.
- `ARenderService` additionally requires it to be an absolute `http(s)` base with **no query string,
  no fragment and no userinfo**. The origin comparison below reads `origin`, which discards all
  three while still reporting a match, so a base carrying one is a misconfiguration whose effect
  would otherwise be invisible.

`nuxeoInternalUrl` is **not** required and **not** validated. It is vestigial under NEV 2026, and
requiring it would force a deployment that retired the sidecar to invent a dummy value or see the
integration silently disable itself. Do not set it: the fragment that would carry it is public, and
nothing on the server or in the browser has a use for it.

### When is `http:` accepted for `viewerOrigin`?

The rule is **host-relative**, not build-relative. `insecureAllowedForHost()` accepts `http:` when
either holds:

| Application served over      | `http:` viewerOrigin | Why                                                                                                                                                                                                                              |
| ---------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http://…` (typical on-prem) | **accepted**         | An iframe is a downgrade only relative to its host document. Where the page is already plaintext there is nothing to downgrade, and anyone able to tamper with the framed viewer can already tamper with the page delivering it. |
| `https://…`                  | **rejected**         | This is the real downgrade: a plaintext viewer inside a secure page, carrying annotations.                                                                                                                                       |
| any, dev build               | accepted             | Local ARender runs on `http://localhost:9080`.                                                                                                                                                                                   |

This corrects an earlier version of this table which said `http:` was permitted "only in a dev
build". That was never what the preview-fallback path did, and after review it is no longer what
ARender does either — the previous wording would have led an operator to believe a supported on-prem
configuration was invalid. If your application is served over `https:`, ARender must be too.

Being allowed to use `http:` does not relax anything else: the no-query/no-fragment/no-userinfo
requirements above still apply. `viewerOrigin` is now itself **the origin allow-list** — the
previewer URL Nuxeo returns is framed only if its origin matches, so a compromised server cannot
redirect the iframe somewhere else. What it cannot bound is `viewerOrigin` itself: a customer
configures where their own ARender lives, so whoever ships the bootstrap fragment chooses the allow-list.
The structural control for that is a CSP `frame-src` header, which is not currently set.

For local development the compose file above publishes the ARender UI on host port 9080, so a dev
bootstrap fragment uses `"viewerOrigin": "http://localhost:9080"`.

## File Reference

| File                         | Purpose                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `arender-docker-compose.yml` | Docker Compose for all ARender + nginx proxy services   |
| `.env.arender.example`       | Template for the above — the file that is in git        |
| `.env.arender`               | ARender image version and Nuxeo credential (gitignored) |
| `nginx-arender-proxy.conf`   | Nginx config that injects Basic Auth for Nuxeo          |
