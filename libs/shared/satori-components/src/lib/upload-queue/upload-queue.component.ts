import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

import type { NxsUploadItem } from './upload-queue';

/**
 * The files of an upload, each with its own state: chosen, waiting, uploading with its progress,
 * uploaded, or refused with the reason and Retry.
 *
 * Presentational: it draws `items` — usually an `NxsUploadQueue`'s — and reports Remove and Retry;
 * the page runs the upload. The count of files uploaded and refused is announced politely as it
 * changes, so a screen reader follows a long upload without watching each bar.
 */
@Component({
  selector: 'nxs-upload-queue',
  standalone: true,
  templateUrl: './upload-queue.component.html',
  styleUrl: './upload-queue.component.scss',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-upload-queue' },
})
export class NxsUploadQueueComponent {
  /** The files, in order. */
  readonly items = input.required<readonly NxsUploadItem[]>();
  /** The list's accessible name, already translated, such as "Files to upload". */
  readonly label = input.required<string>();

  /** Remove was pressed on a file that is not uploading: its id. */
  readonly remove = output<string>();
  /** Retry was pressed on a refused file: its id. */
  readonly retry = output<string>();

  protected readonly doneCount = computed(
    () => this.items().filter((item) => item.state === 'done').length,
  );
  protected readonly failedCount = computed(
    () => this.items().filter((item) => item.state === 'failed').length,
  );
  protected readonly started = computed(() => this.items().some((item) => item.state !== 'staged'));

  protected size(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
  }

  protected removable(item: NxsUploadItem): boolean {
    return item.state === 'staged' || item.state === 'failed' || item.state === 'done';
  }
}
