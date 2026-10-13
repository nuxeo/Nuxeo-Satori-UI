import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, provideZonelessChangeDetection, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowseService, type NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { NxsDocumentTreeComponent } from './document-tree.component';

function folder(uid: string, path: string, title = uid, type = 'Folder'): NuxeoDocument {
  return {
    uid,
    title,
    type,
    path,
    lastModified: '',
    properties: {},
    facets: ['Folderish'],
  } as NuxeoDocument;
}

const ROOT = {
  uid: 'root',
  title: 'Root',
  type: 'Root',
  path: '/',
  lastModified: '',
  properties: {},
} as NuxeoDocument;
const DOMAIN = folder('domain', '/default-domain', 'Domain', 'Domain');
const OTHER_DOMAIN = folder('other', '/other-domain', 'Other domain', 'Domain');
const WORKSPACES = folder(
  'workspaces',
  '/default-domain/workspaces',
  'Workspaces',
  'WorkspaceRoot',
);
const SECTIONS = folder('sections', '/default-domain/sections', 'Sections', 'SectionRoot');
const CLAIMS = folder('claims', '/default-domain/workspaces/claims', 'Claims', 'Workspace');
const LEGAL = folder('legal', '/default-domain/workspaces/legal', 'Legal', 'Workspace');
const ARCHIVE = folder('archive', '/default-domain/workspaces/claims/archive', 'Archive');

/** Each folder's folders, as `getNavTreeChildren` would answer. */
const CHILDREN: Record<string, NuxeoDocument[]> = {
  domain: [WORKSPACES, SECTIONS],
  workspaces: [CLAIMS, LEGAL],
  claims: [ARCHIVE],
  sections: [],
  legal: [],
  archive: [],
};
/** The folders that hold a folder, as `getFolderIdsWithSubfolders` would answer. */
const HOLD_FOLDERS = new Set(['domain', 'workspaces', 'claims']);

@Component({
  standalone: true,
  imports: [NxsDocumentTreeComponent],
  template: `<nxs-document-tree
    label="Folders"
    [currentPath]="path()"
    (navigate)="opened.push($event.path)"
  />`,
})
class HostComponent {
  readonly path = signal('/');
  readonly opened: string[] = [];
  readonly tree = viewChild.required(NxsDocumentTreeComponent);
}

