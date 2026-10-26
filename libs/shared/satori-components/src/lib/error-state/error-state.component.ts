import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

import type { NxsHeadingLevel } from '../heading-level';
import type { NxsErrorStateInputs } from '../primitives';
import { nxsVisibleText } from '../visible-text';
import type { NxsErrorStatus } from './error-status';

interface Variant {
  readonly icon: string;
  readonly heading: string;
  readonly message: string;
}

const VARIANTS: Readonly<Record<NxsErrorStatus, Variant>> = {
  401: {
    icon: 'lock',
    heading: 'satori-components.error-state.unauthorized.heading',
    message: 'satori-components.error-state.unauthorized.message',
  },
  403: {
    icon: 'block',
    heading: 'satori-components.error-state.forbidden.heading',
    message: 'satori-components.error-state.forbidden.message',
  },
  404: {
    icon: 'search',
    heading: 'satori-components.error-state.not-found.heading',
    message: 'satori-components.error-state.not-found.message',
  },
  500: {
    icon: 'error',
    heading: 'satori-components.error-state.server.heading',
    message: 'satori-components.error-state.server.message',
  },
};

/**
 * What a region shows in place of content that failed to load — a listing, a page, a result set.
 *
 * One of four variants chosen by `status`, each with its own icon, heading and explanation; map a
 * failed request onto one with `nxsErrorStatus(error)`. A host that knows what failed ("Failed to
 * load folder contents.") passes it as `heading`, already translated, and the variant's explanation
 * stays underneath it.
 *
 * It is an alert because it replaces a loader the user was waiting on. Retry is offered only for a
 * server error, and only when the host asks for it: retrying a 401, 403 or 404 gets the same answer.
 * Anything else the host offers — "Go back" — is projected.
 *
 * Registered as `nxs.primitives.errorState`, so a customer can replace it by ID; a host rendering it
 * that way passes `retryHandler`, because the outlet binds no outputs.
 */
@Component({
  selector: 'nxs-error-state',
  standalone: true,
  templateUrl: './error-state.component.html',
  styleUrl: './error-state.component.scss',
  imports: [MatButtonModule, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-error-state', role: 'alert', '[attr.data-status]': 'status()' },
})
export class NxsErrorStateComponent implements NxsErrorStateInputs {
  /** Which variant: the HTTP status the failure stands for. */
  readonly status = input<NxsErrorStatus>(500);
  /** What failed, already translated. Blank, or only whitespace, shows the variant's own heading. */
  readonly heading = input('');
  /**
   * The heading's level in the page outline, rendered as the native `<h1>`–`<h6>`: one below the
   * heading of the section it replaces, or 1 when it replaces the whole page.
   */
  readonly headingLevel = input<NxsHeadingLevel>(2);
  /** Offer Retry for a server error. Accepts a bare attribute, `retryable`. */
  readonly retryable = input(false, { transform: booleanAttribute });

  /**
   * Called when Retry is pressed, before `retry` is emitted — for a host that renders the component
   * by ID, where no output can be bound.
   */
  readonly retryHandler = input<(() => void) | null>(null);

  /** Retry was pressed. */
  readonly retry = output<void>();

  protected readonly variant = computed(() => VARIANTS[this.status()]);
  /** The host's heading as a reader gets it: whitespace or zero-width characters alone are none. */
  protected readonly ownHeading = computed(() => nxsVisibleText(this.heading()));
  protected readonly canRetry = computed(() => this.retryable() && this.status() === 500);

  protected pressRetry(): void {
    this.retryHandler()?.();
    this.retry.emit();
  }
}
