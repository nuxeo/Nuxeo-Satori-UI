import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { isDocumentId } from '@agentic-ui/shared/document-layouts';
import {
  NxsBannerComponent,
  NxsButtonComponent,
  NxsConfirmDialogComponent,
  NxsErrorStateComponent,
  NxsIconButtonComponent,
  NxsIconComponent,
  NxsSpinnerComponent,
  NxsTextFieldComponent,
  nxsErrorStatus,
  type NxsBannerAction,
  type NxsConfirmDialogData,
  type NxsErrorStatus,
} from '@nuxeo/satori-platform/components';
import {
  EMPTY,
  type Observable,
  type Subscription,
  catchError,
  concat,
  concatMap,
  defer,
  filter,
  from,
  map,
  of,
  switchMap,
  tap,
  throwError,
} from 'rxjs';

import { readCaptureCode } from '../capture-code';
import { CaptureFilingService, failureOf } from '../capture-filing.service';
import {
  CAPTURE_OBJECT_URLS,
  CAPTURE_PHOTOS_MAX,
  CapturePhotos,
  type CaptureFailure,
  type CapturePhoto,
} from '../capture-photos';
import {
  CAPTURE_CHOICES_MAX,
  CaptureRecordsService,
  type CaptureChoice,
  type CaptureRecord,
} from '../capture-records.service';
import { PHOTO_CODEC } from '../photo-codec';

/** What the find form found, or why it found nothing. */
type Lookup =
  | { readonly status: 'idle' }
  | { readonly status: 'finding' }
  | {
      readonly status: 'choices';
      readonly code: string;
      readonly choices: readonly CaptureChoice[];
    }
  | { readonly status: 'too-many'; readonly code: string }
  | { readonly status: 'none'; readonly code: string }
  | { readonly status: 'empty' }
  | { readonly status: 'too-long' }
  | { readonly status: 'failed'; readonly error: NxsErrorStatus };

/** The record chosen, as the page reads it. */
type Chosen =
  | { readonly status: 'none' }
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: NxsErrorStatus }
  | { readonly status: 'chosen'; readonly record: CaptureRecord };

/** How the filing went, once it has started. */
type Filing =
  | { readonly status: 'idle' }
  | { readonly status: 'filing' }
  | { readonly status: 'done'; readonly photos: number; readonly note: boolean }
  | { readonly status: 'stopped'; readonly failure: CaptureFailure }
  | { readonly status: 'partly'; readonly failed: number };

/** The note, once the photos are filed: sent as a text file beside them. */
interface NoteFiling {
  /** The note as it was sent: typing more makes a new note. */
  readonly text: string;
  readonly file: File;
  readonly sent: boolean;
  readonly state: 'waiting' | 'sending' | 'done' | 'failed';
  readonly failure: CaptureFailure | null;
}

/** Stops a filing: no photo after this one is sent. */
class StoppedFiling extends Error {
  constructor(readonly failure: CaptureFailure) {
    super(`filing stopped: ${failure}`);
  }
}

/** The page's leave guard asks this. */
export interface LeavableCapture {
  leave(): Observable<boolean>;
}

/**
 * The capture page, `/capture`: a person on a phone chooses a record, takes photos with the phone's
 * camera, looks them over, removes any, adds a note, and files them on the record, where its
 * layout's `capture` says (layout-v2.md, section 2, "Capture").
 *
 * - **The record** is chosen by its number or its barcode, typed, pasted or scanned by a scanner
 *   that types as a keyboard does; by a link to its page, or its id; or by the record page's own
 *   link, `/capture?record=<id>`. A number is looked up in the properties each type's capture
 *   names (`findBy`).
 * - **The photos** come from the camera, through the browser's own file input with
 *   `capture="environment"`, or from the phone's photos. Each is made ready as it comes
 *   (`prepare-photo.ts`): drawn down where it is large, upright, and with no location unless the
 *   layout keeps it. Each is shown from its own object URL, revoked when it goes.
 * - **The filing** uploads each photo in turn as the Attachments panel uploads a file, through
 *   `CaptureFilingService`, with its progress, trying again when the connection drops, and then
 *   the note, as a text file beside them.
 *
 * What it offers is no control: the server's permissions decide who may add a file to a record.
 * The page asks the record's permissions first, so that a person who may not is told before they
 * take a photo, and a 403 on an upload says the same.
 */
