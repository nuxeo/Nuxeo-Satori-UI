# Developer Guide

This guide documents the coding conventions, project structure, and step-by-step patterns used in this repository. Follow these rules when contributing code so the codebase stays consistent. For high-level architecture boundaries and layer rules, see [architecture.md](architecture.md).

---

## 1. Prerequisites and Setup

| Requirement     | Version / Notes                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Node.js**     | LTS (v20 or v22 recommended; odd versions like v25 work but are not LTS)                                                    |
| **npm**         | Ships with Node; used as the package manager (see `.npmrc`)                                                                 |
| **Nuxeo**       | Running on `http://localhost:8080` for local development                                                                    |
| **Mailpit**     | Optional — required for `User.Invite` / invitation emails locally; see [`../nuxeo-conf/README.md`](../nuxeo-conf/README.md) |
| **Angular CLI** | Installed via `devDependencies` (`~20.3`); do not install globally                                                          |
| **Nx**          | Installed via `devDependencies` (`22.6`); invoked with `npx nx`                                                             |

### First-time setup

```bash
git clone <repo-url> && cd agentic-ui-poc
```

Set a GitHub Packages read token for the Hyland scoped packages (required for `@hylandsoftware/satori-ui` and the Satori fonts, icons and tokens it brings):

```powershell
# PowerShell
$env:SATORI_GH_READONLY_TOKEN = "<github-packages-read-token>"
npm install
```

The root [`.npmrc`](../.npmrc) maps `@hylandsoftware` to `https://npm.pkg.github.com` using `SATORI_GH_READONLY_TOKEN`.

### Start the dev server

Always use the Nx command so the proxy config (forwarding `/nuxeo` to `localhost:8080`) is applied:

```bash
npx nx serve nuxeo-ui        # http://localhost:4200
```

The proxy is defined in `apps/nuxeo-ui/proxy.conf.json` and referenced from `angular.json` serve options. If you must use `ng serve` directly, pass `--proxy-config apps/nuxeo-ui/proxy.conf.json`.

---

## 2. Project Structure

```text
agentic-ui-poc/
├── apps/
│   └── nuxeo-ui/                  # Application shell
│       ├── proxy.conf.json        # Dev proxy: /nuxeo -> localhost:8080
│       ├── public/                # Static assets (images, favicon)
│       └── src/
│           ├── index.html
│           ├── main.ts            # Bootstrap
│           ├── styles.scss        # Global styles + Satori theme
│           └── app/
│               ├── app.ts         # Root component (router-outlet only)
│               ├── app.config.ts  # Global providers
│               ├── app.routes.ts  # Top-level routes
│               ├── auth/          # Guards, service, interceptor
│               ├── shell/         # AppShellComponent (nav + header)
│               ├── login/         # LoginPageComponent
│               ├── dashboard/     # DashboardPageComponent
│               └── platform-nav-items.ts
├── libs/
│   ├── core/                      # Nuxeo client, auth, singletons
│   ├── shared/
│   │   ├── nuxeo-client/          # Nuxeo REST API services, models, queries
│   │   ├── ui/                    # Presentational components
│   │   └── util/                  # Pure TS helpers
│   └── features/
│       ├── browse/
│       ├── search/
│       └── document-detail/
├── docs/                          # Architecture, MVP checklist, obstacles log
├── angular.json                   # Angular CLI config (build/serve/test)
├── nx.json                        # Nx workspace config
├── tsconfig.base.json             # Shared compiler options + path aliases
└── package.json
```

### Dependency flow

```text
apps/nuxeo-ui
  ├──> libs/core
  ├──> libs/shared/nuxeo-client
  ├──> libs/shared/ui
  ├──> libs/shared/util
  └──> libs/features/*
         ├──> libs/core
         ├──> libs/shared/ui
         └──> libs/shared/util

libs/core ──> libs/shared/util
```

**Rules:**

- Features **must not** import other features. Communicate via the router or shared contracts.
- `libs/core` **must not** import from `libs/features/*`.
- `libs/shared/ui` **must not** import features or core.
- These boundaries are enforced by the `@nx/enforce-module-boundaries` ESLint rule in `eslint.config.mjs`.

### Import path aliases

All library imports use `@agentic-ui/` aliases defined in `tsconfig.base.json`:

