import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatChipInputEvent } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { MockInstance, vi } from 'vitest';

import { UserService } from '@nuxeo/satori-platform/nuxeo-client';

import { UserFormDialogComponent, UserFormDialogData } from './user-form-dialog.component';

describe('UserFormDialogComponent (NXSAT-151 / NXSAT-166)', () => {
  let component: UserFormDialogComponent;
  let fixture: ComponentFixture<UserFormDialogComponent>;
  let closeSpy: ReturnType<typeof vi.fn>;
  let createUserSpy: ReturnType<typeof vi.fn>;
  let snackBarOpenSpy: MockInstance<MatSnackBar['open']>;

  beforeEach(async () => {
    closeSpy = vi.fn();
    createUserSpy = vi.fn().mockReturnValue(of({ id: 'new.user' }));
    await TestBed.configureTestingModule({
      imports: [
        testTranslateModule(),
        testTranslateModule(),
        UserFormDialogComponent,
        NoopAnimationsModule,
      ],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: { mode: 'create' } satisfies UserFormDialogData,
        },
        {
          provide: MatDialogRef,
          useValue: { close: closeSpy, disableClose: false },
        },
        {
          provide: UserService,
          useValue: {
            searchGroupsPaged: vi.fn().mockReturnValue(of({ entries: [], totalSize: 0 })),
            createUser: createUserSpy,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserFormDialogComponent);
    component = fixture.componentInstance;
    snackBarOpenSpy = vi.spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open');
    fixture.detectChanges();
    component.loadingGroups = false;
  });

  it('defaults Set user password toggle to off', () => {
    expect(component.setUserPassword).toBe(false);
  });

  it('allows save with username and email when password toggle is off', () => {
    component.username = 'new.user';
    component.email = 'new.user@example.com';

    expect(component.canSave).toBe(true);
  });

  it('calls createUser and closes with invited flag when password toggle is off', () => {
    component.username = 'invite.user';
    component.email = 'invite.user@example.com';

    component.submit(false);

    expect(createUserSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'invite.user',
        email: 'invite.user@example.com',
      }),
    );
    expect(closeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'invite.user',
        invited: true,
        createAnother: false,
      }),
    );
    const result = closeSpy.mock.calls[0][0];
    expect(result).not.toHaveProperty('password');
  });

  it('passes createAnother when creating another user', () => {
    component.username = 'another.user';
    component.email = 'another.user@example.com';

    component.submit(true);

    expect(closeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ createAnother: true, invited: true }),
    );
  });

  it('closes with invited false and no password after password create', () => {
    component.username = 'pwd.user';
    component.email = 'pwd.user@example.com';
    component.setUserPassword = true;
    component.password = 'Secret123';
    component.confirmPassword = 'Secret123';

    component.submit(false);

    expect(createUserSpy).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'pwd.user', password: 'Secret123' }),
    );
    expect(closeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'pwd.user', invited: false }),
    );
    expect(closeSpy.mock.calls[0][0]).not.toHaveProperty('password');
  });

  it('shows toast and keeps dialog open when create fails', fakeAsync(() => {
    createUserSpy.mockReturnValue(
      throwError(() => ({ error: { message: 'Failed to invoke operation: User.Invite' } })),
    );
    component.username = 'fail.user';
    component.email = 'fail.user@example.com';

    component.submit(false);
    tick();

    expect(closeSpy).not.toHaveBeenCalled();
    expect(snackBarOpenSpy).toHaveBeenCalledWith(
      'Failed to invoke operation: User.Invite',
      'Dismiss',
      expect.objectContaining({ duration: 7000 }),
    );
    expect(component.saving()).toBe(false);
  }));

  it('shows simplified API message for invite mail failures', fakeAsync(() => {
    createUserSpy.mockReturnValue(
      throwError(() => ({
        error: {
          message:
            'Failed to invoke operation: User.Invite, Failed to invoke operation User.Invite, An error occurred while sending a mail',
        },
      })),
    );
    component.username = 'fail.user';
    component.email = 'fail.user@example.com';

    component.submit(false);
    tick();

    expect(snackBarOpenSpy).toHaveBeenCalledWith(
      'An error occurred while sending a mail',
      'Dismiss',
      expect.objectContaining({ duration: 7000 }),
    );
  }));

  it('adds selected group without concatenating typed prefix (NXSAT-151)', () => {
    const deselect = vi.fn();
    component.groupSearchQuery = 'power';
    component.groupOptions = [{ groupname: 'powerusers', grouplabel: 'powerusers' }];

    const chipInput = { clear: vi.fn() };
    component.addGroupFromInput({
      value: 'powerpowerusers',
      chipInput,
    } as unknown as MatChipInputEvent);

    expect(component.groups).toEqual(['powerusers']);
    expect(component.groupSearchQuery).toBe('');
    expect(chipInput.clear).toHaveBeenCalled();

    component.onGroupSelected({
      option: { value: 'powerusers', deselect },
    } as unknown as MatAutocompleteSelectedEvent);

    expect(component.groups).toEqual(['powerusers']);
    expect(deselect).toHaveBeenCalled();
  });

  it('ignores partial prefix chip before autocomplete selection (NXSAT-151)', () => {
    component.groupSearchQuery = 'power';
    component.groupOptions = [{ groupname: 'powerusers', grouplabel: 'powerusers' }];

    const chipInput = { clear: vi.fn() };
    component.addGroupFromInput({
      value: 'power',
      chipInput,
    } as unknown as MatChipInputEvent);

    expect(component.groups).toEqual([]);
    expect(chipInput.clear).toHaveBeenCalled();

    component.groups = ['powe'];
    component.onGroupSelected({
      option: { value: 'powerusers', deselect: vi.fn() },
    } as unknown as MatAutocompleteSelectedEvent);

    expect(component.groups).toEqual(['powerusers']);
    expect(component.groupSearchQuery).toBe('');
  });

  it('does not strip typed prefix when suffix is not a known group (NXSAT-151)', () => {
    component.groupSearchQuery = 'power';
    component.groupOptions = [{ groupname: 'powerusers', grouplabel: 'powerusers' }];

    const chipInput = { clear: vi.fn() };
    component.addGroupFromInput({
      value: 'powerusers',
      chipInput,
    } as unknown as MatChipInputEvent);

    expect(component.groups).toEqual(['powerusers']);
  });

  it('selects autocomplete result on Enter when suggestions are shown (NXSAT-151)', () => {
    component.groupSearchQuery = 'en';
    component.groupOptions = [{ groupname: 'group01', grouplabel: 'Group 01' }];

    component.onGroupInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

    const chipInput = { clear: vi.fn() };
    component.addGroupFromInput({
      value: 'en',
      chipInput,
    } as unknown as MatChipInputEvent);

    expect(component.groups).toEqual([]);

    component.onGroupSelected({
      option: { value: 'group01', deselect: vi.fn() },
    } as unknown as MatAutocompleteSelectedEvent);

    expect(component.groups).toEqual(['group01']);
  });

  it('accepts exact group name that is also a prefix of another option (NXSAT-151)', () => {
    component.groupOptions = [
      { groupname: 'admin', grouplabel: 'admin' },
      { groupname: 'administrators', grouplabel: 'administrators' },
    ];

    const chipInput = { clear: vi.fn() };
    component.addGroupFromInput({
      value: 'admin',
      chipInput,
    } as unknown as MatChipInputEvent);

    expect(component.groups).toEqual(['admin']);
  });

  it('blocks save when email is missing (NXSAT-166)', () => {
    component.username = 'new.user';
    component.email = '   ';

    expect(component.canSave).toBe(false);
  });

  it('keeps password fields empty when Set user password is off (NXSAT-166)', () => {
    expect(component.setUserPassword).toBe(false);
    expect(component.password).toBe('');
    expect(component.confirmPassword).toBe('');
  });
});
