import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
  BrowseService,
  decodeNuxeoPathSegment,
  isFolderishDocument,
  normalizeNuxeoPath,
  nuxeoPathSegments,
  nuxeoPathsEqualFlexible,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';
import { forkJoin } from 'rxjs';

import { nxsErrorStatus, type NxsErrorStatus } from '../error-state/error-status';
import { NxsSpinnerComponent } from '../spinner/spinner.component';

/** What the folder picker needs from the page that opens it. Text arrives already translated. */
export interface NxsFolderPickerDialogData {
  /** The dialog's heading — "Copy to", "Move to". */
  readonly heading: string;
  /** The button that chooses the folder on screen — "Copy here", "Move here". */
  readonly confirmLabel: string;
  /** Where the picker opens; `/default-domain` when absent. */
  readonly initialPath?: string;
  /**
   * A folder that cannot be the destination, nor anything inside it: the folder being moved.
   * Nuxeo refuses to move a folder into itself; the picker does not offer it.
   */
  readonly excludePath?: string;
  /** A folder that is not a destination because the document is already there. */
  readonly currentParentPath?: string;
}

/** The folder chosen. */
export interface NxsFolderPickerDialogResult {
  readonly uid: string;
  readonly path: string;
  readonly title: string;
}

/**
 * Chooses a destination folder, as a `MatDialog`: `dialog.open(NxsFolderPickerDialogComponent,
 * { data })`, then `afterClosed()` gives the folder, or nothing when cancelled.
 *
 * It opens on a folder and lists the folders in it; the user goes into one, or up a level, and
 * chooses the folder on screen. It reads the repository through `BrowseService` with the
 * application's credentials, and says why when it cannot: no access to a folder, a folder gone,
 * or a failure with Retry. It only chooses; the page copies or moves.
 */
@Component({
  selector: 'nxs-folder-picker-dialog',
  standalone: true,
  templateUrl: './folder-picker-dialog.component.html',
  styleUrl: './folder-picker-dialog.component.scss',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, NxsSpinnerComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-folder-picker-dialog' },
})
export class NxsFolderPickerDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<NxsFolderPickerDialogComponent, NxsFolderPickerDialogResult>>(MatDialogRef);
  private readonly browse = inject(BrowseService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly data = inject<NxsFolderPickerDialogData>(MAT_DIALOG_DATA);

  protected readonly path = signal(normalizeNuxeoPath(this.data.initialPath || '/default-domain'));
  protected readonly folder = signal<NuxeoDocument | null>(null);
  protected readonly folders = signal<readonly NuxeoDocument[]>([]);
  protected readonly loading = signal(true);
  protected readonly failure = signal<NxsErrorStatus | 'not-a-folder' | null>(null);

  protected readonly trail = computed(() =>
    nuxeoPathSegments(this.path()).map((segment) => decodeNuxeoPathSegment(segment)),
  );
  protected readonly canGoUp = computed(() => nuxeoPathSegments(this.path()).length > 1);
  /** Why the folder on screen cannot be chosen, if it cannot. */
  protected readonly refusal = computed<'inside' | 'already' | null>(() => {
    const path = this.path();
    const exclude = this.data.excludePath;
    if (exclude && isSameOrInside(path, exclude)) return 'inside';
    const parent = this.data.currentParentPath;
    if (parent && nuxeoPathsEqualFlexible(path, parent)) return 'already';
    return null;
  });
  protected readonly canChoose = computed(
    () => !this.loading() && this.failure() === null && this.folder() !== null && !this.refusal(),
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    const path = this.path();
    this.loading.set(true);
    this.failure.set(null);
    forkJoin({
      folder: this.browse.getByPath(path),
      children: this.browse.getChildren(path, 200, 0),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ folder, children }) => {
          if (path !== this.path()) return;
          this.loading.set(false);
          if (!isFolderishDocument(folder)) {
            this.folder.set(null);
            this.folders.set([]);
            this.failure.set('not-a-folder');
            return;
          }
          this.folder.set(folder);
          this.folders.set(
            (children.entries ?? [])
              .filter((doc) => isFolderishDocument(doc))
              .sort((a, b) =>
                (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' }),
              ),
          );
        },
        error: (error: unknown) => {
          if (path !== this.path()) return;
          this.loading.set(false);
          this.folder.set(null);
          this.folders.set([]);
          this.failure.set(nxsErrorStatus(error));
        },
      });
  }

  protected open(doc: NuxeoDocument): void {
    if (!doc.path) return;
    this.path.set(normalizeNuxeoPath(doc.path));
    this.load();
  }

  protected up(): void {
    if (!this.canGoUp()) return;
    const segments = nuxeoPathSegments(this.path());
    this.path.set(`/${segments.slice(0, -1).join('/')}`);
    this.load();
  }

  protected choose(): void {
    const folder = this.folder();
    if (!this.canChoose() || !folder) return;
    this.dialogRef.close({ uid: folder.uid, path: this.path(), title: folder.title ?? '' });
  }

  protected cancel(): void {
    this.dialogRef.close();
  }
}

function isSameOrInside(path: string, container: string): boolean {
  const inner = nuxeoPathSegments(path).map((segment) => segment.toLowerCase());
  const outer = nuxeoPathSegments(container).map((segment) => segment.toLowerCase());
  return (
    outer.length > 0 &&
    outer.length <= inner.length &&
    outer.every((segment, i) => segment === inner[i])
  );
}
