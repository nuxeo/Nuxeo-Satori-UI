import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Directionality } from '@angular/cdk/bidi';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterEveryRender,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  numberAttribute,
  output,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCheckboxModule, type MatCheckboxChange } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatSortModule, type Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { merge } from 'rxjs';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import {
  DocTypeLabelPipe,
  NON_CONTENT_DOCUMENT_TYPES,
  avatarColor,
  docTypeIcon,
  isFolderishDocument,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsActionMenuComponent, type NxsMenuAction } from '../action-menu/action-menu.component';
import { NxsAvatarComponent } from '../avatar/avatar.component';
import { NxsEmptyStateComponent } from '../empty-state/empty-state.component';
import { NxsErrorStateComponent } from '../error-state/error-state.component';
import type { NxsErrorStatus } from '../error-state/error-status';
import { NxsFileDropTracker } from '../file-drop';
import type { NxsHeadingLevel } from '../heading-level';
import { NxsPagerComponent } from '../pager/pager.component';
import { NXS_PRIMITIVE_IDS, type NxsAvatarColor } from '../primitives';
import { NxsSpinnerComponent } from '../spinner/spinner.component';
import { NxsTagComponent } from '../tag/tag.component';
import { NxsThumbnailComponent } from '../thumbnail/thumbnail.component';
import { nxsVisibleText } from '../visible-text';

/** One column of a document list. */
export interface NxsDocumentListColumn {
  /**
   * What the column shows. `title`, `type`, `modified`, `lastContributor`, `created`, `author`,
   * `state`, `version`, `nature`, `coverage` and `subjects` are the packaged columns; any other key
   * is read as a Nuxeo property of that name, such as `dc:source`.
   */
  readonly key: string;
  /** The header, already translated. */
  readonly label: string;
  /**
   * Whether the header sorts. Only set it for a key the listing's source can sort by on the server:
   * the list never sorts a page itself. A column that cannot sort has a plain header.
   */
  readonly sortable?: boolean;
}

/** The server-side order a list is in: a column's key and a direction. */
export interface NxsDocumentListSort {
  readonly key: string;
  readonly direction: 'asc' | 'desc';
}

/** A row's action, chosen from that row's menu. */
export interface NxsDocumentListRowAction {
  readonly action: NxsMenuAction;
  readonly document: NuxeoDocument;
}

const SELECT_COLUMN = '__select';
const ACTIONS_COLUMN = '__actions';
/** What a row's controls are found by, to keep them out of the Tab sequence. */
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';
/** The same, scoped to the body rows: each alternative on its own, or the header is caught too. */
const ROW_CONTROLS = FOCUSABLE.split(',')
  .map((selector) => `tr.nxs-document-list__row ${selector.trim()}`)
  .join(', ');

let nextId = 0;

/**
 * One page of documents as a table: sortable headers, selection, keyboard navigation and a pager,
 * with the loading, empty and error states in place of the rows.
 *
 * The server pages and sorts it. The list never sorts or slices what it is given: it shows the
 * page in `documents`, and asks for another order with `sortChange` and another page with
 * `pageChange`. A Material table with `MatSort`, not virtualised —
 * `docs/satori-components/decision-table-primitive.md`.
 *
 * One row is in the Tab sequence at a time. Arrow keys move between rows, Home and End go to the
 * first and last, Space selects, Shift extends a selection from the last row selected, Ctrl or
 * Cmd+A selects the page, and Enter opens. Inside a row, Right and Left move between its controls,
 * which never take a Tab stop of their own.
 */
