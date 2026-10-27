import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { UserService, type NuxeoGroup, type NuxeoUser } from '@nuxeo/satori-platform/nuxeo-client';
import { of } from 'rxjs';
import { vi } from 'vitest';

import {
  NxsGroupFormDialogComponent,
  type NxsGroupFormDialogData,
} from './group-form-dialog.component';

/** The English the dialog shows, so the spec can find its controls. */
const ENGLISH: Record<string, string> = {
  'satori-components.group-form-dialog.cancel': 'Cancel',
  'satori-components.group-form-dialog.create': 'Create',
  'satori-components.group-form-dialog.create-another': 'Create another',
  'satori-components.group-form-dialog.create-group': 'Create group',
  'satori-components.group-form-dialog.edit-group': 'Edit group',
  'satori-components.group-form-dialog.group-name': 'Group name',
  'satori-components.group-form-dialog.label': 'Label',
  'satori-components.group-form-dialog.member-usernames': 'Member usernames',
  'satori-components.group-form-dialog.pick-member':
    'Pick from search or enter a username and press Enter',
  'satori-components.group-form-dialog.remove-member': 'Remove {{ name }}',
  'satori-components.group-form-dialog.save': 'Save',
  'satori-components.group-form-dialog.search-users': 'Search users or type a username…',
};

const USERS = {
  entries: [
    { id: 'alice', properties: { firstName: 'Alice', lastName: 'Ng', email: 'alice@acme.test' } },
    { id: 'bob', properties: {} },
  ] as unknown as NuxeoUser[],
};

const GROUP = {
  groupname: 'editors',
  grouplabel: 'Editors',
  memberUsers: ['carol'],
} as unknown as NuxeoGroup;

describe('NxsGroupFormDialogComponent', () => {
  let fixture: ComponentFixture<NxsGroupFormDialogComponent>;
  const close = vi.fn();
  const searchUsersPaged = vi.fn();

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const component = (): Record<string, unknown> =>
    fixture.componentInstance as unknown as Record<string, unknown>;
  const method = (name: string): ((...args: unknown[]) => unknown) =>
    component()[name] as (...args: unknown[]) => unknown;
  const signalOf = <T>(name: string): (() => T) => component()[name] as () => T;
  const button = (text: string): HTMLButtonElement =>
    Array.from(el().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement;
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

  async function create(data: NxsGroupFormDialogData): Promise<void> {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    searchUsersPaged.mockReturnValue(of(USERS));
    await TestBed.configureTestingModule({
      imports: [NxsGroupFormDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: UserService, useValue: { searchUsersPaged } },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).setTranslation('en', ENGLISH);
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(NxsGroupFormDialogComponent);
    await render();
  }

  describe('create', () => {
    beforeEach(() => create({ mode: 'create' }));

    it('keeps Create off until a group name is entered', async () => {
      expect(button('Create').disabled).toBe(true);
      await type('groupname', '   ');
      expect(button('Create').disabled).toBe(true);
      await type('groupname', 'editors');
      expect(button('Create').disabled).toBe(false);
    });

    it('closes with the trimmed values and the members added, and nothing is written', async () => {
      await type('groupname', ' editors ');
      await type('grouplabel', ' Editors ');
      method('addMemberFromInput')({ value: 'carol', chipInput: { clear: vi.fn() } });
      button('Create').click();
      expect(close).toHaveBeenCalledWith({
        mode: 'create',
        groupname: 'editors',
        grouplabel: 'Editors',
        memberUsers: ['carol'],
        createAnother: false,
      });
    });

    it('closes with createAnother set for Create another', async () => {
      await type('groupname', 'editors');
      button('Create another').click();
      expect(close).toHaveBeenCalledWith(expect.objectContaining({ createAnother: true }));
    });

    it('adds a typed member on Enter, and ignores a blank one', () => {
      const clear = vi.fn();
      method('addMemberFromInput')({ value: '   ', chipInput: { clear } });
      expect(signalOf<string[]>('members')()).toEqual([]);
      method('addMemberFromInput')({ value: 'dave', chipInput: { clear } });
      expect(signalOf<string[]>('members')()).toEqual(['dave']);
      expect(clear).toHaveBeenCalledTimes(2);
    });

    it('adds the member chosen from the results, and not the typed prefix', () => {
      (component()['memberQuery'] as { set: (v: string) => void }).set('al');
      (component()['memberOptions'] as { set: (v: unknown[]) => void }).set(USERS.entries);
      method('addMemberFromInput')({ value: 'alice', chipInput: { clear: vi.fn() } });
      expect(signalOf<string[]>('members')()).toEqual(['alice']);
    });

    it('takes Enter as a choice from the results when there are any', () => {
      (component()['memberQuery'] as { set: (v: string) => void }).set('x');
      (component()['memberOptions'] as { set: (v: unknown[]) => void }).set(USERS.entries);
      method('onMemberInputKeydown')({ key: 'Enter' } as KeyboardEvent);
      method('addMemberFromInput')({ value: 'x', chipInput: { clear: vi.fn() } });
      expect(signalOf<string[]>('members')()).toEqual([]);
    });

    it('treats a typed prefix of a known user as unfinished', () => {
      (component()['memberOptions'] as { set: (v: unknown[]) => void }).set(USERS.entries);
      method('addMemberFromInput')({ value: 'al', chipInput: { clear: vi.fn() } });
      expect(signalOf<string[]>('members')()).toEqual([]);
    });

    it('adds the chosen member from the autocomplete and skips the Enter that followed', () => {
      method('onMemberSelected')({ option: { value: USERS.entries[1], deselect: vi.fn() } });
      method('addMemberFromInput')({ value: 'bob', chipInput: { clear: vi.fn() } });
      expect(signalOf<string[]>('members')()).toEqual(['bob']);
    });

    it('removes a member and asks the results again', () => {
      method('onMemberSelected')({ option: { value: USERS.entries[1], deselect: vi.fn() } });
      method('removeMember')('bob');
      expect(signalOf<string[]>('members')()).toEqual([]);
    });

    it('asks for results on focus, and when the query changes', async () => {
      method('onMemberInputFocus')();
      method('onMemberSearch')('al');
      // The search waits 250 ms for typing to settle.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(searchUsersPaged).toHaveBeenCalledWith('al', 30, 0);
    });

    it('describes a member with a name and email, or neither', () => {
      expect(method('userDisplayLine')(USERS.entries[0])).toBe('Alice Ng · alice@acme.test');
      expect(method('userDisplayLine')(USERS.entries[1])).toBe('');
    });
  });

  describe('edit', () => {
    beforeEach(() => create({ mode: 'edit', group: GROUP }));

    it('starts from the group, with the name fixed', () => {
      expect(input('groupname').value).toBe('editors');
      expect(input('groupname').disabled).toBe(true);
      expect(signalOf<string[]>('members')()).toEqual(['carol']);
    });

    it('closes with the edited values and no createAnother', async () => {
      await type('grouplabel', 'Editors team');
      button('Save').click();
      expect(close).toHaveBeenCalledWith({
        mode: 'edit',
        groupname: 'editors',
        grouplabel: 'Editors team',
        memberUsers: ['carol'],
      });
    });

    it('does not offer Create another', () => {
      expect(button('Create another')).toBeUndefined();
    });
  });

  it('refuses to save in edit mode without a group', async () => {
    await create({ mode: 'edit' });
    expect(button('Save').disabled).toBe(true);
  });
});
