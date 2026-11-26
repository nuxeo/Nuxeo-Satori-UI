import { InjectionToken, computed, signal } from '@angular/core';

import type { PhotoCodec } from './photo-codec';
import { PhotoRefused, preparePhoto, type PhotoRefusal, type PreparedPhoto } from './prepare-photo';

/**
 * Where a photo stands: being made ready, ready, refused before it was sent; then waiting its
 * turn, on its way, waiting to try again after the connection dropped, filed, or not filed.
 */
export type CapturePhotoState =
  'preparing' | 'ready' | 'refused' | 'waiting' | 'uploading' | 'retrying' | 'done' | 'failed';

/** Why a photo was not filed. */
export type CaptureFailure =
  /** The connection dropped, or the server did not answer, and trying again did not help. */
  | 'connection'
  /** The server would not take a file this large. */
  | 'too-large'
  /** The server refused the file. */
  | 'refused'
  /** The server failed to file it, a 500: another filing may do better. */
  | 'server'
  /** The person may not add a file to the record. */
  | 'forbidden'
  /** The record is no longer there, or no longer theirs to read. */
  | 'gone';

/** One photo on the capture page. */
export interface CapturePhoto {
  readonly id: string;
  /** Its number among the photos of this page, from 1, never reused: what its name ends with. */
  readonly seq: number;
  /** When it was added, which its name says. */
  readonly takenAt: Date;
  /** As the camera or the gallery gave it: what is prepared again when the record changes. */
  readonly original: File;
  readonly state: CapturePhotoState;
  /** What is uploaded, once ready. */
  readonly prepared: PreparedPhoto | null;
  /** Its picture as prepared, as an object URL this list owns, revokes and never shares. */
  readonly preview: string | null;
  /** How much of it has been sent, 0 to 100. */
  readonly percent: number;
  /** Why it was not prepared. */
  readonly refusal: PhotoRefusal | null;
  /** Why it was not filed. */
  readonly failure: CaptureFailure | null;
  /**
   * The record a request has carried it to, or `null`: filed on that record again, the page asks
   * the record first whether it already has it. Kept when it is prepared again, since it is then
   * named as before for the same record.
   */
  readonly sentTo: string | null;
}

/** How the photos are prepared for the record chosen: their names, and whether they keep a place. */
export interface CaptureNaming {
  /** The name a photo is filed with, without its extension. */
  readonly name: (photo: Pick<CapturePhoto, 'seq' | 'takenAt'>) => string;
  readonly keepLocation: boolean;
}

/**
 * The browser's object URLs, through which a photo's preview is drawn. A test provides its own, to
 * see each one revoked: jsdom has none.
 */
export interface ObjectUrls {
  create(blob: Blob): string;
  revoke(url: string): void;
}

export const CAPTURE_OBJECT_URLS = new InjectionToken<ObjectUrls>('CAPTURE_OBJECT_URLS', {
  providedIn: 'root',
  factory: () => ({
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
  }),
});

/** How many photos one filing takes. */
export const CAPTURE_PHOTOS_MAX = 20;

let nextId = 0;

/**
 * The photos on the capture page, in the order taken: each prepared as it comes, one at a time so
 * that a phone decodes one picture at once, and shown from its own object URL, which is revoked
 * when the photo is removed or prepared again, and all of them when the page is left.
 */
export class CapturePhotos {
  private readonly list = signal<readonly CapturePhoto[]>([]);
  private naming: CaptureNaming | null = null;
  /** The preparations, one after another. */
  private queue: Promise<void> = Promise.resolve();
  /** Each preparation's turn: a photo prepared again, or removed, ignores an earlier result. */
  private readonly turns = new Map<string, number>();
  private closed = false;
  private seq = 0;

  /** Every photo, in order. */
  readonly items = this.list.asReadonly();
  readonly preparing = computed(() => this.items().some((photo) => photo.state === 'preparing'));
  /** The photos a filing sends: ready, or not filed last time for a reason another try may mend. */
  readonly fileable = computed(() =>
    this.items().filter(
      (photo) =>
        photo.state === 'ready' ||
        (photo.state === 'failed' &&
          (photo.failure === 'connection' || photo.failure === 'server')),
    ),
  );
  readonly busy = computed(() =>
    this.items().some(
      (photo) =>
        photo.state === 'waiting' || photo.state === 'uploading' || photo.state === 'retrying',
    ),
  );
  readonly done = computed(() => this.items().filter((photo) => photo.state === 'done'));