@Component({
  selector: 'nxs-document-list',
  standalone: true,
  templateUrl: './document-list.component.html',
  styleUrl: './document-list.component.scss',
  imports: [
    DatePipe,
    DocTypeLabelPipe,
    ExtensionOutletComponent,
    MatCheckboxModule,
    MatIconModule,
    MatSortModule,
    MatTableModule,
    NgTemplateOutlet,
    NxsActionMenuComponent,
    NxsAvatarComponent,
    NxsEmptyStateComponent,
    NxsErrorStateComponent,
    NxsPagerComponent,
    NxsSpinnerComponent,
    NxsTagComponent,
    NxsThumbnailComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxs-document-list',
    '[class.nxs-document-list--drag-over]': 'drop.over()',
    '(dragenter)': 'drop.enter($event)',
    '(dragover)': 'drop.overTarget($event)',
    '(dragleave)': 'drop.leave($event)',
    '(drop)': 'onDrop($event)',
  },
})
export class NxsDocumentListComponent {
  /** The page on screen, in the server's order. */
  readonly documents = input.required<readonly NuxeoDocument[]>();
  /** The columns, in order. The `title` column is the one that names each row. */
  readonly columns = input.required<readonly NxsDocumentListColumn[]>();
  /** The table's accessible name, already translated, such as "Contents of Invoices". */
  readonly label = input.required<string>();
  /** The order the page is in, or `null` for the source's own order. */
  readonly sort = input<NxsDocumentListSort | null>(null);
  /** The selected documents' ids, on every page. Two-way: `[(selectedIds)]`. */
  readonly selectedIds = model<readonly string[]>([]);
  /** Shows the selection checkboxes. Accepts a bare attribute. */
  readonly selectable = input(true, { transform: booleanAttribute });
  /** The page on screen, from zero. */
  readonly pageIndex = input(0, { transform: numberAttribute });
  /** How many documents a full page holds. */
  readonly pageSize = input(50, { transform: numberAttribute });
  /** Every document across every page, or negative when the server did not count them. */
  readonly totalSize = input(-1, { transform: numberAttribute });
  /** Whether the server has another page. */
  readonly hasNextPage = input(false, { transform: booleanAttribute });
  /** Shows the loader in place of the rows. */
  readonly loading = input(false, { transform: booleanAttribute });
  /** The status of the request that failed, mapped with `nxsErrorStatus()`, or `null`. */
  readonly error = input<NxsErrorStatus | null>(null);
  /**
   * What failed, already translated — "The folder could not be loaded". Shown for a server error
   * only: a 401, 403 or 404 keeps its own heading, so a refusal never reads as a breakage.
   */
  readonly errorHeading = input('');
  /** The empty state's heading, already translated. Blank says "Nothing here yet". */
  readonly emptyHeading = input('');
  /** An optional second line for the empty state, already translated. */
  readonly emptyMessage = input('');
  /** The level of the empty and error states' headings in the page outline. */
  readonly stateHeadingLevel = input<NxsHeadingLevel>(2);
  /** Each row's menu entries, by document id. A row with none has no menu. */
  readonly rowActions = input<Readonly<Record<string, readonly NxsMenuAction[]>>>({});
  /** Accepts files dragged onto the list. Accepts a bare attribute. */
  readonly dropEnabled = input(false, { transform: booleanAttribute });
  /** What the list says while files are dragged over it, already translated. */
  readonly dropLabel = input('');

  /** The order asked for, or `null` when the user cleared it. The host fetches it. */
  readonly sortChange = output<NxsDocumentListSort | null>();
  /** The page index asked for. The host fetches it. */
  readonly pageChange = output<number>();
  /** A row was opened: clicked, or Enter on it. */
  readonly open = output<NuxeoDocument>();
  /** An entry of a row's menu was chosen. */
  readonly rowAction = output<NxsDocumentListRowAction>();
  /** Files were dropped on the list. Only while `dropEnabled`. */
  readonly filesDropped = output<readonly File[]>();
  /** Retry was pressed on a server error. */
  readonly retry = output<void>();

  protected readonly tagId = NXS_PRIMITIVE_IDS.tag;
  protected readonly avatarId = NXS_PRIMITIVE_IDS.avatar;
  protected readonly hintId = `nxs-document-list-hint-${nextId++}`;
  protected readonly selectColumn = SELECT_COLUMN;
  protected readonly actionsColumn = ACTIONS_COLUMN;
  protected readonly drop = new NxsFileDropTracker(() => this.dropEnabled());

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly translate = inject(TranslateService);
  private readonly direction = inject(Directionality, { optional: true });
  private readonly translations = toSignal(
    merge(this.translate.onLangChange, this.translate.onTranslationChange),
    { initialValue: null },
  );

