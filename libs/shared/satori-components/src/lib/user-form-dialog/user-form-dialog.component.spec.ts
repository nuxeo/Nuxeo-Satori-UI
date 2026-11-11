import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { UserService, type NuxeoUser } from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import {
  NxsUserFormDialogComponent,
  type NxsUserFormDialogData,
} from './user-form-dialog.component';

/** The English the dialog shows, so the spec can find its controls and read its refusals. */
const ENGLISH: Record<string, string> = {
  'satori-components.user-form-dialog.cancel': 'Cancel',
  'satori-components.user-form-dialog.company': 'Company',
  'satori-components.user-form-dialog.create': 'Create',
  'satori-components.user-form-dialog.create-another': 'Create another',
  'satori-components.user-form-dialog.create-failed': 'Create failed',
  'satori-components.user-form-dialog.create-user': 'Create user',
  'satori-components.user-form-dialog.edit-user': 'Edit user',
  'satori-components.user-form-dialog.email': 'Email',
  'satori-components.user-form-dialog.first-name': 'First name',
  'satori-components.user-form-dialog.groups': 'Groups',
  'satori-components.user-form-dialog.invitation-failed': 'Invitation failed',
  'satori-components.user-form-dialog.last-name': 'Last name',
  'satori-components.user-form-dialog.loading': 'Loading',
  'satori-components.user-form-dialog.loading-groups': 'Loading groups...',
  'satori-components.user-form-dialog.password': 'Password',
  'satori-components.user-form-dialog.passwords-do-not-match': 'Passwords do not match',
  'satori-components.user-form-dialog.pick-group':
    'Pick from search or enter a group name and press Enter',
  'satori-components.user-form-dialog.remove-group': 'Remove group {{ name }}',
  'satori-components.user-form-dialog.save': 'Save',
  'satori-components.user-form-dialog.search-groups': 'Search groups or type a group name…',
  'satori-components.user-form-dialog.set-password': 'Set user password',
  'satori-components.user-form-dialog.username': 'Username',
  'satori-components.user-form-dialog.verify-password': 'Verify password',
  'admin.message.user-already-exists':
    'A user or pending invitation with this username already exists.',
  'admin.message.password-required-for-server':
    'Password is required for this server. Enable "Set user password" or configure User.Invite.',
};

const GROUPS = {
  entries: [
    { groupname: 'members', grouplabel: 'Members' },
    { groupname: 'managers', grouplabel: 'Managers' },
  ],
};

const USER = {
  id: 'jdoe',
  properties: {
    firstName: 'Jane',
    lastName: 'Doe',
    company: 'Acme',
    email: 'jdoe@acme.test',
    groups: ['members'],
  },
} as unknown as NuxeoUser;

