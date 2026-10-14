import { signal } from '@angular/core';

/** Whether a drag carries files from the user's computer, rather than text or a link. */
export function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * The drag-over state of one drop target that accepts files, and nothing else.
 *
 * `dragenter` and `dragleave` fire for every child the pointer crosses, so a plain flag flickers
 * off over the first child; counting the entries keeps it on until the pointer leaves the target.
 * A drag of text or a link is ignored entirely: no highlight, and the browser keeps its default.
 */
export class NxsFileDropTracker {
  /** True while files are dragged over the target. */
  readonly over = signal(false);
  private depth = 0;

  constructor(private readonly accepts: () => boolean) {}

  enter(event: DragEvent): void {
    if (!this.takes(event)) return;
    event.preventDefault();
    this.depth += 1;
    this.over.set(true);
  }

  overTarget(event: DragEvent): void {
    if (!this.takes(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  leave(event: DragEvent): void {
    if (!this.takes(event)) return;
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) this.over.set(false);
  }

  /** The files dropped, or none when the drop is not one this target takes. */
  drop(event: DragEvent): File[] {
    if (!this.takes(event)) return [];
    event.preventDefault();
    this.depth = 0;
    this.over.set(false);
    return Array.from(event.dataTransfer?.files ?? []);
  }

  private takes(event: DragEvent): boolean {
    return this.accepts() && dragHasFiles(event);
  }
}
