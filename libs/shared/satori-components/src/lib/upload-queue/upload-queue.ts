import { computed, signal } from '@angular/core';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { nxsErrorStatus, type NxsErrorStatus } from '../error-state/error-status';

/** Where a file stands: chosen, waiting its turn, on its way, created, or refused. */
export type NxsUploadState = 'staged' | 'waiting' | 'uploading' | 'done' | 'failed';

/** One file in an upload queue. */
export interface NxsUploadItem {
  readonly id: string;
  readonly file: File;
  readonly state: NxsUploadState;
  /** This file's own progress, 0 to 100. */
  readonly percent: number;
  /** Why it failed, by status, when it did. */
  readonly error: NxsErrorStatus | null;
  /** The document created from it, once done. */
  readonly document: NuxeoDocument | null;
}

/**
 * The progress `DocumentImportService` reports while it uploads a list of files in one batch:
 * the whole list's percent and the index of the file in hand.
 */
export interface NxsUploadProgress {
  readonly percent: number;
  readonly fileIndex?: number;
  readonly fileCount?: number;
}

let nextId = 0;

/**
 * The state of one upload queue: the files chosen, then each file's progress and outcome while
 * they upload, in order. `nxs-upload-queue` draws it.
 *
 * It does no request itself. A page stages files, then runs its upload — usually
 * `DocumentImportService.importFiles(path, queue.pending(), { onProgress: (p) => queue.progress(p) })`
 * — and reports the outcome with `complete` or `fail`. So the same queue serves an import dialog
 * and files dropped on a list, with the request each already makes.
 */
export class NxsUploadQueue {
  private readonly state = signal<readonly NxsUploadItem[]>([]);
  /** The ids of the files in the run under way, in upload order. */
  private running: readonly string[] = [];

  /** Every file, in the order chosen. */
  readonly items = this.state.asReadonly();
  /** Whether a run is under way. */
  readonly busy = computed(() =>
    this.items().some((item) => item.state === 'waiting' || item.state === 'uploading'),
  );
  readonly done = computed(() => this.items().filter((item) => item.state === 'done'));
  readonly failed = computed(() => this.items().filter((item) => item.state === 'failed'));

  /** Adds files to the queue, not yet uploading. */
  stage(files: readonly File[]): void {
    const added = files.map((file) => item(file));
    this.state.update((items) => [...items, ...added]);
  }

  /** The files not uploaded yet — chosen, or refused last time — in order: what a run uploads. */
  pending(): File[] {
    return this.items()
      .filter((item) => item.state === 'staged' || item.state === 'failed')
      .map((item) => item.file);
  }

  /** Marks the pending files as this run's, waiting their turn. */
  start(): void {
    const pending = this.items().filter(
      (item) => item.state === 'staged' || item.state === 'failed',
    );
    this.running = pending.map((item) => item.id);
    const ids = new Set(this.running);
    this.update((item) =>
      ids.has(item.id) ? { ...item, state: 'waiting', percent: 0, error: null } : item,
    );
  }

  /** Moves the run along: files before `fileIndex` are on their way to done, that one is uploading. */
  progress(progress: NxsUploadProgress): void {
    const count = progress.fileCount ?? this.running.length;
    const index = Math.min(Math.max(progress.fileIndex ?? 0, 0), this.running.length - 1);
    if (count <= 0 || index < 0) return;
    const segment = 100 / count;
    const own = Math.round(
      Math.min(Math.max((progress.percent - index * segment) / segment, 0), 1) * 100,
    );
    this.update((item) => {
      const at = this.running.indexOf(item.id);
      if (at < 0 || item.state === 'done') return item;
      if (at < index) return { ...item, state: 'uploading', percent: 100 };
      if (at === index) return { ...item, state: 'uploading', percent: own };
      return item;
    });
  }

  /** The run finished: each file created, its document in the same order. */
  complete(documents: readonly NuxeoDocument[]): void {
    const running = this.running;
    this.update((item) => {
      const at = running.indexOf(item.id);
      return at < 0
        ? item
        : { ...item, state: 'done', percent: 100, document: documents[at] ?? null };
    });
    this.running = [];
  }

  /**
   * The run stopped on a failure. Files that had reached 100% were created, and are done; the first
   * that had not failed, with the error's status; the ones after it never started, and go back to
   * the queue for another run.
   */
  fail(error: unknown): void {
    const status = nxsErrorStatus(error);
    const running = this.running;
    const percents = new Map(this.items().map((item) => [item.id, item.percent]));
    const first = running.findIndex((id) => (percents.get(id) ?? 0) < 100);
    const failedAt = first < 0 ? running.length - 1 : first;
    this.update((item) => {
      const at = running.indexOf(item.id);
      if (at < 0) return item;
      if (at < failedAt) return { ...item, state: 'done', percent: 100 };
      if (at === failedAt) return { ...item, state: 'failed', error: status };
      return { ...item, state: 'staged', percent: 0 };
    });
    this.running = [];
  }

  /** Takes a file out, unless it is part of a run under way. */
  remove(id: string): void {
    this.state.update((items) =>
      items.filter(
        (item) => item.id !== id || item.state === 'waiting' || item.state === 'uploading',
      ),
    );
  }

  /** Drops the files that are done, keeping the rest. */
  clearDone(): void {
    this.state.update((items) => items.filter((item) => item.state !== 'done'));
  }

  /** Empties the queue, unless a run is under way. */
  clear(): void {
    if (!this.busy()) this.state.set([]);
  }

  private update(change: (item: NxsUploadItem) => NxsUploadItem): void {
    this.state.update((items) => items.map(change));
  }
}

function item(file: File): NxsUploadItem {
  return {
    id: `nxs-upload-${nextId++}`,
    file,
    state: 'staged',
    percent: 0,
    error: null,
    document: null,
  };
}
