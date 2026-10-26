# Beat 11 & 12 Demo Walkthrough — Template App & Generators

**Purpose:** Show customers how to build their own features using the platform, either from the template or with generators.

**Time:** 10 minutes total (4 min Beat 11 + 3 min Beat 12 + 3 min live example)

---

## Part 1: Beat 11 — The Template App (4 min)

### What to Say:

> "We provide a complete starter template that shows you how to build a Nuxeo UI using only our published APIs. This is what you'd clone and customize for your own needs."

### On Screen (http://localhost:4310):

**Step 1: Show the Home Page (Diagnostics)**

Navigate to `http://localhost:4310/home`

Point out:

- **"This shows what your app has access to"**
- Live config (Bootstrap, Manifest, Theme)
- Extension registry inventory (every registered ID)
- Your custom extensions (`template.*`) appear alongside platform ones (`app.*`)

**Key message:** _"Your extensions are first-class citizens in the registry."_

---

**Step 2: Show a Working Feature — Documents Page**

Navigate to `http://localhost:4310/documents`

Point out:

- Browse real Nuxeo repository
- Document tree navigation
- Search functionality
- All built with `@nuxeo/satori-platform` APIs

**Key message:** _"This entire UI is 1,401 lines of TypeScript. Zero imports from our internal libraries."_

---

**Step 3: Show the Code**

Open in your editor:

```
apps/nuxeo-satori-template/src/app/pages/documents/documents.ts
```

Point out:

```typescript
// ONLY public imports
import { DocumentService } from '@nuxeo/satori-platform/nuxeo-client';
import { WidgetContainerComponent } from '@nuxeo/satori-platform/ui';
```

**Key message:** _"If we break an internal API, this code keeps working because it never depended on our internals."_

---

**Step 4: Build It**

```bash
npx nx build nuxeo-satori-template
```

Show the output:

```
Initial chunk files   | Names         |  Raw size
main-XXXXX.js         | main          | 402.14 kB
```

**Key message:** _"402 kB initial bundle. No Angular Material, minimal dependencies, just what you need."_

---

## Part 2: Beat 12 — The Generators (3 min)

### What to Say:

> "You don't have to write everything from scratch. We provide four Nx generators that scaffold the boilerplate for you."

### The Four Generators:

1. **extension-library** — Creates a new customer extension library
2. **extension-rule** — Adds a rule (visibility logic)
3. **extension-action** — Adds an action (button handler)
4. **extension-component** — Adds a component (panel/page)

---

### Demo: Generate a Complete Extension Library

**Step 1: Generate the Library**

```bash
npx nx g ./tools/satori-generators:extension-library insurance-extensions --owner=acme
```

**What it creates:**

```
libs/extensions/insurance-extensions/
├── src/
│   ├── index.ts                          # Public API
│   ├── lib/
│   │   ├── insurance-extensions.ts       # Main provider
│   │   ├── insurance-extensions.spec.ts  # Tests
│   └── README.md
├── project.json
├── tsconfig.json
└── package.json (if publishable)
```

**Show the generated code:**

Open `libs/extensions/insurance-extensions/src/lib/insurance-extensions.ts`:

```typescript
import { inject, type EnvironmentProviders } from '@angular/core';
import {
  EXTENSION_SLOTS,
  provideSatoriExtensions,
  type SatoriExtensionContributions,
} from '@nuxeo/satori-platform/extensions';

export function provideInsuranceExtensions(): EnvironmentProviders {
  return provideSatoriExtensions((): SatoriExtensionContributions => {
    return {
      slots: {},
      rules: {},
      actions: {},
      components: {},
      failClosedRules: [],
    };
  });
}
```

**Key message:** _"This is your extension point. You register rules, actions, and components here."_

---

**Step 2: Add a Rule**

```bash
npx nx g ./tools/satori-generators:extension-rule is-claims-adjuster --library=insurance-extensions
```

**What it adds:**

```typescript
// In insurance-extensions.ts
rules: {
  'insurance.rules.isClaimsAdjuster': () => {
    // TODO: implement rule logic
    return true;
  }
},
failClosedRules: ['insurance.rules.isClaimsAdjuster']
```