describe('NxsUserFormDialogComponent', () => {
  let fixture: ComponentFixture<NxsUserFormDialogComponent>;
  const close = vi.fn();
  const createUser = vi.fn();
  const searchGroupsPaged = vi.fn();
  let disableClose = false;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const component = (): Record<string, unknown> =>
    fixture.componentInstance as unknown as Record<string, unknown>;
  const method = (name: string): ((...args: unknown[]) => unknown) =>
    (component()[name] as (...args: unknown[]) => unknown).bind(component());
  const button = (text: string): HTMLButtonElement =>
    Array.from(el().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement;
  const toggle = (): HTMLButtonElement =>
    el().querySelector('mat-slide-toggle button') as HTMLButtonElement;
  const alert = (): string | undefined => el().querySelector('[role="alert"]')?.textContent?.trim();
  const input = (name: string): HTMLInputElement =>
    el().querySelector(`input[name="${name}"]`) as HTMLInputElement;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function type(name: string, value: string): Promise<void> {
    input(name).value = value;
    input(name).dispatchEvent(new Event('input'));
    await render();
  }

  async function create(data: NxsUserFormDialogData): Promise<void> {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    disableClose = false;
    searchGroupsPaged.mockReturnValue(of(GROUPS));
    createUser.mockReturnValue(of({}));
    await TestBed.configureTestingModule({
      imports: [NxsUserFormDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        {
          provide: MatDialogRef,
          useValue: {
            close,
            get disableClose() {
              return disableClose;
            },
            set disableClose(v: boolean) {
              disableClose = v;
            },
          },
        },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: UserService, useValue: { createUser, searchGroupsPaged } },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).setTranslation('en', ENGLISH);
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(NxsUserFormDialogComponent);
    await render();
  }

  describe('create', () => {
    beforeEach(() => create({ mode: 'create' }));

    it('keeps Create off until a username and an email are entered', async () => {
      expect(button('Create').disabled).toBe(true);
      await type('username', 'newuser');
      expect(button('Create').disabled).toBe(true);
      await type('email', 'new@acme.test');
      expect(button('Create').disabled).toBe(false);
    });

    it('creates the user with no password, so the server sends an invitation', async () => {
      await type('username', 'newuser');
      await type('email', 'new@acme.test');
      button('Create').click();
      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'newuser',
          email: 'new@acme.test',
          password: undefined,
        }),
      );
      expect(close).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'create', invited: true, createAnother: false }),
      );
    });

    it('creates with a password when one is set, and says it was not invited', async () => {
      await type('username', 'newuser');
      await type('email', 'new@acme.test');
      toggle().click();
      await render();
      await type('password', 'pw-1');
      await type('confirmPassword', 'pw-1');
      button('Create').click();
      expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ password: 'pw-1' }));
      expect(close).toHaveBeenCalledWith(expect.objectContaining({ invited: false }));
    });

    it('says the passwords differ and keeps Create off', async () => {
      await type('username', 'newuser');
      await type('email', 'new@acme.test');
      toggle().click();
      await render();
      await type('password', 'pw-1');
      await type('confirmPassword', 'pw-2');
      expect(alert()).toBe('Passwords do not match');
      expect(button('Create').disabled).toBe(true);
    });

    it('closes with createAnother set for Create another', async () => {
      await type('username', 'newuser');
      await type('email', 'new@acme.test');
      button('Create another').click();
      expect(close).toHaveBeenCalledWith(expect.objectContaining({ createAnother: true }));
    });

    it('shows the server reason when the user already exists, and stays open', async () => {
      createUser.mockReturnValue(throwError(() => ({ error: { message: 'User already exists' } })));
      await type('username', 'newuser');
      await type('email', 'new@acme.test');
      button('Create').click();
      await render();
      expect(alert()).toBe('A user or pending invitation with this username already exists.');
      expect(close).not.toHaveBeenCalled();
      expect(disableClose).toBe(false);
    });

    it('shows a generic invitation failure when the server names no reason', async () => {
      createUser.mockReturnValue(throwError(() => new Error('boom')));
      await type('username', 'newuser');
      await type('email', 'new@acme.test');
      button('Create').click();
      await render();
      expect(alert()).toBe('Invitation failed');
    });

    it('shows the create failure when a password was set and the server names no reason', async () => {
      createUser.mockReturnValue(throwError(() => new Error('boom')));
      await type('username', 'newuser');
      await type('email', 'new@acme.test');
      toggle().click();
      await render();
      await type('password', 'pw-1');
      await type('confirmPassword', 'pw-1');
      button('Create').click();
      await render();
      expect(alert()).toBe('Create failed');
    });

    it('reads a server that requires a password as a request for one', async () => {
      createUser.mockReturnValue(throwError(() => ({ message: 'must have a password, quickly' })));
      await type('username', 'newuser');
      await type('email', 'new@acme.test');
      button('Create').click();
      await render();
      expect(alert()).toBe(
        'Password is required for this server. Enable "Set user password" or configure User.Invite.',
      );
    });

    it('keeps a group already on the list when a prefixed group is picked', async () => {
      await render();
      (component()['groups'] as { set: (v: string[]) => void }).set(['sales']);
      method('onGroupSearch')('sales');
      method('onGroupSelected')({ option: { value: 'sales-emea', deselect: vi.fn() } });
      expect((component()['groups'] as () => string[])()).toEqual(['sales', 'sales-emea']);
    });

    it('adds a typed group after a mouse pick, once the text starts a new query', async () => {
      await render();
      method('onGroupSelected')({ option: { value: 'members', deselect: vi.fn() } });
      method('onGroupSearch')('managers');
      method('addGroupFromInput')({ value: 'managers', chipInput: { clear: vi.fn() } });
      expect((component()['groups'] as () => string[])()).toEqual(['members', 'managers']);
    });

    it('adds a typed group as a chip on Enter', async () => {
      const clear = vi.fn();
      await render();
      method('addGroupFromInput')({ value: 'custom', chipInput: { clear } });
      await render();
      expect((component()['groups'] as () => string[])()).toEqual(['custom']);
      expect(clear).toHaveBeenCalled();
    });

    it('ignores a blank group entry', () => {
      const clear = vi.fn();
      method('addGroupFromInput')({ value: '   ', chipInput: { clear } });
      expect((component()['groups'] as () => string[])()).toEqual([]);
      expect(clear).toHaveBeenCalled();
    });

    it('adds the group chosen from the autocomplete and not the typed prefix', () => {
      const groupsOf = component()['groups'] as () => string[];
      method('onGroupSearch')('man');
      // The partial chip is created while this search is under way, so it is not a member from before it.
      (component()['groups'] as { set: (v: string[]) => void }).set(['man']);
      const deselect = vi.fn();
      method('onGroupSelected')({ option: { value: 'managers', deselect } });
      expect(groupsOf()).toEqual(['managers']);
      expect(deselect).toHaveBeenCalled();
    });

    it('does not add a second chip for the Enter that followed an autocomplete choice', () => {
      const clear = vi.fn();
      method('onGroupSelected')({ option: { value: 'members', deselect: vi.fn() } });
      method('addGroupFromInput')({ value: 'members', chipInput: { clear } });
      expect((component()['groups'] as () => string[])()).toEqual(['members']);
    });

    it('removes a group chip', () => {
      method('onGroupSelected')({ option: { value: 'members', deselect: vi.fn() } });
      method('removeGroup')('members');
      expect((component()['groups'] as () => string[])()).toEqual([]);
    });

    it('treats a typed prefix of a known group as unfinished, not a chip', async () => {
      await render();
      (component()['groupOptions'] as { set: (v: unknown[]) => void }).set([
        { groupname: 'managers', grouplabel: 'Managers' },
      ]);
      const clear = vi.fn();
      method('addGroupFromInput')({ value: 'man', chipInput: { clear } });
      expect((component()['groups'] as () => string[])()).toEqual([]);
    });

    it('resolves a suffix typed after a search term to the matching option', () => {
      (component()['groupQuery'] as { set: (v: string) => void }).set('man');
      (component()['groupOptions'] as { set: (v: unknown[]) => void }).set([
        { groupname: 'managers', grouplabel: 'Managers' },
      ]);
      method('addGroupFromInput')({ value: 'manmanagers', chipInput: { clear: vi.fn() } });
      expect((component()['groups'] as () => string[])()).toEqual(['managers']);
    });

    it('turns the group search into a query on focus and on each change', () => {
      method('onGroupInputFocus')();
      method('onGroupSearch')('ma');
      expect(searchGroupsPaged).toHaveBeenCalledWith('*', 200, 0);
    });

    it('refreshes the group results after each blank selection, not just the first', () => {
      vi.useFakeTimers();
      method('onGroupInputFocus')();
      vi.advanceTimersByTime(250);
      searchGroupsPaged.mockClear();
      method('onGroupSelected')({ option: { value: 'members', deselect: vi.fn() } });
      vi.advanceTimersByTime(250);
      method('onGroupSelected')({ option: { value: 'managers', deselect: vi.fn() } });
      vi.advanceTimersByTime(250);
      expect(searchGroupsPaged).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('takes Enter as a choice from the results when there are any, and as typed text when not', () => {
      (component()['groupQuery'] as { set: (v: string) => void }).set('x');
      method('onGroupInputKeydown')({ key: 'Enter' } as KeyboardEvent);
      method('addGroupFromInput')({ value: 'x', chipInput: { clear: vi.fn() } });
      expect((component()['groups'] as () => string[])()).toEqual([]);
      (component()['groupOptions'] as { set: (v: unknown[]) => void }).set([]);
      method('onGroupInputKeydown')({ key: 'Enter' } as KeyboardEvent);
      method('addGroupFromInput')({ value: 'x', chipInput: { clear: vi.fn() } });
      expect((component()['groups'] as () => string[])()).toEqual(['x']);
    });

    it('clears the password fields when the toggle is switched off', () => {
      method('setPasswordEnabled')(true);
      (component()['password'] as { set: (v: string) => void }).set('pw');
      method('setPasswordEnabled')(false);
      expect((component()['password'] as () => string)()).toBe('');
    });
  });

  describe('edit', () => {
    beforeEach(() => create({ mode: 'edit', user: USER }));

    it('starts from the user and keeps the username read-only', () => {
      expect(input('username').value).toBe('jdoe');
      expect(input('username').disabled).toBe(true);
      expect(input('email').value).toBe('jdoe@acme.test');
      expect(button('Create another')).toBeUndefined();
    });

    it('closes with the edited values and does not create a user', async () => {
      await type('firstName', 'Janet');
      button('Save').click();
      expect(createUser).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'edit',
          username: 'jdoe',
          firstName: 'Janet',
          groups: ['members'],
        }),
      );
    });

    it('refuses to save when opened in edit mode without a user', async () => {
      await create({ mode: 'edit' });
      expect(button('Save').disabled).toBe(true);
    });
  });

  describe('while groups load', () => {
    it('keeps Create off until the group list has arrived', async () => {
      const groups$ = new Subject<typeof GROUPS>();
      searchGroupsPaged.mockReturnValue(groups$);
      TestBed.resetTestingModule();
      vi.clearAllMocks();
      searchGroupsPaged.mockReturnValue(groups$);
      createUser.mockReturnValue(of({}));
      await TestBed.configureTestingModule({
        imports: [NxsUserFormDialogComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideTranslateService(),
          { provide: MatDialogRef, useValue: { close, disableClose: false } },
          { provide: MAT_DIALOG_DATA, useValue: { mode: 'create' } },
          { provide: UserService, useValue: { createUser, searchGroupsPaged } },
        ],
      }).compileComponents();
      TestBed.inject(TranslateService).setTranslation('en', ENGLISH);
      TestBed.inject(TranslateService).use('en');
      fixture = TestBed.createComponent(NxsUserFormDialogComponent);
      await render();
      await type('username', 'newuser');
      await type('email', 'new@acme.test');
      expect(button('Create').disabled).toBe(true);
      groups$.next(GROUPS);
      groups$.complete();
      await render();
      expect(button('Create').disabled).toBe(false);
    });
  });

  it('cancels with undefined, so a caller sees no submission', async () => {
    await create({ mode: 'create', groups: [] } as unknown as NxsUserFormDialogData);
    button('Cancel').click();
    expect(close.mock.calls).toEqual([[undefined]]);
  });
});
