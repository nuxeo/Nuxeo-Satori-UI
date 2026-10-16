# How to Add a New Feature Module

Follow these steps exactly. Do not deviate from the structure — it ensures Nx boundary rules
and lazy loading work correctly.

---

## Step 1 — Generate the Nx library

```bash
npx nx g @nx/angular:library \
  --name=feature-<name> \
  --directory=libs/features/<name> \
  --standalone \
  --no-component
```

---

## Step 2 — Create the directory structure

```
libs/features/<name>/
├── src/
│   ├── index.ts                      ← barrel file (exports routes + main component)
│   └── lib/
│       ├── lib.routes.ts             ← Routes array
│       └── <name>/
│           ├── <name>.ts             ← Main smart container component
│           └── <name>.html           ← External template (always external)
```

If the feature needs dialogs:

```
│       └── <dialog-name>/
│           ├── <dialog-name>.ts
│           └── <dialog-name>.html
```

---

## Step 3 — `lib.routes.ts`

```typescript
import { Routes } from '@angular/router';
import { MyFeatureComponent } from './my-feature/my-feature';

export const myFeatureRoutes: Routes = [{ path: '', component: MyFeatureComponent }];
```

---

## Step 4 — `src/index.ts`

```typescript
export { myFeatureRoutes } from './lib/lib.routes';
export { MyFeatureComponent } from './lib/my-feature/my-feature';
// Export any dialogs or sub-components that other parts of the app need
```

---

## Step 5 — Main component (`<name>.ts`)

```typescript
import { Component, signal, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DocumentDetailService } from '@nuxeo/satori-platform/nuxeo-client';

@Component({
  standalone: true,
  selector: 'app-my-feature',
  templateUrl: './my-feature.html',
  imports: [CommonModule, MatButtonModule, MatProgressSpinnerModule],
})
export class MyFeatureComponent {
  private readonly service = inject(DocumentDetailService);

  readonly items = signal<Item[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.loadItems();
  }

  loadItems(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .getItems()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (items) => {
          this.items.set(items);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Failed to load');
          this.loading.set(false);
        },
      });
  }
}
```

---

## Step 6 — Add lazy route to `apps/nuxeo-ui/src/app/app.routes.ts`

```typescript
{
  path: '<name>',
  loadChildren: () =>
    import('@agentic-ui/feature-<name>').then(m => m.<name>Routes),
},
```

---

## Step 7 — Add nav item to `apps/nuxeo-ui/src/app/platform-nav-items.ts`

```typescript
{
  label: 'My Feature',
  icon: 'my_icon',
  route: '/<name>',
},
```

---

## Step 8 — Update `docs/api-integrations.md`

Add an entry for any new Nuxeo API endpoint this feature calls.

---

## Step 9 — Run verification

```bash
npx nx affected -t lint
npx nx affected -t build
npx nx affected -t test
```

All must pass before committing.

---

## How to Add a Dialog to an Existing Feature

1. Create `libs/features/<feature>/src/lib/<dialog-name>/` with `.ts` and `.html`
2. Export from `libs/features/<feature>/src/index.ts`
3. Import `MatDialogModule` in the host component
4. Open via:

```typescript
const dialog = inject(MatDialog);

openMyDialog(): void {
  dialog.open(MyDialogComponent, {
    width: '500px',
    data: { ... } satisfies MyDialogData,
  });
}
```

5. In the dialog:

```typescript
export interface MyDialogData {
  docUid: string;
  // ...
}

@Component({ standalone: true, ... })
export class MyDialogComponent {
  readonly data = inject<MyDialogData>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<MyDialogComponent>);

  close(result?: unknown): void {
    this.dialogRef.close(result);
  }
}
```