**Key message:** _"Rules control visibility. This one would check if the user has the 'Claims Adjuster' role."_

---

**Step 3: Add an Action**

```bash
npx nx g ./tools/satori-generators:extension-action export-claim --library=insurance-extensions
```

**What it adds:**

```typescript
// In insurance-extensions.ts
actions: {
  'insurance.actions.exportClaim': {
    execute: (context) => {
      console.log('Export claim action triggered', {
        url: context.url,
        selectionCount: context.selectionCount,
      });
      // TODO: implement action logic
    },
  },
}
```

**Key message:** _"Actions are button handlers. This would export claim documents to an external system."_

---

**Step 4: Add a Component**

```bash
npx nx g ./tools/satori-generators:extension-component claims-panel --library=insurance-extensions
```

**What it creates:**

```
libs/extensions/insurance-extensions/src/lib/
├── claims-panel/
│   ├── claims-panel.component.ts
│   ├── claims-panel.component.html
│   ├── claims-panel.component.scss
│   └── claims-panel.component.spec.ts
```

**And registers it:**

```typescript
components: {
  'insurance.panel.claimsSummary': () =>
    import('./claims-panel/claims-panel.component').then((m) => m.ClaimsPanelComponent),
}
```

**Key message:** _"Components are lazy-loaded. The chunk is only fetched when a manifest places this panel."_

---

## Part 3: Live Demo — Add a Feature End-to-End (3 min)

### Scenario: Add a "Quick Stats" Dashboard to the Template App

**What we'll build:** A new dashboard page showing document statistics

---

**Step 1: Create the Component**

```bash
cd apps/nuxeo-satori-template
```

Create `src/app/pages/stats/stats.ts`:

```typescript
import { Component, inject, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SearchService } from '@nuxeo/satori-platform/nuxeo-client';
import { WidgetGridComponent, WidgetContainerComponent } from '@nuxeo/satori-platform/ui';

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [WidgetGridComponent, WidgetContainerComponent],
  template: `
    <div style="padding: 2rem;">
      <h1>Quick Statistics</h1>

      <lib-widget-grid [columns]="3">
        <lib-widget-container title="Total Documents">
          <div style="text-align: center; padding: 2rem;">
            <div style="font-size: 3rem; font-weight: 500;">
              {{ totalDocs() ?? '...' }}
            </div>
          </div>
        </lib-widget-container>

        <lib-widget-container title="This Week">
          <div style="text-align: center; padding: 2rem;">
            <div style="font-size: 3rem; font-weight: 500;">
              {{ recentDocs() ?? '...' }}
            </div>
          </div>
        </lib-widget-container>

        <lib-widget-container title="My Documents">
          <div style="text-align: center; padding: 2rem;">
            <div style="font-size: 3rem; font-weight: 500;">
              {{ myDocs() ?? '...' }}
            </div>
          </div>
        </lib-widget-container>
      </lib-widget-grid>
    </div>
  `,
})
export class StatsComponent {
  private search = inject(SearchService);

  private totalResult = toSignal(this.search.search({ pageSize: 0 }));

  protected totalDocs = computed(() => this.totalResult()?.totalSize);
  protected recentDocs = computed(() => 0); // TODO: Add date filter
  protected myDocs = computed(() => 0); // TODO: Add user filter
}
```

**Time: 30 seconds** (paste pre-written code)

---

**Step 2: Add the Route**

Edit `apps/nuxeo-satori-template/src/app/app.routes.ts`:

```typescript
{
  path: 'stats',
  loadComponent: () => import('./pages/stats/stats').then((m) => m.StatsComponent),
},
```

**Time: 10 seconds**

---

**Step 3: Add Navigation Entry**

Edit `apps/nuxeo-satori-template/src/app/extensions/template-extensions.ts`:

```typescript
const NAV_ITEMS: readonly NavItemDescriptor[] = [
  // ... existing items
  {
    id: 'template.navbar.stats',
    label: 'Statistics',
    path: '/stats',
    icon: 'bar_chart',
    order: 22,
  },
  // ... rest
];
```