@Component({
  selector: 'lib-capture-page',
  standalone: true,
  imports: [
    MatProgressBarModule,
    NxsBannerComponent,
    NxsButtonComponent,
    NxsErrorStateComponent,
    NxsIconButtonComponent,
    NxsIconComponent,
    NxsSpinnerComponent,
    NxsTextFieldComponent,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './capture-page.html',
  styleUrl: './capture-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'holdUnload($event)' },
})
export class CapturePageComponent implements LeavableCapture {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly records = inject(CaptureRecordsService);
  private readonly filings = inject(CaptureFilingService);
  private readonly translate = inject(TranslateService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly photosMax = CAPTURE_PHOTOS_MAX;
  protected readonly photos = new CapturePhotos(inject(PHOTO_CODEC), inject(CAPTURE_OBJECT_URLS));

  /** What is in the find field. */
  protected readonly code = signal('');
  protected readonly lookup = signal<Lookup>({ status: 'idle' });
  protected readonly chosen = signal<Chosen>({ status: 'none' });
  protected readonly note = signal('');
  protected readonly filing = signal<Filing>({ status: 'idle' });
  private readonly noteFiling = signal<NoteFiling | null>(null);
  /** A record is being chosen on the page, not named by the address it opened at. */
  private focusOnOpen = false;
  /** The record open, or being opened: `undefined` before the first. */
  private openUid: string | null | undefined = undefined;
  /** The search for a number under way, cancelled by another or by a record chosen. */
  private lookupRun: Subscription | null = null;
  /** The page is gone: a filing cut short by it says nothing, and moves no focus. */
  private left = false;
  /** What a screen reader is told as the page moves on, politely. */
  protected readonly announcement = signal('');

  private readonly recordHeading = viewChild<ElementRef<HTMLElement>>('recordHeading');
  private readonly result = viewChild<ElementRef<HTMLElement>>('result');
  private readonly cameraInput = viewChild<ElementRef<HTMLInputElement>>('camera');
  private readonly galleryInput = viewChild<ElementRef<HTMLInputElement>>('gallery');

  /** The record the address names, `?record=<id>`. */
  private readonly recordId = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('record'))),
    { initialValue: null },
  );

  protected readonly record = computed(() => {
    const chosen = this.chosen();
    return chosen.status === 'chosen' ? chosen.record : null;
  });
  /** A record photos can be filed on, by this person: what the photo controls need. */
  protected readonly target = computed(() => {
    const record = this.record();
    return record && record.capture && record.writable ? record : null;
  });
  protected readonly filingNow = computed(() => this.filing().status === 'filing');
  protected readonly toFile = computed(() => this.photos.fileable().length);
  /** The note typed, not filed yet as it now reads. */
  private readonly noteToFile = computed(() => {
    const text = this.note().trim();
    const note = this.noteFiling();
    return text !== '' && !(note?.state === 'done' && note.text === text);
  });
  /**
   * Whether File does anything: photos to file, or a note to file beside photos filed already, and
   * nothing being made ready or sent.
   */
  protected readonly canFile = computed(
    () =>
      this.target() !== null &&
      !this.filingNow() &&
      !this.photos.preparing() &&
      !this.photos.busy() &&
      (this.toFile() > 0 || (this.noteToFile() && this.photos.done().length > 0)),
  );
  protected readonly noteState = computed(() => this.noteFiling()?.state ?? null);
  protected readonly noteFailure = computed(() => this.noteFiling()?.failure ?? null);
  /** The banner's actions once filing stops on a dropped connection: try again. */
  protected readonly retryActions = computed<readonly NxsBannerAction[]>(() => [
    {
      label: this.translate.instant('capture.filing.retry'),
      emphasis: 'filled',
      press: () => this.file(),
    },
  ]);

  constructor() {
    toObservable(this.recordId)
      .pipe(
        filter((uid) => this.opens(uid)),
        switchMap((uid) => this.load(uid)),
        takeUntilDestroyed(),
      )
      .subscribe();
    this.destroyRef.onDestroy(() => {
      this.left = true;
      this.photos.close();
    });
  }

  /** Whether leaving the page would lose photos not filed yet: it asks first. */
  leave(): Observable<boolean> {
    const left = this.unfiled();
    if (left === 0) return of(true);
    const data: NxsConfirmDialogData = {
      title: this.translate.instant('capture.leave.title'),
      message: this.translate.instant('capture.leave.message', { count: left }),
      confirmLabel: this.translate.instant('capture.leave.confirm'),
    };
    return this.dialog
      .open(NxsConfirmDialogComponent, { data })
      .afterClosed()
      .pipe(map((agreed) => agreed === true));
  }

  /**
   * Asks the browser to confirm closing or reloading the tab while photos are not filed, where it
   * asks at all: Safari on iOS never does. `returnValue` as well, for the browsers that read it.
   */
  protected holdUnload(event: BeforeUnloadEvent): void {
    if (this.unfiled() === 0) return;
    event.preventDefault();
    Object.assign(event, { returnValue: '' });
  }

  /**
   * Whether the address's record is one to open: not the one open already, and none while a filing
   * is under way. Back or Forward during a filing changes the address without leaving the page;
   * the address is put back, and the photos go on to the record they were being filed on.
   */
  private opens(uid: string | null): boolean {
    if (uid === this.openUid) return false;
    if (!this.filingNow()) return true;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { record: this.openUid ?? null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.say('capture.filing.wait');
    return false;
  }

  // ── The record ──

  /** The find form: a number, a barcode, a link or an id. */
  protected find(event?: Event): void {
    event?.preventDefault();
    const code = readCaptureCode(this.code());
    if (code.kind === 'empty' || code.kind === 'too-long') {
      this.lookup.set({ status: code.kind });
      return;
    }
    if (code.kind === 'id') {
      this.lookup.set({ status: 'idle' });
      this.choose(code.id);
      return;
    }
    this.lookup.set({ status: 'finding' });
    this.lookupRun?.unsubscribe();
    this.lookupRun = this.records
      .find(code.number)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (choices) => {
          if (choices.length === 1) {
            this.lookup.set({ status: 'idle' });
            this.choose(choices[0].uid);
          } else if (choices.length === 0) {
            this.lookup.set({ status: 'none', code: code.number });
            this.say('capture.find.none', { code: code.number });
          } else if (choices.length > CAPTURE_CHOICES_MAX) {
            this.lookup.set({ status: 'too-many', code: code.number });
            this.say('capture.find.too-many', { code: code.number });
          } else {
            this.lookup.set({ status: 'choices', code: code.number, choices });
            this.say('capture.find.choices', { count: choices.length, code: code.number });
          }
        },
        error: (error: unknown) =>
          this.lookup.set({ status: 'failed', error: nxsErrorStatus(error) }),
      });
  }

  /** Opens a record: the address says which, so that Back returns to the one before. */
  protected choose(uid: string): void {
    if (this.filingNow()) return;
    this.lookupRun?.unsubscribe();
    // Chosen here: once it opens, the focus goes to it, so that a screen reader goes on from there.
    // A record the address named as the page opened leaves the focus where the page put it.
    this.focusOnOpen = true;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { record: uid },
      queryParamsHandling: 'merge',
    });
    if (this.recordId() === uid) this.focusRecord();
  }

  /** Back to the find form. The photos stay, for the next record. */
  protected another(): void {
    if (this.filingNow()) return;
    this.lookupRun?.unsubscribe();
    this.lookup.set({ status: 'idle' });
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { record: null },
      queryParamsHandling: 'merge',
    });
  }

  protected retryRecord(): void {
    const uid = this.recordId();
    if (uid) this.load(uid).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  private load(uid: string | null): Observable<unknown> {
    this.openUid = uid;
    if (!uid) {
      this.chosen.set({ status: 'none' });
      return EMPTY;
    }
    // Only a record's id goes into the request's path: anything else in the address names none.
    if (!isDocumentId(uid)) {
      this.chosen.set({ status: 'failed', error: 404 });
      return EMPTY;
    }
    this.chosen.set({ status: 'loading' });
    this.filing.set({ status: 'idle' });
    this.noteFiling.set(null);
    return this.records.load(uid).pipe(
      tap((record) => {
        this.chosen.set({ status: 'chosen', record });
        if (record.capture) {
          const prefix = record.number ? `${fileNamePart(record.number)}-` : '';
          this.photos.retarget({
            keepLocation: record.capture.keepLocation,
            name: ({ seq, takenAt }) => `${prefix}photo-${stamp(takenAt)}-${seq}`,
          });
        }
        this.say(
          !record.capture
            ? 'capture.record.no-capture'
            : record.writable
              ? 'capture.record.chosen'
              : 'capture.record.read-only',
          { record: record.number ?? record.title },
        );
        if (this.focusOnOpen) this.focusRecord();
      }),
      catchError((error: unknown) => {
        this.chosen.set({ status: 'failed', error: nxsErrorStatus(error) });
        return EMPTY;
      }),
    );
  }

  private focusRecord(): void {
    this.focusOnOpen = false;
    afterNextRender(() => this.recordHeading()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  // ── The photos ──

  protected takePhoto(): void {
    this.cameraInput()?.nativeElement.click();
  }

  protected choosePhotos(): void {
    this.galleryInput()?.nativeElement.click();
  }

  /** The camera or the gallery gave files: the pictures among them are added. */
  protected added(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    // Emptied, so that the same photo chosen again is a change the input reports.
    input.value = '';
    if (files.length === 0 || !this.target()) return;
    const pictures = files.filter((file) => file.type === '' || file.type.startsWith('image/'));
    const taken = this.photos.add(pictures);
    if (this.filing().status === 'done') this.filing.set({ status: 'idle' });
    if (pictures.length < files.length) this.say('capture.photos.not-pictures');
    else if (taken < pictures.length)
      this.say('capture.photos.too-many', { max: CAPTURE_PHOTOS_MAX });
    else this.say('capture.photos.added', { count: taken });
  }

  /**
   * Takes a photo out. The focus goes to the next photo's Remove, else the one before's, else Take a
   * photo, since the button pressed goes with its photo.
   */
  protected remove(photo: CapturePhoto, position: number): void {
    const items = this.photos.items();
    const at = items.findIndex((each) => each.id === photo.id);
    const neighbour = items[at + 1] ?? items[at - 1] ?? null;
    this.photos.remove(photo.id);
    this.say('capture.photos.removed', { position });
    afterNextRender(
      () => {
        const host = this.host.nativeElement;
        const next = neighbour
          ? host.querySelector<HTMLElement>(
              `[data-capture-photo-id="${neighbour.id}"] .capture__remove button`,
            )
          : null;
        (next ?? host.querySelector<HTMLElement>('[data-capture-take] button'))?.focus();
      },
      { injector: this.injector },
    );
  }

  // ── The filing ──

  /**
   * Files the photos not filed yet, in turn, then the note. A photo the server refuses is left
   * with its reason and the rest go on; a dropped connection that trying again did not mend, a
   * 403 or a 404 stops the filing, and the photos not sent wait for another.
   */
  protected file(): void {
    const record = this.target();
    const capture = record?.capture;
    if (!record || !capture || !this.canFile()) return;
    const queue = this.photos.fileable().map((photo) => photo.id);
    for (const id of queue) this.photos.update(id, { state: 'waiting', percent: 0, failure: null });
    this.filing.set({ status: 'filing' });
    this.say('capture.filing.started', { count: queue.length });
    // File is disabled while the photos go: the focus goes to where the filing is said.
    this.focusResult();
    concat(
      // One after another: a phone's connection carries one photo at a time best.
      from(queue).pipe(concatMap((id) => this.sendPhoto(record.uid, capture.property, id))),
      defer(() => this.sendNote(record)),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        complete: () => this.finished(),
        error: (error: unknown) => this.stopped(error),
      });
  }

  private sendPhoto(uid: string, property: string, id: string): Observable<void> {
    const photo = this.photos.find(id);
    if (!photo?.prepared || photo.state !== 'waiting') return EMPTY;
    const sentBefore = photo.sentTo === uid;
    this.photos.update(id, { state: 'uploading', percent: 0, sentTo: uid });
    return this.filings
      .send(uid, property, photo.prepared.file, sentBefore, {
        onPercent: (percent) => this.photos.update(id, { state: 'uploading', percent }),
        onRetry: () => this.photos.update(id, { state: 'retrying', percent: 0 }),
      })
      .pipe(
        tap(() => this.photos.update(id, { state: 'done', percent: 100, failure: null })),
        map(() => undefined),
        catchError((error: unknown) => {
          const failure = failureOf(error);
          this.photos.update(id, { state: 'failed', percent: 0, failure });
          // A file the server will not take: the next one may be fine.
          if (failure === 'too-large' || failure === 'refused' || failure === 'server')
            return EMPTY;
          return throwError(() => new StoppedFiling(failure));
        }),
      );
  }

  /** The note, once every photo is filed, as a text file of its own beside them. */
  private sendNote(record: CaptureRecord): Observable<void> {
    const capture = record.capture;
    const text = this.note().trim();
    if (!capture || text === '' || this.photos.fileable().length > 0) return EMPTY;
    if (this.photos.items().some((photo) => photo.state === 'failed')) return EMPTY;
    let note = this.noteFiling();
    if (note?.state === 'done' && note.text === text) return EMPTY;
    if (!note || note.text !== text) {
      const filed = this.photos.done().map((photo) => photo.prepared?.file.name ?? '');
      const prefix = record.number ? `${fileNamePart(record.number)}-` : '';
      const body = `${text}\n\n${this.translate.instant('capture.note.photos')}\n${filed.join('\n')}\n`;
      note = {
        text,
        file: new File([body], `${prefix}note-${stamp(new Date())}.txt`, {
          type: 'text/plain;charset=utf-8',
        }),
        sent: false,
        state: 'waiting',
        failure: null,
      };
    }
    const sentBefore = note.sent;
    this.noteFiling.set({ ...note, state: 'sending', sent: true, failure: null });
    return this.filings
      .send(record.uid, capture.property, note.file, sentBefore, {
        onPercent: () => undefined,
        onRetry: () => undefined,
      })
      .pipe(
        tap(() => this.noteFiling.update((each) => each && { ...each, state: 'done' })),
        map(() => undefined),
        catchError((error: unknown) => {
          const failure = failureOf(error);
          this.noteFiling.update((each) => each && { ...each, state: 'failed', failure });
          return throwError(() => new StoppedFiling(failure));
        }),
      );
  }

  private finished(): void {
    // Leaving the page completes the filing it cuts short: nothing was filed by that.
    if (this.left) return;
    const failed = this.photos.items().filter((photo) => photo.state === 'failed').length;
    // Said once: by the result, which the focus moves to, and not the live region as well.
    if (failed > 0) this.filing.set({ status: 'partly', failed });
    else
      this.filing.set({
        status: 'done',
        photos: this.photos.done().length,
        note: this.noteFiling()?.state === 'done',
      });
    this.announcement.set('');
    this.focusResult();
  }

  private stopped(error: unknown): void {
    if (this.left) return;
    const failure =
      error instanceof StoppedFiling
        ? error.failure
        : error instanceof HttpErrorResponse
          ? failureOf(error)
          : 'connection';
    // The photos that never had their turn wait for the next filing.
    for (const photo of this.photos.items())
      if (photo.state === 'waiting') this.photos.update(photo.id, { state: 'ready' });
    this.filing.set({ status: 'stopped', failure });
    this.announcement.set('');
    this.focusResult();
  }

  /** After a filing, a new one starts clean: the photos filed go, and so do the note and its text. */
  protected more(): void {
    this.photos.clearDone();
    this.note.set('');
    this.noteFiling.set(null);
    this.filing.set({ status: 'idle' });
    this.say('capture.filing.more');
  }

  private focusResult(): void {
    afterNextRender(() => this.result()?.nativeElement.focus(), { injector: this.injector });
  }

  /** The photos that would be lost: taken, and not filed. */
  private unfiled(): number {
    return this.photos
      .items()
      .filter((photo) => photo.state !== 'done' && photo.state !== 'refused').length;
  }

  /**
   * Tells a screen reader, politely. The same words twice in a row, as two photos removed one after
   * the other at the same place, end in a no-break space the second time, so that the region
   * changes and is read again.
   */
  private say(key: string, params?: Record<string, unknown>): void {
    const text = this.translate.instant(key, params) as string;
    this.announcement.update((before) => (before === text ? `${text}\u00a0` : text));
  }

  // ── For the template ──

  protected sizeOf(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected isRemovable(photo: CapturePhoto): boolean {
    return (
      !this.filingNow() &&
      photo.state !== 'waiting' &&
      photo.state !== 'uploading' &&
      photo.state !== 'retrying'
    );
  }
}

/** A part of a file name: what a number holds of letters, digits, `.`, `_` and `-`, at most 40. */
export function fileNamePart(text: string): string {
  return (
    text
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 40) || 'record'
  );
}

/** `20261126-140512`, the time in the phone's own zone: what a photo's name says of when. */
export function stamp(when: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0');
  return (
    `${when.getFullYear()}${two(when.getMonth() + 1)}${two(when.getDate())}-` +
    `${two(when.getHours())}${two(when.getMinutes())}${two(when.getSeconds())}`
  );
}