| Alias                                 | Entry point                                  |
| ------------------------------------- | -------------------------------------------- |
| `@agentic-ui/core`                    | `libs/core/src/index.ts`                     |
| `@nuxeo-satori/platform/ui`           | `libs/shared/ui/src/index.ts`                |
| `@agentic-ui/shared/util`             | `libs/shared/util/src/index.ts`              |
| `@agentic-ui/feature-browse`          | `libs/features/browse/src/index.ts`          |
| `@agentic-ui/feature-search`          | `libs/features/search/src/index.ts`          |
| `@agentic-ui/feature-document-detail` | `libs/features/document-detail/src/index.ts` |

Always import from the alias, never from relative paths that cross library boundaries.

---

## 3. Naming Conventions

### Files

Use **kebab-case** for all file names:

| Kind         | Pattern                           | Example                                                |
| ------------ | --------------------------------- | ------------------------------------------------------ |
| Component    | `<name>.component.ts/.html/.scss` | `widget-container.component.ts`                        |
| Service      | `<name>.service.ts`               | `auth.service.ts`                                      |
| Guard        | `<name>.guards.ts`                | `auth.guards.ts`                                       |
| Interceptor  | `<name>.interceptor.ts`           | `nuxeo-auth.interceptor.ts`                            |
| Config token | `<name>.config.ts`                | `libs/shared/nuxeo-client/src/lib/nuxeo-api.config.ts` |
| Route file   | `lib.routes.ts`                   | (always this name in feature libs)                     |
| Public API   | `index.ts`                        | (always at `src/index.ts`)                             |

### Classes and selectors

- **Component classes**: PascalCase (`AppShellComponent`, `WidgetContainerComponent`).
- **Selectors**: kebab-case with a prefix:
  - `app-` for app-level components (e.g., `app-shell`, `app-login-page`)
  - `lib-` for shared UI components (e.g., `lib-widget-container`, `lib-widget-grid`)

### Route exports

Feature route arrays use **camelCase** with a `Routes` suffix:

```typescript
export const browseRoutes: Route[] = [...]
export const searchRoutes: Route[] = [...]
export const documentDetailRoutes: Route[] = [...]
```

---

## 4. Component Patterns

### Standalone by default

Angular 19 components are standalone by default. Do **not** add `standalone: true` unless the component explicitly needs it for compatibility in a mixed context. List dependencies in the `imports` array:

```typescript
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    SatPlatformNavModule,
    SatAppHeaderModule,
    MatMenuModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent { ... }
```

### Dependency injection: `inject()` over constructor

Use the `inject()` function for all DI. Do not use constructor parameter injection:

```typescript
// Correct
export class AppShellComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
}

// Wrong -- do not use constructor injection
export class AppShellComponent {
  constructor(
    private router: Router,
    private auth: AuthService,
  ) {}
}
```

### Signals for reactive state

Use Angular Signals (`signal()`, `computed()`) for component and service state. Avoid `BehaviorSubject` for new code:

```typescript
// Service state
private readonly state = signal<StoredSession | null>(null);
readonly username = computed(() => this.state()?.username ?? null);
readonly isAuthenticated = computed(() => this.state() !== null);

// Component-local state
readonly submitting = signal(false);
readonly step = signal<LoginStep>('username');

// Derived state
readonly pageTitle = computed(() => {
  const url = this.currentUrl();
  // navItems() resolves the `navbar` extension slot — see docs/extension-reference.md.
  const match = this.navItems().find(
    (item) => url === item.path || url.startsWith(item.path + '/'),
  );
  return match?.label ?? this.appConfig.bootstrap().branding.applicationTitle;
});
```

### Signal-based inputs

Use `input()` and `input.required()` for component inputs instead of the `@Input()` decorator:

```typescript
export class WidgetContainerComponent {
  readonly title = input.required<string>();
  readonly icon = input<string>();
  readonly iconColor = input<string>('');
}
```

Access them in templates by calling them as functions: `{{ title() }}`, `{{ icon() }}`.

### External templates and styles

Use **separate `.html` and `.scss` files** for all non-trivial components. Inline `template` and `styles` are acceptable only for minimal placeholders:

