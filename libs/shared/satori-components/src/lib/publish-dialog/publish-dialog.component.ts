import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';
import {
  DocumentDetailService,
  isPermissionDeniedError,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsSpinnerComponent } from '../spinner/spinner.component';
import { NxsToastService, provideNxsToast } from '../toast/toast.service';

/** The ID the dialog is registered under, so a customer library can re-register a replacement. */
export const NXS_PUBLISH_DIALOG_ID = 'nxs.components.publishDialog';

/** A rendition the dialog offers, with its label already translated. */
export interface NxsPublishRendition {
  /** The rendition's Nuxeo name, sent as `renditionName`. */
  readonly name: string;
  readonly label: string;
}

/** What `nxs-publish-dialog` publishes. */
export interface NxsPublishDialogData {
  /** The document published as it is — the live document, or a version of it. */
  readonly documentUid: string;
  readonly documentTitle: string;
  /** That document's version label, such as `1.2` or `1.2+`. Without one, it reads "Current version". */
  readonly versionLabel?: string;
  /** The live document whose earlier versions are offered instead. Defaults to `documentUid`. */
  readonly versionableUid?: string;
  /** The renditions offered, labels translated. None offers only "None" and "Default rendition". */
  readonly renditions?: readonly NxsPublishRendition[];
}

/** Closes with the publication created, or with nothing when cancelled. */
export type NxsPublishDialogResult = NuxeoDocument | undefined;

interface SectionOption {
  readonly uid: string;
  readonly title: string;
  readonly depth: number;
}

interface VersionOption {
  readonly uid: string;
  readonly label: string;
}

// Symbols, not strings: a rendition is chosen by its name, and a server may name one `none` or
// `default`.
const NO_RENDITION: unique symbol = Symbol('no rendition');
const DEFAULT_RENDITION: unique symbol = Symbol('default rendition');
type RenditionChoice = typeof NO_RENDITION | typeof DEFAULT_RENDITION | string;

/** When to give up on opening: the page the dialog was asked for may be gone once it resolves. */
export interface NxsOpenPublishDialogOptions {
  /** Checked once the component has resolved; `false` opens nothing. */
  readonly stillWanted?: () => boolean;
}

/**
 * Open the dialog registered as `NXS_PUBLISH_DIALOG_ID`, or `nxs-publish-dialog` when nothing
 * resolves it — the one way both publish actions open it, so re-registering the ID replaces the
 * dialog for the document page and for a selection alike. A replacement receives the same
 * `MAT_DIALOG_DATA` and should close with the same result.
 *
 * A lazily registered replacement resolves later than the click, so the caller can pass
 * `stillWanted` to refuse a dialog for a document the user has since left; the promise then
 * resolves with `undefined`.
 */
export async function nxsOpenPublishDialog(
  dialog: MatDialog,
  components: ExtensionComponentRegistry,
  data: NxsPublishDialogData,
  options: NxsOpenPublishDialogOptions = {},
): Promise<MatDialogRef<unknown, NxsPublishDialogResult> | undefined> {
  const component = (await components.resolve(NXS_PUBLISH_DIALOG_ID)) ?? NxsPublishDialogComponent;
  if (options.stillWanted && !options.stillWanted()) return undefined;
  return dialog.open<unknown, NxsPublishDialogData, NxsPublishDialogResult>(component, {
    width: '600px',
    maxWidth: '95vw',
    data,
  });
}

/**
 * Publish a document to a section — Web UI's `nuxeo-internal-publish` dialog.
 *
 * Sections are listed as a tree. The Version select publishes the version chosen: the document as
 * it is, or one of its live document's earlier versions. A rendition can be published instead of
 * the document, and existing publications in the section can be overridden. Publish runs
 * `Document.PublishToSection`; a toast names the document and the section, and a refusal reads as
 * one. It does not decide who may publish — open it only where `canPublishDocument(doc)` holds —
 * and Nuxeo still checks the right to add to the section.
 */
