import { formatDate } from '@angular/common';
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
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import {
  NxsBannerComponent,
  NxsEmptyStateComponent,
  NxsErrorStateComponent,
  NxsSpinnerComponent,
  nxsErrorStatus,
  type NxsErrorStatus,
  type NxsHeadingLevel,
} from '@nuxeo/satori-platform/components';
import {
  DocumentDetailService,
  assetRightsDecision,
  type AssetRightsDecision,
  type AssetRightsExplanation,
  type AssetRightsReason,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { catchError, concat, map, of, switchMap, type Observable } from 'rxjs';

/** One of a picture's views, as Nuxeo writes it in `picture:views`: a rendition of the picture. */
export interface PictureViewEntry {
  /** Its place in `picture:views`, which names its file: `picture:views/<index>/content`. */
  readonly index: number;
  /** Its name, such as `Medium`, or `View 3` for one with none. */
  readonly title: string;
  readonly width: number | null;
  readonly height: number | null;
  /** The file's format, such as `JPEG`, from its MIME type; `null` when Nuxeo gives none. */
  readonly format: string | null;
  /**
   * What the view's file is known by: the record, its place and its digest. A picture replaced on
   * the record has new digests, so its views are fetched again rather than shown from before. A
   * view with no digest, which Nuxeo 2025 always gives, is known by its record and place alone.
   */
  readonly key: string;
}

/**
 * The views the page shows first, in this order: one sized for a screen where the record has one.
 * `OriginalJpeg` is the picture at its own size, and comes last.
 */
const FIRST_VIEWS = ['Medium', 'Small', 'FullHD', 'OriginalJpeg'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A dimension Nuxeo gives as a number or a numeric text; `null` for none or for nonsense. */
function dimension(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * The record's picture views, in the order Nuxeo lists them. A view with no file, as one still
 * being generated has, is left out: there is nothing to fetch.
 */
export function readPictureViews(document: NuxeoDocument): PictureViewEntry[] {
  const views = document.properties?.['picture:views'];
  if (!Array.isArray(views)) return [];
  return views.flatMap((view: unknown, index): PictureViewEntry[] => {
    if (!isRecord(view) || !isRecord(view['content'])) return [];
    const content = view['content'];
    const title =
      typeof view['title'] === 'string' && view['title'].trim() !== ''
        ? view['title']
        : `View ${index + 1}`;
    const mime = content['mime-type'];
    const format =
      typeof mime === 'string' && /^image\/[A-Za-z0-9.+-]+$/.test(mime)
        ? mime.slice('image/'.length).toUpperCase()
        : null;
    const digest = typeof content['digest'] === 'string' ? content['digest'] : '';
    return [
      {
        index,
        title,
        width: dimension(view['width']),
        height: dimension(view['height']),
        format,
        key: `${document.uid}/${index}/${digest}`,
      },
    ];
  });
}

/** The view shown first: the first of {@link FIRST_VIEWS} the record has, else its first view. */
export function firstPictureView(views: readonly PictureViewEntry[]): PictureViewEntry | undefined {
  for (const title of FIRST_VIEWS) {
    const view = views.find((each) => each.title === title);
    if (view) return view;
  }
  return views[0];
}

/**
 * Why the server refused a view, as the page says it: a translation key and its parameters, from
 * the reason the server's rights gave (`nuxeo-agentic-assets`, the `assetRights` enricher).
 */
export interface RightsRefusal {
  /** The server's code, on the page as `data-refusal`. */
  readonly reason: Exclude<AssetRightsReason, 'cleared' | 'preview'>;
  readonly key: string;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * What the page says of a use the server's rights refuse, or `null` when they do not refuse it: a
 * 403 for any other reason, such as the record's permissions, is then said as any 403 is.
 *
 * @param channels the asset's channels, as the server read them
 * @param locale the reader's, for the day and the list of channels
 */
export function rightsRefusal(
  decision: AssetRightsDecision,
  channels: readonly string[] | null,
  locale: string,
): RightsRefusal | null {
  const key = (code: string) => `document-layouts.rights.refused.${code}`;
  switch (decision.reason) {
    case 'cleared':
    case 'preview':
      return null;
    case 'rights-ended': {
      // The server's day, in UTC: the day the asset's rights card shows.
      const end = decision.rightsEnd ? new Date(`${decision.rightsEnd}T00:00:00Z`) : null;
      return end && !Number.isNaN(end.getTime())
        ? {
            reason: 'rights-ended',
            key: key('rights-ended'),
            params: { end: formatDate(end, 'longDate', locale, 'UTC') },
          }
        : { reason: 'rights-ended', key: key('rights-ended-undated'), params: {} };
    }
    case 'channel-not-covered': {
      const channel = decision.channel ?? '';
      // `null`: the server did not say, as for a proxy, whose live document's rights decide.
      if (channels === null)
        return {
          reason: 'channel-not-covered',
          key: key('channel-not-covered-unnamed'),
          params: { channel },
        };
      return channels.length > 0
        ? {
            reason: 'channel-not-covered',
            key: key('channel-not-covered'),
            params: {
              channel,
              channels: new Intl.ListFormat(locale, { type: 'conjunction' }).format(channels),
            },
          }
        : {
            reason: 'channel-not-covered',
            key: key('channel-not-covered-none'),
            params: { channel },
          };
    }
    case 'not-cleared':
      return { reason: 'not-cleared', key: key('not-cleared'), params: {} };
    case 'policy-error':
      return { reason: 'policy-error', key: key('policy-error'), params: {} };
  }
}

/** What the server's rights say of `view`, once it was refused; `null` when they say nothing. */
function viewRefusal(
  rights: AssetRightsExplanation | null,
  view: PictureViewEntry,
  locale: string,
): RightsRefusal | null {
  if (!rights) return null;
  const decision = assetRightsDecision(rights, { kind: 'view', name: view.title });
  return rightsRefusal(decision, rights.channels, locale);
}

type Shown =
  | { readonly key: string; readonly status: 'loading' }
  | { readonly key: string; readonly status: 'ready'; readonly url: string }
  | {
      readonly key: string;
      readonly status: 'failed';
      readonly error: NxsErrorStatus;
      /** The server's rights' reason, when they are why it was refused. */
      readonly refusal: RightsRefusal | null;
    };

/**
 * A Picture's views on its record page: the one chosen, large, and a button for each of them.
 *
 * Each view's file is fetched through `DocumentDetailService.fetchBlobByXpath`, so that the
 * request carries the application's authentication, and shown from a blob URL: never an `<img>`
 * bound to a Nuxeo address (AGENTS/07-security.md). A view is fetched when it is first shown, and
 * kept while the record shows it; every blob URL is revoked when the component is destroyed, and
 * one whose view the record no longer has, another record's or a replaced picture's, as soon as
 * the record changes.
 *
 * Fetched with the reason `view`, as the document page's preview is, so Nuxeo audits it as a view
 * and not a download.
 *
 * **A view the server's rights refuse** (`nuxeo-agentic-assets`) answers 403. The component then
 * asks the server why, through the `assetRights` enricher, and says the server's reason in place of
 * the view. It hides no button and greys none: each view is asked for, and the server decides. A
 * 403 the rights do not explain, such as one from the record's permissions, is said as any 403 is.
 */
@Component({
  selector: 'lib-record-picture-views',
  standalone: true,
  imports: [
    MatButtonModule,
    NxsBannerComponent,
    NxsEmptyStateComponent,
    NxsErrorStateComponent,
    NxsSpinnerComponent,
    TranslatePipe,
  ],
  templateUrl: './record-picture-views.html',
  styleUrl: './record-picture-views.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordPictureViewsComponent {
  readonly document = input.required<NuxeoDocument>();
  /** The heading level of the empty and error states, under the page's card headings. */
  readonly stateHeadingLevel = input<NxsHeadingLevel>(4);

  private readonly documents = inject(DocumentDetailService);
  private readonly locale = inject(LOCALE_ID);

  readonly views = computed(() => readPictureViews(this.document()), {
    equal: (a, b) => a.length === b.length && a.every((view, i) => view.key === b[i].key),
  });

  /** The view the reader chose, by its key: it holds the record too, so another record's resets. */
  private readonly chosen = signal<string | null>(null);

  /** Bumped by Retry, so that the same view is asked for again. */
  private readonly attempt = signal(0);

  readonly selected = computed<PictureViewEntry | null>(() => {
    const views = this.views();
    const chosen = this.chosen();
    return views.find((view) => view.key === chosen) ?? firstPictureView(views) ?? null;
  });

  private readonly shownState = signal<Shown | null>(null);
  /** What is shown for the selected view: its state is that view's, never the one before it. */
  readonly shown = computed<Shown | null>(() => {
    const state = this.shownState();
    return state && state.key === this.selected()?.key ? state : null;
  });

  /** The selected view's blob URL, once it is fetched. */
  readonly imageUrl = computed(() => {
    const shown = this.shown();
    return shown?.status === 'ready' ? shown.url : null;
  });

  /** Why the selected view could not be fetched, as the error state's variant; `null` if it was not refused. */
  readonly failure = computed<NxsErrorStatus | null>(() => {
    const shown = this.shown();
    return shown?.status === 'failed' ? shown.error : null;
  });

  /** The server's rights' reason for refusing the selected view, when they are why. */
  readonly refusal = computed<RightsRefusal | null>(() => {
    const shown = this.shown();
    return shown?.status === 'failed' ? shown.refusal : null;
  });

  /** The blob URL of each view fetched, by its key: what is revoked. */
  private readonly urls = new Map<string, string>();

  constructor() {
    // The same view asked again only by Retry: a record reloaded with the same views asks nothing.
    const request = computed(
      () => {
        const view = this.selected();
        return view ? { view, uid: this.document().uid, attempt: this.attempt() } : null;
      },
      { equal: (a, b) => a?.view.key === b?.view.key && a?.attempt === b?.attempt },
    );
    toObservable(request)
      .pipe(
        switchMap((asked) => {
          this.revokeAllBut(new Set(this.views().map((view) => view.key)));
          if (!asked) return of(null);
          return this.fetch(asked.uid, asked.view);
        }),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.shownState.set(state));
    inject(DestroyRef).onDestroy(() => this.revokeAllBut(new Set()));
  }

  choose(view: PictureViewEntry): void {
    this.chosen.set(view.key);
  }

  retry(): void {
    this.attempt.update((n) => n + 1);
  }

  /** What the caption says of a view: its name, its size and its format, as `Medium · 1000 × 667 · JPEG`. */
  caption(view: PictureViewEntry): string {
    return [view.title, this.size(view), view.format]
      .filter((part): part is string => part !== null)
      .join(' · ');
  }

  /** A view's own size, as `1000 × 667`, or `null` when Nuxeo gives none. */
  size(view: PictureViewEntry): string | null {
    return view.width !== null && view.height !== null ? `${view.width} × ${view.height}` : null;
  }

  private fetch(uid: string, view: PictureViewEntry): Observable<Shown> {
    const known = this.urls.get(view.key);
    if (known) return of({ key: view.key, status: 'ready', url: known });
    return concat(
      of<Shown>({ key: view.key, status: 'loading' }),
      this.documents.fetchBlobByXpath(uid, `picture:views/${view.index}/content`).pipe(
        map((blob): Shown => {
          const url = URL.createObjectURL(blob);
          this.urls.set(view.key, url);
          return { key: view.key, status: 'ready', url };
        }),
        catchError((error: unknown) => this.failed(uid, view, nxsErrorStatus(error))),
      ),
    );
  }

  /**
   * The state of a view that could not be fetched. A 403 may be the server's rights refusing it:
   * the server is then asked why, and says so, or says nothing and the 403 is shown as it is.
   */
  private failed(uid: string, view: PictureViewEntry, error: NxsErrorStatus): Observable<Shown> {
    const shown = (refusal: RightsRefusal | null): Shown => ({
      key: view.key,
      status: 'failed',
      error,
      refusal,
    });
    if (error !== 403) return of(shown(null));
    return this.documents.fetchAssetRights(uid).pipe(
      map((rights) => shown(viewRefusal(rights, view, this.locale))),
      catchError(() => of(shown(null))),
    );
  }

  /** Revoke the blob URL of every view fetched but those in `keep`. */
  private revokeAllBut(keep: ReadonlySet<string>): void {
    for (const [key, url] of this.urls) {
      if (keep.has(key)) continue;
      URL.revokeObjectURL(url);
      this.urls.delete(key);
    }
  }
}
