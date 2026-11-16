import { LiveAnnouncer } from '@angular/cdk/a11y';
import { DIR_DOCUMENT, Directionality } from '@angular/cdk/bidi';
import {
  Component,
  provideZonelessChangeDetection,
  signal,
  viewChild,
  ChangeDetectionStrategy,
  type Provider,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrowseService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
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
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-document-tree
    label="Folders"
    [currentPath]="path()"
    (navigate)="onNavigate($event)"
  />`,
})
class HostComponent {
  readonly path = signal('/');
  readonly opened: string[] = [];
  /** When set, the page follows a chosen folder, as the real shell does. */
  follow = false;
  onNavigate(doc: { path?: string }): void {
    this.opened.push(doc.path ?? '');
    if (this.follow) this.path.set(doc.path ?? '/');
  }
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
    extra: Provider[] = [],
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
        ...extra,
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

    const backLabels = (): string[] =>
      [...el().querySelectorAll('.nxs-document-tree__back')].map(
        (button) => button.textContent?.trim() ?? '',
      );

    it('shows the folder on screen alone, expanded to its folders, which is marked', () => {
      expect(labels()).toEqual(['Claims', 'Archive']);
      expect(item('Claims').getAttribute('aria-current')).toBe('page');
      expect(item('Claims').getAttribute('aria-expanded')).toBe('true');
      expect(item('Archive').hasAttribute('aria-expanded')).toBe(false);
      expect(items().filter((node) => node.getAttribute('aria-current') === 'page')).toHaveLength(
        1,
      );
    });

    it('hides the siblings of the folder and of each folder above it', () => {
      // Legal is a sibling of Claims, Sections of Workspaces, the other domain of Domain.
      expect(labels()).not.toContain('Legal');
      expect(labels()).not.toContain('Sections');
      expect(labels()).not.toContain('Workspaces');
      expect(labels()).not.toContain('Domain');
      expect(labels()).not.toContain('Other domain');
    });

    it('shows one back row for each ancestor, from the root down', () => {
      expect(backLabels()).toEqual(['Root', 'Domain', 'Workspaces']);
    });

    it('goes back to the root from its button', () => {
      const back = el().querySelector('.nxs-document-tree__back') as HTMLButtonElement;
      expect(back.textContent?.trim()).toContain('Root');
      back.click();
      expect(host.opened).toEqual(['/']);
    });

    it('opens an ancestor from its back row', () => {
      const buttons = [...el().querySelectorAll<HTMLButtonElement>('.nxs-document-tree__back')];
      buttons[2].click();
      buttons[1].click();
      expect(host.opened).toEqual(['/default-domain/workspaces', '/default-domain']);
    });

    it('follows the page to another folder, narrowing to it', async () => {
      host.path.set('/default-domain/sections');
      await render();
      expect(labels()).toEqual(['Sections']);
      expect(backLabels()).toEqual(['Root', 'Domain']);
      expect(item('Sections').getAttribute('aria-current')).toBe('page');
    });

    it('shows a domain on its own at its own level, with the root as the one back row', async () => {
      host.path.set('/default-domain');
      await render();
      expect(labels()).toEqual(['Domain', 'Workspaces', 'Sections']);
      expect(backLabels()).toEqual(['Root']);
    });

    it('stays narrowed while a newly opened folder loads, rather than widening to the domain', async () => {
      const held = new Subject<{ entries: NuxeoDocument[] }>();
      browse.getNavTreeChildren.mockImplementation((doc: NuxeoDocument) =>
        doc.uid === 'legal' ? held : of({ entries: CHILDREN[doc.uid] ?? [] }),
      );
      host.path.set('/default-domain/workspaces/legal');
      await render();
      // The folder just left is folded as the path moves; nothing around it is brought back.
      expect(labels()).toEqual(['Claims']);
      expect(backLabels()).toEqual(['Root', 'Domain', 'Workspaces']);

      held.next({ entries: [] });
      held.complete();
      await render();
      expect(labels()).toEqual(['Legal']);
      expect(backLabels()).toEqual(['Root', 'Domain', 'Workspaces']);
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
      expect(document.activeElement).toBe(item('Legal'));
      key(item('Legal'), 'Home');
      await render();
      expect(document.activeElement).toBe(item('Workspaces'));
      key(item('Workspaces'), 'ArrowUp');
      await render();
      expect(document.activeElement).toBe(item('Workspaces'));
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

    it('steps out to the parent with Left, then collapses it', async () => {
      item('Claims').focus();
      key(item('Claims'), 'ArrowLeft');
      await render();
      expect(document.activeElement).toBe(item('Workspaces'));
      key(item('Workspaces'), 'ArrowLeft');
      await render();
      expect(item('Workspaces').getAttribute('aria-expanded')).toBe('false');
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

  /**
   * The ARIA tree pattern puts "inward" on the key that points along the reading direction, so
   * right to left it is Left that expands and Right that collapses. The component reads
   * `Directionality`, which the shell's `syncDocumentDirection` writes from the active language;
   * providing `DIR_DOCUMENT` lets the real `Directionality` resolve from it rather than asserting
   * a double's behaviour.
   *
   * Untested until Arabic and Hebrew were advertised: nothing set `dir`, so this branch of
   * `onKeydown` had never run.
   */
  describe('keyboard, right to left', () => {
    beforeEach(() => {
      const rtlDocument = document.implementation.createHTMLDocument('rtl');
      rtlDocument.documentElement.dir = 'rtl';
      return create('/default-domain/workspaces', [DOMAIN, OTHER_DOMAIN], CHILDREN, [
        { provide: DIR_DOCUMENT, useValue: rtlDocument },
      ]);
    });

    it('reads rtl from Directionality', () => {
      expect(TestBed.inject(Directionality).value).toBe('rtl');
    });

    it('expands with Left, then steps into the first child', async () => {
      item('Claims').focus();
      key(item('Claims'), 'ArrowLeft');
      await render();
      expect(item('Claims').getAttribute('aria-expanded')).toBe('true');
      key(item('Claims'), 'ArrowLeft');
      await render();
      expect(document.activeElement).toBe(item('Archive'));
    });

    it('steps out to the parent with Right, then collapses it', async () => {
      item('Claims').focus();
      key(item('Claims'), 'ArrowRight');
      await render();
      expect(document.activeElement).toBe(item('Workspaces'));
      key(item('Workspaces'), 'ArrowRight');
      await render();
      expect(item('Workspaces').getAttribute('aria-expanded')).toBe('false');
    });

    it('leaves Up and Down alone, which do not mirror', async () => {
      const start = item('Workspaces');
      start.focus();
      key(start, 'ArrowDown');
      await render();
      expect(document.activeElement).toBe(item('Claims'));
      key(item('Claims'), 'ArrowUp');
      await render();
      expect(document.activeElement).toBe(item('Workspaces'));
    });
  });

  describe('for a user who can only read a workspace', () => {
    // The bootstrap puts such workspaces directly under the root, with no domain above them.
    const MINE = folder('mine', '/default-domain/UserWorkspaces/mine', 'Mine', 'Workspace');
    const THEIRS = folder('theirs', '/default-domain/UserWorkspaces/theirs', 'Theirs', 'Workspace');
    const SUB = folder('sub', '/default-domain/UserWorkspaces/mine/sub', 'Sub');
    const accessible: Record<string, NuxeoDocument[]> = { mine: [SUB], theirs: [], sub: [] };
    const backLabels = (): string[] =>
      [...el().querySelectorAll('.nxs-document-tree__back')].map(
        (button) => button.textContent?.trim() ?? '',
      );

    it('narrows to the opened workspace, with the root as its one back row', async () => {
      await create('/default-domain/UserWorkspaces/mine', [MINE, THEIRS], accessible);
      expect(labels()).toEqual(['Mine', 'Sub']);
      expect(backLabels()).toEqual(['Root']);
      expect(item('Mine').getAttribute('aria-current')).toBe('page');
    });

    it('narrows to a folder inside it, with the workspace as a back row', async () => {
      await create('/default-domain/UserWorkspaces/mine/sub', [MINE, THEIRS], accessible);
      expect(labels()).toEqual(['Sub']);
      expect(backLabels()).toEqual(['Root', 'Mine']);
    });
  });

  describe('after navigating and retrying', () => {
    const backs = (): HTMLButtonElement[] => [
      ...el().querySelectorAll<HTMLButtonElement>('.nxs-document-tree__back'),
    ];

    it('resumes loading the path below a folder whose retry succeeds', async () => {
      await create('/');
      let failed = false;
      browse.getNavTreeChildren.mockImplementation((doc: NuxeoDocument) => {
        if (doc.uid === 'workspaces' && !failed) {
          failed = true;
          return throwError(() => ({ status: 500 }));
        }
        return of({ entries: CHILDREN[doc.uid] ?? [] });
      });
      host.path.set('/default-domain/workspaces/claims');
      await render();
      // The sync stopped at Workspaces; the tree stays on it with its failure row.
      expect(item('Workspaces').getAttribute('aria-expanded')).toBe('true');
      const failure = el().querySelector('.nxs-document-tree__item--error') as HTMLElement;
      expect(failure).not.toBeNull();

      key(failure, 'Enter');
      await render();
      // Retrying goes on to Claims and its folders, rather than narrowing to Claims unexpanded.
      expect(labels()).toEqual(['Claims', 'Archive']);
      expect(item('Claims').getAttribute('aria-expanded')).toBe('true');
    });

    it('stays on the failed folder, not an empty one, while the retry loads the rest of the path', async () => {
      await create('/');
      const claimsFolders = new Subject<{ entries: NuxeoDocument[] }>();
      let failed = false;
      browse.getNavTreeChildren.mockImplementation((doc: NuxeoDocument) => {
        if (doc.uid === 'workspaces' && !failed) {
          failed = true;
          return throwError(() => ({ status: 500 }));
        }
        if (doc.uid === 'claims') return claimsFolders;
        return of({ entries: CHILDREN[doc.uid] ?? [] });
      });
      host.path.set('/default-domain/workspaces/claims');
      await render();
      key(el().querySelector('.nxs-document-tree__item--error') as HTMLElement, 'Enter');
      await render();
      // Workspaces has its folders back, but Claims is still loading: the tree must not narrow to
      // Claims yet, because there is nothing under it to show.
      expect(labels()).toEqual(['Workspaces', 'Claims', 'Legal']);

      claimsFolders.next({ entries: CHILDREN['claims'] });
      claimsFolders.complete();
      await render();
      expect(labels()).toEqual(['Claims', 'Archive']);
    });

    it('puts focus on the opened folder’s row after Enter', async () => {
      await create('/default-domain/workspaces');
      host.follow = true;
      const claims = item('Claims');
      claims.focus();
      key(claims, 'Enter');
      await render();
      expect(host.path()).toBe('/default-domain/workspaces/claims');
      expect(labels()).toEqual(['Claims', 'Archive']);
      expect(document.activeElement).toBe(item('Claims'));
      expect(item('Claims').tabIndex).toBe(0);
    });

    it('puts focus on the folder a back button opened', async () => {
      await create('/default-domain/workspaces/claims');
      host.follow = true;
      const workspacesBack = backs()[2];
      workspacesBack.focus();
      workspacesBack.click();
      await render();
      expect(host.path()).toBe('/default-domain/workspaces');
      expect(document.activeElement).toBe(item('Workspaces'));
    });

    it('retries through the sync when the route spells the path differently', async () => {
      await create('/');
      let failed = false;
      browse.getNavTreeChildren.mockImplementation((doc: NuxeoDocument) => {
        if (doc.uid === 'workspaces' && !failed) {
          failed = true;
          return throwError(() => ({ status: 500 }));
        }
        return of({ entries: CHILDREN[doc.uid] ?? [] });
      });
      host.path.set('/DEFAULT-DOMAIN/WORKSPACES/claims');
      await render();
      key(el().querySelector('.nxs-document-tree__item--error') as HTMLElement, 'Enter');
      await render();
      expect(labels()).toEqual(['Claims', 'Archive']);
    });

    it('does not pull focus back once the user has moved it out of the tree', async () => {
      await create('/default-domain/workspaces');
      host.follow = true;
      const claimsFolders = new Subject<{ entries: NuxeoDocument[] }>();
      browse.getNavTreeChildren.mockImplementation((doc: NuxeoDocument) =>
        doc.uid === 'claims' ? claimsFolders : of({ entries: CHILDREN[doc.uid] ?? [] }),
      );
      const claims = item('Claims');
      claims.focus();
      key(claims, 'Enter');
      await render();

      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      claimsFolders.next({ entries: CHILDREN['claims'] });
      claimsFolders.complete();
      await render();
      expect(labels()).toEqual(['Claims', 'Archive']);
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });

    it('drops the focus intent when another folder supersedes the one opened', async () => {
      await create('/default-domain/workspaces');
      host.follow = true;
      const claimsFolders = new Subject<{ entries: NuxeoDocument[] }>();
      browse.getNavTreeChildren.mockImplementation((doc: NuxeoDocument) =>
        doc.uid === 'claims' ? claimsFolders : of({ entries: CHILDREN[doc.uid] ?? [] }),
      );
      const claims = item('Claims');
      claims.focus();
      key(claims, 'Enter');
      await render();

      // Another control sends the page to Sections before Claims has answered.
      host.path.set('/default-domain/sections');
      await render();
      (document.activeElement as HTMLElement | null)?.blur();
      claimsFolders.next({ entries: CHILDREN['claims'] });
      claimsFolders.complete();
      await render();

      // Later the page comes back to Claims by itself: that is not the user's Enter any more.
      host.path.set('/default-domain/workspaces/claims');
      await render();
      expect(labels()).toEqual(['Claims', 'Archive']);
      expect(el().contains(document.activeElement)).toBe(false);
    });

    it('does not take focus when the page moves on its own', async () => {
      await create('/default-domain/workspaces');
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      host.path.set('/default-domain/sections');
      await render();
      expect(document.activeElement).toBe(outside);
      outside.remove();
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