@Component({
  selector: 'nxs-publish-dialog',
  standalone: true,
  templateUrl: './publish-dialog.component.html',
  styleUrl: './publish-dialog.component.scss',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    NxsSpinnerComponent,
    TranslatePipe,
  ],
  providers: [provideNxsToast()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-publish-dialog' },
})
export class NxsPublishDialogComponent {
  protected readonly data = inject<NxsPublishDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<NxsPublishDialogComponent, NxsPublishDialogResult>>(MatDialogRef);
  private readonly documents = inject(DocumentDetailService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(NxsToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly noRendition = NO_RENDITION;
  protected readonly defaultRendition = DEFAULT_RENDITION;
  protected readonly renditions = this.data.renditions ?? [];

  protected readonly sectionsState = signal<'loading' | 'ready' | 'failed'>('loading');
  protected readonly sections = signal<readonly SectionOption[]>([]);
  protected readonly versions = signal<readonly VersionOption[]>([this.currentVersion()]);

  protected readonly section = signal('');
  protected readonly version = signal(this.data.documentUid);
  protected readonly showRenditions = signal(false);
  protected readonly rendition = signal<RenditionChoice>(NO_RENDITION);
  protected readonly override = signal(false);
  protected readonly publishing = signal(false);

  constructor() {
    this.loadSections();
    this.loadVersions();
  }

  protected loadSections(): void {
    this.sectionsState.set('loading');
    this.documents
      .getSectionTree()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.sections.set(sectionTree(res.entries));
          this.sectionsState.set('ready');
        },
        error: () => this.sectionsState.set('failed'),
      });
  }

  protected publish(): void {
    const target = this.sections().find((s) => s.uid === this.section());
    if (!target || this.publishing()) return;
    this.publishing.set(true);
    // Closing mid-request would unsubscribe from a publication Nuxeo may already have made, and
    // drop both its toast and the result the page refreshes on.
    this.dialogRef.disableClose = true;
    const rendition: RenditionChoice = this.showRenditions() ? this.rendition() : NO_RENDITION;
    this.documents
      .publishDocument(this.version(), target.uid, {
        override: this.override(),
        renditionName: typeof rendition === 'string' ? rendition : undefined,
        defaultRendition: rendition === DEFAULT_RENDITION,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (publication) => {
          this.publishing.set(false);
          this.toast.show(
            this.translate.instant('satori-components.publish-dialog.published', {
              document: this.data.documentTitle,
              section: target.title,
            }),
          );
          this.dialogRef.close(publication);
        },
        error: (err: unknown) => {
          this.publishing.set(false);
          this.dialogRef.disableClose = false;
          this.toast.error(
            this.translate.instant(
              isPermissionDeniedError(err)
                ? 'satori-components.publish-dialog.forbidden'
                : 'satori-components.publish-dialog.failed',
            ),
          );
        },
      });
  }

  /** Earlier versions are an option, not a requirement: a failed read leaves the document itself. */
  private loadVersions(): void {
    this.documents
      .getVersionsDirect(this.data.versionableUid ?? this.data.documentUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (versions) =>
          this.versions.set([
            this.currentVersion(),
            ...versions
              .filter((v) => v.uid !== this.data.documentUid)
              .map((v) => ({ v, major: versionPart(v, 'major'), minor: versionPart(v, 'minor') }))
              .sort((a, b) => b.major - a.major || b.minor - a.minor)
              .map(({ v, major, minor }) => ({ uid: v.uid, label: `${major}.${minor}` })),
          ]),
        error: () => undefined,
      });
  }

  private currentVersion(): VersionOption {
    return {
      uid: this.data.documentUid,
      label:
        this.data.versionLabel ||
        this.translate.instant('satori-components.publish-dialog.current-version'),
    };
  }
}

function versionPart(doc: NuxeoDocument, part: 'major' | 'minor'): number {
  return Number(doc.properties?.[`uid:${part}_version`] ?? 0);
}

/**
 * The sections in tree order, each with its depth. A section whose parent is not in the list —
 * a root, or one under a section the user cannot read — starts a tree of its own.
 */
function sectionTree(docs: readonly NuxeoDocument[]): SectionOption[] {
  const paths = new Set(docs.map((d) => d.path));
  const children = new Map<string, NuxeoDocument[]>();
  const roots: NuxeoDocument[] = [];
  for (const doc of docs) {
    const parent = doc.path.split('/').slice(0, -1).join('/');
    if (paths.has(parent)) children.set(parent, [...(children.get(parent) ?? []), doc]);
    else roots.push(doc);
  }
  const out: SectionOption[] = [];
  const walk = (nodes: readonly NuxeoDocument[], depth: number): void => {
    for (const doc of nodes) {
      out.push({ uid: doc.uid, title: doc.title, depth });
      walk(children.get(doc.path) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}
