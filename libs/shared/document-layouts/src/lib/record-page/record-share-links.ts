import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT, formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsConfirmDialogComponent,
  NxsDateInputComponent,
  NxsErrorStateComponent,
  NxsSpinnerComponent,
  nxsErrorStatus,
  type NxsConfirmDialogData,
  type NxsErrorStatus,
  type NxsHeadingLevel,
} from '@nuxeo/satori-platform/components';
import {
  ShareLinkService,
  shareLinkLabel,
  shareLinkUrl,
  type NuxeoDocument,
  type ShareLink,
  type ShareLinkDownloads,
  type ShareLinkItem,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  Subject,
  catchError,
  distinctUntilChanged,
  filter,
  map,
  of,
  startWith,
  switchMap,
  type Observable,
} from 'rxjs';

import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from './record-clock';
import {
  SHARE_LINK_DEFAULT_DAYS,
  SHARE_LINK_MAX_DAYS,
  SHARE_LINK_MAX_ITEMS,
  endInRange,
  fieldDate,
  fieldDay,
  itemTitle,
  refusalKey,
  shareableItems,
  utcDay,
  type ShareableItem,
} from './share-links';

type Loaded =
  | { readonly uid: string; readonly status: 'loading' }
  /** The server answered 403: the user may not manage the asset's links, so nothing is drawn. */
  | { readonly uid: string; readonly status: 'hidden' }
  | { readonly uid: string; readonly status: 'failed'; readonly error: NxsErrorStatus }
  | { readonly uid: string; readonly status: 'loaded'; readonly links: readonly ShareLink[] };

type DownloadsLoaded =
  | { readonly uid: string; readonly status: 'loading' }
  | { readonly uid: string; readonly status: 'failed'; readonly error: NxsErrorStatus }
  | { readonly uid: string; readonly status: 'loaded'; readonly log: ShareLinkDownloads };

/** A created link, shown once: the address and the link's label. Held here and nowhere else. */
interface Created {
  readonly uid: string;
  readonly url: string;
  readonly label: string;
}

/** An item the server refused, as the page says it. */
interface RefusalShown {
  readonly item: ShareLinkItem;
  readonly title: string | null;
  readonly key: string;
}

let nextId = 0;

/**
 * A picture's share links on its record page (layout-v2.md, section 2, "Share links"): the links
 * people outside open without signing in, each listing some of the asset's views or its original,
 * until an end day. The page lists the asset's links, offers a new one and Revoke, and shows what
 * the links served.
 *
 * - **The server decides everything,** through `nuxeo-agentic-assets`: who may manage the links
 *   (`WriteSecurity` on the asset), what a link may list, that it serves its items watermarked
 *   only while it is neither revoked nor past its end and while the asset's rights allow each
 *   one, and the downloads it logs. The page checks no permission first: it asks for the links,
 *   and on a 403 draws nothing at all. Any other failure is said, with Retry.
 * - **A new link's address is shown once,** with Copy, from the server's answer: its token is
 *   held in this component until the user is done with it, and never stored, logged or sent
 *   anywhere. The server keeps only the token's hash, so the address cannot be shown again: a
 *   lost one is revoked and made anew.
 * - **The end day is a day in UTC,** the link's last, as the asset's rights end is: from today to
 *   {@link SHARE_LINK_MAX_DAYS} days on.
 * - **In the designer's preview** (`readOnly`) the links are listed with no Create or Revoke.
 */