  constructor(
    private readonly codec: PhotoCodec,
    private readonly urls: ObjectUrls,
  ) {}

  /** How many more photos this filing takes. */
  room(): number {
    return Math.max(0, CAPTURE_PHOTOS_MAX - this.items().length);
  }

  /**
   * Sets how photos are prepared, for the record chosen. Every photo not filed yet is prepared
   * again, since its name and whether it keeps its place are the record's; the filed ones are
   * the last record's, and are dropped.
   */
  retarget(naming: CaptureNaming): void {
    this.naming = naming;
    for (const photo of this.items().filter((each) => each.state === 'done')) this.drop(photo.id);
    // A photo on its way is the filing's; the page does not change the record while one is.
    for (const photo of this.items())
      if (!['waiting', 'uploading', 'retrying'].includes(photo.state)) this.prepare(photo.id);
  }

  /** Adds photos, as many as there is room for, each prepared in turn. Returns how many it took. */
  add(files: readonly File[]): number {
    const taken = files.slice(0, this.room());
    const added = taken.map((original): CapturePhoto => ({
      id: `capture-photo-${nextId++}`,
      seq: ++this.seq,
      takenAt: new Date(),
      original,
      state: 'preparing',
      prepared: null,
      preview: null,
      percent: 0,
      refusal: null,
      failure: null,
      sentTo: null,
    }));
    this.list.update((items) => [...items, ...added]);
    for (const photo of added) this.prepare(photo.id);
    return taken.length;
  }

  /** Takes a photo out, unless it is on its way; its preview is revoked. */
  remove(id: string): void {
    const photo = this.find(id);
    if (!photo || photo.state === 'waiting' || photo.state === 'uploading') return;
    if (photo.state === 'retrying') return;
    this.drop(id);
  }

  /** Takes out the photos that are filed. */
  clearDone(): void {
    for (const photo of this.done()) this.drop(photo.id);
  }

  /** Revokes every preview and ignores any preparation still running: the page is left. */
  close(): void {
    this.closed = true;
    for (const photo of this.items()) if (photo.preview) this.urls.revoke(photo.preview);
    this.list.set([]);
    this.turns.clear();
  }

  /** Changes a photo, as the filing moves it along. */
  update(
    id: string,
    change: Partial<Omit<CapturePhoto, 'id' | 'seq' | 'takenAt' | 'original' | 'preview'>>,
  ): void {
    this.list.update((items) =>
      items.map((photo) => (photo.id === id ? { ...photo, ...change } : photo)),
    );
  }

  find(id: string): CapturePhoto | undefined {
    return this.items().find((photo) => photo.id === id);
  }

  private drop(id: string): void {
    const photo = this.find(id);
    if (photo?.preview) this.urls.revoke(photo.preview);
    this.turns.delete(id);
    this.list.update((items) => items.filter((each) => each.id !== id));
  }

  /** Queues a photo's preparation, with the naming in force: its last one wins. */
  private prepare(id: string): void {
    const naming = this.naming;
    const photo = this.find(id);
    if (!naming || !photo || this.closed) return;
    const turn = (this.turns.get(id) ?? 0) + 1;
    this.turns.set(id, turn);
    if (photo.preview) this.urls.revoke(photo.preview);
    this.list.update((items) =>
      items.map((each) =>
        each.id === id
          ? {
              ...each,
              state: 'preparing',
              prepared: null,
              preview: null,
              percent: 0,
              refusal: null,
              failure: null,
            }
          : each,
      ),
    );
    const current = (): boolean => !this.closed && this.turns.get(id) === turn;
    this.queue = this.queue.then(async () => {
      if (!current()) return;
      const name = naming.name(photo);
      try {
        const prepared = await preparePhoto(
          photo.original,
          { name, keepLocation: naming.keepLocation },
          this.codec,
        );
        if (!current()) return;
        const preview = this.urls.create(prepared.file);
        this.list.update((items) =>
          items.map((each) =>
            each.id === id ? { ...each, state: 'ready', prepared, preview } : each,
          ),
        );
      } catch (error) {
        if (!current()) return;
        const refusal = error instanceof PhotoRefused ? error.reason : 'unreadable';
        this.list.update((items) =>
          items.map((each) => (each.id === id ? { ...each, state: 'refused', refusal } : each)),
        );
      }
    });
  }

  /** Resolves once every preparation queued so far is over: for a test, and for a filing. */
  settled(): Promise<void> {
    return this.queue;
  }
}
