import type { InputSignal, InputSignalWithTransform, TemplateRef } from '@angular/core';

import type { NxsToolbarAction } from './document-toolbar/document-toolbar.component';
import type { NxsErrorStatus } from './error-state/error-status';
import type { NxsHeadingLevel } from './heading-level';
import type { NxsTab, NxsTabBodyContext } from './tabs/tab-body.directive';

/**
 * The IDs of the primitives Satori also ships, registered by `provideNxsComponents()`.
 *
 * Each ID resolves to a Material implementation from this entry point, and to a Satori-backed one
 * once `provideNxsSatoriComponents()` from `@nuxeo/satori-platform/components-satori` is provided
 * after it. Both implement the same `Nxs…Inputs` contract below, so whoever renders an ID — a
 * `lib-extension-outlet` with `componentInputs` — gets the same inputs whichever is registered.
 * A customer overriding an ID implements that contract too.
 */
export const NXS_PRIMITIVE_IDS = Object.freeze({
  avatar: 'nxs.primitives.avatar',
  breadcrumbs: 'nxs.primitives.breadcrumbs',
  tag: 'nxs.primitives.tag',
  statusTag: 'nxs.primitives.statusTag',
  richTooltip: 'nxs.primitives.richTooltip',
  errorState: 'nxs.primitives.errorState',
  tabs: 'nxs.primitives.tabs',
  actionBar: 'nxs.primitives.actionBar',
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

/** Status tag statuses: the statuses Satori's status tag takes, which `/components-satori` asserts. */
export type NxsTagStatus =
  'important-loud' | 'important' | 'success' | 'warning' | 'info' | 'neutral' | 'neutral-quiet';

/** `nxs.primitives.statusTag`. Text inputs arrive already translated. */
export interface NxsStatusTagInputs {
  readonly label: InputSignal<string>;
  readonly status: InputSignal<NxsTagStatus>;
  /** Hide the status's icon, which Satori's status tag shows by default. */
  readonly hideIcon: InputSignal<boolean>;
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

/**
 * `nxs.primitives.tabs`: a tab strip and the selected tab's body. Text inputs arrive already
 * translated.
 *
 * A host rendering the ID through `lib-extension-outlet` passes `body` and `selectHandler`,
 * because the outlet sets inputs and neither projects content nor binds outputs.
 */
export interface NxsTabsInputs {
  /** The tabs, in display order. */
  readonly tabs: InputSignal<readonly NxsTab[]>;
  /** The tab list's accessible name. Optional. */
  readonly label: InputSignal<string>;
  /** The selected tab's position. Past the last tab selects the last. */
  readonly selectedIndex: InputSignal<number>;
  /**
   * The template every tab's body renders from, given the tab as `let-tab`. A body once shown is
   * kept, hidden, while another tab is selected, so what the user left in it is there on return.
   */
  readonly body: InputSignal<TemplateRef<NxsTabBodyContext> | null>;
  /**
   * Called with the selected tab and its position whenever the selection changes — the user
   * choosing a tab, or the host moving `selectedIndex` — but not for the first selection.
   */
  readonly selectHandler: InputSignal<((tab: NxsTab, index: number) => void) | null>;
}

/**
 * `nxs.primitives.actionBar`: a row of actions, some behind a "More actions" menu. Text inputs
 * arrive already translated.
 *
 * A host rendering the ID through `lib-extension-outlet` passes `actionHandler`, because the
 * outlet sets inputs and binds no outputs.
 */
export interface NxsActionBarInputs {
  /** Every entry, in display order; each one's `overflow` decides which group it is in. */
  readonly actions: InputSignal<readonly NxsToolbarAction[]>;
  /** The group's accessible name. Blank falls back to the library's own "Document actions". */
  readonly label: InputSignal<string>;
  /** The menu button's accessible name and tooltip. Blank falls back to "More actions". */
  readonly moreLabel: InputSignal<string>;
  /** Called with the entry the user ran. Never a disabled one. */
  readonly actionHandler: InputSignal<((action: NxsToolbarAction) => void) | null>;
}
