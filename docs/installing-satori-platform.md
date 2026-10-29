# Installing `@nuxeo/satori-platform`

`@nuxeo/satori-platform` is the Nuxeo Satori platform package. It is published to the Nuxeo
registry, `https://packages.nuxeo.com/repository/npm-public/`, under the `@nuxeo` scope.
Installing it needs **no registry login and no token**.

> **Status:** not yet published. The commands below are the intended consumer steps. They are
> verified only against a locally built tarball (see `libs/platform/README.md`), not against the
> live registry. Once the first `alpha` is published, re-run them in a clean project and update
> this line.

## 1. Point the `@nuxeo` scope at the Nuxeo registry

Add one line to the project's `.npmrc`:

```ini
@nuxeo:registry=https://packages.nuxeo.com/repository/npm-public/
```

Without it, npm looks for `@nuxeo/satori-platform` on public npm, where it does not exist.

## 2. Install the alpha

```bash
npm install @nuxeo/satori-platform@alpha
```

The first release is published under the `alpha` dist-tag, so `npm install` without `@alpha`
does not pick it up. A `latest` tag is only set by a deliberate promotion.

## 3. Peer dependencies

npm installs these for you, and they resolve from public npm:

| Peer                                                                                                 | Range     |
| ---------------------------------------------------------------------------------------------------- | --------- |
| `@angular/cdk`, `@angular/material`, `@angular/material-date-fns-adapter`                            | `^22.2.0` |
| `@angular/common`, `@angular/core`, `@angular/forms`, `@angular/platform-browser`, `@angular/router` | `^22.2.3` |
| `@ngx-translate/core`                                                                                | `^18.0.0` |
| `date-fns`                                                                                           | `^2.30.0` |
| `rxjs`                                                                                               | `^7.8.0`  |

`@hylandsoftware/satori-ui` is an **optional** peer. It is needed only by
`@nuxeo/satori-platform/components-satori`, and it is installed from GitHub Packages, which
requires a token. Leave it out to use the platform without the Satori-backed components.

## 4. Use it

```ts
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { ConfirmDialogComponent } from '@nuxeo/satori-platform/ui';
```

The package's entry points are `.`, `/app-config`, `/components`, `/components-satori`,
`/extensions`, `/nuxeo-client` and `/ui`. `/components-satori` needs the optional peer in step 3. The extension contract is described in the package README.

## Troubleshooting

- **`404 Not Found` for `@nuxeo/satori-platform`**: step 1 is missing, or the `.npmrc` is not in
  the project root.
- **An `@hylandsoftware/satori-ui` error**: the optional peer needs GitHub Packages access. Leave
  it out, or use a GitHub token that can read `@hylandsoftware` packages.
