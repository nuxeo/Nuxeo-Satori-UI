import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import {
  DocumentDetailService,
  PrincipalPermissionsService,
  UserService,
  type NuxeoGroup,
  type NuxeoUser,
} from '@nuxeo/satori-platform/nuxeo-client';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { NxsAdminUserDetailsPageComponent } from './admin-user-details-page.component';

/** The English the page shows, so the spec can find its rows and messages. */
const ENGLISH: Record<string, string> = {
  'satori-components.admin-user-details-page.change-password': 'Change password',
  'satori-components.admin-user-details-page.company': 'Company:',
  'satori-components.admin-user-details-page.could-not-load': 'Could not load user details.',
  'satori-components.admin-user-details-page.could-not-remove-permission':
    'Could not remove the permission.',
  'satori-components.admin-user-details-page.could-not-update-groups':
    "Could not update the user's groups.",
  'satori-components.admin-user-details-page.delete': 'Delete',
  'satori-components.admin-user-details-page.delete-failed': 'Delete failed',
  'satori-components.admin-user-details-page.delete-user': 'Delete user',
  'satori-components.admin-user-details-page.delete-user-named':
    'Delete user "{{ name }}"? This cannot be undone.',
  'satori-components.admin-user-details-page.edit': 'Edit',
  'satori-components.admin-user-details-page.email': 'Email:',
  'satori-components.admin-user-details-page.granted-by': 'Granted by',
  'satori-components.admin-user-details-page.group-permissions': '{{ group }} permissions',
  'satori-components.admin-user-details-page.groups': 'Groups',
  'satori-components.admin-user-details-page.identifier': 'Identifier',
  'satori-components.admin-user-details-page.loading': 'Loading',
  'satori-components.admin-user-details-page.local-permissions': 'Local permissions',
  'satori-components.admin-user-details-page.name': 'Name',
  'satori-components.admin-user-details-page.no-groups': 'No groups assigned.',
  'satori-components.admin-user-details-page.no-local': 'No local permissions.',
  'satori-components.admin-user-details-page.no-permissions':
    '{{ name }} does not have permissions.',
  'satori-components.admin-user-details-page.on': 'On',
  'satori-components.admin-user-details-page.password-update-failed': 'Password update failed',
  'satori-components.admin-user-details-page.password-updated': 'Password updated',
  'satori-components.admin-user-details-page.permission-removed': 'Permission removed',
  'satori-components.admin-user-details-page.remove-from-group': 'Remove {{ name }} from this user',
  'satori-components.admin-user-details-page.remove-group': 'Remove group',
  'satori-components.admin-user-details-page.remove-permission': 'Remove permission',
  'satori-components.admin-user-details-page.removed-from-group': 'Group removed from the user',
  'satori-components.admin-user-details-page.right': 'Right',
  'satori-components.admin-user-details-page.time-frame': 'Time frame',
  'satori-components.admin-user-details-page.update-failed': 'Could not save the changes.',
  'satori-components.admin-user-details-page.user-updated': 'User saved',
};

const USER = {
  id: 'jdoe',
  properties: {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jdoe@acme.test',
    company: 'Acme',
    groups: ['members'],
  },
} as unknown as NuxeoUser;

const GROUP = { groupname: 'members', grouplabel: 'Members' } as unknown as NuxeoGroup;

const PERMISSION = {
  documentUid: 'doc-1',
  documentTitle: 'Claims',
  documentPath: '/Claims',
  permission: 'Read',
  acePrincipal: 'jdoe',
  grantedBy: 'admin',
};

const EMPTY = {
  rows: [],
  totalDocuments: 0,
  numberOfPages: 0,
  currentPageIndex: 0,
  currentPageSize: 0,
};