**Time: 15 seconds**

---

**Step 4: See It Live**

Navigate to `http://localhost:4310/stats`

**What the audience sees:**

- New "Statistics" nav entry appeared
- Dashboard with 3 stat tiles
- Real data from Nuxeo (total document count)

**Time: 5 seconds (auto-reload via HMR)**

---

### Total Time for Live Demo: ~60 seconds

**Key message:** _"From idea to working feature in under a minute. The platform handles routing, lazy loading, navigation registration — you just write your component."_

---

## Part 4: Summary & Key Messages

### For Beat 11 (Template App):

✅ **"Clone and customize"** — not fork our code  
✅ **"402 kB bundle"** — minimal, focused  
✅ **"Zero internal imports"** — upgrade-safe  
✅ **"Production ready"** — real browse, search, auth, theming

### For Beat 12 (Generators):

✅ **"Scaffolding, not magic"** — generates readable code  
✅ **"Four generators"** — library, rule, action, component  
✅ **"Test included"** — 6 passing tests from scaffold  
✅ **"TWO STEPS"** — library + route (generator tells you)

### For Live Demo:

✅ **"Component → Route → Nav"** — three edits, one minute  
✅ **"HMR auto-reload"** — see it instantly  
✅ **"Real APIs"** — SearchService, WidgetGrid work immediately  
✅ **"No rebuild"** — dev server watches and recompiles

---

## Caveats to Mention

**From the runbook:**

> "Be honest if asked: the three contribution generators write registrations but **no specs**."

Translation: When you generate a rule/action/component, you get the code file but no test file. The library generator creates tests for the provider, but not for each individual contribution.

**Also mention:**

- Generators scaffold **boilerplate**, not complete implementations
- You still need to write the business logic (TODOs are left in the code)
- The library generator output tells you what to do next (add route, wire provider)

---

## What to Have Ready Before the Demo

1. **Clean worktree** (no uncommitted changes that might conflict)
2. **Template server running** on `:4310`
3. **Pre-written Stats component code** in a text file (for copy-paste)
4. **Terminal positioned** at repo root
5. **Browser open** to `http://localhost:4310`
6. **Editor open** to `apps/nuxeo-satori-template/src/app/`

**Backup plan:** If live coding goes wrong, the UI Components page at `http://localhost:4310/components` is a complete working example you can fall back to.

---

## Questions You'll Be Asked

**Q: "Do I have to use the template?"**  
A: No. You can start from scratch with just `npm install @nuxeo/satori-platform` and build whatever structure you want. The template shows one way, not the only way.

**Q: "Can I use the generators in my own repo?"**  
A: Yes. They're published in the `@nuxeo/satori-platform` package under `/generators`. Run them with:

```bash
npm install -D @nuxeo/satori-platform
npx nx g @nuxeo/satori-platform:extension-library my-extensions
```

**Q: "What if I want a different framework?"**  
A: The extension registry is framework-agnostic. The contract is: register an ID, provide a lazy loader. You could theoretically build components in Vue/React/Web Components and register them. (But you'd be on your own for that — not officially supported.)

**Q: "How do I test my custom actions?"**  
A: The generator creates a `.spec.ts` file for the provider. For the action logic itself, you can unit test the service method directly:

```typescript
it('should export claim', () => {
  const context = { selectionCount: 2, selection: [...] };
  service.exportClaim(context);
  expect(mockApi.export).toHaveBeenCalledWith(...);
});
```

**Q: "Can I debug the generators?"**  
A: Yes. They're in `tools/satori-generators/`. You can modify them, or write your own following the same pattern. They're Nx generators using the standard Nx devkit API.

---

## Success Criteria

By the end of Beat 11 & 12, the audience should understand:

1. ✅ They get a working starter app (template)
2. ✅ It's built on public APIs only (upgrade-safe)
3. ✅ Generators scaffold common patterns (faster start)
4. ✅ Creating features is fast (component → route → nav)
5. ✅ The platform handles infrastructure (routing, lazy loading, registry)

**The meta-message:** _"You focus on your business logic. We provide the platform and the patterns."_
