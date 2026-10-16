import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  canCreateDocumentVersion,
  DocumentDetailService,
  formatRelativeTime,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { catchError, map, of, Subject, switchMap, tap, type Observable } from 'rxjs';

import {
  NxsCreateVersionDialogComponent,
  type NxsCreateVersionDialogData,
  type NxsCreateVersionDialogResult,
} from '../create-version-dialog/create-version-dialog.component';
import { NxsSpinnerComponent } from '../spinner/spinner.component';

const major = (doc: NuxeoDocument): number => Number(doc.properties?.['uid:major_version'] ?? 0);
const minor = (doc: NuxeoDocument): number => Number(doc.properties?.['uid:minor_version'] ?? 0);

/**
 * A document's version number as Web UI writes it: `1.2`, and `1.2+` while it is checked out —
 * changed since that version.
 */
export function nxsVersionLabel(doc: NuxeoDocument): string {
  const label = `${major(doc)}.${minor(doc)}`;
  return doc.isCheckedOut && !doc.isVersion ? `${label}+` : label;
}

/** Newest first, by number, as Web UI sorts its list — not by date, which a restore reorders. */
function newestFirst(a: NuxeoDocument, b: NuxeoDocument): number {
  return major(b) - major(a) || minor(b) - minor(a);
}

/**
 * A document's versions — Web UI's `nuxeo-document-versions`, as the document's info panel shows
 * it.
 *
 * As in Web UI:
 *
 * - With versions, the number (`1.2`, `1.2+` when checked out) opens the list, newest first, each
 *   with when and by whom it was last changed. Choosing one emits `versionSelected`; the host opens
 *   it read-only. Choosing never restores — restoring is the version page's confirmed action.
 * - On a version, the list leads back to the live document (`latestSelected`), and lists the live
 *   document's versions with the one on screen marked.
 * - Create Version is in the list while the document is checked out, and is the whole control
 *   while it has no version. It is offered only where `canCreateDocumentVersion` holds — the live
 *   document, not a publication or a record, `Versionable`, and `WriteVersion`; otherwise the control reads
 *   "Unversioned". It opens `nxs-create-version-dialog` and emits `versionCreated`.
 *
 * The list is read when it opens, through `Document.GetVersions`, which reads the repository
 * rather than the search index, so a version just created is in it.
 */
@Component({
  selector: 'nxs-manage-versions',
  standalone: true,
  templateUrl: './manage-versions.component.html',
  styleUrl: './manage-versions.component.scss',
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    TranslatePipe,
    NxsSpinnerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-manage-versions' },
})
export class NxsManageVersionsComponent {
  private readonly documents = inject(DocumentDetailService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  /** The document on screen: the live document or one of its versions. */
  readonly document = input.required<NuxeoDocument>();

  /** A version the user chose. Open it read-only; never restore from here. */
  readonly versionSelected = output<NuxeoDocument>();
  /** The live document, chosen while one of its versions is on screen. */
  readonly latestSelected = output<void>();
  /** A version was created: the document is now checked in at it. Reload the document. */
  readonly versionCreated = output<NuxeoDocument>();

  protected readonly label = computed(() => nxsVersionLabel(this.document()));
  protected readonly hasVersions = computed(() => {
    const doc = this.document();
    return major(doc) > 0 || minor(doc) > 0;
  });
  protected readonly canCreate = computed(() => canCreateDocumentVersion(this.document()));
  /** Create Version in the list: only while there are changes to version, as in Web UI. */
  protected readonly offersCreate = computed(
    () => this.canCreate() && this.document().isCheckedOut === true,
  );

  /** The document whose versions are listed — this one, or the live one a version belongs to. */
  private readonly liveUid = computed(() => {
    const doc = this.document();
    return (doc.isVersion && doc.versionableId) || doc.uid;
  });

  protected readonly versions = signal<readonly NuxeoDocument[]>([]);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  private readonly opens = new Subject<void>();

  constructor() {
    toObservable(this.liveUid)
      .pipe(
        tap(() => {
          this.versions.set([]);
          this.failed.set(false);
          this.loading.set(false);
        }),
        switchMap((uid) => this.opens.pipe(switchMap(() => this.fetch(uid)))),
        takeUntilDestroyed(),
      )
      .subscribe((versions) => {
        this.loading.set(false);
        if (versions === null) {
          this.failed.set(true);
          return;
        }
        this.versions.set(versions);
      });
  }

  protected opened(): void {
    this.opens.next();
  }

  protected retry(event: Event): void {
    // Keeps the menu open: the retry answers in place.
    event.stopPropagation();
    this.opens.next();
  }

  protected isShown(version: NuxeoDocument): boolean {
    return version.uid === this.document().uid;
  }

  protected numberOf(version: NuxeoDocument): string {
    return `${major(version)}.${minor(version)}`;
  }

  protected modified(version: NuxeoDocument): string {
    const when =
      (version.properties?.['dc:modified'] as string | undefined) ?? version.lastModified;
    const who =
      (version.properties?.['dc:lastContributor'] as string | undefined) ??
      this.translate.instant('satori-components.manage-versions.unknown-user');
    return this.translate.instant('satori-components.manage-versions.modified', {
      when: when ? formatRelativeTime(when, this.translate.currentLang) : '',
      who,
    });
  }

  protected choose(version: NuxeoDocument): void {
    if (!this.isShown(version)) this.versionSelected.emit(version);
  }

  protected create(): void {
    if (!this.canCreate()) return;
    const doc = this.document();
    this.dialog
      .open<
        NxsCreateVersionDialogComponent,
        NxsCreateVersionDialogData,
        NxsCreateVersionDialogResult
      >(NxsCreateVersionDialogComponent, {
        width: '600px',
        maxWidth: '95vw',
        data: {
          documentUid: doc.uid,
          documentTitle: doc.title,
          major: major(doc),
          minor: minor(doc),
        },
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((version) => {
        if (version) this.versionCreated.emit(version);
      });
  }

  private fetch(uid: string): Observable<readonly NuxeoDocument[] | null> {
    this.failed.set(false);
    this.loading.set(true);
    return this.documents.getVersionsDirect(uid).pipe(
      map((versions) => [...versions].sort(newestFirst)),
      catchError(() => of(null)),
    );
  }
}