describe('NxsAdminUserDetailsPageComponent', () => {
  let fixture: ComponentFixture<NxsAdminUserDetailsPageComponent>;
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
      getUser: vi.fn(() => of(USER)),
      getGroup: vi.fn(() => of(GROUP)),
      updateUser: vi.fn(() => of({})),
      deleteUser: vi.fn(() => of({})),
    };
    permissions = {
      listLocalPermissionRows: vi.fn(() => of({ ...EMPTY, rows: [PERMISSION], totalDocuments: 1 })),
    };
    documents = {
      removePermission: vi.fn(() => of({})),
    };
    const dialog = { open: vi.fn(() => ({ afterClosed: () => of(dialogResults.shift()) })) };
    await TestBed.configureTestingModule({
      imports: [NxsAdminUserDetailsPageComponent],
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
    fixture = TestBed.createComponent(NxsAdminUserDetailsPageComponent);
    fixture.componentRef.setInput('userId', 'jdoe');
    await render();
  });

  it('loads the user named by the input and shows the profile', () => {
    expect(userService['getUser']).toHaveBeenCalledWith('jdoe');
    expect(el().querySelector('h1')?.textContent?.trim()).toBe('jdoe');
    expect(text()).toContain('jdoe@acme.test');
    expect(text()).toContain('Acme');
  });

  it('shows the groups and the permissions held directly', () => {
    expect(text()).toContain('Members');
    expect(text()).toContain('Claims');
    expect(text()).toContain('Read');
  });

  it('shows an alert when the user cannot be loaded', async () => {
    userService['getUser'].mockReturnValue(throwError(() => new Error('nope')));
    fixture.componentRef.setInput('userId', 'missing');
    await render();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load user details.',
    );
  });

  it('calls its callback with the group when it is chosen', () => {
    const emitted: string[] = [];
    fixture.componentRef.setInput('groupChosen', (id: string) => emitted.push(id));
    button('Members')?.click();
    expect(emitted).toEqual(['members']);
  });

  it('calls its callback with the document when a permission is chosen', () => {
    const emitted: string[] = [];
    fixture.componentRef.setInput('documentChosen', (id: string) => emitted.push(id));
    button('Claims')?.click();
    expect(emitted).toEqual(['doc-1']);
  });

  it('removes the user from one group by sending the groups that remain', async () => {
    (fixture.componentInstance as unknown as { removeFromGroup(id: string): void }).removeFromGroup(
      'members',
    );
    await render();
    expect(userService['updateUser']).toHaveBeenCalledWith('jdoe', { groups: [] });
    expect(text()).toContain('Group removed from the user');
  });

  it('saves a new password when the dialog returns one', async () => {
    dialogResults.push('new-pw');
    (fixture.componentInstance as unknown as { changePassword(): void }).changePassword();
    await render();
    expect(userService['updateUser']).toHaveBeenCalledWith('jdoe', { password: 'new-pw' });
    expect(text()).toContain('Password updated');
  });

  it('does nothing when the password dialog is cancelled', async () => {
    dialogResults.push(undefined);
    (fixture.componentInstance as unknown as { changePassword(): void }).changePassword();
    await render();
    expect(userService['updateUser']).not.toHaveBeenCalled();
  });

  it('shows an alert when a password update is refused', async () => {
    dialogResults.push('new-pw');
    userService['updateUser'].mockReturnValue(throwError(() => new Error('no')));
    (fixture.componentInstance as unknown as { changePassword(): void }).changePassword();
    await render();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Password update failed');
  });

  it('saves the edited profile', async () => {
    dialogResults.push({
      mode: 'edit',
      username: 'jdoe',
      firstName: 'Janet',
      lastName: 'Doe',
      company: 'Acme',
      email: 'jdoe@acme.test',
      groups: ['members'],
    });
    (fixture.componentInstance as unknown as { edit(): void }).edit();
    await render();
    expect(userService['updateUser']).toHaveBeenCalledWith(
      'jdoe',
      expect.objectContaining({ firstName: 'Janet' }),
    );
    expect(text()).toContain('User saved');
  });

  it('deletes the user after confirmation and calls deleted', async () => {
    dialogResults.push(true);
    const deleted = vi.fn();
    fixture.componentRef.setInput('deleted', deleted);
    (fixture.componentInstance as unknown as { deleteUser(): void }).deleteUser();
    await render();
    expect(userService['deleteUser']).toHaveBeenCalledWith('jdoe');
    expect(deleted).toHaveBeenCalled();
  });

  it('removes a permission and reports it', async () => {
    (
      fixture.componentInstance as unknown as { removePermission(row: unknown): void }
    ).removePermission(PERMISSION);
    await render();
    expect(documents['removePermission']).toHaveBeenCalledWith('doc-1', {
      user: 'jdoe',
      permission: 'Read',
      acl: 'local',
    });
    expect(text()).toContain('Permission removed');
  });
});