  /**
   * Each row's accessible name, for the row, its checkbox and its menu: its title, and, where
   * another document on the page has the same title, its place among them — so no two rows on a
   * page share a name. Titles that differ only in case or surrounding space read the same aloud,
   * so they count as the same.
   */
  private readonly accessibleNames = computed(() => {
    this.translations();
    const documents = this.documents();
    const same = (doc: NuxeoDocument) => this.rowName(doc).toLocaleLowerCase();
    const counts = new Map<string, number>();
    for (const doc of documents) counts.set(same(doc), (counts.get(same(doc)) ?? 0) + 1);
    const seen = new Map<string, number>();
    const names = new Map<string, string>();
    for (const doc of documents) {
      const name = this.rowName(doc);
      const count = counts.get(same(doc)) ?? 1;
      if (count === 1) {
        names.set(doc.uid, name);
        continue;
      }
      const index = (seen.get(same(doc)) ?? 0) + 1;
      seen.set(same(doc), index);
      names.set(
        doc.uid,
        this.translate.instant('satori-components.document-list.row-name-repeated', {
          name,
          index,
          count,
        }),
      );
    }
    return names;
  });

  /** The row in the Tab sequence. */
  protected readonly activeIndex = signal(0);
  /** Where a Shift selection extends from, and what was selected before it began. */
  private anchor = 0;
  private rangeBase: ReadonlySet<string> = new Set();
  /** Whether Shift was held for the checkbox change that follows. */
  private shiftHeld = false;

  protected readonly selected = computed(() => new Set(this.selectedIds()));
  protected readonly sortableColumns = computed(() => this.columns().filter((c) => c.sortable));
  protected readonly plainColumns = computed(() => this.columns().filter((c) => !c.sortable));
  protected readonly hasRowActions = computed(() =>
    this.documents().some((doc) => this.actionsFor(doc).length > 0),
  );
  protected readonly displayedColumns = computed(() => [
    ...(this.selectable() ? [SELECT_COLUMN] : []),
    ...this.columns().map((column) => column.key),
    ...(this.hasRowActions() ? [ACTIONS_COLUMN] : []),
  ]);
  protected readonly pageIds = computed(() => this.documents().map((doc) => doc.uid));
  protected readonly allOnPageSelected = computed(() => {
    const ids = this.pageIds();
    const selected = this.selected();
    return ids.length > 0 && ids.every((id) => selected.has(id));
  });
  protected readonly someOnPageSelected = computed(
    () => !this.allOnPageSelected() && this.pageIds().some((id) => this.selected().has(id)),
  );
  /** The header row counts as one. Unknown is `-1`, which ARIA reads as "not known". */
  protected readonly rowCount = computed(() => {
    const total = this.totalSize();
    return total >= 0 ? total + 1 : -1;
  });
  protected readonly matSortActive = computed(() => this.sort()?.key ?? '');
  protected readonly matSortDirection = computed(() => this.sort()?.direction ?? '');

  constructor() {
    // A new page starts at its first row, so the Tab stop is never left past the end of a shorter
    // one, and a Shift selection never extends from a row of the previous page.
    effect(() => {
      this.documents();
      untracked(() => {
        this.activeIndex.set(0);
        this.anchor = 0;
        this.rangeBase = new Set(this.selectedIds());
      });
    });

    // Every control inside a row leaves the Tab sequence, including the ones a resolved component
    // or a menu renders, so a page of fifty rows is one Tab stop, not a hundred and fifty. After
    // every render, because a component resolved by ID can arrive in a later one than its row.
    afterEveryRender({
      write: () => {
        for (const control of this.host.nativeElement.querySelectorAll<HTMLElement>(ROW_CONTROLS)) {
          if (control.getAttribute('tabindex') !== '-1') control.setAttribute('tabindex', '-1');
        }
      },
    });
  }

  protected actionsFor(doc: NuxeoDocument): readonly NxsMenuAction[] {
    const actions: Partial<Record<string, readonly NxsMenuAction[]>> = this.rowActions();
    return actions[doc.uid] ?? [];
  }

  protected isSelected(doc: NuxeoDocument): boolean {
    return this.selected().has(doc.uid);
  }

  protected isFolder(doc: NuxeoDocument): boolean {
    return doc.type === 'Favorites' || isFolderishDocument(doc);
  }

  /** A container's rendition is only Nuxeo's generic icon, so it is not fetched; the type icon shows. */
  protected hasThumbnail(doc: NuxeoDocument): boolean {
    const type = doc.type?.trim().toLowerCase() ?? '';
    return type.length > 0 && !NON_CONTENT_DOCUMENT_TYPES.has(type);
  }

