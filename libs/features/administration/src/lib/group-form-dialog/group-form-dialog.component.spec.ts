import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatChipInputEvent } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { NuxeoUser, UserService } from '@nuxeo/satori-platform/nuxeo-client';

import { GroupFormDialogComponent, GroupFormDialogData } from './group-form-dialog.component';

function mockUser(id: string): NuxeoUser {
  return {
    'entity-type': 'user',
    id,
    properties: {
      username: id,
      firstName: 'Test',
      lastName: 'User',
      email: `${id}@example.com`,
      groups: [],
    },
  };
}

describe('GroupFormDialogComponent (NXSAT-151)', () => {
  let component: GroupFormDialogComponent;
  let fixture: ComponentFixture<GroupFormDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupFormDialogComponent, NoopAnimationsModule],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            mode: 'edit',
            group: {
              'entity-type': 'group',
              groupname: 'administrators',
              grouplabel: 'Administrators',
              memberUsers: [],
              memberGroups: [],
            },
          } satisfies GroupFormDialogData,
        },
        {
          provide: MatDialogRef,
          useValue: { close: vi.fn() },
        },
        {
          provide: UserService,
          useValue: {
            searchUsersPaged: vi.fn().mockReturnValue(of({ entries: [], totalSize: 0 })),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('adds selected member without concatenating typed prefix (NXSAT-151)', () => {
    const deselect = vi.fn();
    const user = mockUser('poweruser01');
    component.userSearchQuery = 'power';
    component.filteredUsers = [user];

    const chipInput = { clear: vi.fn() };
    component.addMemberFromInput({
      value: 'powerpoweruser01',
      chipInput,
    } as unknown as MatChipInputEvent);

    expect(component.memberUsernames).toEqual(['poweruser01']);
    expect(component.userSearchQuery).toBe('');
    expect(chipInput.clear).toHaveBeenCalled();

    component.onUserSelected({
      option: { value: user, deselect },
    } as unknown as MatAutocompleteSelectedEvent);

    expect(component.memberUsernames).toEqual(['poweruser01']);
    expect(deselect).toHaveBeenCalled();
  });

  it('ignores partial prefix chip before autocomplete selection (NXSAT-151)', () => {
    const user = mockUser('poweruser01');
    component.userSearchQuery = 'power';
    component.filteredUsers = [user];

    const chipInput = { clear: vi.fn() };
    component.addMemberFromInput({
      value: 'power',
      chipInput,
    } as unknown as MatChipInputEvent);

    expect(component.memberUsernames).toEqual([]);
    expect(chipInput.clear).toHaveBeenCalled();

    component.memberUsernames = ['powe'];
    component.onUserSelected({
      option: { value: user, deselect: vi.fn() },
    } as unknown as MatAutocompleteSelectedEvent);

    expect(component.memberUsernames).toEqual(['poweruser01']);
    expect(component.userSearchQuery).toBe('');
  });

  it('does not strip typed prefix when suffix is not a known user id (NXSAT-151)', () => {
    component.userSearchQuery = 'power';
    component.filteredUsers = [mockUser('poweruser01')];

    const chipInput = { clear: vi.fn() };
    component.addMemberFromInput({
      value: 'poweruser01',
      chipInput,
    } as unknown as MatChipInputEvent);

    expect(component.memberUsernames).toEqual(['poweruser01']);
  });

  it('selects autocomplete result on Enter when suggestions are shown (NXSAT-151)', () => {
    component.userSearchQuery = 'en';
    component.filteredUsers = [mockUser('group01')];

    component.onMemberInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

    const chipInput = { clear: vi.fn() };
    component.addMemberFromInput({
      value: 'en',
      chipInput,
    } as unknown as MatChipInputEvent);

    expect(component.memberUsernames).toEqual([]);

    component.onUserSelected({
      option: { value: mockUser('group01'), deselect: vi.fn() },
    } as unknown as MatAutocompleteSelectedEvent);

    expect(component.memberUsernames).toEqual(['group01']);
  });

  it('accepts exact user id that is also a prefix of another option (NXSAT-151)', () => {
    component.filteredUsers = [mockUser('admin'), mockUser('administrators')];

    const chipInput = { clear: vi.fn() };
    component.addMemberFromInput({
      value: 'admin',
      chipInput,
    } as unknown as MatChipInputEvent);

    expect(component.memberUsernames).toEqual(['admin']);
  });

  it('suppresses matChipInputTokenEnd after autocomplete selection (NXSAT-151)', () => {
    const user = mockUser('poweruser01');
    component.userSearchQuery = 'power';
    component.filteredUsers = [user];

    component.onUserSelected({
      option: { value: user, deselect: vi.fn() },
    } as unknown as MatAutocompleteSelectedEvent);

    expect(component.memberUsernames).toEqual(['poweruser01']);

    const chipInput = { clear: vi.fn() };
    component.addMemberFromInput({
      value: 'powerpoweruser01',
      chipInput,
    } as unknown as MatChipInputEvent);

    expect(component.memberUsernames).toEqual(['poweruser01']);
    expect(chipInput.clear).toHaveBeenCalled();
    expect(component.userSearchQuery).toBe('');
  });
});
