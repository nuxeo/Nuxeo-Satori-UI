import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  type DoCheck,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  numberAttribute,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type {
  AbstractControl,
  ControlValueAccessor,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipGrid, MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatInput, MatInputModule } from '@angular/material/input';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map, type Observable } from 'rxjs';

import {
  DocumentDetailService,
  UserService,
  type NuxeoGroup,
  type NuxeoUser,
  type UserGroupSuggestion,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsDocTypeIconComponent } from '../doc-type-icon/doc-type-icon.component';
import { NxsPickerControl, nxsPickerProviders } from '../pickers/picker-control';
import { nxsSearchAsYouType } from '../pickers/search-as-you-type';
import type { NxsPickerItem, NxsPickerOption } from '../pickers/suggestion-view';

/** A user or a group, as the picker offers and returns it. */
export interface NxsPrincipal {
  /** The username or group name: what Nuxeo's permissions and workflows take. */
  readonly id: string;
  /** What the picker shows: the display name Nuxeo gives, or the id when there is none. */
  readonly label: string;
  readonly kind: 'user' | 'group';
  /** `user:<id>` or `group:<id>`, the form some Nuxeo operations take. */
  readonly prefixedId: string;
  readonly email?: string;
}

/** Whom the picker searches: Web UI's `searchType`. */
export type NxsPrincipalSearch = 'users-and-groups' | 'users' | 'groups';

/** Web UI's user suggestion starts searching at three characters. */
const WEB_UI_MIN_CHARS = 3;
let nextId = 0;

/**
 * A field that finds a user or a group as the user types, and returns the one chosen — the picker
 * Add permission, sharing and workflow assignment use, as Web UI's `nuxeo-user-suggestion` is.
 *
 * It searches from three characters, Web UI's default, so a one-letter term does not list the
 * whole directory; set `minChars` for a smaller one. Typing after a choice clears it, so the value
 * is always a principal the server returned, never free text: text typed and not chosen is an
 * `nxsChooseFromList` error on the form. Use it with `ngModel` or a form control, or bind `value`
 * two-way.
 */
@Component({
  selector: 'nxs-user-group-picker',
  standalone: true,
  templateUrl: '../pickers/suggestion-picker.html',
  styleUrl: './user-group-picker.component.scss',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatInputModule,
    NxsDocTypeIconComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: nxsPickerProviders(() => NxsUserGroupPickerComponent),
  host: { class: 'nxs-user-group-picker' },
})
export class NxsUserGroupPickerComponent implements ControlValueAccessor, Validator, DoCheck {
  /** The field's label, already translated. Required: the input has no other name. */
  readonly label = input.required<string>();
  /** Choose several principals, shown as removable chips. The value is then an ordered array. */
  readonly multiple = input(false, { transform: booleanAttribute });
  /** Whom to search: users and groups (the default), users only, or groups only. */
  readonly search = input<NxsPrincipalSearch>('users-and-groups');
  /** Characters typed before the server is asked. Web UI's three by default. */
  readonly minChars = input(WEB_UI_MIN_CHARS, { transform: numberAttribute });
  /** Help under the field, already translated. */
  readonly hint = input('');
  /** Marks the field required. With a form, its `Validators.required` does the same. */
  readonly required = input(false, { transform: booleanAttribute });
  /** Shown but not editable. A form's `disable()` does the same. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The principal chosen, or `null`; with `multiple`, the ordered principals chosen. Two-way. */
  readonly value = model<NxsPrincipal | readonly NxsPrincipal[] | null>(null);

  protected readonly inputId = `nxs-user-group-picker-${nextId++}`;
  private readonly input = viewChild(MatInput);
  private readonly grid = viewChild(MatChipGrid);
  private readonly documents = inject(DocumentDetailService);
  private readonly users = inject(UserService);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly translate = inject(TranslateService);
  private readonly control = new NxsPickerControl<NxsPrincipal | readonly NxsPrincipal[] | null>();

  private committed: NxsPrincipal | readonly NxsPrincipal[] | null = null;
  private committedMultiple = false;

  /** What the input shows: the chosen principal's label, or what the user is typing. */
  protected readonly text = signal('');
  protected readonly finder = nxsSearchAsYouType<NxsPrincipal>(
    (term) => this.find(term),
    () => this.minChars(),
  );
  protected readonly isDisabled = computed(() => this.disabled() || this.control.formDisabled());
  protected readonly chosen = computed<readonly NxsPrincipal[]>(() => {
    const value = this.value();
    return value && 'prefixedId' in value ? [value] : (value ?? []);
  });
  protected readonly options = computed(() => {
    const taken = new Set(
      this.multiple() ? this.chosen().map((principal) => principal.prefixedId) : [],
    );
    return this.finder.state().results.filter((principal) => !taken.has(principal.prefixedId));
  });
  /** In multiple mode the text is always a new, uncommitted choice. */
  protected readonly unmatched = computed(
    () => this.text().trim() !== '' && (this.multiple() || this.chosen().length === 0),
  );
  protected readonly errorState = {
    isErrorState: () =>
      this.control.wasTouched() &&
      (this.unmatched() || this.missing() || this.control.formInvalid()),
  };
  protected readonly displayWith = (principal: NxsPrincipal | string | null): string =>
    typeof principal === 'string' ? principal : (principal?.label ?? '');