  protected icon(doc: NuxeoDocument): string {
    return docTypeIcon(doc.type);
  }

  protected rowName(doc: NuxeoDocument): string {
    return nxsVisibleText(doc.title) || doc.path || doc.uid;
  }

  protected accessibleName(doc: NuxeoDocument): string {
    return this.accessibleNames().get(doc.uid) ?? this.rowName(doc);
  }

  protected rowIndex(index: number): number {
    return this.pageIndex() * this.pageSize() + index + 2;
  }

  protected contributor(doc: NuxeoDocument): string {
    return text(doc.properties?.['dc:lastContributor']);
  }

  /** Never empty: an empty string crashes Satori's avatar inside change detection. */
  protected initials(name: string): string {
    return nxsVisibleText(name) || '?';
  }

  protected avatarColor(name: string): NxsAvatarColor {
    return avatarColor(name) as NxsAvatarColor;
  }

  /** The text of a column that is neither the title, the type, a date nor a person. */
  protected cellText(doc: NuxeoDocument, key: string): string {
    const properties = doc.properties ?? {};
    switch (key) {
      case 'author':
        return text(properties['dc:creator']);
      case 'state':
      case 'nature':
        return text(properties['dc:nature']);
      case 'coverage':
        return text(properties['dc:coverage']);
      case 'subjects':
        return text(properties['dc:subjects']);
      case 'version': {
        const major = properties['uid:major_version'];
        return major === undefined || major === null
          ? ''
          : `${major}.${properties['uid:minor_version'] ?? 0}`;
      }
      default:
        return key.includes(':') ? text(properties[key]) : '';
    }
  }

  protected createdDate(doc: NuxeoDocument): string | null {
    const value = doc.properties?.['dc:created'];
    return typeof value === 'string' && value ? value : null;
  }

  protected onSortChange(sort: Sort): void {
    const next: NxsDocumentListSort | null =
      sort.direction === 'asc' || sort.direction === 'desc'
        ? { key: sort.active, direction: sort.direction }
        : null;
    this.sortChange.emit(next);
    const column = this.columns().find((candidate) => candidate.key === sort.active)?.label ?? '';
    const key = !next
      ? 'satori-components.document-list.sort-cleared'
      : next.direction === 'asc'
        ? 'satori-components.document-list.sorted-ascending'
        : 'satori-components.document-list.sorted-descending';
    void this.announcer.announce(this.translate.instant(key, { column }), 'polite');
  }

  protected onPageChange(index: number): void {
    this.pageChange.emit(index);
  }

  protected onRowAction(action: NxsMenuAction, document: NuxeoDocument): void {
    this.rowAction.emit({ action, document });
  }

  protected onDrop(event: DragEvent): void {
    const files = this.drop.drop(event);
    if (files.length > 0) this.filesDropped.emit(files);
  }

  /** Records Shift for the checkbox change it precedes, from the pointer or the keyboard. */
  protected noteModifiers(event: MouseEvent | KeyboardEvent): void {
    this.shiftHeld = event.shiftKey;
  }

  protected onCheckboxChange(change: MatCheckboxChange, index: number): void {
    const shift = this.shiftHeld;
    this.shiftHeld = false;
    this.activeIndex.set(index);
    if (shift) this.selectRange(index);
    else this.toggleAt(index);
    // The checkbox flips itself; put it back to what the selection says, which a range may not be.
    change.source.checked = this.selected().has(this.pageIds()[index]);
  }

  protected onSelectPage(change: MatCheckboxChange): void {
    if (this.allOnPageSelected()) this.deselectPage();
    else this.selectPage();
    change.source.checked = this.allOnPageSelected();
  }

  protected onRowClick(event: MouseEvent, doc: NuxeoDocument, index: number): void {
    this.activeIndex.set(index);
    if (isInsideControl(event.target, event.currentTarget)) return;
    if (this.selectable() && event.shiftKey) {
      this.selectRange(index);
      return;
    }
    if (this.selectable() && (event.ctrlKey || event.metaKey)) {
      this.toggleAt(index);
      return;
    }
    this.open.emit(doc);
  }

