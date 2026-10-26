import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DocumentDetailService,
  UserService,
  type UserGroupSuggestion,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NXS_SEARCH_DEBOUNCE_MS } from '../pickers/search-as-you-type';
import {
  NxsUserGroupPickerComponent,
  type NxsPrincipal,
  type NxsPrincipalSearch,
} from './user-group-picker.component';

const ADMIN: UserGroupSuggestion = {
  id: 'Administrator',
  displayLabel: 'Administrator',
  type: 'USER_TYPE',
  prefixed_id: 'user:Administrator',
  email: 'admin@example.invalid',
};
const ADMINS: UserGroupSuggestion = {
  id: 'administrators',
  displayLabel: 'Administrators group',
  type: 'GROUP_TYPE',
  prefixed_id: 'group:administrators',
};

@Component({
  standalone: true,
  imports: [NxsUserGroupPickerComponent, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-user-group-picker
    label="Grant to"
    [search]="search()"
    [minChars]="minChars()"
    [formControl]="principal"
  />`,
})
class HostComponent {
  readonly search = signal<NxsPrincipalSearch>('users-and-groups');
  readonly minChars = signal(3);
  readonly principal = new FormControl<NxsPrincipal | null>(null, Validators.required);
}

describe('NxsUserGroupPickerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let suggestions: ReturnType<typeof vi.fn<(term: string) => Observable<UserGroupSuggestion[]>>>;
  let users: { searchUsers: ReturnType<typeof vi.fn>; searchGroups: ReturnType<typeof vi.fn> };
  let announce: ReturnType<typeof vi.fn>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const input = (): HTMLInputElement => root().querySelector('input') as HTMLInputElement;
  const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('mat-option')];
  const text = (selector: string): string | undefined =>
    root().querySelector(selector)?.textContent?.trim();

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function type(value: string): Promise<void> {
    input().focus();
    input().value = value;
    input().dispatchEvent(new Event('input'));
    await render();
  }

  async function settle(): Promise<void> {
    vi.advanceTimersByTime(NXS_SEARCH_DEBOUNCE_MS);
    await render();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    suggestions = vi.fn(() => of([ADMIN, ADMINS]));
    users = { searchUsers: vi.fn(), searchGroups: vi.fn() };
    announce = vi.fn(() => Promise.resolve());
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DocumentDetailService, useValue: { searchUsersGroups: suggestions } },
        { provide: UserService, useValue: users },
        { provide: LiveAnnouncer, useValue: { announce } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  afterEach(() => vi.useRealTimers());

  it('names its input with the label', () => {
    expect(text('mat-label')).toBe('Grant to');
    expect(input().id).toBeTruthy();
    expect(root().querySelector(`label[for="${input().id}"]`)).not.toBeNull();
  });

  it('asks for three characters before searching, as Web UI does, and does not search', async () => {
    await type('ad');
    await settle();
    expect(text('mat-hint')).toBe('Type at least 3 characters');
    expect(suggestions).not.toHaveBeenCalled();
  });

  it('searches users and groups once the user pauses, not on every key', async () => {
    await type('adm');
    vi.advanceTimersByTime(NXS_SEARCH_DEBOUNCE_MS - 1);
    expect(suggestions).not.toHaveBeenCalled();
    await settle();
    expect(suggestions).toHaveBeenCalledExactlyOnceWith('adm');
    // The icon's ligature is hidden from assistive technology; the label and the detail are
    // separate words in the option's name.
    expect(options().map((option) => option.textContent?.trim())).toEqual([
      'Administrator User · admin@example.invalid',
      'Administrators group Group',
    ]);
  });

  it('shows Searching… while the server answers', async () => {
    const answer = new Subject<UserGroupSuggestion[]>();
    suggestions.mockReturnValue(answer);
    await type('adm');
    await settle();
    expect(options().map((option) => option.textContent?.trim())).toEqual(['Searching…']);
    answer.next([ADMIN]);
    await render();
    expect(options()).toHaveLength(1);
  });

  it('returns the principal chosen, and the form is valid', async () => {
    await type('adm');
    await settle();
    options()[1].click();
    await render();
    expect(host.principal.value).toEqual({
      id: 'administrators',
      label: 'Administrators group',
      kind: 'group',
      prefixedId: 'group:administrators',
    });
    expect(input().value).toBe('Administrators group');
    expect(host.principal.valid).toBe(true);
  });

  it('clears the choice when the user types again, and the half-typed text is an error', async () => {
    await type('adm');
    await settle();
    options()[0].click();
    await render();
    await type('Administrato');
    expect(host.principal.value).toBeNull();
    expect(host.principal.hasError('nxsChooseFromList')).toBe(true);
    input().dispatchEvent(new Event('blur'));
    await render();
    expect(text('mat-error')).toBe('Choose an entry from the list');
  });

  it('keeps only the answer for the latest term', async () => {
    const first = new Subject<UserGroupSuggestion[]>();
    suggestions.mockReturnValueOnce(first).mockReturnValueOnce(of([ADMINS]));
    await type('adm');
    await settle();
    await type('admins');
    await settle();
    first.next([ADMIN]);
    await render();
    expect(options().map((option) => option.getAttribute('data-principal'))).toEqual([
      'group:administrators',
    ]);
  });

  it('says so when nothing matches, and announces it', async () => {
    suggestions.mockReturnValue(of([]));
    await type('zzz');
    await settle();
    expect(options().map((option) => option.textContent?.trim())).toEqual(['No results']);
    expect(announce).toHaveBeenLastCalledWith('No results', 'polite');
  });

  it('announces how many results the search found', async () => {
    await type('adm');
    await settle();
    expect(announce).toHaveBeenLastCalledWith('2 results', 'polite');
  });

  it('says the search failed rather than throwing, and keeps working', async () => {
    suggestions.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    await type('adm');
    await settle();
    expect(options().map((option) => option.textContent?.trim())).toEqual([
      'Search failed. Try again.',
    ]);
    await type('admi');
    await settle();
    expect(options()).toHaveLength(2);
  });

  it('searches users only through the user directory, naming each by first and last name', async () => {
    users.searchUsers.mockReturnValue(
      of([
        {
          id: 'jdoe',
          properties: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.invalid' },
        },
        { id: 'nobody', properties: { firstName: '', lastName: '', email: '' } },
      ]),
    );
    host.search.set('users');
    await render();
    await type('jan');
    await settle();
    expect(users.searchUsers).toHaveBeenCalledWith('jan');
    expect(suggestions).not.toHaveBeenCalled();
    options()[1].click();
    await render();
    expect(host.principal.value).toEqual({
      id: 'nobody',
      label: 'nobody',
      kind: 'user',
      prefixedId: 'user:nobody',
    });
  });

  it('searches groups only through the group directory, naming each by its label', async () => {
    users.searchGroups.mockReturnValue(of([{ groupname: 'members', grouplabel: 'Members group' }]));
    host.search.set('groups');
    await render();
    await type('mem');
    await settle();
    expect(users.searchGroups).toHaveBeenCalledWith('mem');
    options()[0].click();
    await render();
    expect(host.principal.value?.prefixedId).toBe('group:members');
    expect(host.principal.value?.label).toBe('Members group');
  });

  it('searches from one character when asked to', async () => {
    host.minChars.set(1);
    await render();
    await type('a');
    await settle();
    expect(suggestions).toHaveBeenCalledWith('a');
  });

  it('shows a principal the form already holds, and clears it with the x button', async () => {
    host.principal.setValue({
      id: 'jdoe',
      label: 'Jane Doe',
      kind: 'user',
      prefixedId: 'user:jdoe',
    });
    await render();
    expect(input().value).toBe('Jane Doe');
    const clear = root().querySelector<HTMLButtonElement>('button.nxs-picker__clear');
    expect(clear?.getAttribute('aria-label')).toBe('Clear');
    clear?.click();
    await render();
    expect(host.principal.value).toBeNull();
    expect(input().value).toBe('');
  });

  it('shows the form’s required error once the user has left the field empty', async () => {
    expect(root().querySelector('mat-error')).toBeNull();
    input().dispatchEvent(new Event('blur'));
    await render();
    expect(text('mat-error')).toBe('Required');
    expect(host.principal.touched).toBe(true);
  });

  it('is disabled when the form disables it', async () => {
    host.principal.disable();
    await render();
    expect(input().disabled).toBe(true);
  });
});
