import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  propertiesOf,
  publishable,
  validateLayoutV2,
  type Finding,
} from '@agentic-ui/shared/app-definition';
import { RecordPageComponent, type RecordLayoutPreview } from '@agentic-ui/shared/document-layouts';
import {
  NxsBannerComponent,
  NxsConfirmDialogComponent,
  NxsIconComponent,
  NxsSpinnerComponent,
  type NxsConfirmDialogData,
} from '@nuxeo/satori-platform/components';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { type Observable, combineLatest, map, of, switchMap } from 'rxjs';

import { downloadJson } from '../download';
import { LayoutDesignerService, type Reading, type RecordChoice } from '../layout-designer.service';
import {
  addProperty,
  cardsOf,
  insertField,
  layoutFileText,
  moveField,
  removeField,
  setCardText,
  type CardPlace,
  type CardText,
  type DesignerCard,
  type DesignerField,
  type LayoutJson,
} from '../layout-edits';

/** A field the designer has taken out of the file, kept to be shown again. */
export interface HiddenField {
  readonly place: CardPlace;
  /** Where it was among the card's fields, where it goes back. */
  readonly index: number;
  /** The entry as the file wrote it. */
  readonly entry: unknown;
  /** The card it was in, by its id, and what the designer called the field. */
  readonly cardId: string;
  readonly name: string;
}

/**
 * Whether the file may be saved:
 *
 * - `checking` while the content model is read, since a file may be saved only once it has been
 *   held to it, or once it is known that it cannot be;
 * - `refused` when the validator has any finding at all: the pipeline's verdict, `publishable`,
 *   since the file goes into a package the pipeline then checks;
 * - `saveable` otherwise.
 */
export type SaveState = 'nothing' | 'checking' | 'refused' | 'saveable';

/** The name a package gives a record page's file, under `layouts/<Type>/`. */
export const LAYOUT_FILE_NAME = 'view.layout.json';

/**
 * The layout designer: an administrator opens a record page's layout file, version 2, as the
 * server serves it, changes it, and sees the record page it draws for a real record of the type
 * (docs/business-apps/development-plan.md, phase 6). The edits are reordering and hiding fields,
 * adding a property of the type, and a card's id, heading text and heading key.
 *
 * - **The preview** is the record page engine's own: the file is read, held to the record's type
 *   and drawn by `lib-record-page`, as the View tab draws a served file, but read-only.
 * - **Every change is validated** by the app definition's validator, held to the server's content
 *   model when it can be read, and its findings are listed. A file with any finding cannot be
 *   saved.
 * - **Saving** is a download of the file, as a package holds it. Nothing is written to the server,
 *   and publishing is not built: the app registry has no write API.
 *
 * The route is behind the administrator gate, but showing the page to administrators only is not
 * a security control: the server's permissions decide what anyone may read or change.
 */