  protected onOpenClick(event: MouseEvent, doc: NuxeoDocument, index: number): void {
    event.stopPropagation();
    this.activeIndex.set(index);
    this.open.emit(doc);
  }

  protected onRowFocusIn(index: number): void {
    this.activeIndex.set(index);
  }

  protected onRowKeydown(event: KeyboardEvent, doc: NuxeoDocument, index: number): void {
    const row = event.currentTarget as HTMLElement;
    const onRow = event.target === row;
    const last = this.documents().length - 1;
    const { forward, backward } = this.inlineKeys();

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const next = clamp(index + (event.key === 'ArrowDown' ? 1 : -1), 0, last);
        this.moveTo(next, event.shiftKey);
        return;
      }
      case 'Home':
      case 'End': {
        if (!onRow) return;
        event.preventDefault();
        this.moveTo(event.key === 'Home' ? 0 : last, event.shiftKey);
        return;
      }
      case ' ':
        if (!onRow || !this.selectable()) return;
        event.preventDefault();
        if (event.shiftKey) this.selectRange(index);
        else this.toggleAt(index);
        return;
      case 'Enter':
        if (!onRow) return;
        event.preventDefault();
        this.open.emit(doc);
        return;
      case 'a':
      case 'A':
        if (!onRow || !this.selectable() || !(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        this.selectPage();
        return;
      case 'Escape':
        if (onRow) return;
        event.preventDefault();
        row.focus();
        return;
    }
    if (event.key === forward || event.key === backward) {
      const controls = Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (control) => !control.hasAttribute('disabled'),
      );
      if (controls.length === 0) return;
      event.preventDefault();
      const at = onRow
        ? -1
        : controls.findIndex((control) => control.contains(event.target as Node));
      const target = event.key === forward ? at + 1 : at - 1;
      if (target < 0) row.focus();
      else controls[Math.min(target, controls.length - 1)].focus();
    }
  }

  private inlineKeys(): { forward: string; backward: string } {
    return this.direction?.value === 'rtl'
      ? { forward: 'ArrowLeft', backward: 'ArrowRight' }
      : { forward: 'ArrowRight', backward: 'ArrowLeft' };
  }

  private moveTo(index: number, extend: boolean): void {
    if (index < 0) return;
    this.activeIndex.set(index);
    if (extend && this.selectable()) this.selectRange(index);
    this.focusRow(index);
  }

  private focusRow(index: number): void {
    this.host.nativeElement
      .querySelector<HTMLElement>(`tr.nxs-document-list__row[data-row="${index}"]`)
      ?.focus();
  }

  private toggleAt(index: number): void {
    const id = this.pageIds()[index];
    if (id === undefined) return;
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.anchor = index;
    this.rangeBase = next;
    this.commit(next);
  }

  /** Everything selected before the range began, plus every row from the anchor to `index`. */
  private selectRange(index: number): void {
    const ids = this.pageIds();
    const [from, to] = this.anchor <= index ? [this.anchor, index] : [index, this.anchor];
    const next = new Set(this.rangeBase);
    for (const id of ids.slice(from, to + 1)) next.add(id);
    this.commit(next);
  }

  private selectPage(): void {
    const next = new Set(this.selected());
    for (const id of this.pageIds()) next.add(id);
    this.rangeBase = next;
    this.commit(next);
  }

  private deselectPage(): void {
    const next = new Set(this.selected());
    for (const id of this.pageIds()) next.delete(id);
    this.rangeBase = next;
    this.commit(next);
  }

  /** Keeps the order ids were selected in, so the host's own list does not reshuffle. */
  private commit(next: ReadonlySet<string>): void {
    const current = this.selectedIds();
    const kept = current.filter((id) => next.has(id));
    const added = [...next].filter((id) => !current.includes(id));
    this.selectedIds.set([...kept, ...added]);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** A cell value as text: a list joined, anything not a string or a number left blank. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' || typeof item === 'number').join(', ');
  }
  return '';
}

/** Whether a click landed on a control inside the row, which handles it itself. */
function isInsideControl(target: EventTarget | null, row: EventTarget | null): boolean {
  if (!(target instanceof Element) || !(row instanceof Element)) return false;
  const control = target.closest('a, button, input, label, mat-checkbox, [role="menuitem"]');
  return control !== null && row.contains(control);
}
