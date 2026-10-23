import type { InputSignal, InputSignalWithTransform } from '@angular/core';

import type { NxsErrorStatus } from './error-state/error-status';
import type { NxsHeadingLevel } from './heading-level';

/**
 * The IDs of the primitives Satori also ships, registered by `provideNxsComponents()`.
 *
 * Each ID resolves to a Material implementation from this entry point, and the first four to a
 * Satori-backed one once `provideNxsSatoriComponents()` from `@nuxeo/satori-platform/components-satori`
 * is provided after it. `errorState` stays on Material there: Satori's error states arrive in
 * Satori 1.0, which needs a newer Angular than this package supports. `banner` stays on Material
 * too, until its Satori twin is written. Both implement the same `Nxs…Inputs` contract below, so
 * whoever renders an ID — a `lib-extension-outlet` with `componentInputs` — gets the same inputs
 * whichever is registered.
 * A customer overriding an ID implements that contract too.
 */
export const NXS_PRIMITIVE_IDS = Object.freeze({
  avatar: 'nxs.primitives.avatar',
  breadcrumbs: 'nxs.primitives.breadcrumbs',
  tag: 'nxs.primitives.tag',
  richTooltip: 'nxs.primitives.richTooltip',
  errorState: 'nxs.primitives.errorState',
  banner: 'nxs.primitives.banner',
  chipSet: 'nxs.primitives.chipSet',
} as const);

/** Avatar colours. The values Satori's avatar takes, which `/components-satori` asserts. */
export type NxsAvatarColor =
  'purple' | 'blue' | 'pink' | 'teal' | 'yellow' | 'green' | 'red' | 'orange';

/** Avatar diameters in pixels. The values Satori's avatar takes, which `/components-satori` asserts. */
export type NxsAvatarSize = '24' | '28' | '36' | '64' | '80' | '128';

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

/** The tone of a banner: what kind of notice it is. The icon and colours follow from it. */
export type NxsBannerTone = 'info' | 'warning' | 'error';

/**
 * Whether a screen reader announces a banner as it appears: `alert` interrupts, `status` waits for
 * a pause, and `none` leaves it to be read in place.
 */
export type NxsBannerAnnounce = 'none' | 'status' | 'alert';

/** One button a banner offers, after its message. */
export interface NxsBannerAction {
  /** The button's text, already translated. */
  readonly label: string;
  /** A Material icon ligature shown before the label. */
  readonly icon?: string;
  /** `filled` is the one the banner recommends; `text` is the quietest. */
  readonly emphasis: 'text' | 'outlined' | 'filled';
  /** Destructive: drawn in the error colour. */
  readonly danger?: boolean;
  readonly disabled?: boolean;
  /** A class added to the button, for the host's own styling or a test to find it by. */
  readonly cssClass?: string;
  /** Called when the button is pressed. */
  readonly press: () => void;
}

/**
 * `nxs.primitives.banner`: a notice within content, with the message and the actions it offers.
 * Text arrives already translated.
 */
export interface NxsBannerInputs {
  readonly message: InputSignal<string>;
  readonly tone: InputSignal<NxsBannerTone>;
  readonly announce: InputSignal<NxsBannerAnnounce>;
  readonly actions: InputSignal<readonly NxsBannerAction[]>;
}

/** One chip in a chip set. Its labels arrive already translated. */
export interface NxsChipItem {
  readonly id: string;
  readonly label: string;
  /** The remove button's accessible name, such as "Remove Europe". */
  readonly removeLabel: string;
  readonly disabled?: boolean;
}

/**
 * `nxs.primitives.chipSet`: a row of removable chips, such as the values a vocabulary field holds.
 * Pressing a chip's remove button removes it from the set; the host drops it from its own list.
 */
export interface NxsChipSetInputs {
  /** The chips, in order. */
  readonly items: InputSignal<readonly NxsChipItem[]>;
  /** The set's accessible name, or blank for none. */
  readonly label: InputSignal<string>;
  /** Called when a chip's remove button is pressed, for a host rendering the ID, which binds no outputs. */
  readonly removeHandler: InputSignal<((item: NxsChipItem) => void) | null>;
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
