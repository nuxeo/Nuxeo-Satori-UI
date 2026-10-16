# @agentic-ui/acme-extensions

A **Layer 2** extension library for the Nuxeo Satori platform. It contributes to
the application's addressable surface by registering IDs — it does not modify the
platform, and it does not need to be merged into it.

## It is inert until an application opts in

Nothing here runs on install. Add one line to your application's providers:

```ts
import { provideAcmeExtensions } from '@agentic-ui/acme-extensions';

export const appConfig: ApplicationConfig = {
  providers: [
    // ...
    provideAcmeExtensions(),
  ],
};
```

That is the whole integration. **No edits to any `@nuxeo/satori-platform` library**
are required, which is the property this library exists to demonstrate.

## What it registers

| Kind        | ID                                  | Where it lives             |
| ----------- | ----------------------------------- | -------------------------- |
| Navbar item | `acme.navbar.acmeExtensions`        | `src/lib/extensions.ts`    |
| Rule        | `acme.rules.canUseAcme`             | `src/lib/rules.service.ts` |
| Action      | `acme.actions.acmeExtensionsExport` | `src/lib/rules.service.ts` |
| Component   | `acme.panel.acmeExtensions`         | `src/lib/panel/`           |

`ACME_EXTENSIONS_EXTENSION_IDS` exports this list, and a spec asserts it against
what is actually in the registries — so the table cannot drift from the code.

### IDs are a public contract

Every ID is `<owner>.<surface>.<name>`. Once a manifest references one, **renaming
it is a breaking change**. Keep your own `acme.` prefix; it is what
guarantees you never collide with the platform's `app.` IDs or another vendor's.

## Layer 1: what a manifest can do to this without touching the code

Hide it, reorder it, relabel it, gate it behind a different rule, or place the
panel somewhere else — all from the runtime manifest:

```json
{
  "extensions": {
    "overrides": {
      "acme.navbar.acmeExtensions": { "label": "Renamed", "order": 15 }
    },
    "slots": {
      "sidebar": [
        {
          "id": "acme.sidebar.acmeExtensions",
          "label": "AcmeExtensions",
          "component": "acme.panel.acmeExtensions",
          "order": 10
        }
      ]
    }
  }
}
```

## Hiding a control is not a security control

Layer 1 decides what the UI **offers**. Nuxeo decides what the server **allows**,
server-side, on every operation. `failClosedRules` makes an unregistered rule deny
rather than permit, which closes a startup-timing gap in the _interface_ — it is
not authorisation. Use Nuxeo ACLs for that.

## Verify

```bash
npx nx test acme-extensions        # asserts the IDs are really registered
npx nx typecheck acme-extensions   # `test` does not typecheck — vitest strips types
npx nx lint acme-extensions
```

`typecheck` is not redundant. Vitest strips types through esbuild, so a green
`test` is not type safety.

## Making it yours

1. Replace the contributions in `src/lib/extensions.ts`.
2. Put your logic in `src/lib/rules.service.ts` — it is an ordinary
   injectable, so inject `HttpClient` or your own services freely.
3. Update `ACME_EXTENSIONS_EXTENSION_IDS` and the spec's expected IDs together.
4. Keep the shape of the spec's assertions. They check observable registry state,
   which is the only thing that catches a descriptor nothing renders.