  protected readonly pickerKind: 'principal' | 'document' = 'principal';
  protected readonly minimumCharacters = this.minChars;
  protected readonly chosenItems = computed<readonly NxsPickerItem<NxsPrincipal>[]>(() =>
    this.chosen().map((principal) => ({
      value: principal,
      key: principal.prefixedId,
      label: principal.label,
    })),
  );
  protected readonly optionItems = computed<readonly NxsPickerOption<NxsPrincipal>[]>(() =>
    this.options().map((principal) => ({
      value: principal,
      key: principal.prefixedId,
      label: principal.label,
      icon: principal.kind === 'group' ? 'user_group' : 'user',
      detailKey: `satori-components.user-group-picker.${principal.kind}`,
      detail: principal.email ? ' · ' + principal.email : '',
    })),
  );

  constructor() {
    effect(() => {
      const value = this.value();
      const multiple = this.multiple();
      untracked(() => {
        if (value === this.committed && multiple === this.committedMultiple) return;
        this.committed = value;
        this.committedMultiple = multiple;
        this.finder.reset();
        this.text.set(multiple ? '' : (this.chosen()[0]?.label ?? ''));
      });
    });
    effect(() => {
      const { status } = this.finder.state();
      const count = this.options().length;
      untracked(() => this.announce(status === 'found' && !count ? 'none' : status, count));
    });
    effect(() => {
      this.unmatched();
      untracked(() => this.control.revalidate());
    });
  }

  /**
   * `MatInput` recomputes its error state only when its own input has a form control, and this
   * one has none — the form is on the picker — so the picker asks it to on every check.
   */
  ngDoCheck(): void {
    this.input()?.updateErrorState();
    this.grid()?.updateErrorState();
  }

  validate(control: AbstractControl): ValidationErrors | null {
    return this.control.validate(control, this.unmatched() ? { nxsChooseFromList: true } : null);
  }

  registerOnValidatorChange(fn: () => void): void {
    this.control.registerOnValidatorChange(fn);
  }

  protected missing(): boolean {
    return this.control.missing(this.required(), this.chosen().length === 0);
  }

  writeValue(value: NxsPrincipal | readonly NxsPrincipal[] | null): void {
    this.value.set(value ?? (this.multiple() ? [] : null));
    this.text.set(this.multiple() ? '' : (this.chosen()[0]?.label ?? ''));
    this.finder.reset();
  }

  registerOnChange(fn: (value: NxsPrincipal | readonly NxsPrincipal[] | null) => void): void {
    this.control.registerOnChange(fn);
  }

  registerOnTouched(fn: () => void): void {
    this.control.registerOnTouched(fn);
  }

  setDisabledState(disabled: boolean): void {
    this.control.setDisabledState(disabled);
  }

  protected onInput(event: Event): void {
    const typed = (event.target as HTMLInputElement).value;
    this.text.set(typed);
    if (!this.multiple() && this.chosen().length && typed !== this.chosen()[0].label)
      this.choose(null);
    this.finder.query(typed);
  }

  protected choose(principal: NxsPrincipal | null): void {
    if (this.isDisabled()) return;
    if (this.multiple()) {
      if (!principal || this.chosen().some((chosen) => chosen.prefixedId === principal.prefixedId))
        return;
      this.commit([...this.chosen(), principal]);
      this.text.set('');
      this.finder.reset();
    } else {
      this.commit(principal);
      if (principal) {
        this.text.set(principal.label);
        this.finder.reset();
      }
    }
  }

  protected clear(): void {
    this.text.set('');
    this.finder.reset();
    this.commit(this.multiple() ? [] : null);
  }

  protected remove(principal: NxsPrincipal): void {
    if (this.isDisabled()) return;
    this.commit(this.chosen().filter((chosen) => chosen.prefixedId !== principal.prefixedId));
  }

  private commit(value: NxsPrincipal | readonly NxsPrincipal[] | null): void {
    this.committed = value;
    this.value.set(value);
    this.control.changed(value);
  }

  protected blurred(): void {
    this.control.blurred();
  }

  private find(term: string): Observable<readonly NxsPrincipal[]> {
    switch (this.search()) {
      case 'users':
        return this.users.searchUsers(term).pipe(map((found) => found.map(fromUser)));
      case 'groups':
        return this.users.searchGroups(term).pipe(map((found) => found.map(fromGroup)));
      default:
        return this.documents
          .searchUsersGroups(term)
          .pipe(map((found) => found.map(fromSuggestion)));
    }
  }

  private announce(status: string, count: number): void {
    const key =
      status === 'found'
        ? count === 1
          ? 'satori-components.pickers.results-one'
          : 'satori-components.pickers.results-many'
        : status === 'none'
          ? 'satori-components.pickers.no-results'
          : status === 'failed'
            ? 'satori-components.pickers.failed'
            : null;
    if (key) void this.announcer.announce(this.translate.instant(key, { count }), 'polite');
  }
}

function fromSuggestion(entry: UserGroupSuggestion): NxsPrincipal {
  const kind = entry.type === 'GROUP_TYPE' ? 'group' : 'user';
  return {
    id: entry.id,
    label: entry.displayLabel?.trim() || entry.id,
    kind,
    prefixedId: entry.prefixed_id || `${kind}:${entry.id}`,
    ...(entry.email ? { email: entry.email } : {}),
  };
}

function fromUser(user: NuxeoUser): NxsPrincipal {
  const id = user.id;
  const first = user.properties?.firstName?.trim() ?? '';
  const last = user.properties?.lastName?.trim() ?? '';
  const email = user.properties?.email?.trim();
  return {
    id,
    label: `${first} ${last}`.trim() || id,
    kind: 'user',
    prefixedId: `user:${id}`,
    ...(email ? { email } : {}),
  };
}

function fromGroup(group: NuxeoGroup): NxsPrincipal {
  const id = group.groupname;
  return {
    id,
    label: group.grouplabel?.trim() || id,
    kind: 'group',
    prefixedId: `group:${id}`,
  };
}