describe('NxsDocumentTreeComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let browse: {
    getNavTreeBootstrap: ReturnType<typeof vi.fn>;
    getNavTreeChildren: ReturnType<typeof vi.fn>;
    getFolderIdsWithSubfolders: ReturnType<typeof vi.fn>;
  };
  let announce: ReturnType<typeof vi.fn>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const items = (): HTMLElement[] => [...el().querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const item = (label: string): HTMLElement => {
    const match = items().find(
      (node) =>
        node
          .querySelector(':scope > .nxs-document-tree__row .nxs-document-tree__label')
          ?.textContent?.trim() === label,
    );
    if (!match) throw new Error(`no tree item ${label}; have ${labels().join(', ')}`);
    return match;
  };
  const labels = (): string[] =>
    items().map(
      (node) =>
        node
          .querySelector(':scope > .nxs-document-tree__row .nxs-document-tree__label')
          ?.textContent?.trim() ?? '',
    );
  const row = (label: string): HTMLElement =>
    item(label).querySelector(':scope > .nxs-document-tree__row') as HTMLElement;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  function key(target: HTMLElement, name: string): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  }

  async function create(
    path = '/',
    domains: NuxeoDocument[] = [DOMAIN, OTHER_DOMAIN],
    children: Record<string, NuxeoDocument[]> = CHILDREN,
  ): Promise<void> {
    browse = {
      getNavTreeBootstrap: vi.fn(() => of({ root: ROOT, entries: domains })),
      getNavTreeChildren: vi.fn((doc: NuxeoDocument) => of({ entries: children[doc.uid] ?? [] })),
      getFolderIdsWithSubfolders: vi.fn((uids: readonly string[]) =>
        of(new Set(uids.filter((uid) => HOLD_FOLDERS.has(uid)))),
      ),
    };
    announce = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: BrowseService, useValue: browse },
        { provide: LiveAnnouncer, useValue: { announce } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.path.set(path);
    await render();
  }

  describe('at the repository root', () => {
    beforeEach(() => create('/'));

    it('shows the root with its domains, the root marked as the current folder', () => {
      const tree = el().querySelector('[role="tree"]');
      expect(tree?.getAttribute('aria-label')).toBe('Folders');
      expect(labels()).toEqual(['Root', 'Domain', 'Other domain']);
      expect(item('Root').getAttribute('aria-current')).toBe('page');
      expect(item('Root').getAttribute('aria-selected')).toBe('true');
      expect(item('Domain').getAttribute('aria-selected')).toBe('false');
      expect(item('Domain').hasAttribute('aria-current')).toBe(false);
      expect(el().querySelector('.nxs-document-tree__back')).toBeNull();
    });

    it('states each row’s level, position and size', () => {
      expect(item('Root').getAttribute('aria-level')).toBe('1');
      expect(item('Domain').getAttribute('aria-level')).toBe('2');
      expect(item('Other domain').getAttribute('aria-posinset')).toBe('2');
      expect(item('Other domain').getAttribute('aria-setsize')).toBe('2');
    });

    it('asks once per level which folders hold a folder, and drops the arrow from a leaf', () => {
      expect(browse.getFolderIdsWithSubfolders).toHaveBeenCalledWith(['domain', 'other']);
      expect(item('Domain').getAttribute('aria-expanded')).toBe('false');
      expect(item('Other domain').hasAttribute('aria-expanded')).toBe(false);
      expect(item('Other domain').querySelector('.nxs-document-tree__arrow')).toBeNull();
    });

    it('keeps one row in the Tab sequence: the current folder’s', () => {
      expect(items().filter((node) => node.tabIndex === 0)).toEqual([item('Root')]);
    });

    it('opens a folder from its row, and the root as the path "/"', async () => {
      row('Domain').click();
      row('Root').click();
      expect(host.opened).toEqual(['/default-domain', '/']);
    });

    it('expands from the arrow, loading once, and collapses again', async () => {
      (item('Domain').querySelector('.nxs-document-tree__arrow') as HTMLElement).click();
      await render();
      expect(labels()).toEqual(['Root', 'Domain', 'Workspaces', 'Sections', 'Other domain']);
      expect(item('Domain').getAttribute('aria-expanded')).toBe('true');
      expect(host.opened).toEqual([]);

      (item('Domain').querySelector('.nxs-document-tree__arrow') as HTMLElement).click();
      await render();
      expect(labels()).toEqual(['Root', 'Domain', 'Other domain']);

      (item('Domain').querySelector('.nxs-document-tree__arrow') as HTMLElement).click();
      await render();
      expect(labels()).toContain('Workspaces');
      expect(browse.getNavTreeChildren).toHaveBeenCalledTimes(1);
    });
  });

  it('opens the only domain when the root has just one', async () => {
    await create('/', [DOMAIN]);
    row('Root').click();
    expect(host.opened).toEqual(['/default-domain']);
  });

  describe('inside a domain', () => {
    beforeEach(() => create('/default-domain/workspaces/claims'));

    it('shows that domain’s branch, expanded down to the current folder, which is marked', () => {
      expect(labels()).toEqual(['Domain', 'Workspaces', 'Claims', 'Archive', 'Legal', 'Sections']);
      expect(item('Claims').getAttribute('aria-current')).toBe('page');
      expect(item('Workspaces').getAttribute('aria-expanded')).toBe('true');
      expect(item('Claims').getAttribute('aria-expanded')).toBe('true');
      expect(item('Archive').hasAttribute('aria-expanded')).toBe(false);
      expect(items().filter((node) => node.getAttribute('aria-current') === 'page')).toHaveLength(
        1,
      );
    });

    it('goes back to the root from its button', () => {
      const back = el().querySelector('.nxs-document-tree__back') as HTMLButtonElement;
      expect(back.textContent?.trim()).toContain('Root');
      back.click();
      expect(host.opened).toEqual(['/']);
    });

    it('follows the page to another folder, folding the branch it left', async () => {
      host.path.set('/default-domain/sections');
      await render();
      expect(labels()).toEqual(['Domain', 'Workspaces', 'Sections']);
      expect(item('Sections').getAttribute('aria-current')).toBe('page');
      expect(item('Workspaces').getAttribute('aria-expanded')).toBe('false');
    });

    it('marks the nearest shown folder when the current one is not in the tree', async () => {
      host.path.set('/default-domain/workspaces/claims/a-file.pdf');
      await render();
      expect(item('Claims').getAttribute('aria-current')).toBe('page');
    });
  });

  describe('which folder it marks as the current one', () => {
    const WS = '/default-domain/workspaces';
    // Listed before their exact twins, so taking the first loose match would mark the wrong one.
    const SIBLINGS: Record<string, NuxeoDocument[]> = {
      ...CHILDREN,
      workspaces: [
        folder('lower', `${WS}/folder`, 'Lower'),
        folder('upper', `${WS}/Folder`, 'Upper'),
        folder('hyphen', `${WS}/a-b`, 'Hyphen'),
        folder('spaced', `${WS}/a b`, 'Spaced'),
        CLAIMS,
        LEGAL,
      ],
    };

    it.each([
      ['the folder whose name matches exactly, of two differing in case', `${WS}/Folder`, 'Upper'],
      ['the other of the two', `${WS}/folder`, 'Lower'],
      ['the folder whose name has a space, not its hyphenated twin', `${WS}/a b`, 'Spaced'],
      ['the hyphenated twin', `${WS}/a-b`, 'Hyphen'],
      ['a folder named in other casing than Nuxeo’s', `${WS}/CLAIMS`, 'Claims'],
      ['a folder, with a trailing slash', `${WS}/claims/`, 'Claims'],
      ['an exact ancestor of a folder not shown', `${WS}/Folder/sub`, 'Upper'],
      ['the parent, for a name that only starts with a sibling’s', `${WS}/claimsx`, 'Workspaces'],
    ])('%s', async (_case, path, current) => {
      await create(path, [DOMAIN, OTHER_DOMAIN], SIBLINGS);
      const marked = items().filter((node) => node.getAttribute('aria-current') === 'page');
      expect(marked).toEqual([item(current)]);
    });
  });

  describe('keyboard', () => {
    beforeEach(() => create('/default-domain/workspaces'));

    it('moves the Tab stop with Up, Down, Home and End', async () => {
      const start = item('Workspaces');
      start.focus();
      key(start, 'ArrowDown');
      await render();
      expect(document.activeElement).toBe(item('Claims'));
      expect(item('Claims').tabIndex).toBe(0);
      expect(start.tabIndex).toBe(-1);

      key(item('Claims'), 'End');
      await render();
      expect(document.activeElement).toBe(item('Sections'));
      key(item('Sections'), 'Home');
      await render();
      expect(document.activeElement).toBe(item('Domain'));
      key(item('Domain'), 'ArrowUp');
      await render();
      expect(document.activeElement).toBe(item('Domain'));
    });

    it('expands with Right, then steps into the first child', async () => {
      item('Claims').focus();
      key(item('Claims'), 'ArrowRight');
      await render();
      expect(item('Claims').getAttribute('aria-expanded')).toBe('true');
      key(item('Claims'), 'ArrowRight');
      await render();
      expect(document.activeElement).toBe(item('Archive'));
    });

    it('collapses with Left, then steps out to the parent', async () => {
      item('Workspaces').focus();
      key(item('Workspaces'), 'ArrowLeft');
      await render();
      expect(item('Workspaces').getAttribute('aria-expanded')).toBe('false');
      key(item('Workspaces'), 'ArrowLeft');
      await render();
      expect(document.activeElement).toBe(item('Domain'));
    });

    it('opens with Enter and toggles with Space', async () => {
      key(item('Legal'), 'Enter');
      expect(host.opened).toEqual(['/default-domain/workspaces/legal']);
      key(item('Workspaces'), ' ');
      await render();
      expect(item('Workspaces').getAttribute('aria-expanded')).toBe('false');
      expect(host.opened).toHaveLength(1);
    });
  });

  describe('failures', () => {
    it('shows a row under a folder whose folders failed, announces it, and retries from it', async () => {
      await create('/');
      browse.getNavTreeChildren.mockReturnValueOnce(throwError(() => ({ status: 500 })));
      (item('Domain').querySelector('.nxs-document-tree__arrow') as HTMLElement).click();
      await render();

      const failure = el().querySelector('.nxs-document-tree__item--error') as HTMLElement;
      expect(failure.getAttribute('role')).toBe('treeitem');
      expect(failure.querySelector('.nxs-document-tree__label')?.textContent?.trim()).toBe(
        'Could not load the folders. Retry',
      );
      expect(announce).toHaveBeenCalledWith(
        'The folders in Domain could not be loaded',
        'assertive',
      );

      key(failure, 'Enter');
      await render();
      expect(el().querySelector('.nxs-document-tree__item--error')).toBeNull();
      expect(labels()).toContain('Workspaces');
    });

    it('says a refused folder is refused, not that it failed', async () => {
      await create('/');
      browse.getNavTreeChildren.mockReturnValueOnce(throwError(() => ({ status: 403 })));
      (item('Domain').querySelector('.nxs-document-tree__arrow') as HTMLElement).click();
      await render();
      expect(
        el()
          .querySelector('.nxs-document-tree__item--error .nxs-document-tree__label')
          ?.textContent?.trim(),
      ).toBe('You do not have access to these folders');
      expect(announce).toHaveBeenCalledWith(
        'You do not have access to the folders in Domain',
        'assertive',
      );
    });

    it('records a failure met while expanding to the current folder too', async () => {
      const failing = new Subject<never>();
      await create('/');
      browse.getNavTreeChildren.mockImplementation((doc: NuxeoDocument) =>
        doc.uid === 'workspaces' ? failing : of({ entries: CHILDREN[doc.uid] ?? [] }),
      );
      host.path.set('/default-domain/workspaces/claims');
      await render();
      failing.error({ status: 500 });
      await render();
      expect(item('Workspaces').getAttribute('aria-current')).toBe('page');
      expect(el().querySelector('.nxs-document-tree__item--error')).not.toBeNull();
    });

    it('shows the tree’s own failure by status, with Retry for a server error', async () => {
      await create('/');
      browse.getNavTreeBootstrap.mockReturnValue(throwError(() => new Error('down')));
      host.tree().reload();
      await render();
      const state = el().querySelector('nxs-error-state');
      expect(state?.getAttribute('data-status')).toBe('500');
      expect(state?.querySelector('h3')?.textContent?.trim()).toBe(
        'The folders could not be loaded',
      );
      expect(announce).toHaveBeenCalledWith('The folders could not be loaded', 'assertive');

      browse.getNavTreeBootstrap.mockReturnValue(of({ root: ROOT, entries: [DOMAIN] }));
      (state?.querySelector('button') as HTMLButtonElement).click();
      await render();
      expect(labels()).toEqual(['Root', 'Domain']);
    });

    it('says a refused tree is refused, without a Retry', async () => {
      await create('/');
      browse.getNavTreeBootstrap.mockReturnValue(throwError(() => ({ status: 403 })));
      host.tree().reload();
      await render();
      const state = el().querySelector('nxs-error-state');
      expect(state?.querySelector('h3')?.textContent?.trim()).toBe('You do not have access');
      expect(state?.querySelector('button')).toBeNull();
    });

    it('keeps the arrow when Nuxeo cannot say which folders hold one', async () => {
      await create('/');
      browse.getFolderIdsWithSubfolders.mockReturnValue(of(null));
      (item('Domain').querySelector('.nxs-document-tree__arrow') as HTMLElement).click();
      await render();
      expect(item('Sections').getAttribute('aria-expanded')).toBe('false');
    });

    it('shows a named spinner while the tree loads', async () => {
      const pending = new Subject<{ root: NuxeoDocument; entries: NuxeoDocument[] }>();
      await create('/');
      browse.getNavTreeBootstrap.mockReturnValue(pending);
      host.tree().reload();
      await render();
      expect(el().querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe(
        'Loading folders',
      );
      pending.next({ root: ROOT, entries: [] });
      pending.complete();
      await render();
      expect(labels()).toEqual(['Root']);
    });
  });
});
