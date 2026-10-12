# Angular Conventions — Non-Negotiable Rules

These conventions are enforced by ESLint, Nx boundary rules, and code review.
Every piece of code in this repository follows these patterns.

---

## Component Template

```typescript
@Component({
  standalone: true,                          // ALWAYS — no NgModules anywhere
  selector: 'app-my-feature',
  templateUrl: './my-feature.component.html', // ALWAYS external — never inline template
  imports: [
    CommonModule,                            // or specific directives (NgIf, NgFor)
    MatButtonModule,
    // ... only what this component needs
  ],
  changeDetection: ChangeDetectionStrategy.OnPush, // preferred but not mandatory
})
export class MyFeatureComponent {
```

---

## Dependency Injection

```typescript
// CORRECT — inject() function
export class MyComponent {
  private readonly service = inject(MyService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
}

// WRONG — never use constructor parameters
export class MyComponent {
  constructor(private service: MyService) {} // ❌
}
```

---

## State Management with Signals

```typescript
export class MyComponent {
  // Mutable state — use signal()
  readonly items = signal<Item[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly selectedId = signal<string | null>(null);

  // Derived state — use computed()
  readonly count = computed(() => this.items().length);
  readonly hasItems = computed(() => this.items().length > 0);
  readonly selectedItem = computed(() => this.items().find((i) => i.id === this.selectedId()));

  // Side effects — use effect()
  constructor() {
    effect(() => {
      // Runs when routeParam() changes — use for loading data on param change
      const id = this.docId();
      if (id) this.loadDocument(id);
    });
  }

  // Updating signals
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
          this.error.set('Failed to load items');
          this.loading.set(false); // ALWAYS reset on error so user can retry
        },
      });
  }
}
```

---

## Observable Subscriptions

```typescript
// CORRECT — always use takeUntilDestroyed()
private readonly destroyRef = inject(DestroyRef);

ngOnInit(): void {
  this.service.getData()
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe(data => this.data.set(data));
}

// In constructor (preferred — destroyRef not needed)
constructor() {
  this.service.getData()
    .pipe(takeUntilDestroyed())  // works in constructor without explicit DestroyRef
    .subscribe(data => this.data.set(data));
}

// WRONG — memory leak
ngOnInit(): void {
  this.service.getData().subscribe(data => this.data.set(data)); // ❌ no cleanup
}
```

---

## Blob URL Lifecycle

```typescript
// CORRECT — always revoke in ngOnDestroy
private blobUrls: string[] = [];

loadImage(uid: string): void {
  this.service.fetchThumbnail(uid)
    .pipe(takeUntilDestroyed())
    .subscribe(blob => {
      const url = URL.createObjectURL(blob);
      this.blobUrls.push(url);
      this.imageUrl.set(url);
    });
}

ngOnDestroy(): void {
  this.blobUrls.forEach(url => URL.revokeObjectURL(url));
}

// WRONG — memory leak
loadImage(uid: string): void {
  this.service.fetchThumbnail(uid).subscribe(blob => {
    this.imageUrl.set(URL.createObjectURL(blob)); // ❌ never revoked
  });
}
```

---

## Authenticated Content (Images)

**A document thumbnail is `<nxs-thumbnail>`** (`@nuxeo-satori/platform/components`). It fetches
the rendition through `fetchThumbnail`, owns the blob URL and revokes it when the document changes
and on destroy, and shows its projected content (the type icon) until the image arrives or when
there is none. Size it with a class on the host; do not set `display` on it. A page that lists many
lists `provideNxsThumbnailCache()` in its `providers`: its thumbnails then share one request per
document, keep their URL across a view switch, and run at most four requests at once.

```html
<nxs-thumbnail class="doc-thumb" [documentId]="doc.uid">
  <mat-icon class="doc-icon">{{ docIcon(doc) }}</mat-icon>
</nxs-thumbnail>
```

For any other authenticated image — an attachment preview, a picture view — the pattern below
still applies:

```typescript
// CORRECT — fetch via HttpClient (interceptor adds auth header)
loadThumbnail(uid: string): void {
  this.documentDetailService.fetchThumbnail(uid)
    .pipe(takeUntilDestroyed())
    .subscribe(blob => {
      this.thumbnailUrl.set(URL.createObjectURL(blob));
    });
}
```

```html
<!-- CORRECT — blob URL from signal -->
<img [src]="thumbnailUrl()" alt="thumbnail" />

<!-- WRONG — browser fetches directly, bypasses auth interceptor -->
<img [src]="doc.contextParameters['thumbnail']?.url" />
<!-- ❌ -->
```

---

## Component Inputs (Route-bound)

```typescript
// CORRECT — use input() signal for route param binding
export class DocumentDetailComponent {
  readonly docUid = input.required<string>(); // bound via withComponentInputBinding()

  constructor() {
    effect(() => {
      const uid = this.docUid();
      // Reset all state when uid changes
      this.doc.set(null);
      this.loading.set(true);
      this.loadDocument(uid);
    });
  }
}
```

---

## Template Patterns

```html
<!-- Loading / empty / content states -->
@if (loading()) {
<mat-progress-spinner />
} @else if (error()) {
<p class="error">{{ error() }}</p>
} @else if (items().length === 0) {
<p class="empty">No items found.</p>
} @else { @for (item of items(); track item.id) {
<app-item-card [item]="item" />
} }

<!-- Event binding -->
<button mat-button (click)="openDialog()">Open</button>

<!-- WRONG — never use div with click -->
<div (click)="openDialog()">Open</div>
<!-- ❌ not accessible -->
```

---

## Nx Import Rules

```typescript
// Features import from shared
import { DocumentDetailService } from '@nuxeo-satori/platform/nuxeo-client';
import { WidgetContainerComponent } from '@nuxeo-satori/platform/ui';

// Features NEVER import from other features
import { BrowseComponent } from '@agentic-ui/feature-browse'; // ❌ BANNED
```

---

## Service Pattern

```typescript
@Injectable({ providedIn: 'root' })
export class MyDomainService {
  private readonly api = inject(NuxeoApiBase); // inject NuxeoApiBase, not HttpClient

  getDocument(uid: string): Observable<NuxeoDocument> {
    return this.api.get<NuxeoDocument>(`/nuxeo/api/v1/id/${uid}`);
  }

  createDocument(properties: Partial<NuxeoDocument>): Observable<NuxeoDocument> {
    return this.api.post<NuxeoDocument>('/nuxeo/api/v1/path/default-domain/workspaces', properties);
  }
}
```
