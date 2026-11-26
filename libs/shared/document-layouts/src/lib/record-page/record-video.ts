import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  computed,
  inject,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import {
  NXS_STORYBOARD_ID,
  NxsBannerComponent,
  NxsEmptyStateComponent,
  NxsErrorStateComponent,
  NxsSpinnerComponent,
  NxsStoryboardComponent,
  nxsErrorStatus,
  type NxsErrorStatus,
  type NxsHeadingLevel,
  type NxsStoryboardItem,
} from '@nuxeo/satori-platform/components';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import {
  DocumentDetailService,
  assetRightsDecision,
  type AssetRightsExplanation,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { catchError, concat, forkJoin, map, of, switchMap, type Observable } from 'rxjs';

import { rightsRefusal, type RightsRefusal } from './record-picture-views';

/**
 * The ID the record page draws a video under, through `lib-extension-outlet`, so that a customer
 * library can replace the player: it is given `document` and `stateHeadingLevel`, and falls back to
 * {@link RecordVideoComponent} when nothing is registered.
 */
export const RECORD_VIDEO_ID = 'nxs.components.recordVideo';

/**
 * One file of a video that the page can play: a transcoded video, which the server names, or the
 * original when it has none.
 */
export interface VideoRenditionEntry {
  /** How the server is asked for it: by the rendition's name, or as the original. */
  readonly kind: 'rendition' | 'original';
  /** A transcoded video's name, such as `MP4 480p`; `null` for the original. */
  readonly name: string | null;
  readonly width: number | null;
  readonly height: number | null;
  /** Its MIME type, such as `video/mp4`, when Nuxeo gives a video's; `null` otherwise. */
  readonly mimeType: string | null;
  /** Its format for the caption, such as `MP4`, from its MIME type. */
  readonly format: string | null;
  /**
   * What its file is known by: the record, its kind and name, and its digest. A video replaced on
   * the record has new digests, so its files are fetched again rather than shown from before.
   */
  readonly key: string;
}

/** What Nuxeo read of the video: `vid:info`. Each is `null` when Nuxeo has not read it. */
export interface VideoFacts {
  /** In seconds. */
  readonly duration: number | null;
  readonly width: number | null;
  readonly height: number | null;
  /** As Nuxeo gives it, from the server's ffprobe, such as `matroska,webm`. */
  readonly format: string | null;
}

/** One frame of the video's storyboard, as Nuxeo writes it in `vid:storyboard`. */
export interface StoryboardFrameEntry {
  /** Its place in `vid:storyboard`, which names its file: `vid:storyboard/<index>/content`. */
  readonly index: number;
  /** Seconds from the start of the video. */
  readonly timecode: number;
  /** What Nuxeo says it shows, which is usually blank. */
  readonly comment: string;
  /** The record, its place and its digest, as a rendition's key. */
  readonly key: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A size Nuxeo gives as a number or a numeric text; `null` for none or for nonsense. */
function dimension(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null;
}

/** A positive number of seconds, or `null`. */
function seconds(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : null;
}

/** A video's MIME type, or `null` for any other, so that nothing else is taken for one. */
function videoMime(value: unknown): string | null {
  return typeof value === 'string' && /^video\/[A-Za-z0-9.+-]+$/.test(value) ? value : null;
}

const digestOf = (content: Record<string, unknown>): string =>
  typeof content['digest'] === 'string' ? content['digest'] : '';

/**
 * A name the rendition adapter can be asked by: not blank, and not `.` or `..`, which a URL reads
 * as no segment or as a step up.
 */
function renditionName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name === '' || name === '.' || name === '..' ? null : name;
}

/**
 * The files the page can play, in the order Nuxeo lists them: the record's transcoded videos, each
 * with a file and a name, the first of each name; else, when it has none, its original. Nuxeo
 * makes the transcoded ones a while after an upload, and not at all without ffmpeg on the server,
 * so the original is played until they come.
 */
export function readVideoRenditions(document: NuxeoDocument): VideoRenditionEntry[] {
  const properties = document.properties ?? {};
  const transcoded = properties['vid:transcodedVideos'];
  const seen = new Set<string>();
  const renditions: VideoRenditionEntry[] = [];
  for (const entry of Array.isArray(transcoded) ? transcoded : []) {
    if (!isRecord(entry) || !isRecord(entry['content'])) continue;
    const name = renditionName(entry['name']);
    if (name === null || seen.has(name)) continue;
    seen.add(name);
    const content = entry['content'];
    const info = isRecord(entry['info']) ? entry['info'] : {};
    const mimeType = videoMime(content['mime-type']);
    renditions.push({
      kind: 'rendition',
      name,
      width: dimension(info['width']),
      height: dimension(info['height']),
      mimeType,
      format: formatOf(mimeType),
      key: `${document.uid}/rendition/${name}/${digestOf(content)}`,
    });
  }
  if (renditions.length > 0) return renditions;
  const original = properties['file:content'];
  if (!isRecord(original)) return [];
  const info = isRecord(properties['vid:info']) ? properties['vid:info'] : {};
  const mimeType = videoMime(original['mime-type']);
  return [
    {
      kind: 'original',
      name: null,
      width: dimension(info['width']),
      height: dimension(info['height']),
      mimeType,
      format: formatOf(mimeType),
      key: `${document.uid}/original/${digestOf(original)}`,
    },
  ];
}

/** `MP4` for `video/mp4`, `WEBM` for `video/webm`: the subtype, as the picture's caption says JPEG. */
function formatOf(mimeType: string | null): string | null {
  return mimeType ? mimeType.slice('video/'.length).toUpperCase() : null;
}

/** What Nuxeo read of the video, or `null` when it read none of it, as without ffprobe. */
export function readVideoFacts(document: NuxeoDocument): VideoFacts | null {
  const info = document.properties?.['vid:info'];
  if (!isRecord(info)) return null;
  const format =
    typeof info['format'] === 'string' && info['format'].trim() !== ''
      ? info['format'].trim()
      : null;
  const facts: VideoFacts = {
    duration: seconds(info['duration']),
    width: dimension(info['width']),
    height: dimension(info['height']),
    format,
  };
  return Object.values(facts).some((value) => value !== null) ? facts : null;
}

/**
 * The storyboard's frames, in the order Nuxeo lists them: each with a file and a timecode, the
 * first at each timecode, since the strip tells its frames apart by it.
 */
export function readStoryboard(document: NuxeoDocument): StoryboardFrameEntry[] {
  const storyboard = document.properties?.['vid:storyboard'];
  if (!Array.isArray(storyboard)) return [];
  const seen = new Set<number>();
  return storyboard.flatMap((frame: unknown, index): StoryboardFrameEntry[] => {
    if (!isRecord(frame) || !isRecord(frame['content'])) return [];
    const raw = frame['timecode'];
    const timecode = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof timecode !== 'number' || !Number.isFinite(timecode) || timecode < 0) return [];
    if (seen.has(timecode)) return [];
    seen.add(timecode);
    return [
      {
        index,
        timecode,
        comment: typeof frame['comment'] === 'string' ? frame['comment'] : '',
        key: `${document.uid}/storyboard/${index}/${digestOf(frame['content'])}`,
      },
    ];
  });
}

