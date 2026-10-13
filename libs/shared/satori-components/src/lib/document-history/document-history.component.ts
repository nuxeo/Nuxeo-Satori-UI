import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, type Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { TranslatePipe } from '@ngx-translate/core';
import {
  DirectoryService,
  DocumentDetailService,
  type AuditEntry,
  type AuditLogQuery,
  type AuditLogSortField,
  type DirectoryEntry,
} from '@nuxeo-satori/platform/nuxeo-client';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  forkJoin,
  map,
  of,
  Subject,
  switchMap,
  tap,
} from 'rxjs';

import { NxsAvatarComponent } from '../avatar/avatar.component';
import { NxsEmptyStateComponent } from '../empty-state/empty-state.component';
import { NxsErrorStateComponent } from '../error-state/error-state.component';
import { nxsErrorStatus, type NxsErrorStatus } from '../error-state/error-status';
import type { NxsHeadingLevel } from '../heading-level';
import { NxsSpinnerComponent } from '../spinner/spinner.component';
import { NxsTagComponent } from '../tag/tag.component';

const SORTABLE: readonly AuditLogSortField[] = [
  'eventId',
  'eventDate',
  'principalName',
  'category',
];

/** The filters, as the user set them. */
interface NxsHistoryFilters {
  readonly user: string;
  readonly from: Date | null;
  readonly to: Date | null;
  readonly eventId: string;
  readonly category: string;
}

type NxsHistoryPage =
  | { readonly entries: readonly AuditEntry[]; readonly total: number }
  | { readonly failure: NxsErrorStatus };

const NO_FILTERS: NxsHistoryFilters = { user: '', from: null, to: null, eventId: '', category: '' };

/** Start of the day after `day`, local time: the adapter's end is exclusive, the user's "To" is not. */
function dayAfter(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
}

