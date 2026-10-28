import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import {
  DocumentDetailService,
  PrincipalPermissionsService,
  UserService,
  type NuxeoGroup,
} from '@nuxeo/satori-platform/nuxeo-client';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { NxsAdminGroupDetailsPageComponent } from './admin-group-details-page.component';

/** The English the page shows, so the spec can find its rows and messages. */
const ENGLISH: Record<string, string> = {
  'satori-components.admin-group-details-page.could-not-load': 'Could not load group details.',
  'satori-components.admin-group-details-page.could-not-remove-member':
    'Could not remove the member.',
  'satori-components.admin-group-details-page.could-not-remove-permission':
    'Could not remove the permission.',
  'satori-components.admin-group-details-page.could-not-update-nested':
    'Could not update the nested groups.',
  'satori-components.admin-group-details-page.delete': 'Delete',
  'satori-components.admin-group-details-page.delete-failed': 'Delete failed',
  'satori-components.admin-group-details-page.delete-group': 'Delete group',
  'satori-components.admin-group-details-page.delete-group-named': 'Delete group "{{ name }}"?',
  'satori-components.admin-group-details-page.edit': 'Edit',
  'satori-components.admin-group-details-page.granted-by': 'Granted by',
  'satori-components.admin-group-details-page.group': 'Group',
  'satori-components.admin-group-details-page.group-saved': 'Group saved',
  'satori-components.admin-group-details-page.identifier': 'Identifier',
  'satori-components.admin-group-details-page.loading': 'Loading',
  'satori-components.admin-group-details-page.member-removed': 'Member removed',
  'satori-components.admin-group-details-page.members': 'Members',
  'satori-components.admin-group-details-page.nested-group-removed': 'Nested group removed',
  'satori-components.admin-group-details-page.nested-groups': 'Nested groups',
  'satori-components.admin-group-details-page.no-members': 'No members.',
  'satori-components.admin-group-details-page.no-nested': 'No nested groups.',
  'satori-components.admin-group-details-page.no-permissions':
    'This group does not have permissions.',
  'satori-components.admin-group-details-page.on': 'On',
  'satori-components.admin-group-details-page.permission-removed': 'Permission removed',
  'satori-components.admin-group-details-page.permissions': 'Permissions',
  'satori-components.admin-group-details-page.remove-member': 'Remove {{ name }} from this group',
  'satori-components.admin-group-details-page.remove-member-tooltip': 'Remove member',
  'satori-components.admin-group-details-page.remove-nested': 'Remove {{ name }} from this group',
  'satori-components.admin-group-details-page.remove-nested-tooltip': 'Remove nested group',
  'satori-components.admin-group-details-page.remove-permission': 'Remove permission',
  'satori-components.admin-group-details-page.right': 'Right',
  'satori-components.admin-group-details-page.time-frame': 'Time frame',
  'satori-components.admin-group-details-page.update-failed': 'Could not save the changes.',
  'satori-components.admin-group-details-page.username': 'Username',
};

const GROUP = {
  groupname: 'editors',
  grouplabel: 'Editors',
  memberUsers: ['jdoe', 'asmith'],
  memberGroups: ['reviewers'],
} as unknown as NuxeoGroup;

const PERMISSION = {
  documentUid: 'doc-1',
  documentTitle: 'Claims',
  documentPath: '/Claims',
  permission: 'Write',
  acePrincipal: 'editors',
  aceId: 'editors:Write',
  grantedBy: 'admin',
};

const PAGE = {
  rows: [PERMISSION],
  totalDocuments: 1,
  numberOfPages: 1,
  currentPageIndex: 0,
  currentPageSize: 10,
};