/** How sure a browser is that it can play a type: `probably`, `maybe` or `''`, as `canPlayType` says. */
export type CanPlay = (mimeType: string) => string;

/**
 * The file the page plays: the first the browser says it can probably play, else the first it may,
 * else the first, among those not already found unplayable. `null` when none is left.
 */
export function pickRendition(
  renditions: readonly VideoRenditionEntry[],
  unplayable: ReadonlySet<string>,
  canPlay: CanPlay,
): VideoRenditionEntry | null {
  const left = renditions.filter((rendition) => !unplayable.has(rendition.key));
  const answer = (rendition: VideoRenditionEntry) =>
    rendition.mimeType ? canPlay(rendition.mimeType) : '';
  return (
    left.find((rendition) => answer(rendition) === 'probably') ??
    left.find((rendition) => answer(rendition) === 'maybe') ??
    left[0] ??
    null
  );
}

/** A duration as a player shows one: `0:12`, `4:05`, or `1:02:03` from an hour. */
export function formatDuration(total: number): string {
  const whole = Math.floor(total);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
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
 * A video on its record page: a player of one of its files, the facts Nuxeo read of it, and its
 * storyboard, which seeks the player.
 *
 * **What it plays.** The record's transcoded videos, where the server made them, else its
 * original. Each transcoded video is the same cut in another format, so one is played: the first
 * the browser says it can play. One the browser then cannot decode gives way to the next, and when
 * none is left the page says the browser cannot play the video.
 *
 * **Each file is fetched through the application,** so that the request carries its
 * authentication, and played from a blob URL: never a `<video>` given a Nuxeo address
 * (AGENTS/07-security.md). A transcoded video is asked for by its name, through the REST API's
 * rendition adapter (`DocumentDetailService.fetchRendition`), which names it to the server's rights
 * by that name; the original through `@blob/file:content`, with the reason `view`. The whole file
 * is fetched before it plays: there is no streaming.
 *
 * **Blob URLs:** a file is fetched when it is first played, and kept while the record shows it, as
 * are the storyboard's frames; one the record no longer has, another record's or a replaced
 * video's, is revoked as soon as the record changes, one the browser could not decode at once, and
 * every one when the component is destroyed.
 *
 * **A file the server's rights refuse** (`nuxeo-agentic-assets`) answers 403. The component then
 * asks the server why, through the `assetRights` enricher, and says the server's reason where the
 * player would be. Nothing is hidden or tried instead: the server decided. A 403 the rights do not
 * explain is said as any 403 is.
 *
 * **The storyboard** is drawn through `nxs.components.storyboard`, so that an override of the strip
 * reaches it too, and only with the player, which its frames seek. Its frames are previews, fetched
 * as files, `vid:storyboard/<n>/content`; one that cannot be fetched shows without its picture.
 */
@Component({
  selector: 'lib-record-video',
  standalone: true,
  imports: [
    ExtensionOutletComponent,
    NxsBannerComponent,
    NxsEmptyStateComponent,
    NxsErrorStateComponent,
    NxsSpinnerComponent,
    NxsStoryboardComponent,
    TranslatePipe,
  ],
  templateUrl: './record-video.html',
  styleUrl: './record-video.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordVideoComponent {
  readonly document = input.required<NuxeoDocument>();
  /** The heading level of the empty and error states, under the page's card headings. */
  readonly stateHeadingLevel = input<NxsHeadingLevel>(4);

  protected readonly storyboardId = NXS_STORYBOARD_ID;

  private readonly documents = inject(DocumentDetailService);
  private readonly locale = inject(LOCALE_ID);
  private readonly probe = inject(DOCUMENT).createElement('video');
  private readonly player = viewChild<ElementRef<HTMLVideoElement>>('player');

  private readonly canPlay: CanPlay = (mimeType) =>
    typeof this.probe.canPlayType === 'function' ? this.probe.canPlayType(mimeType) : '';

  readonly renditions = computed(() => readVideoRenditions(this.document()), {
    equal: sameKeys,
  });
  readonly facts = computed(() => readVideoFacts(this.document()));
  readonly frames = computed(() => readStoryboard(this.document()), { equal: sameKeys });

  /** The files the browser could not decode, by key: the next is played instead. */
  private readonly unplayable = signal<ReadonlySet<string>>(new Set());
  /** Bumped by Retry, so that the same file is asked for again. */
  private readonly attempt = signal(0);
  /** Where the player is, in seconds, for the storyboard's current frame. */
  private readonly position = signal(0);

  readonly selected = computed(() =>
    pickRendition(this.renditions(), this.unplayable(), this.canPlay),
  );

  /** Every file the record has was found unplayable by this browser. */
  readonly nothingPlayable = computed(
    () => this.renditions().length > 0 && this.selected() === null,
  );

  private readonly shownState = signal<Shown | null>(null);
  /** What is shown for the selected file: its state is that file's, never the one before it. */
  readonly shown = computed<Shown | null>(() => {
    const state = this.shownState();
    return state && state.key === this.selected()?.key ? state : null;
  });

  /** The selected file's blob URL, once it is fetched. */
  readonly videoUrl = computed(() => {
    const shown = this.shown();
    return shown?.status === 'ready' ? shown.url : null;
  });

  readonly failure = computed<NxsErrorStatus | null>(() => {
    const shown = this.shown();
    return shown?.status === 'failed' ? shown.error : null;
  });

  /** The server's rights' reason for refusing the selected file, when they are why. */
  readonly refusal = computed<RightsRefusal | null>(() => {
    const shown = this.shown();
    return shown?.status === 'failed' ? shown.refusal : null;
  });

  /** Each frame's blob URL, by its key, once fetched; a frame that could not be is absent. */
  private readonly frameUrls = signal<ReadonlyMap<string, string>>(new Map());

  /** The storyboard as the strip takes it: each frame with its picture, or none yet. */
  readonly storyboard = computed<readonly NxsStoryboardItem[]>(() => {
    const urls = this.frameUrls();
    return this.frames().map((frame) => ({
      timecode: frame.timecode,
      thumbnailUrl: urls.get(frame.key) ?? null,
      label: frame.comment,
    }));
  });

  /** The frame the player is at: the last whose timecode it has passed. */
  readonly activeTimecode = computed<number | null>(() => {
    const position = this.position();
    let active: number | null = null;
    for (const frame of this.frames()) if (frame.timecode <= position) active = frame.timecode;
    return active;
  });

  /** What `nxs.components.storyboard` is given: `seekHandler`, since the outlet binds no output. */
  readonly storyboardInputs = computed(() => ({
    items: this.storyboard(),
    activeTimecode: this.activeTimecode(),
    seekHandler: this.seekHandler,
  }));

  private readonly seekHandler = (timecode: number): void => this.seekTo(timecode);

  /** The blob URL of each file fetched, by its key: what is revoked. */
  private readonly urls = new Map<string, string>();

  constructor() {
    // The same file asked again only by Retry: a record reloaded with the same files asks nothing.
    const request = computed(
      () => {
        const rendition = this.selected();
        return rendition ? { rendition, uid: this.document().uid, attempt: this.attempt() } : null;
      },
      {
        equal: (a, b) => a?.rendition.key === b?.rendition.key && a?.attempt === b?.attempt,
      },
    );
    toObservable(request)
      .pipe(
        switchMap((asked) => {
          this.revokeAllBut(new Set(this.renditions().map((rendition) => rendition.key)));
          this.position.set(0);
          if (!asked) return of(null);
          return this.fetch(asked.uid, asked.rendition);
        }),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.shownState.set(state));

    // The storyboard's frames, each fetched once while the record has it.
    toObservable(this.frames)
      .pipe(
        switchMap((frames) => {
          this.revokeFramesBut(new Set(frames.map((frame) => frame.key)));
          const known = this.frameUrls();
          const missing = frames.filter((frame) => !known.has(frame.key));
          if (missing.length === 0) return of([]);
          const uid = this.document().uid;
          return forkJoin(
            missing.map((frame) =>
              this.documents.fetchBlobByXpath(uid, `vid:storyboard/${frame.index}/content`).pipe(
                map((blob) => ({ key: frame.key, blob })),
                catchError(() => of(null)),
              ),
            ),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((fetched) => {
        const got = fetched.filter((each): each is { key: string; blob: Blob } => each !== null);
        if (got.length === 0) return;
        const urls = new Map(this.frameUrls());
        for (const { key, blob } of got) urls.set(key, URL.createObjectURL(blob));
        this.frameUrls.set(urls);
      });

    inject(DestroyRef).onDestroy(() => {
      this.revokeAllBut(new Set());
      this.revokeFramesBut(new Set());
    });
  }

  retry(): void {
    this.attempt.update((n) => n + 1);
  }

  /** Move the player to `timecode`, in seconds: what a storyboard frame asks. */
  seekTo(timecode: number): void {
    const player = this.player()?.nativeElement;
    if (!player) return;
    player.currentTime = timecode;
    this.position.set(timecode);
  }

  /** The player moved: the storyboard marks the frame it is at. */
  moved(): void {
    const player = this.player()?.nativeElement;
    if (player) this.position.set(player.currentTime);
  }

  /**
   * The browser could not decode the file it was given: its URL is revoked at once, and the next
   * file is played, or, with none left, the page says the browser cannot play the video. Only an
   * error from the file shown now counts: a player being taken down for another record says none.
   */
  undecodable(event: Event): void {
    const shown = this.shown();
    const player = event.target as HTMLVideoElement | null;
    if (shown?.status !== 'ready' || player?.getAttribute('src') !== shown.url) return;
    URL.revokeObjectURL(shown.url);
    this.urls.delete(shown.key);
    this.unplayable.update((keys) => new Set([...keys, shown.key]));
  }

  /** What the caption says of a file: its name, its size and its format, as `MP4 480p · 854 × 480 · MP4`. */
  caption(rendition: VideoRenditionEntry, name: string | null): string {
    return [name, this.size(rendition.width, rendition.height), rendition.format]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · ');
  }

  /** A file's own size, as `854 × 480`, or `null` when Nuxeo gives none. */
  size(width: number | null, height: number | null): string | null {
    return width !== null && height !== null ? `${width} × ${height}` : null;
  }

  duration(total: number): string {
    return formatDuration(total);
  }

  private fetch(uid: string, rendition: VideoRenditionEntry): Observable<Shown> {
    const known = this.urls.get(rendition.key);
    if (known) return of({ key: rendition.key, status: 'ready', url: known });
    const asked =
      rendition.kind === 'rendition' && rendition.name !== null
        ? this.documents.fetchRendition(uid, rendition.name)
        : this.documents.fetchBlobByXpath(uid, 'file:content');
    return concat(
      of<Shown>({ key: rendition.key, status: 'loading' }),
      asked.pipe(
        map((blob): Shown => {
          const url = URL.createObjectURL(blob);
          this.urls.set(rendition.key, url);
          return { key: rendition.key, status: 'ready', url };
        }),
        catchError((error: unknown) => this.failed(uid, rendition, nxsErrorStatus(error))),
      ),
    );
  }

  /**
   * The state of a file that could not be fetched. A 403 may be the server's rights refusing it:
   * the server is then asked why, and says so, or says nothing and the 403 is shown as it is.
   */
  private failed(
    uid: string,
    rendition: VideoRenditionEntry,
    error: NxsErrorStatus,
  ): Observable<Shown> {
    const shown = (refusal: RightsRefusal | null): Shown => ({
      key: rendition.key,
      status: 'failed',
      error,
      refusal,
    });
    if (error !== 403) return of(shown(null));
    return this.documents.fetchAssetRights(uid).pipe(
      map((rights) => shown(this.refusalOf(rights, rendition))),
      catchError(() => of(shown(null))),
    );
  }

  /** What the server's rights say of `rendition`, once it was refused; `null` when they say nothing. */
  private refusalOf(
    rights: AssetRightsExplanation | null,
    rendition: VideoRenditionEntry,
  ): RightsRefusal | null {
    if (!rights) return null;
    const decision = assetRightsDecision(
      rights,
      rendition.kind === 'original'
        ? { kind: 'original', name: null }
        : { kind: 'rendition', name: rendition.name },
    );
    return rightsRefusal(decision, rights.channels, this.locale, 'video');
  }

  /** Revoke the blob URL of every file fetched but those in `keep`. */
  private revokeAllBut(keep: ReadonlySet<string>): void {
    for (const [key, url] of this.urls) {
      if (keep.has(key)) continue;
      URL.revokeObjectURL(url);
      this.urls.delete(key);
    }
  }

  /** Revoke the blob URL of every frame fetched but those in `keep`. */
  private revokeFramesBut(keep: ReadonlySet<string>): void {
    const urls = this.frameUrls();
    if ([...urls.keys()].every((key) => keep.has(key))) return;
    const kept = new Map<string, string>();
    for (const [key, url] of urls) {
      if (keep.has(key)) kept.set(key, url);
      else URL.revokeObjectURL(url);
    }
    this.frameUrls.set(kept);
  }
}

function sameKeys<T extends { readonly key: string }>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((each, i) => each.key === b[i].key);
}