function startOf(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

/** "documentModified" → "Document Modified", for an event the directory does not name. */
function humanise(id: string): string {
  return id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

/**
 * A document's history — Web UI's `nuxeo-document-history`, which is its audit search for one
 * document.
 *
 * As in Web UI, every filter and the sort go to the server (`@audit`), so they reach every entry
 * rather than the page on screen: the user who acted (an exact username), a From and To day, the
 * performed action and the event category. The table shows the action, when, who, the category,
 * the comment and the lifecycle state, newest first, a page at a time. Action and category read
 * through the `eventTypes` and `eventCategories` vocabularies.
 *
 * It needs a Material `DateAdapter`, as any datepicker does; the host provides it.
 */
@Component({
  selector: 'nxs-document-history',
  standalone: true,
  templateUrl: './document-history.component.html',
  styleUrl: './document-history.component.scss',
  imports: [
    DatePipe,
    FormsModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    TranslatePipe,
    NxsAvatarComponent,
    NxsEmptyStateComponent,
    NxsErrorStateComponent,
    NxsSpinnerComponent,
    NxsTagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-document-history' },
})
export class NxsDocumentHistoryComponent {
  private readonly documents = inject(DocumentDetailService);
  private readonly directories = inject(DirectoryService);

  /** The document whose history this is. */
  readonly documentUid = input.required<string>();
  /** Entries per page; the user can change it. */
  readonly pageSize = input(20);
  /** The heading level of the empty and error states, one below the section's own. */
  readonly headingLevel = input<NxsHeadingLevel>(3);

  protected readonly columns = [
    'eventId',
    'eventDate',
    'principalName',
    'category',
    'comment',
    'docLifeCycle',
  ];

  protected readonly filters = signal<NxsHistoryFilters>(NO_FILTERS);
  /** What is in the Username box; it filters once the user pauses, not per keystroke. */
  protected readonly userText = signal('');
  private readonly typed = new Subject<string>();
  protected readonly sort = signal<{ by: AuditLogSortField; order: 'asc' | 'desc' }>({
    by: 'eventDate',
    order: 'desc',
  });
  protected readonly pageIndex = signal(0);
  private readonly chosenPageSize = signal<number | null>(null);
  protected readonly size = computed(() => this.chosenPageSize() ?? this.pageSize());
  private readonly retries = signal(0);

  protected readonly entries = signal<readonly AuditEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly failure = signal<NxsErrorStatus | null>(null);
  protected readonly filtered = computed(() => {
    const f = this.filters();
    return !!(f.user.trim() || f.from || f.to || f.eventId || f.category);
  });

  protected readonly eventTypes = signal<readonly DirectoryEntry[]>([]);
  protected readonly categories = signal<readonly DirectoryEntry[]>([]);
  private readonly eventLabels = computed(
    () => new Map(this.eventTypes().map((e) => [e.id, e.displayLabel])),
  );
  private readonly categoryLabels = computed(
    () => new Map(this.categories().map((e) => [e.id, e.displayLabel])),
  );

  constructor() {
    forkJoin({
      types: this.directories.getEventTypes().pipe(catchError(() => of([]))),
      categories: this.directories.getEventCategories().pipe(catchError(() => of([]))),
    })
      .pipe(takeUntilDestroyed())
      .subscribe(({ types, categories }) => {
        this.eventTypes.set(types);
        this.categories.set(categories);
      });

    const request = computed(() => ({
      uid: this.documentUid(),
      filters: this.filters(),
      sort: this.sort(),
      pageIndex: this.pageIndex(),
      size: this.size(),
      retry: this.retries(),
    }));

    this.typed
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((user) => this.setFilter('user', user));

    // A document change resets the filters and the page before anything is asked.
    toObservable(this.documentUid)
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.clearFilters());

    toObservable(request)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.failure.set(null);
        }),
        switchMap((r) =>
          this.documents
            .getAuditLog(r.uid, r.size, r.pageIndex, this.queryOf(r.filters, r.sort))
            .pipe(
              map((list): NxsHistoryPage => ({
                entries: list.entries ?? [],
                total: list.resultsCount ?? list.totalSize ?? list.entries?.length ?? 0,
              })),
              catchError((err: unknown) => of<NxsHistoryPage>({ failure: nxsErrorStatus(err) })),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((page) => {
        this.loading.set(false);
        if ('failure' in page) {
          this.failure.set(page.failure);
          this.entries.set([]);
          this.total.set(0);
          return;
        }
        this.entries.set(page.entries);
        this.total.set(page.total);
      });
  }

  protected setFilter<K extends keyof NxsHistoryFilters>(
    key: K,
    value: NxsHistoryFilters[K],
  ): void {
    this.filters.update((f) => ({ ...f, [key]: value }));
    this.pageIndex.set(0);
  }

  protected typeUser(text: string): void {
    this.userText.set(text);
    this.typed.next(text);
  }

  protected clearFilters(): void {
    this.userText.set('');
    this.filters.set(NO_FILTERS);
    this.pageIndex.set(0);
  }

  protected sorted(event: Sort): void {
    const by = SORTABLE.find((field) => field === event.active);
    this.sort.set(
      by && event.direction ? { by, order: event.direction } : { by: 'eventDate', order: 'desc' },
    );
    this.pageIndex.set(0);
  }

  protected paged(event: PageEvent): void {
    this.chosenPageSize.set(event.pageSize);
    this.pageIndex.set(event.pageIndex);
  }

  protected retry(): void {
    this.retries.update((n) => n + 1);
  }

  protected eventLabel(id: string): string {
    return this.eventLabels().get(id) ?? humanise(id);
  }

  protected categoryLabel(id: string): string {
    return (
      this.categoryLabels().get(id) ??
      humanise(id)
        .replace(/^Event /, '')
        .replace(/ Category$/, '')
    );
  }

  protected initials(user: string): string {
    return user.charAt(0).toUpperCase();
  }

  private queryOf(
    f: NxsHistoryFilters,
    sort: { by: AuditLogSortField; order: 'asc' | 'desc' },
  ): AuditLogQuery {
    return {
      principalName: f.user.trim() || undefined,
      eventIds: f.eventId ? [f.eventId] : undefined,
      eventCategory: f.category || undefined,
      startDate: f.from ? startOf(f.from) : undefined,
      endDate: f.to ? dayAfter(f.to) : undefined,
      sortBy: sort.by,
      sortOrder: sort.order,
    };
  }
}