describe('NxsAdminGroupDetailsPageComponent', () => {
  let fixture: ComponentFixture<NxsAdminGroupDetailsPageComponent>;
  let userService: Record<string, ReturnType<typeof vi.fn>>;
  let permissions: Record<string, ReturnType<typeof vi.fn>>;
  let documents: Record<string, ReturnType<typeof vi.fn>>;
  /** What the next dialog closes with, in order. */
  let dialogResults: unknown[];

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => el().textContent ?? '';
  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(el().querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    dialogResults = [];
    userService = {
      getGroup: vi.fn(() => of(GROUP)),
      updateGroup: vi.fn(() => of({})),
      deleteGroup: vi.fn(() => of({})),
    };
    permissions = { listLocalPermissionRows: vi.fn(() => of(PAGE)) };
    documents = { removePermissionById: vi.fn(() => of({})) };
    const dialog = { open: vi.fn(() => ({ afterClosed: () => of(dialogResults.shift()) })) };
    await TestBed.configureTestingModule({
      imports: [NxsAdminGroupDetailsPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        { provide: UserService, useValue: userService },
        { provide: PrincipalPermissionsService, useValue: permissions },
        { provide: DocumentDetailService, useValue: documents },
        { provide: MatDialog, useValue: dialog },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).setTranslation('en', ENGLISH);
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(NxsAdminGroupDetailsPageComponent);
    fixture.componentRef.setInput('groupId', 'editors');
    await render();
  });

  it('loads the group named by the input and shows its label and name', () => {
    expect(userService['getGroup']).toHaveBeenCalledWith('editors');
    expect(el().querySelector('h1')?.textContent?.trim()).toBe('Editors');
    expect(text()).toContain('editors');
  });

  it('lists the members, the nested groups and the permissions', () => {
    expect(text()).toContain('jdoe');
    expect(text()).toContain('asmith');
    expect(text()).toContain('reviewers');
    expect(text()).toContain('Claims');
  });

  it('shows an alert when the group cannot be loaded', async () => {
    userService['getGroup'].mockReturnValue(throwError(() => new Error('nope')));
    fixture.componentRef.setInput('groupId', 'missing');
    await render();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load group details.',
    );
  });

  it('calls its callback with the member, nested group and document when each is chosen', () => {
    const users: string[] = [];
    const groups: string[] = [];
    const docs: string[] = [];
    fixture.componentRef.setInput('userChosen', (id: string) => users.push(id));
    fixture.componentRef.setInput('groupChosen', (id: string) => groups.push(id));
    fixture.componentRef.setInput('documentChosen', (id: string) => docs.push(id));
    button('jdoe')?.click();
    button('reviewers')?.click();
    button('Claims')?.click();
    expect(users).toEqual(['jdoe']);
    expect(groups).toEqual(['reviewers']);
    expect(docs).toEqual(['doc-1']);
  });

  it('removes a member by sending the members that remain', async () => {
    (fixture.componentInstance as unknown as { removeMember(id: string): void }).removeMember(
      'jdoe',
    );
    await render();
    expect(userService['updateGroup']).toHaveBeenCalledWith('editors', { memberUsers: ['asmith'] });
    expect(text()).toContain('Member removed');
  });

  it('removes a nested group by sending the groups that remain', async () => {
    (
      fixture.componentInstance as unknown as { removeNestedGroup(id: string): void }
    ).removeNestedGroup('reviewers');
    await render();
    expect(userService['updateGroup']).toHaveBeenCalledWith('editors', { memberGroups: [] });
    expect(text()).toContain('Nested group removed');
  });

  it('shows an alert when a member cannot be removed', async () => {
    userService['updateGroup'].mockReturnValue(throwError(() => new Error('no')));
    (fixture.componentInstance as unknown as { removeMember(id: string): void }).removeMember(
      'jdoe',
    );
    await render();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'Could not remove the member.',
    );
  });

  it('saves the edited group', async () => {
    dialogResults.push({
      mode: 'edit',
      groupname: 'editors',
      grouplabel: 'Editors 2',
      memberUsers: ['jdoe'],
    });
    (fixture.componentInstance as unknown as { edit(): void }).edit();
    await render();
    expect(userService['updateGroup']).toHaveBeenCalledWith('editors', {
      grouplabel: 'Editors 2',
      memberUsers: ['jdoe'],
    });
    expect(text()).toContain('Group saved');
  });

  it('deletes the group after confirmation and calls deleted', async () => {
    dialogResults.push(true);
    const deleted = vi.fn();
    fixture.componentRef.setInput('deleted', deleted);
    (fixture.componentInstance as unknown as { deleteGroup(): void }).deleteGroup();
    await render();
    expect(userService['deleteGroup']).toHaveBeenCalledWith('editors');
    expect(deleted).toHaveBeenCalled();
  });

  it('removes a permission and reports it', async () => {
    (
      fixture.componentInstance as unknown as { removePermission(row: unknown): void }
    ).removePermission(PERMISSION);
    await render();
    expect(documents['removePermissionById']).toHaveBeenCalledWith('doc-1', 'editors:Write');
    expect(text()).toContain('Permission removed');
  });
});
