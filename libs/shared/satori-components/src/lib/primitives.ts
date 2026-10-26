import type { InputSignal, InputSignalWithTransform } from '@angular/core';

import type { NxsErrorStatus } from './error-state/error-status';
import type { NxsHeadingLevel } from './heading-level';

/**
 * The IDs of the primitives Satori also ships, registered by `provideNxsComponents()`.
 *
 * Each ID resolves to a Material implementation from this entry point, and the first four to a
 * Satori-backed one once `provideNxsSatoriComponents()` from `@nuxeo/satori-platform/components-satori`
 * is provided after it. `errorState` stays on Material there: Satori's error states arrive in
 * Satori 1.0, which needs a newer Angular than this package supports. Both implement the same `Nxs…Inputs` contract below, so whoever renders an ID — a
 * `lib-extension-outlet` with `componentInputs` — gets the same inputs whichever is registered.
 * A customer overriding an ID implements that contract too.
 */
export const NXS_PRIMITIVE_IDS = Object.freeze({
  avatar: 'nxs.primitives.avatar',
  breadcrumbs: 'nxs.primitives.breadcrumbs',
  tag: 'nxs.primitives.tag',
  richTooltip: 'nxs.primitives.richTooltip',
  errorState: 'nxs.primitives.errorState',
} as const);

/** Avatar colours. The values Satori's avatar takes, which `/components-satori` asserts. */
export type NxsAvatarColor =
  'purple' | 'blue' | 'pink' | 'teal' | 'yellow' | 'green' | 'red' | 'orange';

/** Avatar diameters in pixels. The values Satori's avatar takes, which `/components-satori` asserts. */
export type NxsAvatarSize = '18' | '24' | '28' | '36' | '64' | '80' | '128';

/** Tag colours: the avatar colours plus `gray`, as Satori's category tag takes them. */
export type NxsTagColor = NxsAvatarColor | 'gray';

/**
 * One breadcrumb. With `routerLink` it navigates in the app, with `href` it is a plain link, and
 * with neither it is text — the current page when it is the last item.
 */
export interface NxsBreadcrumbItem {
  readonly label: string;
  readonly routerLink?: string | readonly (string | number)[];
  readonly queryParams?: Readonly<Record<string, string | number | boolean>>;
  readonly href?: string;
}

/** `nxs.primitives.avatar`. Text inputs arrive already translated. */
export interface NxsAvatarInputs {
  /** Upper-cased: up to two are shown, or one at size `24`. */
  readonly initials: InputSignal<string>;
  readonly color: InputSignal<NxsAvatarColor>;
  readonly size: InputSignal<NxsAvatarSize>;
  /**
   * The accessible name, usually the person's name. Blank, or only whitespace or zero-width
   * characters, makes the avatar decorative.
   */
  readonly label: InputSignal<string>;
}

/** `nxs.primitives.breadcrumbs`. Text inputs arrive already translated. */
export interface NxsBreadcrumbsInputs {
  readonly items: InputSignal<readonly NxsBreadcrumbItem[]>;
  /**
   * The accessible name of the navigation landmark. When it is blank, the Satori implementation
   * keeps the name Satori's own catalogue gives it.
   */
  readonly label: InputSignal<string>;
}

/** `nxs.primitives.tag`. Text inputs arrive already translated. */
export interface NxsTagInputs {
  readonly label: InputSignal<string>;
  readonly color: InputSignal<NxsTagColor>;
}

/**
 * `nxs.primitives.errorState`: what a region shows in place of content that failed to load. Text
 * inputs arrive already translated.
 */
export interface NxsErrorStateInputs {
  /** Which variant: the HTTP status the failure stands for. */
  readonly status: InputSignal<NxsErrorStatus>;
  /** What failed. Blank shows the variant's own heading. */
  readonly heading: InputSignal<string>;
  /** The heading's level in the page outline, 1 to 6. */
  readonly headingLevel: InputSignal<NxsHeadingLevel>;
  /** Offer Retry for a server error. */
  readonly retryable: InputSignalWithTransform<boolean, unknown>;
  /**
   * Called when Retry is pressed. A host rendering the ID through `lib-extension-outlet` passes
   * this, because the outlet sets inputs and binds no outputs.
   */
  readonly retryHandler: InputSignal<(() => void) | null>;
}

/** `nxs.primitives.richTooltip`: a trigger button and a titled panel. Text arrives translated. */
export interface NxsRichTooltipInputs {
  readonly heading: InputSignal<string>;
  readonly content: InputSignal<string>;
  /** The trigger button's accessible name; it shows only an icon. */
  readonly triggerLabel: InputSignal<string>;
  /** A Material icon ligature for the trigger. */
  readonly icon: InputSignal<string>;
}