```typescript
// Acceptable for a placeholder
@Component({
  standalone: true,
  template: `<div class="placeholder"><p>Coming soon</p></div>`,
  styles: [
    `
      .placeholder {
        padding: 1.5rem;
      }
    `,
  ],
})
export class PlaceholderPageComponent {}
```

### RxJS subscriptions and cleanup

Use `takeUntilDestroyed()` from `@angular/core/rxjs-interop` when subscribing to observables in the constructor injection context:

```typescript
constructor() {
  this.router.events
    .pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntilDestroyed(),
    )
    .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects.split('?')[0]));
}
```

---

## 5. How to Add a New Feature Library

### Step 1: Generate the library

```bash
npx nx g @nx/angular:library --directory=libs/features/<name> --name=<name>
```

This creates the standard Nx Angular library scaffold with Vitest, ESLint config, and tsconfig files.

### Step 2: Create the route file

Create `libs/features/<name>/src/lib/lib.routes.ts`:

```typescript
import { Route } from '@angular/router';
import { MyFeature } from './<name>/<name>';

export const myFeatureRoutes: Route[] = [{ path: '', component: MyFeature }];
```

### Step 3: Export from the public API

Edit `libs/features/<name>/src/index.ts`:

```typescript
export * from './lib/lib.routes';
export * from './lib/<name>/<name>';
```

Routes are exported first so consumers can do `import('@agentic-ui/feature-<name>').then(m => m.myFeatureRoutes)`.

### Step 4: Add the path alias

In `tsconfig.base.json`, add:

```json
"@agentic-ui/feature-<name>": ["libs/features/<name>/src/index.ts"]
```

### Step 5: Add the lazy route

In `apps/nuxeo-ui/src/app/app.routes.ts`, add a child route under the shell:

```typescript
{
  path: '<url-segment>',
  loadChildren: () =>
    import('@agentic-ui/feature-<name>').then((m) => m.myFeatureRoutes),
},
```

### Step 6: Add a nav item (if applicable)

In `apps/nuxeo-ui/src/app/platform-nav-items.ts`, add an entry:

```typescript
{ label: 'My Feature', path: '/<url-segment>', icon: 'some_icon' },
```

Icon names must exist in `@hylandsoftware/satori-icons`.

---

## 6. How to Add a Shared UI Component

### Step 1: Create the component folder

```text
libs/shared/ui/src/lib/<component-name>/
  ├── <component-name>.component.ts
  ├── <component-name>.component.html
  └── <component-name>.component.scss
```

### Step 2: Write the component

Use the `ui-` selector prefix, `input()` / `input.required()` for the public API, and `ng-content` for content projection:

```typescript
import { Component, input } from '@angular/core';

@Component({
  selector: 'ui-my-component',
  standalone: true,
  imports: [],
  templateUrl: './my-component.component.html',
  styleUrl: './my-component.component.scss',
})
export class MyComponent {
  readonly label = input.required<string>();
  readonly variant = input<'primary' | 'secondary'>('primary');
}
```

Template with content projection:

```html
<div class="my-component">
  <span class="my-component-label">{{ label() }}</span>
  <ng-content />
</div>
```

### Step 3: Export from the library barrel

In `libs/shared/ui/src/index.ts`, add a named export:

```typescript
export { MyComponent } from './lib/my-component/my-component.component';
```

### Step 4: Import from consumers

```typescript
import { MyComponent } from '@nuxeo-satori/platform/ui';
```

---

## 7. Routing Patterns

### Shell layout

The app uses a **single shell route** (`AppShellComponent`) that wraps all authenticated pages with the Satori platform nav and app header. Child routes render inside the shell's `<router-outlet />`:

```typescript
{
  path: '',
  loadComponent: () =>
    import('./shell/app-shell.component').then((m) => m.AppShellComponent),
  canActivate: [authGuard],
  children: [
    { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    { path: 'dashboard', loadComponent: () => import(...) },
    { path: 'browse', loadChildren: () => import(...) },
    ...
  ],
},
```

### Lazy loading

- **Feature libraries** with child routes: use `loadChildren` pointing to the feature's `*Routes` array.
- **Standalone pages** without child routes: use `loadComponent`.
- **Placeholder routes** (not yet implemented): share the `placeholder` factory:

```typescript
const placeholder = () =>
  import('./placeholder-page.component').then((m) => m.PlaceholderPageComponent);

{ path: 'tasks', loadComponent: placeholder },
```

### Route guards

Guards are exported as `CanActivateFn` functions (not classes):

```typescript
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(['/login']);
};
```

- `authGuard` protects the shell and all authenticated child routes.
- `loginGuard` prevents navigating to `/login` when already authenticated.

---

## 8. Service and State Patterns

### Singleton services

Use `providedIn: 'root'` for app-wide singletons. Do not add them to module `providers` arrays:

```typescript
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  ...
}
```

### Nuxeo client library (`@nuxeo-satori/platform/nuxeo-client`)

All Nuxeo REST API services live in `libs/shared/nuxeo-client/`. The library is split by domain:

| Layer    | Path                                 | Contents                                                  |
| -------- | ------------------------------------ | --------------------------------------------------------- |
| Models   | `src/lib/models/`                    | `NuxeoDocument`, `NuxeoTask`, `NuxeoPaginatedList`, etc.  |
| Queries  | `src/lib/queries/nxql-queries.ts`    | NXQL query constants                                      |
| Services | `src/lib/services/`                  | `DocumentService`, `TaskService`, `CollectionService`     |
| Base     | `src/lib/services/nuxeo-api-base.ts` | Shared HTTP helpers (`apiUrl()`, `nxqlSearch()`, `get()`) |
| Config   | `src/lib/nuxeo-api.config.ts`        | `NUXEO_API_ORIGIN` injection token                        |

When adding a new Nuxeo API domain (e.g., workflows, users, audit), create a new service file in `src/lib/services/`, a model file if needed, and re-export from `src/index.ts`. Import in consumers via:

```typescript
import { DocumentService, NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';
```

### Signal-based state management

Services hold state in `signal()` and expose derived values via `computed()`:

```typescript
private readonly state = signal<StoredSession | null>(null);

readonly username = computed(() => this.state()?.username ?? null);
readonly isAuthenticated = computed(() => this.state() !== null);
```

Mutate state with `.set()` or `.update()`. Never expose the writable signal directly; expose only the computed read-only projections.

### Injection tokens for configuration

Use `InjectionToken` with `providedIn: 'root'` and a `factory` for configuration values that may vary by environment:

```typescript
export const NUXEO_API_ORIGIN = new InjectionToken<string>('NUXEO_API_ORIGIN', {
  providedIn: 'root',
  factory: () => '',
});
```

Inject in services via `inject(NUXEO_API_ORIGIN)`.

### HTTP interceptors

Write interceptors as `HttpInterceptorFn` functions (not classes):

```typescript
export const nuxeoAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const basic = auth.basicCredentials();
  if (!basic || !req.url.includes('/nuxeo/')) {
    return next(req);
  }
  return next(
    req.clone({
      setHeaders: { Authorization: `Basic ${basic}` },
    }),
  );
};
```

Register interceptors in `app.config.ts`:

```typescript
provideHttpClient(withInterceptors([nuxeoAuthInterceptor])),
```

### Documenting API integrations

Every new Nuxeo API call **must** be documented in [docs/api-integrations.md](api-integrations.md). Copy the template at the bottom of that file and fill in:

- **Title** -- short name for the integration
- **API Endpoint** -- HTTP method and path (e.g., `GET /nuxeo/api/v1/search/lang/NXQL/execute`)
- **Payload Details** -- query parameters, request body, headers, and response shape

This ensures any contributor can quickly see which APIs are in use, what they return, and which service owns them.

---

## 9. Styling Guide

### Global theme

Satori theme is applied in `apps/nuxeo-ui/src/styles.scss`:

```scss
@use '@hylandsoftware/satori-ui/theme' as sat;

html {
  color-scheme: light dark;
  @include sat.theme;
}
```

### Material Icons

The Material Icons font is loaded in `apps/nuxeo-ui/src/index.html`. Use `<mat-icon>icon_name</mat-icon>` with ligature names.

### Body classes

`index.html` applies `mat-app-background mat-typography` to `<body>` for Angular Material baseline styles.

### Component styles

- Each component gets its own `.scss` file with `:host` block for host element sizing.
- Component styles are **encapsulated** by default (Angular view encapsulation). Do **not** set `ViewEncapsulation.None`.
- Global overrides for third-party component quirks (e.g., Satori nav clipping) go in `styles.scss`.

