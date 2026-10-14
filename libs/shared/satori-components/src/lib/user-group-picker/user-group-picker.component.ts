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
} from '@nuxeo-satori/platform/nuxeo-client';

import { NxsPickerControl, nxsPickerProviders } from '../pickers/picker-control';
import { nxsSearchAsYouType } from '../pickers/search-as-you-type';

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
  templateUrl: './user-group-picker.component.html',
  styleUrl: './user-group-picker.component.scss',
  imports: [MatAutocompleteModule, MatButtonModule, MatIconModule, MatInputModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: nxsPickerProviders(() => NxsUserGroupPickerComponent),
  host: { class: 'nxs-user-group-picker' },
})
export class NxsUserGroupPickerComponent implements ControlValueAccessor, Validator, DoCheck {
  /** The field's label, already translated. Required: the input has no other name. */
  readonly label = input.required<string>();
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
  /** The principal chosen, or `null`. Two-way; a form control carries the same value. */
  readonly value = model<NxsPrincipal | null>(null);

  private readonly input = viewChild.required(MatInput);
  private readonly documents = inject(DocumentDetailService);
  private readonly users = inject(UserService);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly translate = inject(TranslateService);
  private readonly control = new NxsPickerControl<NxsPrincipal | null>();

  /** What the input shows: the chosen principal's label, or what the user is typing. */
  protected readonly text = signal('');
  protected readonly finder = nxsSearchAsYouType<NxsPrincipal>(
    (term) => this.find(term),
    () => this.minChars(),
  );
  protected readonly isDisabled = computed(() => this.disabled() || this.control.formDisabled());
  /** Text typed and no principal chosen for it. */
  protected readonly unmatched = computed(() => !this.value() && this.text().trim() !== '');
  protected readonly errorState = {
    isErrorState: () =>
      this.control.wasTouched() &&
      (this.unmatched() || this.missing() || this.control.formInvalid()),
  };
  protected readonly displayWith = (principal: NxsPrincipal | string | null): string =>
    typeof principal === 'string' ? principal : (principal?.label ?? '');

  constructor() {
    effect(() => {
      const chosen = this.value();
      untracked(() => {
        if (chosen) this.text.set(chosen.label);
      });
    });
    effect(() => {
      const { status, results } = this.finder.state();
      untracked(() => this.announce(status, results.length));
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
    this.input().updateErrorState();
  }

  validate(control: AbstractControl): ValidationErrors | null {
    return this.control.validate(control, this.unmatched() ? { nxsChooseFromList: true } : null);
  }

  registerOnValidatorChange(fn: () => void): void {
    this.control.registerOnValidatorChange(fn);
  }

  protected missing(): boolean {
    return this.control.missing(this.required(), this.value() === null);
  }

  writeValue(value: NxsPrincipal | null): void {
    this.value.set(value ?? null);
    this.text.set(value?.label ?? '');
  }

  registerOnChange(fn: (value: NxsPrincipal | null) => void): void {
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
    if (this.value() && typed !== this.value()?.label) this.choose(null);
    this.finder.query(typed);
  }

  protected choose(principal: NxsPrincipal | null): void {
    this.value.set(principal);
    if (principal) {
      this.text.set(principal.label);
      this.finder.reset();
    }
    this.control.changed(principal);
  }

  protected clear(): void {
    this.text.set('');
    this.finder.reset();
    this.choose(null);
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
