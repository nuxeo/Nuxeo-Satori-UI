import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
  Injector,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { catchError, of, switchMap } from 'rxjs';
import {
  DocumentDetailService,
  DocumentImportService,
  formatNoteHtmlForSourceView,
  hasInsertablePictureBlob,
  inferBlobDocTypeFromFile,
  isHtmlNoteFormat,
  isMarkdownNoteFormat,
  renderNoteMarkdown,
  renderTrustedHtml,
  sanitizeDocumentName,
  titleFromFileName,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';
import DOMPurify from 'dompurify';
import Quill from 'quill';
import { applyHeaderFormatSelectionOnly, type QuillRange } from './note-quill-header';
import { NoteImagePickerDialogComponent } from './note-image-picker-dialog';
import { buildNoteImagesInsertHtml } from './note-image-insert';
import { notePictureInsertUrl } from './note-image-url';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsSpinnerComponent,
  NxsToastService,
  provideNxsToast,
} from '@nuxeo-satori/platform/components';

@Component({
  selector: 'lib-note-editor',
  standalone: true,
  imports: [
    NxsSpinnerComponent,
    TranslatePipe,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  providers: [provideNxsToast()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './note-editor.html',
  styleUrl: './note-editor.scss',
})
export class NoteEditorComponent {
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(NxsToastService);
  private readonly documentImportService = inject(DocumentImportService);
  private readonly documentDetailService = inject(DocumentDetailService);

  readonly content = input.required<string>();
  readonly mimeType = input.required<string>();
  /** Parent folder path for RTE image uploads (Web UI stores uploaded pictures in the repository). */
  readonly uploadParentPath = input<string | null>(null);
  readonly saving = input(false);
  readonly loading = input(false);
  readonly autoFocus = input(false);
  readonly readOnly = input(false);

  readonly saveNote = output<string>();
  readonly focused = output<void>();

  readonly sourceMode = signal(false);
  readonly plainTextEditMode = signal(false);
  readonly editText = signal('');
  readonly imageUploading = signal(false);

  private readonly quillToolbarRef = viewChild<ElementRef<HTMLDivElement>>('quillToolbar');
  private readonly quillEditorRef = viewChild<ElementRef<HTMLDivElement>>('quillEditor');
  private readonly imageUploadInputRef =
    viewChild<ElementRef<HTMLInputElement>>('imageUploadInput');
  private readonly plainTextEditorRef =
    viewChild<ElementRef<HTMLTextAreaElement>>('plainTextEditor');

  private quill: Quill | null = null;
  /** Last `content()` value pushed into the Quill visual editor. */
  private lastParentContent: string | null = null;
  private syncedPlainContent: string | null = null;
  private lastEmittedSave: string | null = null;
  private savedRange: QuillRange | null = null;
  /** True when the Quill visual editor has unsaved edits vs persisted `content()`. */
  private visualDirty = false;

  readonly isHtml = () => isHtmlNoteFormat(this.mimeType());
  readonly isMarkdown = () => isMarkdownNoteFormat(this.mimeType());

  readonly markdownHtml = computed(() => {
    if (!this.isMarkdown()) return null;
    const raw = renderNoteMarkdown(this.content() ?? '');
    return renderTrustedHtml(this.sanitizer, raw, { ADD_ATTR: ['target', 'rel'] });
  });

  readonly htmlReadonlyView = computed(() => {
    if (!this.isHtml()) return null;
    return renderTrustedHtml(this.sanitizer, this.content() ?? '', {
      ADD_ATTR: ['target', 'rel'],
    });
  });

  constructor() {
    afterNextRender(() => this.tryInitQuill());

    effect(() => {
      const text = this.content();
      const mime = this.mimeType();
      const source = this.sourceMode();
      const saving = this.saving();

      if (isHtmlNoteFormat(mime)) {
        if (source) return;
        if (text === this.lastParentContent) return;
        this.lastParentContent = text;
        this.visualDirty = false;
        queueMicrotask(() => {
          if (!this.quill) {
            this.tryInitQuill(text);
          } else {
            this.applyExternalContent(text);
          }
        });
        return;
      }

      if (text !== this.syncedPlainContent) {
        this.syncedPlainContent = text;
        if (
          this.plainTextEditMode() &&
          this.lastEmittedSave !== null &&
          text === this.lastEmittedSave &&
          !saving
        ) {
          this.plainTextEditMode.set(false);
          this.lastEmittedSave = null;
          this.editText.set(text);
        } else if (!this.plainTextEditMode()) {
          this.editText.set(text);
        } else if (this.lastEmittedSave === null) {
          this.plainTextEditMode.set(false);
          this.editText.set(text);
        }
      }
    });

    effect(() => {
      if (this.readOnly() || !this.autoFocus() || this.loading()) return;
      if (this.isHtml()) {
        if (this.sourceMode()) return;
        queueMicrotask(() => {
          this.quill?.focus();
          this.focused.emit();
        });
        return;
      }
      queueMicrotask(() => {
        this.enterPlainTextEdit();
        this.focused.emit();
      });
    });

    this.destroyRef.onDestroy(() => {
      this.destroyQuill();
    });
  }

  onToolbarMouseDown(event: MouseEvent): void {
    if (!this.quill) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest('.note-quill-toolbar')) return;
    event.preventDefault();
    const range = this.quill.getSelection();
    if (range) {
      this.savedRange = { index: range.index, length: range.length };
    }
  }

  onImageFileSelected(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.quill) return;
    if (!file.type.startsWith('image/')) return;
    this.uploadAndInsertImage(file);
  }

  insertImagesFromExistingDocuments(): void {
    if (!this.quill || this.readOnly()) return;

    this.dialog
      .open(NoteImagePickerDialogComponent, {
        width: '900px',
        maxWidth: '95vw',
        maxHeight: '90vh',
        autoFocus: 'dialog',
        panelClass: 'note-image-picker-panel',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((docs: NuxeoDocument[] | undefined) => {
        if (!docs?.length || !this.quill) return;
        const urls = docs
          .filter((doc) => hasInsertablePictureBlob(doc))
          .map((doc) => notePictureInsertUrl(doc))
          .filter((url): url is string => !!url);
        if (!urls.length) {
          this.toast.error(
            this.translate.instant(
              'document-detail.message.selected-documents-have-no-insertable-image-url',
            ),
          );
          return;
        }
        queueMicrotask(() => this.insertImagesAtSelection(urls));
      });
  }

  toggleSourceMode(): void {
    if (!this.isHtml() || this.readOnly()) return;

    if (this.sourceMode()) {
      const html = this.editText();
      this.sourceMode.set(false);
      this.visualDirty = false;
      afterNextRender(
        () => {
          this.destroyQuill();
          this.tryInitQuill(html);
          this.editText.set(html);
        },
        { injector: this.injector },
      );
      return;
    }

    const html = this.visualDirty && this.quill ? this.readQuillHtml() : (this.content() ?? '');
    this.editText.set(formatNoteHtmlForSourceView(html));
    if (this.quill) {
      this.destroyQuill();
    }
    this.sourceMode.set(true);
  }

  /** Focus inline note editing — triggered by the note-surface pencil (Web UI parity). */
  focusForEdit(): void {
    if (this.readOnly() || this.loading()) return;

    if (this.isHtml()) {
      if (this.sourceMode()) {
        const html = this.editText();
        this.sourceMode.set(false);
        this.visualDirty = false;
        afterNextRender(
          () => {
            this.destroyQuill();
            this.tryInitQuill(html);
            this.editText.set(html);
            queueMicrotask(() => {
              this.quill?.focus();
              this.focused.emit();
            });
          },
          { injector: this.injector },
        );
        return;
      }

      queueMicrotask(() => {
        if (!this.quill) {
          this.tryInitQuill();
        }
        this.quill?.focus();
        this.focused.emit();
      });
      return;
    }

    this.enterPlainTextEdit();
    this.focused.emit();
  }

  onSave(): void {
    if (this.readOnly() || this.saving() || this.loading()) return;
    const body = this.isHtml()
      ? this.sourceMode()
        ? this.editText()
        : this.readQuillHtml()
      : this.editText();
    if (!this.isHtml()) {
      this.lastEmittedSave = body;
    }
    this.saveNote.emit(body);
  }

  enterPlainTextEdit(): void {
    if (this.readOnly()) return;
    this.editText.set(this.content());
    this.plainTextEditMode.set(true);
    queueMicrotask(() => this.plainTextEditorRef()?.nativeElement?.focus());
  }

  cancelPlainTextEdit(): void {
    this.editText.set(this.content());
    this.plainTextEditMode.set(false);
    this.lastEmittedSave = null;
  }

  private bindVideoTooltipOnce(toolbar: HTMLElement): void {
    if (toolbar.dataset['noteVideoTooltipBound'] === 'true') return;
    toolbar.dataset['noteVideoTooltipBound'] = 'true';

    const videoButton = toolbar.querySelector('.ql-video');
    if (!videoButton) return;

    videoButton.addEventListener('click', () => {
      requestAnimationFrame(() => this.alignVideoTooltipToCursor());
    });
  }

  /** Place Quill's inline video prompt at the current cursor / selection. */
  private alignVideoTooltipToCursor(): void {
    const editorQuill = this.quill;
    const editorEl = this.quillEditorRef()?.nativeElement;
    if (!editorQuill || !editorEl) return;

    const tooltip = editorEl.querySelector<HTMLElement>('.ql-tooltip[data-mode="video"]');
    if (!tooltip) return;

    const range = this.savedRange ?? editorQuill.getSelection(true);
    const index = range?.index ?? Math.max(0, editorQuill.getLength() - 1);
    const length = range?.length ?? 0;
    const bounds = editorQuill.getBounds(index, length);
    if (!bounds) return;

    const editorWidth = editorEl.clientWidth;
    const tooltipWidth = tooltip.offsetWidth || 320;
    const halfTooltip = tooltipWidth / 2;

    let left = bounds.left + bounds.width / 2;
    left = Math.max(halfTooltip + 8, Math.min(left, editorWidth - halfTooltip - 8));

    const top = bounds.bottom + 8;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.right = 'auto';
    tooltip.style.bottom = 'auto';
    tooltip.style.transform = 'translateX(-50%)';
  }

  private tryInitQuill(initialHtml?: string): void {
    if (this.readOnly() || this.sourceMode() || !this.isHtml() || this.loading() || this.quill)
      return;

    const toolbar = this.quillToolbarRef()?.nativeElement;
    const editor = this.quillEditorRef()?.nativeElement;
    if (!toolbar || !editor) return;

    const getSavedRange = (): QuillRange | null => this.savedRange;
    const clearSavedRange = (): void => {
      this.savedRange = null;
    };

    this.quill = new Quill(editor, {
      theme: 'snow',
      modules: {
        toolbar: {
          container: toolbar,
          handlers: {
            header: (value: string | number | boolean) => {
              const editorQuill = this.quill;
              if (!editorQuill) return;
              applyHeaderFormatSelectionOnly(editorQuill, value, getSavedRange());
              clearSavedRange();
            },
            image: () => {
              this.imageUploadInputRef()?.nativeElement.click();
            },
          },
        },
      },
      placeholder: this.translate.instant('document-detail.note-editor.placeholder'),
    });

    this.quill.on('text-change', () => {
      this.visualDirty = true;
    });

    this.bindVideoTooltipOnce(toolbar);

    const html = initialHtml ?? this.content();
    this.applyExternalContent(html, true);
    if (initialHtml === undefined) {
      this.lastParentContent = html;
    }
  }

  private uploadAndInsertImage(file: File): void {
    const editorQuill = this.quill;
    const parentPath = this.uploadParentPath();
    if (!editorQuill || this.imageUploading()) return;
    if (!parentPath) {
      this.toast.error(
        this.translate.instant(
          'document-detail.message.cannot-upload-image-parent-folder-is-unknown',
        ),
      );
      return;
    }

    const docType = inferBlobDocTypeFromFile(file);
    const title = titleFromFileName(file.name);
    const name = sanitizeDocumentName(file.name);

    this.imageUploading.set(true);
    this.documentImportService
      .createBlobHoldingDocumentReliable(parentPath, name, docType, { 'dc:title': title }, file)
      .pipe(
        switchMap((doc) => {
          if (!doc) return of(null);
          return this.documentDetailService
            .getFullDocument(doc.uid)
            .pipe(catchError(() => of(doc)));
        }),
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((doc) => {
        this.imageUploading.set(false);
        if (!doc || !this.quill) {
          this.toast.error(
            this.translate.instant('document-detail.message.failed-to-upload-image'),
          );
          return;
        }
        const url = notePictureInsertUrl(doc);
        if (!url) {
          this.toast.error(
            this.translate.instant('document-detail.message.uploaded-image-has-no-display-url-yet'),
          );
          return;
        }
        this.insertImagesAtSelection([url]);
      });
  }

  private insertImagesAtSelection(urls: string[]): void {
    const editorQuill = this.quill;
    if (!editorQuill || urls.length === 0) return;

    const range = this.savedRange ?? editorQuill.getSelection(true);
    const index = range?.index ?? Math.max(0, editorQuill.getLength() - 1);
    if (range?.length) {
      editorQuill.deleteText(index, range.length, Quill.sources.USER);
    }
    this.savedRange = null;

    editorQuill.clipboard.dangerouslyPasteHTML(
      index,
      buildNoteImagesInsertHtml(urls),
      Quill.sources.USER,
    );
    editorQuill.focus();
    this.visualDirty = true;
  }

  private applyExternalContent(html: string, force = false): void {
    if (!this.quill) return;

    const incoming = html || '';
    if (!force) {
      const current = this.quill.getSemanticHTML();
      if (current === incoming) return;
    }

    const selection = this.quill.getSelection();
    const delta = this.quill.clipboard.convert({ html: incoming });
    this.quill.setContents(delta, Quill.sources.SILENT);

    if (selection) {
      const docLength = this.quill.getLength();
      const index = Math.min(selection.index, Math.max(0, docLength - 1));
      const length = Math.min(selection.length, docLength - index);
      this.quill.setSelection(index, length, Quill.sources.SILENT);
    }
  }

  private readQuillHtml(): string {
    if (!this.quill) return '';
    const raw = this.quill.getSemanticHTML();
    const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] });
    return this.enforceBlankLinkRel(clean);
  }

  /** Prevent reverse-tabnabbing for links opened in a new tab. */
  private enforceBlankLinkRel(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('a[target="_blank"]').forEach((anchor) => {
      anchor.setAttribute('rel', 'noopener noreferrer');
    });
    return doc.body.innerHTML;
  }

  private destroyQuill(): void {
    const editor = this.quillEditorRef()?.nativeElement;
    if (editor) {
      editor.innerHTML = '';
    }
    this.quill = null;
  }
}
