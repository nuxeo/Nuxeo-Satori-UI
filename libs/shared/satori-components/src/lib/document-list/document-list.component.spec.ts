import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  Component,
  provideZonelessChangeDetection,
  signal,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DocumentDetailService, type NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';
import { throwError } from 'rxjs';
import { vi } from 'vitest';

import type { NxsMenuAction } from '../action-menu/action-menu.component';
import type { NxsErrorStatus } from '../error-state/error-status';
import { provideNxsComponents } from '../provide-nxs-components';
import {
  NxsDocumentListComponent,
  type NxsDocumentListColumn,
  type NxsDocumentListRowAction,
  type NxsDocumentListSort,
} from './document-list.component';

function doc(n: number, overrides: Partial<NuxeoDocument> = {}): NuxeoDocument {
  return {
    uid: `uid-${n}`,
    title: `Report ${n}`,
    type: 'File',
    path: `/default-domain/workspaces/ws/report-${n}`,
    lastModified: '2026-03-04T10:00:00.000Z',
    properties: { 'dc:lastContributor': 'jdoe', 'dc:created': '2026-01-02T00:00:00.000Z' },
    ...overrides,
  } as NuxeoDocument;
}

const COLUMNS: readonly NxsDocumentListColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'type', label: 'Type' },
  { key: 'modified', label: 'Modified', sortable: true },
  { key: 'lastContributor', label: 'Last contributor', sortable: true },
];

@Component({
  standalone: true,
  imports: [NxsDocumentListComponent],
  template: `
    <nxs-document-list
      [documents]="documents()"
      [columns]="columns()"
      label="Contents of Reports"
      [sort]="sort()"
      [(selectedIds)]="selected"
      [selectable]="selectable()"
      [pageIndex]="pageIndex()"
      [pageSize]="pageSize()"
      [totalSize]="totalSize()"
      [hasNextPage]="hasNextPage()"
      [loading]="loading()"
      [error]="error()"
      errorHeading="The folder could not be loaded"
      [emptyHeading]="emptyHeading()"
      [rowActions]="rowActions()"
      [dropEnabled]="dropEnabled()"
      (sortChange)="sorts.push($event)"
      (pageChange)="pages.push($event)"
      (open)="opened.push($event.uid)"
      (rowAction)="actions.push($event)"
      (filesDropped)="dropped.push($event)"
      (retry)="retries = retries + 1"
    />
  `,
})
class HostComponent {
  readonly documents = signal<readonly NuxeoDocument[]>([doc(1), doc(2), doc(3), doc(4)]);
  readonly columns = signal(COLUMNS);
  readonly sort = signal<NxsDocumentListSort | null>(null);
  readonly selected = signal<readonly string[]>([]);
  readonly selectable = signal(true);
  readonly pageIndex = signal(0);
  readonly pageSize = signal(50);
  readonly totalSize = signal(-2);
  readonly hasNextPage = signal(false);
  readonly loading = signal(false);
  readonly error = signal<NxsErrorStatus | null>(null);
  readonly emptyHeading = signal('');
  readonly rowActions = signal<Readonly<Record<string, readonly NxsMenuAction[]>>>({});
  readonly dropEnabled = signal(false);
  readonly sorts: (NxsDocumentListSort | null)[] = [];
  readonly pages: number[] = [];
  readonly opened: string[] = [];
  readonly actions: NxsDocumentListRowAction[] = [];
  readonly dropped: (readonly File[])[] = [];
  retries = 0;
}

