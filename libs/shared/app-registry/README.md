# shared-app-registry

The client of the app registry in `nuxeo-agentic-core`
([app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md), section 10): which apps
the person signed in may see, which one is open, and where each file of its definition is read
from. Shared data access (`scope:shared`, `type:data-access`), so that the engines and the app read
through it.

Built on 24 November 2026 against the decision log's proposed answers to B and E, which are still
open ([decisions.md](../../../docs/business-apps/decisions.md), notes).

## What is in it

| Export                 | What it is                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `APP_DEFINITION_FILES` | Where the engines read an app definition's files. The default reads the development server alone |
| `AppRegistryService`   | The registry's client, which the app provides as `APP_DEFINITION_FILES`                          |
| `readAppRegistry`      | The listing, `apps.json`, read: each `app.json` held to the validator, any finding refusing it   |
| `chooseApp`            | The app open: the one last chosen, when the person may still see it, or the first listed         |
| `APP_REGISTRY_REQUEST` | Marks the registry's requests, so that the app's interceptor ends no session on their 401        |
| `APP_REGISTRY_RELOAD`  | Reloads the page, when another app opens                                                         |

## How a file is read

1. Where the development server serves it, beside `bootstrap.json`, past the interceptors, as
   before the registry: what `npm run config:dev` writes.
2. Where that is 404, from the registry, `/nuxeo/agentic-ui-apps/apps/<id>/<path>`, with the
   person's credentials, when the app open lists the file.
3. Otherwise a 404, as before.

So a file `config:dev` writes wins, and on a server, where the first address is always 404, the
registry serves every file. The listing is read once per page, after the configuration, so that
`NUXEO_API_ORIGIN` is the configured one. A registry that does not answer, on a server without one
or before anyone signs in, is one with no app.

## Seeing an app is not a security control

The registry decides which apps the shell offers. Nuxeo's permissions still decide which records
anyone reads, through the REST API, whatever app is open.

## Not done yet

- **Branding and address:** the shell does not apply the open app's `branding`, nor open it at its
  `address`.
- **The platform range:** each `app.json` is validated without the platform's own version, which
  the shell does not know at run time.
- **One request more per file on a server:** the development server's address is asked first, and
  answers 404 there.