### Responsive design

Use a **900px breakpoint** for mobile/tablet layouts:

```scss
@media (max-width: 900px) {
  .login-page {
    flex-direction: column;
  }
}
```

---

## 10. Testing Conventions

### App tests: Karma + Jasmine

The `nuxeo-ui` app uses Karma with Jasmine. Test files are colocated with their source as `*.spec.ts`.

Run app tests:

```bash
npx nx test nuxeo-ui
```

### Library tests: Vitest + Analog

All libraries under `libs/` use **Vitest** with the **Analog** Angular plugin. Each library has:

- `vite.config.mts` with the `@analogjs/vite-plugin-angular` plugin
- `src/test-setup.ts` for Angular test environment setup
- `tsconfig.spec.json` pointing to the test setup

Run library tests:

```bash
npx nx test <library-name>    # e.g., npx nx test browse
```

### Mocking signals in tests

When mocking services that use Angular Signals, provide actual `signal()` instances -- **not** plain functions:

```typescript
const authMock = {
  isAuthenticated: signal(true),
  username: signal('test.user'),
  basicCredentials: () => 'dGVzdA==',
  logout: () => {},
} as unknown as AuthService;

await TestBed.configureTestingModule({
  imports: [App],
  providers: appConfig.providers,
})
  .overrideProvider(AuthService, { useValue: authMock })
  .compileComponents();
```

This ensures the signal's `.call()` behavior works correctly in templates and computed values that depend on `auth.isAuthenticated()`.

---

## 11. Formatting and Linting

### Prettier

Configuration in `.prettierrc`:

| Setting       | Value                         |
| ------------- | ----------------------------- |
| `printWidth`  | 100                           |
| `singleQuote` | true                          |
| HTML parser   | `angular` (for `.html` files) |

Run manually:

```bash
npx prettier --write "**/*.{ts,html,scss,json}"
```

### EditorConfig

`.editorconfig` enforces:

- 2-space indentation
- UTF-8 charset
- Trailing newline
- Single quotes for TypeScript files

### ESLint

The root `eslint.config.mjs` applies:

- Nx base + TypeScript + JavaScript flat configs
- **`@nx/enforce-module-boundaries`** to prevent illegal cross-layer imports

Run linting:

```bash
npx nx lint <project>          # lint a single project
npx nx run-many -t eslint:lint # lint all projects
```

---

## 12. Common Commands

| Command                                             | Purpose                                         |
| --------------------------------------------------- | ----------------------------------------------- |
| `npm install`                                       | Install dependencies                            |
| `npx nx serve nuxeo-ui`                             | Dev server with proxy (`http://localhost:4200`) |
| `npx nx build nuxeo-ui`                             | Production build (output: `dist/nuxeo-ui/`)     |
| `npx nx build nuxeo-ui --configuration=development` | Development build                               |
| `npx nx test nuxeo-ui`                              | App unit tests (Karma)                          |
| `npx nx test <library>`                             | Library unit tests (Vitest)                     |
| `npx nx lint <project>`                             | ESLint for a project                            |
| `npx nx run-many -t test`                           | Run tests across all projects                   |
| `npx nx run-many -t eslint:lint`                    | Lint all projects                               |
| `npx nx graph`                                      | Open the dependency graph visualization         |
| `npx nx affected -t test`                           | Run tests only for affected projects            |
| `npx nx affected -t build`                          | Build only affected projects                    |
| `npx prettier --check .`                            | Verify formatting                               |
| `npx prettier --write .`                            | Fix formatting                                  |

---

## Appendix: App Configuration Reference

The global provider setup in `apps/nuxeo-ui/src/app/app.config.ts`:

| Provider                                             | Purpose                                              |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `provideAnimations()`                                | Angular animations (required by Material and Satori) |
| `provideHttpClient(withInterceptors([...]))`         | HTTP client with auth interceptor                    |
| `provideRouter(routes, withComponentInputBinding())` | Router with route-to-input binding                   |
| `provideSatori()`                                    | Satori UI theme and services                         |
| `TranslateModule.forRoot(...)`                       | ngx-translate with no-op loader (PoC placeholder)    |