describe('NxsDocumentListComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let announce: ReturnType<typeof vi.fn>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rows = (): HTMLTableRowElement[] => [
    ...el().querySelectorAll<HTMLTableRowElement>('tr.nxs-document-list__row'),
  ];
  const headers = (): HTMLTableCellElement[] => [
    ...el().querySelectorAll<HTMLTableCellElement>('th'),
  ];
  const header = (label: string): HTMLTableCellElement => {
    const match = headers().find((th) => th.textContent?.trim() === label);
    if (!match) throw new Error(`no header ${label}`);
    return match;
  };
  const checkbox = (row: number): HTMLInputElement =>
    rows()[row].querySelector('input[type="checkbox"]') as HTMLInputElement;
  const pageCheckbox = (): HTMLInputElement =>
    el().querySelector('th input[type="checkbox"]') as HTMLInputElement;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function key(target: HTMLElement, name: string, init: KeyboardEventInit = {}): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, ...init }));
  }

  async function configure(providers: (Provider | EnvironmentProviders)[] = []): Promise<void> {
    announce = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: LiveAnnouncer, useValue: { announce } },
        {
          provide: DocumentDetailService,
          useValue: { fetchThumbnail: () => throwError(() => ({ status: 404 })) },
        },
        ...providers,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  }

  describe('rows', () => {
    beforeEach(() => configure([provideNxsComponents()]));

    it('renders one row per document, named by its own title', () => {
      expect(rows().map((row) => row.getAttribute('aria-label'))).toEqual([
        'Report 1',
        'Report 2',
        'Report 3',
        'Report 4',
      ]);
      expect(el().querySelector('table')?.getAttribute('aria-label')).toBe('Contents of Reports');
    });

    it('gives every checkbox the name of its own document', () => {
      expect(rows().map((_, i) => checkbox(i).getAttribute('aria-label'))).toEqual([
        'Select Report 1',
        'Select Report 2',
        'Select Report 3',
        'Select Report 4',
      ]);
      expect(pageCheckbox().getAttribute('aria-label')).toBe('Select all on this page');
    });

    it('numbers rows across pages, the header being row one', async () => {
      host.pageIndex.set(2);
      host.pageSize.set(4);
      host.totalSize.set(20);
      await render();
      expect(rows().map((row) => row.getAttribute('aria-rowindex'))).toEqual([
        '10',
        '11',
        '12',
        '13',
      ]);
      expect(el().querySelector('table')?.getAttribute('aria-rowcount')).toBe('21');
    });

    it('says the row count is unknown when the server did not count', () => {
      expect(el().querySelector('table')?.getAttribute('aria-rowcount')).toBe('-1');
    });

    it('falls back to the path for a document with no title', async () => {
      host.documents.set([doc(9, { title: '  ' })]);
      await render();
      expect(rows()[0].getAttribute('aria-label')).toBe('/default-domain/workspaces/ws/report-9');
    });

    it('keeps a page of fifty rows to one Tab stop, row menus included', async () => {
      const many = Array.from({ length: 50 }, (_, i) => doc(i + 1));
      host.documents.set(many);
      host.rowActions.set(
        Object.fromEntries(many.map((d) => [d.uid, [{ id: 'acme.edit', label: 'Edit' }]])),
      );
      await render();
      const tabbable = [...el().querySelectorAll<HTMLElement>('tbody *, tbody')].filter(
        (node) =>
          node.tabIndex >= 0 &&
          (node.matches('a[href], button, input, [tabindex]') || node.hasAttribute('tabindex')) &&
          node.getAttribute('tabindex') !== '-1',
      );
      expect(tabbable).toHaveLength(1);
      expect(tabbable[0]).toBe(rows()[0]);
    });

    it('takes a control that arrives after its row out of the Tab sequence too', async () => {
      // A component resolved by ID renders in a later pass than its row, with nothing the list
      // tracks having changed.
      const late = document.createElement('button');
      late.textContent = 'Late';
      rows()[0].querySelector('td:nth-child(3)')?.append(late);
      expect(late.tabIndex).toBe(0);
      fixture.componentRef.changeDetectorRef.markForCheck();
      await render();
      expect(late.getAttribute('tabindex')).toBe('-1');
    });

    it('renders the type through the registered tag, and the contributor through the avatar', () => {
      const cells = rows()[0].querySelectorAll('td');
      expect(cells[2].querySelector('lib-extension-outlet nxs-tag')?.textContent?.trim()).toBe(
        'File',
      );
      expect(cells[4].querySelector('lib-extension-outlet nxs-avatar')).not.toBeNull();
      expect(cells[4].textContent).toContain('jdoe');
    });
  });

  describe('sorting', () => {
    beforeEach(() => configure());

    it('makes only sortable columns sort controls, with aria-sort on those alone', () => {
      expect(header('Title').getAttribute('aria-sort')).toBe('none');
      expect(header('Modified').getAttribute('aria-sort')).toBe('none');
      expect(header('Type').hasAttribute('aria-sort')).toBe(false);
      expect(header('Type').querySelector('[role="button"], button')).toBeNull();
    });

    it('marks the active column with its direction and every other sortable one "none"', async () => {
      host.sort.set({ key: 'modified', direction: 'desc' });
      await render();
      expect(header('Modified').getAttribute('aria-sort')).toBe('descending');
      expect(header('Title').getAttribute('aria-sort')).toBe('none');
      expect(header('Last contributor').getAttribute('aria-sort')).toBe('none');
    });

    it('asks for the order and announces it, naming the column', async () => {
      (header('Title').querySelector('.mat-sort-header-container') as HTMLElement).click();
      await render();
      expect(host.sorts).toEqual([{ key: 'title', direction: 'asc' }]);
      expect(announce).toHaveBeenCalledWith('Sorted by Title, ascending', 'polite');
    });

    it('announces a descending order and a cleared one', async () => {
      host.sort.set({ key: 'title', direction: 'asc' });
      await render();
      const control = header('Title').querySelector('.mat-sort-header-container') as HTMLElement;
      control.click();
      await render();
      expect(host.sorts.at(-1)).toEqual({ key: 'title', direction: 'desc' });
      expect(announce).toHaveBeenLastCalledWith('Sorted by Title, descending', 'polite');

      host.sort.set({ key: 'title', direction: 'desc' });
      await render();
      control.click();
      await render();
      expect(host.sorts.at(-1)).toBeNull();
      expect(announce).toHaveBeenLastCalledWith(
        'Sort cleared, showing the default order',
        'polite',
      );
    });

    it('describes each sort control by the column it sorts', () => {
      const describedBy = header('Modified')
        .querySelector('.mat-sort-header-container')
        ?.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Sort by Modified');
    });

    it('never reorders the page itself', async () => {
      host.sort.set({ key: 'title', direction: 'desc' });
      await render();
      expect(rows().map((row) => row.dataset['uid'])).toEqual(['uid-1', 'uid-2', 'uid-3', 'uid-4']);
    });
  });

  describe('keyboard', () => {
    beforeEach(() => configure());

    it('moves the single Tab stop with the arrow keys, Home and End', async () => {
      rows()[0].focus();
      key(rows()[0], 'ArrowDown');
      await render();
      expect(document.activeElement).toBe(rows()[1]);
      expect(rows().map((row) => row.tabIndex)).toEqual([-1, 0, -1, -1]);

      key(rows()[1], 'End');
      await render();
      expect(document.activeElement).toBe(rows()[3]);
      key(rows()[3], 'ArrowDown');
      await render();
      expect(document.activeElement).toBe(rows()[3]);

      key(rows()[3], 'Home');
      await render();
      expect(document.activeElement).toBe(rows()[0]);
      key(rows()[0], 'ArrowUp');
      await render();
      expect(document.activeElement).toBe(rows()[0]);
    });

    it('selects with Space and extends with Shift+Arrow from where it started', async () => {
      rows()[1].focus();
      key(rows()[1], ' ');
      await render();
      expect(host.selected()).toEqual(['uid-2']);

      key(rows()[1], 'ArrowDown', { shiftKey: true });
      key(rows()[2], 'ArrowDown', { shiftKey: true });
      await render();
      expect(host.selected()).toEqual(['uid-2', 'uid-3', 'uid-4']);

      // Moving back shrinks the range rather than adding to it.
      key(rows()[3], 'ArrowUp', { shiftKey: true });
      await render();
      expect(host.selected()).toEqual(['uid-2', 'uid-3']);
    });

    it('deselects with Space again, and Shift+Space selects to the anchor', async () => {
      rows()[0].focus();
      key(rows()[0], ' ');
      key(rows()[0], ' ');
      await render();
      expect(host.selected()).toEqual([]);

      key(rows()[0], ' ');
      key(rows()[0], 'ArrowDown');
      key(rows()[1], 'ArrowDown');
      key(rows()[2], ' ', { shiftKey: true });
      await render();
      expect(host.selected()).toEqual(['uid-1', 'uid-2', 'uid-3']);
    });

    it('opens with Enter', () => {
      key(rows()[2], 'Enter');
      expect(host.opened).toEqual(['uid-3']);
    });

    it('selects the whole page with Ctrl or Cmd+A, keeping other pages’ selection', async () => {
      host.selected.set(['elsewhere']);
      await render();
      key(rows()[0], 'a', { ctrlKey: true });
      await render();
      expect(host.selected()).toEqual(['elsewhere', 'uid-1', 'uid-2', 'uid-3', 'uid-4']);
    });

    it('moves between a row’s controls with Right and Left, and Escape returns to the row', async () => {
      host.rowActions.set({ 'uid-1': [{ id: 'acme.edit', label: 'Edit' }] });
      await render();
      const row = rows()[0];
      row.focus();
      key(row, 'ArrowRight');
      expect(document.activeElement).toBe(checkbox(0));
      key(checkbox(0), 'ArrowRight');
      expect((document.activeElement as HTMLElement).classList).toContain(
        'nxs-document-list__open',
      );
      key(document.activeElement as HTMLElement, 'ArrowRight');
      expect(document.activeElement?.closest('nxs-action-menu')).not.toBeNull();
      key(document.activeElement as HTMLElement, 'ArrowLeft');
      key(document.activeElement as HTMLElement, 'ArrowLeft');
      key(document.activeElement as HTMLElement, 'ArrowLeft');
      expect(document.activeElement).toBe(row);

      key(row, 'ArrowRight');
      key(document.activeElement as HTMLElement, 'Escape');
      expect(document.activeElement).toBe(row);
    });

    it('leaves Space and Enter on a control to the control', async () => {
      key(checkbox(0), 'Enter');
      key(checkbox(0), ' ');
      await render();
      expect(host.opened).toEqual([]);
      expect(host.selected()).toEqual([]);
    });

    it('starts a new page at its first row', async () => {
      rows()[0].focus();
      key(rows()[0], 'End');
      await render();
      host.documents.set([doc(7), doc(8)]);
      await render();
      expect(rows().map((row) => row.tabIndex)).toEqual([0, -1]);
    });
  });

  describe('pointer selection', () => {
    beforeEach(() => configure());

    it('toggles a row with its checkbox', async () => {
      checkbox(1).click();
      await render();
      expect(host.selected()).toEqual(['uid-2']);
      expect(checkbox(1).checked).toBe(true);
    });

    it('selects a range with Shift and a second checkbox', async () => {
      checkbox(0).click();
      await render();
      checkbox(3).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
      checkbox(3).click();
      await render();
      expect(host.selected()).toEqual(['uid-1', 'uid-2', 'uid-3', 'uid-4']);
      // The checkbox shows what the range made it, not only its own toggle.
      expect(rows().map((_, i) => checkbox(i).checked)).toEqual([true, true, true, true]);
    });

    it('selects the page from the header, then clears it, sparing other pages', async () => {
      host.selected.set(['elsewhere']);
      await render();
      pageCheckbox().click();
      await render();
      expect(host.selected()).toEqual(['elsewhere', 'uid-1', 'uid-2', 'uid-3', 'uid-4']);
      expect(pageCheckbox().checked).toBe(true);

      pageCheckbox().click();
      await render();
      expect(host.selected()).toEqual(['elsewhere']);
    });

    it('shows the header checkbox indeterminate for part of the page', async () => {
      host.selected.set(['uid-2']);
      await render();
      expect(pageCheckbox().indeterminate).toBe(true);
    });

    it('opens on a plain click and selects with Ctrl, Cmd or Shift', async () => {
      rows()[0]
        .querySelectorAll('td')[3]
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(host.opened).toEqual(['uid-1']);

      rows()[1]
        .querySelectorAll('td')[3]
        .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      rows()[3]
        .querySelectorAll('td')[3]
        .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      await render();
      expect(host.opened).toEqual(['uid-1']);
      expect(host.selected()).toEqual(['uid-2', 'uid-3', 'uid-4']);
    });

    it('opens from the title, once', async () => {
      (rows()[2].querySelector('.nxs-document-list__open') as HTMLButtonElement).click();
      expect(host.opened).toEqual(['uid-3']);
    });

    it('shows no checkboxes and ignores selection keys when not selectable', async () => {
      host.selectable.set(false);
      await render();
      expect(el().querySelector('mat-checkbox')).toBeNull();
      key(rows()[0], ' ');
      key(rows()[0], 'a', { metaKey: true });
      await render();
      expect(host.selected()).toEqual([]);
    });
  });

  describe('states', () => {
    beforeEach(() => configure());

    it('shows a named loader in place of the rows, and keeps the pager disabled', async () => {
      host.loading.set(true);
      host.pageIndex.set(1);
      await render();
      expect(rows()).toHaveLength(0);
      expect(el().querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe(
        'Loading documents',
      );
      expect((el().querySelector('.nxs-pager__previous') as HTMLButtonElement).disabled).toBe(true);
    });

    it('lets a 403 read as a refusal, not as the host’s "could not be loaded"', async () => {
      host.error.set(403);
      await render();
      const state = el().querySelector('nxs-error-state');
      expect(state?.getAttribute('data-status')).toBe('403');
      expect(state?.querySelector('h2')?.textContent?.trim()).toBe('You do not have access');
      expect(state?.textContent).not.toContain('could not be loaded');
      expect(state?.querySelector('button')).toBeNull();
    });

    it('lets a 404 say the folder is gone', async () => {
      host.error.set(404);
      await render();
      expect(el().querySelector('nxs-error-state h2')?.textContent?.trim()).toBe('Not found');
    });

    it('names a server error with the host’s heading and offers Retry', async () => {
      host.error.set(500);
      await render();
      const state = el().querySelector('nxs-error-state');
      expect(state?.querySelector('h2')?.textContent?.trim()).toBe(
        'The folder could not be loaded',
      );
      (state?.querySelector('button') as HTMLButtonElement).click();
      expect(host.retries).toBe(1);
      expect(el().querySelector('nxs-pager nav')).toBeNull();
    });

    it('shows an empty state, with the host’s heading or its own', async () => {
      host.documents.set([]);
      await render();
      expect(el().querySelector('nxs-empty-state h2')?.textContent?.trim()).toBe(
        'Nothing here yet',
      );

      host.emptyHeading.set('This folder is empty');
      await render();
      expect(el().querySelector('nxs-empty-state h2')?.textContent?.trim()).toBe(
        'This folder is empty',
      );
    });

    it('keeps Previous on an empty page past the end, and does not call the folder empty', async () => {
      host.documents.set([]);
      host.pageIndex.set(1);
      await render();
      expect(el().querySelector('nxs-empty-state')).toBeNull();
      expect(el().querySelector('.nxs-pager__range')?.textContent?.trim()).toBe('No more items');
      (el().querySelector('.nxs-pager__previous') as HTMLButtonElement).click();
      expect(host.pages).toEqual([0]);
    });

    it('pages through the pager', async () => {
      host.hasNextPage.set(true);
      await render();
      (el().querySelector('.nxs-pager__next') as HTMLButtonElement).click();
      expect(host.pages).toEqual([1]);
    });
  });

  describe('cells', () => {
    beforeEach(() => configure());

    it('reads packaged keys and Nuxeo properties, and blanks what is not text', async () => {
      host.columns.set([
        { key: 'title', label: 'Title' },
        { key: 'version', label: 'Version' },
        { key: 'subjects', label: 'Subjects' },
        { key: 'author', label: 'Author' },
        { key: 'dc:source', label: 'Source' },
        { key: 'dc:format', label: 'Format' },
        { key: 'unknown', label: 'Unknown' },
        { key: 'created', label: 'Created' },
      ]);
      host.documents.set([
        doc(1, {
          properties: {
            'uid:major_version': 2,
            'uid:minor_version': 1,
            'dc:subjects': ['art', 'science'],
            'dc:creator': 'asmith',
            'dc:source': 'Scanner',
            'dc:format': { nested: true },
            'dc:created': '2026-01-02T00:00:00.000Z',
          },
        }),
      ]);
      await render();
      const cells = [...rows()[0].querySelectorAll('td')].map((td) => td.textContent?.trim());
      expect(cells.slice(2)).toEqual([
        '2.1',
        'art, science',
        'asmith',
        'Scanner',
        '',
        '',
        'Jan 2, 2026',
      ]);
    });

    it('falls back to the built-in tag and avatar without the registered components', async () => {
      // The outlet learns the ID is unregistered from a promise, after the first render.
      await new Promise((resolve) => setTimeout(resolve));
      await render();
      const cells = rows()[0].querySelectorAll('td');
      expect(cells[2].querySelector('lib-extension-outlet nxs-tag')).toBeNull();
      expect(cells[2].querySelector('nxs-tag')?.textContent?.trim()).toBe('File');
      expect(cells[4].querySelector('nxs-avatar')?.textContent?.trim()).toBe('JD');
    });

    it('marks folders so they read as folders', async () => {
      host.documents.set([doc(1, { type: 'Folder', facets: ['Folderish'] })]);
      await render();
      expect(rows()[0].classList).toContain('nxs-document-list__row--folder');
      expect(rows()[0].querySelector('mat-icon')?.classList).toContain(
        'nxs-document-list__icon--folder',
      );
    });
  });

  describe('row actions', () => {
    beforeEach(() => configure());

    it('adds a menu only to the rows that have actions, named for the row', async () => {
      host.rowActions.set({ 'uid-2': [{ id: 'acme.edit', label: 'Edit' }] });
      await render();
      expect(rows()[0].querySelector('nxs-action-menu button')).toBeNull();
      const trigger = rows()[1].querySelector('nxs-action-menu button') as HTMLButtonElement;
      expect(trigger.getAttribute('aria-label')).toBe('Actions for Report 2');

      trigger.click();
      await render();
      (document.querySelector('[data-action-id="acme.edit"]') as HTMLButtonElement).click();
      expect(host.actions.map((a) => [a.action.id, a.document.uid])).toEqual([
        ['acme.edit', 'uid-2'],
      ]);
      // Choosing from the menu does not also open the row.
      expect(host.opened).toEqual([]);
    });

    it('gives every header cell text, the selection and actions columns included', async () => {
      host.rowActions.set({ 'uid-2': [{ id: 'acme.edit', label: 'Edit' }] });
      await render();
      // axe's empty-table-header wants text in the cell; an aria-label on the checkbox is not enough.
      expect(headers().filter((th) => !th.textContent?.trim())).toEqual([]);
      expect(el().querySelector('th.nxs-document-list__select')?.textContent?.trim()).toBe(
        'Selection',
      );
    });

    it('drops the actions column when no row has actions', () => {
      expect(el().querySelector('th.nxs-document-list__actions')).toBeNull();
    });
  });

  describe('dropping files', () => {
    beforeEach(() => configure());

    function drag(type: string, files: File[] = [], kinds = ['Files']): DragEvent {
      const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
      Object.defineProperty(event, 'dataTransfer', {
        value: { types: kinds, files, dropEffect: 'none' },
      });
      return event;
    }

    const list = (): HTMLElement => el().querySelector('nxs-document-list') as HTMLElement;

    it('highlights while files are over it, and emits them on drop', async () => {
      host.dropEnabled.set(true);
      await render();
      list().dispatchEvent(drag('dragenter'));
      list().dispatchEvent(drag('dragenter'));
      list().dispatchEvent(drag('dragleave'));
      await render();
      expect(el().querySelector('.nxs-document-list__drop')?.textContent?.trim()).toBe(
        'Drop files to upload them here',
      );

      const file = new File(['x'], 'scan.pdf');
      const dropEvent = drag('drop', [file]);
      list().dispatchEvent(dropEvent);
      await render();
      expect(dropEvent.defaultPrevented).toBe(true);
      expect(host.dropped).toEqual([[file]]);
      expect(el().querySelector('.nxs-document-list__drop')).toBeNull();
    });

    it('ignores a drag of text, and any drag while dropping is off', async () => {
      host.dropEnabled.set(true);
      await render();
      const text = drag('dragenter', [], ['text/plain']);
      list().dispatchEvent(text);
      expect(text.defaultPrevented).toBe(false);

      host.dropEnabled.set(false);
      await render();
      const files = drag('drop', [new File(['x'], 'a.txt')]);
      list().dispatchEvent(files);
      await render();
      expect(files.defaultPrevented).toBe(false);
      expect(host.dropped).toEqual([]);
      expect(el().querySelector('.nxs-document-list__drop')).toBeNull();
    });
  });
});
