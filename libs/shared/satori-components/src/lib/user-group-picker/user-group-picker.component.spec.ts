import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
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
  template: `@if (multiple()) {
      <nxs-user-group-picker label="Grant to" multiple [formControl]="many" [search]="search()" />
    } @else {
      <nxs-user-group-picker
        label="Grant to"
        [search]="search()"
        [minChars]="minChars()"
        [formControl]="principal"
      />
    }`,
})
class HostComponent {
  readonly multiple = signal(false);
  readonly many = new FormControl<readonly NxsPrincipal[]>([], {
    nonNullable: true,
    validators: Validators.required,
  });
  readonly search = signal<NxsPrincipalSearch>('users-and-groups');
  readonly minChars = signal(3);
  readonly principal = new FormControl<NxsPrincipal | null>(null, Validators.required);
}

const JANE: NxsPrincipal = { id: 'jdoe', label: 'Jane Doe', kind: 'user', prefixedId: 'user:jdoe' };
const SALES: NxsPrincipal = {
  id: 'sales',
  label: 'Sales',
  kind: 'group',
  prefixedId: 'group:sales',
};

/** Forms that update on blur take the picker's value only when the user leaves the field. */
@Component({
  standalone: true,
  imports: [NxsUserGroupPickerComponent, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-user-group-picker label="Grant to" multiple [formControl]="many" />
    <nxs-user-group-picker label="Grant to" [formControl]="one" />
    <button type="button" class="elsewhere">Elsewhere</button>`,
})
class BlurHostComponent {
  readonly many = new FormControl<readonly NxsPrincipal[]>([JANE, SALES], {
    nonNullable: true,
    updateOn: 'blur',
  });
  readonly one = new FormControl<NxsPrincipal | null>(JANE, { updateOn: 'blur' });
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

  /** The user leaves the text input for somewhere outside the picker. */
  function leave(): void {
    input().focus();
    input().blur();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    suggestions = vi.fn(() => of([ADMIN, ADMINS]));
    users = { searchUsers: vi.fn(), searchGroups: vi.fn() };
    announce = vi.fn(() => Promise.resolve());
    await TestBed.configureTestingModule({
      imports: [HostComponent, BlurHostComponent],
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
    leave();
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
    leave();
    await render();
    expect(text('mat-error')).toBe('Required');
    expect(host.principal.touched).toBe(true);
  });

  it('is disabled when the form disables it', async () => {
    host.principal.disable();
    await render();
    expect(input().disabled).toBe(true);
  });
  async function multiple(): Promise<void> {
    host.multiple.set(true);
    await render();
  }
  const chips = (): HTMLElement[] => [...root().querySelectorAll<HTMLElement>('mat-chip-row')];

  it('refreshes the displayed selection when multiple changes without a new value', async () => {
    const picker = TestBed.createComponent(NxsUserGroupPickerComponent);
    picker.componentRef.setInput('label', 'Grant to');
    picker.componentRef.setInput('value', {
      id: 'jdoe',
      label: 'Jane Doe',
      kind: 'user',
      prefixedId: 'user:jdoe',
    });
    picker.detectChanges();
    await picker.whenStable();
    expect(picker.nativeElement.querySelector('input').value).toBe('Jane Doe');

    picker.componentRef.setInput('multiple', true);
    picker.detectChanges();
    await picker.whenStable();
    expect(picker.nativeElement.querySelector('input').value).toBe('');
    expect(picker.nativeElement.querySelector('mat-chip-row').textContent.trim()).toBe('Jane Doe');
    expect(picker.componentInstance.validate(new FormControl())).toBeNull();

    picker.componentRef.setInput('multiple', false);
    picker.detectChanges();
    await picker.whenStable();
    expect(picker.nativeElement.querySelector('input').value).toBe('Jane Doe');
  });

  it('collects distinct principals in order and keeps them when typing the next search', async () => {
    await multiple();
    await type('adm');
    await settle();
    options()[0].click();
    await render();
    expect(input().value).toBe('');
    expect(host.many.value.map((p) => p.prefixedId)).toEqual(['user:Administrator']);
    await type('adm');
    await settle();
    expect(host.many.hasError('nxsChooseFromList')).toBe(true);
    expect(options().map((option) => option.getAttribute('data-principal'))).toEqual([
      'group:administrators',
    ]);
    options()[0].click();
    await render();
    expect(host.many.value.map((p) => p.prefixedId)).toEqual([
      'user:Administrator',
      'group:administrators',
    ]);
    expect(host.many.valid).toBe(true);
    expect(chips()).toHaveLength(2);
  });

  it('hands the form a chosen principal without the search text it replaced', async () => {
    await multiple();
    await type('adm');
    await settle();
    const pending: boolean[] = [];
    const watching = host.many.valueChanges.subscribe(() =>
      pending.push(host.many.hasError('nxsChooseFromList')),
    );
    options()[0].click();
    watching.unsubscribe();
    expect(pending).toEqual([false]);
  });

  it('shows a disabled empty state when every matching principal is selected', async () => {
    await multiple();
    host.many.setValue([
      { id: ADMIN.id, label: ADMIN.displayLabel, kind: 'user', prefixedId: ADMIN.prefixed_id },
      { id: ADMINS.id, label: ADMINS.displayLabel, kind: 'group', prefixedId: ADMINS.prefixed_id },
    ]);
    await render();
    await type('adm');
    await settle();
    expect(options().map((option) => option.textContent?.trim())).toEqual(['No results']);
    expect(options()[0].getAttribute('aria-disabled')).toBe('true');
    options()[0].click();
    await render();
    expect(host.many.value.map((principal) => principal.prefixedId)).toEqual([
      'user:Administrator',
      'group:administrators',
    ]);
    root().querySelector<HTMLButtonElement>('button[aria-label="Remove Administrator"]')?.click();
    await render();
    expect(options().map((option) => option.getAttribute('data-principal'))).toEqual([
      'user:Administrator',
    ]);
  });

  it('removes just the named principal and validates the empty required list', async () => {
    await multiple();
    host.many.setValue([
      { id: 'same', label: 'Same user', kind: 'user', prefixedId: 'user:same' },
      { id: 'same', label: 'Same group', kind: 'group', prefixedId: 'group:same' },
    ]);
    await render();
    expect(input().labels?.[0].textContent).toContain('Grant to');
    root().querySelector<HTMLButtonElement>('button[aria-label="Remove Same user"]')?.click();
    await render();
    expect(host.many.value.map((p) => p.prefixedId)).toEqual(['group:same']);
    root().querySelector<HTMLButtonElement>('button[aria-label="Remove Same group"]')?.click();
    leave();
    await render();
    expect(host.many.value).toEqual([]);
    expect(host.many.hasError('required')).toBe(true);
    expect(text('mat-error')).toBe('Required');
  });

  it('removes the focused chip with Delete and keeps typed text out of the value', async () => {
    await multiple();
    host.many.setValue([{ id: 'jdoe', label: 'Jane Doe', kind: 'user', prefixedId: 'user:jdoe' }]);
    await render();
    const cell = chips()[0].querySelector<HTMLElement>('[role="gridcell"]') as HTMLElement;
    cell.focus();
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', keyCode: 46, bubbles: true }));
    await render();
    expect(host.many.value).toEqual([]);
    await type('Jane');
    expect(host.many.value).toEqual([]);
    expect(host.many.hasError('nxsChooseFromList')).toBe(true);
  });

  it('disables input and chip removal through the form and resets from outside', async () => {
    await multiple();
    host.many.setValue([{ id: 'jdoe', label: 'Jane Doe', kind: 'user', prefixedId: 'user:jdoe' }]);
    await render();
    host.many.disable();
    await render();
    expect(input().disabled).toBe(true);
    expect(root().querySelector<HTMLButtonElement>('button[matChipRemove]')?.disabled).toBe(true);
    host.many.enable();
    host.many.reset();
    await render();
    expect(chips()).toHaveLength(0);
    expect(input().value).toBe('');
  });

  describe('with a form that updates on blur', () => {
    let blurFixture: ComponentFixture<BlurHostComponent>;
    const pickers = (): HTMLElement[] => [
      ...(blurFixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        'nxs-user-group-picker',
      ),
    ];
    const elsewhere = (): HTMLButtonElement =>
      (blurFixture.nativeElement as HTMLElement).querySelector('.elsewhere') as HTMLButtonElement;
    async function settleBlur(): Promise<void> {
      blurFixture.detectChanges();
      await blurFixture.whenStable();
    }

    beforeEach(async () => {
      blurFixture = TestBed.createComponent(BlurHostComponent);
      await settleBlur();
    });

    it('takes a chip removed with the mouse once focus leaves, though the input never had it', async () => {
      const remove = pickers()[0].querySelector<HTMLButtonElement>(
        'button[aria-label="Remove Jane Doe"]',
      ) as HTMLButtonElement;
      remove.focus();
      remove.click();
      await settleBlur();
      expect(pickers()[0].querySelectorAll('mat-chip-row')).toHaveLength(1);
      elsewhere().focus();
      await settleBlur();
      expect(blurFixture.componentInstance.many.value).toEqual([SALES]);
      expect(blurFixture.componentInstance.many.touched).toBe(true);
    });

    it('does not count moving between its own input and chips as leaving', async () => {
      const field = pickers()[0];
      field.querySelector('input')?.focus();
      field.querySelector<HTMLElement>('mat-chip-row [role="gridcell"]')?.focus();
      await settleBlur();
      expect(blurFixture.componentInstance.many.touched).toBe(false);
      elsewhere().focus();
      await settleBlur();
      expect(blurFixture.componentInstance.many.touched).toBe(true);
    });

    it('returns focus to the input after the x button, so leaving then takes the cleared value', async () => {
      const field = pickers()[1];
      const clear = field.querySelector<HTMLButtonElement>(
        'button.nxs-picker__clear',
      ) as HTMLButtonElement;
      clear.focus();
      clear.click();
      await settleBlur();
      expect(document.activeElement).toBe(field.querySelector('input'));
      elsewhere().focus();
      await settleBlur();
      expect(blurFixture.componentInstance.one.value).toBeNull();
    });
  });
});