@Component({
  selector: 'lib-layout-designer-page',
  standalone: true,
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    NxsBannerComponent,
    NxsIconComponent,
    NxsSpinnerComponent,
    RecordPageComponent,
    TranslatePipe,
  ],
  templateUrl: './layout-designer-page.html',
  styleUrl: './layout-designer-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Reloading or closing the tab with changes made asks first, as leaving by the app's router does.
  host: { '(window:beforeunload)': 'holdUnload($event)' },
})
export class LayoutDesignerPageComponent {
  private readonly service = inject(LayoutDesignerService);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);

  /** What a file may name, read once: the rules and row actions register before a page shows. */
  private readonly registries = this.service.registries();

  protected readonly fileName = LAYOUT_FILE_NAME;

  readonly types = toSignal(this.service.types(), { initialValue: { state: 'reading' } });
  readonly model = toSignal(this.service.model(), { initialValue: { state: 'reading' } });

  /** The type whose record page is open. */
  readonly type = signal<string | null>(null);

  /** The type chosen in the picker, which its button opens: the open one until another is chosen. */
  readonly typeChosen = linkedSignal<string>(() => this.type() ?? '');

  readonly source = toSignal(
    toObservable(this.type).pipe(
      switchMap((type) => (type ? this.service.source(type) : of(null))),
    ),
    { initialValue: null },
  );

  readonly typeList = computed<readonly string[]>(() => {
    const types = this.types();
    return types.state === 'read' ? types.value : [];
  });

  /** Why the type's file could not be opened: it could not be read, or what came is no file. */
  readonly sourceProblem = computed<string | null>(() => {
    const source = this.source();
    if (source?.state === 'failed') return source.problem;
    return source?.state === 'read' ? (source.value.problem ?? null) : null;
  });

  /** The file as it was opened, to go back to. */
  readonly opened = computed<LayoutJson | null>(() => {
    const source = this.source();
    return source?.state === 'read' && source.value.content ? source.value.content : null;
  });

  /** The file as it is now, with every change made to it. Opened anew with each type. */
  readonly file = linkedSignal<LayoutJson | null>(() => this.opened());

  /** The fields taken out of the file, to show again. None once another file is opened. */
  readonly hidden = linkedSignal<LayoutJson | null, readonly HiddenField[]>({
    source: this.opened,
    computation: () => [],
  });

  readonly changed = computed(() => {
    const file = this.file();
    const opened = this.opened();
    return file !== null && opened !== null && layoutFileText(file) !== layoutFileText(opened);
  });

  /** Whether leaving the file would lose something: a change to it, or a field to show again. */
  readonly unsaved = computed(() => this.changed() || this.hidden().length > 0);

  readonly cards = computed<readonly DesignerCard[]>(() => cardsOf(this.file()));

  readonly records = toSignal(
    toObservable(this.type).pipe(
      switchMap((type) => (type ? this.service.records(type) : of(null))),
    ),
    { initialValue: null },
  );

  readonly recordList = computed<readonly RecordChoice[]>(() => {
    const records = this.records();
    return records?.state === 'read' ? records.value : [];
  });

  /** The record the preview draws: the first offered, until another is chosen. */
  readonly recordUid = linkedSignal<string | null>(() => {
    const records = this.records();
    return records?.state === 'read' ? (records.value[0]?.uid ?? null) : null;
  });

  readonly record = toSignal(
    toObservable(this.recordUid).pipe(
      switchMap((uid) => (uid ? this.service.record(uid) : of(null))),
    ),
    { initialValue: null },
  );

  private readonly recordDocument = computed<NuxeoDocument | null>(() => {
    const record = this.record();
    return record?.state === 'read' ? record.value : null;
  });

  /** The record page the file draws for the record, redrawn on every change. */
  readonly preview = toSignal(
    combineLatest([toObservable(this.file), toObservable(this.recordDocument)]).pipe(
      switchMap(([file, record]) =>
        file && record
          ? this.service
              .preview(file, record)
              .pipe(map((preview): PreviewShown => ({ record, preview })))
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  /** Every finding of the validator, held to the content model once it is read. */
  readonly findings = computed<readonly Finding[]>(() => {
    const file = this.file();
    const type = this.type();
    if (!file || !type) return [];
    const model = this.model();
    return validateLayoutV2(file, {
      mode: 'view',
      registries: this.registries,
      type,
      model: model.state === 'read' ? model.value : undefined,
    });
  });

  readonly saveState = computed<SaveState>(() => {
    if (!this.file()) return 'nothing';
    if (this.model().state === 'reading') return 'checking';
    return publishable(this.findings()) ? 'saveable' : 'refused';
  });

  /** The type's properties, its facets' included, by `<prefix>:<name>`: what a card may add. */
  readonly properties = computed<readonly string[] | null>(() => {
    const model = this.model();
    const type = this.type();
    if (model.state !== 'read' || !type) return null;
    return [...(propertiesOf(model.value, type)?.keys() ?? [])].sort();
  });

  /** What is chosen to add, card by card, by the card's place. */
  private readonly toAdd = linkedSignal<LayoutJson | null, Readonly<Record<string, string>>>({
    source: this.opened,
    computation: () => ({}),
  });

  /** Opens the type's file, once the person agrees to lose the changes to the one open, if any. */
  open(type: string): void {
    if (type === '' || type === this.type()) return;
    this.discard()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((agreed) => {
        if (agreed) this.type.set(type);
        else this.typeChosen.set(this.type() ?? '');
      });
  }

  /**
   * Whether the page may be left: at once with nothing to lose, else once the person agrees. The
   * route's `canDeactivate` asks it, so that a link in the preview or the menu loses nothing unasked.
   */
  leave(): Observable<boolean> {
    return this.discard();
  }

  /** Asks the browser to confirm reloading or closing the tab while there is something to lose. */
  protected holdUnload(event: BeforeUnloadEvent): void {
    if (this.unsaved()) event.preventDefault();
  }

  private discard(): Observable<boolean> {
    const type = this.type();
    if (!this.unsaved() || !type) return of(true);
    const data: NxsConfirmDialogData = {
      title: this.translate.instant('layout-designer.discard-title'),
      message: this.translate.instant('layout-designer.discard-message', { type }),
      confirmLabel: this.translate.instant('layout-designer.discard'),
    };
    return this.dialog
      .open(NxsConfirmDialogComponent, { data })
      .afterClosed()
      .pipe(map((agreed) => agreed === true));
  }

  chooseRecord(uid: string): void {
    this.recordUid.set(uid === '' ? null : uid);
  }

  /** Moves the field up one place. The focus goes with it, so that pressing again moves it on. */
  moveUp(card: DesignerCard, field: DesignerField): void {
    this.edit((file) => moveField(file, card.place, field.index, field.index - 1));
    this.focusField(card.path, field.index - 1, ['up', 'down']);
  }

  moveDown(card: DesignerCard, field: DesignerField): void {
    this.edit((file) => moveField(file, card.place, field.index, field.index + 1));
    this.focusField(card.path, field.index + 1, ['down', 'up']);
  }

  /** Takes the field out of the file, to show again. The focus goes to the next field, or the last. */
  hide(card: DesignerCard, field: DesignerField): void {
    const file = this.file();
    if (!file) return;
    const { file: next, entry } = removeField(file, card.place, field.index);
    if (entry === undefined) return;
    this.file.set(next);
    this.hidden.update((hidden) => [
      ...hidden,
      {
        place: card.place,
        index: field.index,
        entry,
        cardId: card.id,
        name: this.fieldName(field),
      },
    ]);
    const left = card.fields.length - 1;
    if (left > 0) this.focusField(card.path, Math.min(field.index, left - 1), ['hide']);
    else this.focusIn('.layout-designer__hidden li:last-child', '[data-action="show"]');
  }

  /** Puts the field back where it was, the focus on it. */
  show(field: HiddenField): void {
    this.edit((file) => insertField(file, field.place, field.index, field.entry));
    this.hidden.update((hidden) => hidden.filter((each) => each !== field));
    const card = this.cards().find(
      (each) => each.place.tab === field.place.tab && each.place.card === field.place.card,
    );
    if (card) {
      this.focusField(card.path, Math.min(field.index, card.fields.length - 1), ['hide']);
    }
  }

  setText(card: DesignerCard, key: CardText, value: string): void {
    this.edit((file) => setCardText(file, card.place, key, value));
  }

  /** The properties a card may add: the type's, less those the card shows already. */
  addable(card: DesignerCard): readonly string[] {
    const shown = new Set(
      card.fields.flatMap((field) => (field.kind === 'property' && field.name ? [field.name] : [])),
    );
    return (this.properties() ?? []).filter((xpath) => !shown.has(xpath));
  }

  chosen(card: DesignerCard): string {
    return this.toAdd()[card.path] ?? '';
  }

  choose(card: DesignerCard, xpath: string): void {
    this.toAdd.update((chosen) => ({ ...chosen, [card.path]: xpath }));
  }

  /** Adds the chosen property as the card's last field, the focus on it, to move it from there. */
  add(card: DesignerCard): void {
    const xpath = this.chosen(card);
    if (xpath === '') return;
    this.edit((file) => addProperty(file, card.place, xpath));
    this.toAdd.update((chosen) => ({ ...chosen, [card.path]: '' }));
    this.focusField(card.path, card.fields.length, ['up', 'hide']);
  }

  /** Back to the file as it was opened, the focus on the editor's heading, above the first card. */
  reset(): void {
    this.file.set(this.opened());
    this.hidden.set([]);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('#layout-designer-editor')?.focus(),
      { injector: this.injector },
    );
  }

  /**
   * Saves the file to the browser's downloads, as a package holds it. Refused, whatever the button
   * shows, unless the validator finds nothing: held to the content model once it is read, or, when
   * the model cannot be read, without it, as the page then says.
   */
  download(): void {
    const file = this.file();
    if (!file || this.saveState() !== 'saveable') return;
    downloadJson(LAYOUT_FILE_NAME, layoutFileText(file), this.document);
  }

  /** The file as the download writes it, for the page to show. */
  readonly fileText = computed(() => {
    const file = this.file();
    return file ? layoutFileText(file) : '';
  });

  /** What the designer calls a field: its property, its computed id, or its place. */
  fieldName(field: DesignerField): string {
    return field.name ?? `fields[${field.index}]`;
  }

  /** What a field or a picker holds, from its change event. */
  protected valueOf(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement || target instanceof HTMLSelectElement
      ? target.value
      : '';
  }

  protected failed<T>(reading: Reading<T> | null): string | null {
    return reading?.state === 'failed' ? reading.problem : null;
  }

  private edit(change: (file: LayoutJson) => LayoutJson): void {
    const file = this.file();
    if (file) this.file.set(change(file));
  }

  /**
   * Once the page is drawn again, the focus on the first of `actions` that is offered, in the
   * card's field at `index`. The rows are kept by their place, so without this the focus would
   * stay where the moved field was, on the field that took its place.
   */
  private focusField(cardPath: string, index: number, actions: readonly string[]): void {
    this.focusIn(
      `[data-card="${cardPath}"] .layout-designer__fields > li:nth-child(${index + 1})`,
      ...actions.map((action) => `[data-action="${action}"]`),
    );
  }

  private focusIn(container: string, ...buttons: readonly string[]): void {
    afterNextRender(
      () => {
        const within = this.host.nativeElement.querySelector(container);
        for (const selector of buttons) {
          const button = within?.querySelector<HTMLButtonElement>(selector);
          if (button && !button.disabled) {
            button.focus();
            return;
          }
        }
      },
      { injector: this.injector },
    );
  }
}

/** The preview, with the record it was drawn for. */
export interface PreviewShown {
  readonly record: NuxeoDocument;
  readonly preview: RecordLayoutPreview;
}