@Component({
  selector: 'lib-record-share-links',
  standalone: true,
  imports: [
    MatButton,
    MatCheckbox,
    NxsDateInputComponent,
    NxsErrorStateComponent,
    NxsSpinnerComponent,
    TranslatePipe,
  ],
  templateUrl: './record-share-links.html',
  styleUrl: './record-share-links.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordShareLinksComponent {
  readonly document = input.required<NuxeoDocument>();
  /** Lists the links with no way to create or revoke one, as the designer's preview does. */
  readonly readOnly = input(false);
  /** The level of the section's heading; its parts are one below. */
  readonly headingLevel = input<NxsHeadingLevel>(3);

  private readonly links = inject(ShareLinkService);
  private readonly translate = inject(TranslateService);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly clipboard = inject(Clipboard);
  private readonly dialog = inject(MatDialog);
  private readonly locale = inject(LOCALE_ID);
  private readonly timeZone = inject(RECORD_PAGE_TIME_ZONE);
  private readonly today = inject(RECORD_PAGE_TODAY);
  private readonly page = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly id = `record-share-links-${nextId++}`;
  protected readonly maxItems = SHARE_LINK_MAX_ITEMS;

  private readonly uid = computed(() => this.document().uid);
  private readonly reloads = new Subject<void>();
  private readonly loaded = signal<Loaded | null>(null);
  private readonly downloadsLoaded = signal<DownloadsLoaded | null>(null);
  private readonly downloadReloads = new Subject<void>();

  /** The state of the record shown now; another record's, still answering, is never shown. */
  protected readonly state = computed<Loaded>(() => {
    const loaded = this.loaded();
    return loaded && loaded.uid === this.uid() ? loaded : { uid: this.uid(), status: 'loading' };
  });

  protected readonly downloads = computed<DownloadsLoaded>(() => {
    const loaded = this.downloadsLoaded();
    return loaded && loaded.uid === this.uid() ? loaded : { uid: this.uid(), status: 'loading' };
  });

  protected readonly subLevel = computed(
    () => Math.min(this.headingLevel() + 1, 6) as NxsHeadingLevel,
  );

  /** What the record offers to share. */
  protected readonly offered = computed<readonly ShareableItem[]>(() =>
    shareableItems(this.document()),
  );

  protected readonly chosen = signal<ReadonlySet<ShareLinkItem>>(new Set());
  protected readonly endDate = signal<Date | null>(null);
  protected readonly minDate = computed(() => fieldDate(utcDay(this.now())));
  protected readonly maxDate = computed(() => fieldDate(utcDay(this.now(), SHARE_LINK_MAX_DAYS)));
  /** Today, read once per record: a page left open past midnight is bounded by the server. */
  private readonly now = computed(() => {
    this.uid();
    return this.today();
  });

  protected readonly saving = signal(false);
  protected readonly created = signal<Created | null>(null);
  protected readonly refused = signal<readonly RefusalShown[]>([]);
  protected readonly writeError = signal<string | null>(null);

  /** Create is offered once an item is chosen, no more than the server takes, and a day it takes. */
  protected readonly creatable = computed(
    () =>
      !this.saving() &&
      this.chosen().size > 0 &&
      this.chosen().size <= SHARE_LINK_MAX_ITEMS &&
      endInRange(fieldDay(this.endDate()), this.now()),
  );

  /** The created link shown now: the record's, never another record's. */
  protected readonly createdShown = computed(() => {
    const created = this.created();
    return created && created.uid === this.uid() ? created : null;
  });

  constructor() {
    toObservable(this.uid)
      .pipe(
        switchMap((uid) => {
          this.reset();
          return this.reloads.pipe(
            startWith(undefined),
            switchMap(() => this.fetch(uid)),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((loaded) => this.loaded.set(loaded));
    // The downloads are read once the links are: a 403 there hides the section before any is asked.
    toObservable(this.state)
      .pipe(
        filter((state) => state.status === 'loaded'),
        map((state) => state.uid),
        // Once per record: a link created or revoked changes the list, not the log's reading.
        distinctUntilChanged(),
        switchMap((uid) =>
          this.downloadReloads.pipe(
            startWith(undefined),
            switchMap(() => this.fetchDownloads(uid)),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((loaded) => this.downloadsLoaded.set(loaded));
  }

  retry(): void {
    this.reloads.next();
  }

  retryDownloads(): void {
    this.downloadReloads.next();
  }

  protected label(id: string): string {
    return shareLinkLabel(id);
  }

  /** What the page calls an item: a view's title, or "Original file". */
  protected itemName(item: ShareLinkItem): string {
    return itemTitle(item) ?? this.translate.instant('document-layouts.share-links.original');
  }

  protected itemNames(items: readonly ShareLinkItem[]): string {
    return items.map((item) => this.itemName(item)).join(', ');
  }

  /** A link's last day, as written, in UTC: the day the server counts. */
  protected endDay(end: string): string {
    const parsed = new Date(`${end}T00:00:00Z`);
    return Number.isNaN(parsed.getTime())
      ? end
      : formatDate(parsed, 'longDate', this.locale, 'UTC');
  }

  protected when(instant: string | null): string {
    const parsed = instant ? new Date(instant) : null;
    return parsed && !Number.isNaN(parsed.getTime())
      ? formatDate(parsed, 'medium', this.locale, this.timeZone)
      : '';
  }

  protected isChosen(item: ShareLinkItem): boolean {
    return this.chosen().has(item);
  }

  protected toggle(item: ShareLinkItem, checked: boolean): void {
    this.chosen.update((chosen) => {
      const next = new Set(chosen);
      if (checked) next.add(item);
      else next.delete(item);
      return next;
    });
    this.refused.set([]);
  }

  protected setEnd(value: Date | null): void {
    this.endDate.set(value);
  }

  protected create(): void {
    if (!this.creatable() || this.readOnly()) return;
    const end = fieldDay(this.endDate());
    if (end === null) return;
    const uid = this.uid();
    // In the order the page offers them, which is the asset's.
    const items = this.offered()
      .map((each) => each.item)
      .filter((item) => this.chosen().has(item));
    this.saving.set(true);
    this.writeError.set(null);
    this.refused.set([]);
    this.created.set(null);
    this.links
      .create(uid, items, end)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (answer) => {
          this.saving.set(false);
          if (this.uid() !== uid) return;
          if (answer.kind === 'refused') {
            this.refused.set(
              answer.refused.map((refusal) => ({
                item: refusal.rendition,
                title: itemTitle(refusal.rendition),
                key: refusalKey(refusal.reason),
              })),
            );
            this.announcer.announce(
              this.translate.instant('document-layouts.share-links.refused.heading'),
            );
            return;
          }
          const url = shareLinkUrl(answer.path, this.page.location.origin);
          const state = this.loaded();
          if (state?.uid === uid && state.status === 'loaded') {
            this.loaded.set({
              ...state,
              links: [answer.link, ...state.links.filter((link) => link.id !== answer.link.id)],
            });
          }
          if (url === null) {
            // A path that would leave this server: the link exists, and is not shown.
            this.writeError.set(
              this.translate.instant('document-layouts.share-links.error.address'),
            );
            return;
          }
          this.created.set({ uid, url, label: shareLinkLabel(answer.link.id) });
          this.chosen.set(new Set());
          this.announcer.announce(
            this.translate.instant('document-layouts.share-links.created.announce', {
              label: shareLinkLabel(answer.link.id),
            }),
          );
        },
        error: (failure: unknown) => {
          this.saving.set(false);
          if (this.uid() !== uid) return;
          this.writeError.set(this.translate.instant(this.errorKey('create', failure)));
        },
      });
  }

  /** Copies the created link's address. */
  protected copy(): void {
    const created = this.createdShown();
    if (!created) return;
    const copied = this.clipboard.copy(created.url);
    this.announcer.announce(
      this.translate.instant(
        copied
          ? 'document-layouts.share-links.created.copied'
          : 'document-layouts.share-links.created.copy-failed',
      ),
    );
  }

  /** Done with the created link: its address is gone from the page, and cannot be shown again. */
  protected dismiss(): void {
    this.created.set(null);
  }

  protected revoke(link: ShareLink): void {
    if (this.readOnly() || link.state !== 'active' || this.saving()) return;
    const label = shareLinkLabel(link.id);
    const data: NxsConfirmDialogData = {
      title: this.translate.instant('document-layouts.share-links.revoke.title'),
      message: this.translate.instant('document-layouts.share-links.revoke.message', { label }),
      confirmLabel: this.translate.instant('document-layouts.share-links.revoke.confirm'),
    };
    const uid = this.uid();
    this.dialog
      .open<NxsConfirmDialogComponent, NxsConfirmDialogData, true>(NxsConfirmDialogComponent, {
        data,
      })
      .afterClosed()
      .pipe(
        filter((confirmed) => confirmed === true),
        switchMap(() => {
          this.saving.set(true);
          this.writeError.set(null);
          return this.links.revoke(uid, link.id);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (revoked) => {
          this.saving.set(false);
          const state = this.loaded();
          if (this.uid() !== uid || state?.uid !== uid || state.status !== 'loaded') return;
          this.loaded.set({
            ...state,
            links: state.links.map((each) => (each.id === revoked.id ? revoked : each)),
          });
          this.announcer.announce(
            this.translate.instant('document-layouts.share-links.revoke.done', { label }),
          );
        },
        error: (failure: unknown) => {
          this.saving.set(false);
          if (this.uid() !== uid) return;
          this.writeError.set(this.translate.instant(this.errorKey('revoke', failure)));
        },
      });
  }

  private errorKey(what: 'create' | 'revoke', failure: unknown): string {
    const status = failure instanceof HttpErrorResponse ? failure.status : null;
    const why = status === 403 ? 'forbidden' : status === 400 ? 'refused' : 'failed';
    return `document-layouts.share-links.error.${what}-${why}`;
  }

  private fetch(uid: string): Observable<Loaded> {
    return this.links.list(uid).pipe(
      map((links): Loaded => ({ uid, status: 'loaded', links })),
      catchError((error: unknown) =>
        of<Loaded>(
          // Not allowed to manage them: the section is not drawn at all. A 401 is a session that
          // ended, said as a failure, not a refusal.
          (error as { status?: unknown } | null)?.status === 403
            ? { uid, status: 'hidden' }
            : { uid, status: 'failed', error: nxsErrorStatus(error) },
        ),
      ),
      startWith<Loaded>({ uid, status: 'loading' }),
    );
  }

  private fetchDownloads(uid: string): Observable<DownloadsLoaded> {
    return this.links.downloads(uid).pipe(
      map((log): DownloadsLoaded => ({ uid, status: 'loaded', log })),
      catchError((error: unknown) =>
        of<DownloadsLoaded>({ uid, status: 'failed', error: nxsErrorStatus(error) }),
      ),
      startWith<DownloadsLoaded>({ uid, status: 'loading' }),
    );
  }

  private reset(): void {
    this.chosen.set(new Set());
    this.endDate.set(fieldDate(utcDay(this.today(), SHARE_LINK_DEFAULT_DAYS)));
    this.created.set(null);
    this.refused.set([]);
    this.writeError.set(null);
    this.saving.set(false);
  }
}
