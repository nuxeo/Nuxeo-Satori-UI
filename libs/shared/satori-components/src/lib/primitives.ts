import type { InputSignal, InputSignalWithTransform, TemplateRef } from '@angular/core';

import type { NxsToolbarAction } from './document-toolbar/document-toolbar.component';
import type { NxsErrorStatus } from './error-state/error-status';
import type { NxsHeadingLevel } from './heading-level';
import type { NxsTab, NxsTabBodyContext } from './tabs/tab-body.directive';

/**
 * The IDs of the primitives this library registers by `provideNxsComponents()`. The first four and
 * `errorState` are primitives Satori also ships; `banner` and `chipSet` have no Satori twin yet.
 *
 * Each ID resolves to a Material implementation from this entry point, and all but `banner` and
 * `chipSet` to a Satori-backed one once `provideNxsSatoriComponents()` from
 * `@nuxeo/satori-platform/components-satori` is provided after it. `errorState` is Satori-backed
 * there as `sat-401-error-state` to `sat-500-error-state`, from an entry point not named after it.
 * `banner` and `chipSet` stay on Material until their Satori twins are written. Every
 * implementation of an ID implements the same `Nxs…Inputs` contract below, so whoever renders an ID
 * — a `lib-extension-outlet` with `componentInputs` — gets the same inputs whichever is registered.
 * A customer overriding an ID implements that contract too.
 */
export const NXS_PRIMITIVE_IDS = Object.freeze({
  avatar: 'nxs.primitives.avatar',
  breadcrumbs: 'nxs.primitives.breadcrumbs',
  tag: 'nxs.primitives.tag',
  statusTag: 'nxs.primitives.statusTag',
  richTooltip: 'nxs.primitives.richTooltip',
  errorState: 'nxs.primitives.errorState',
  banner: 'nxs.primitives.banner',
  chipSet: 'nxs.primitives.chipSet',
  tabs: 'nxs.primitives.tabs',
  actionBar: 'nxs.primitives.actionBar',
  card: 'nxs.primitives.card',
  emptyState: 'nxs.primitives.emptyState',
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

/**
 * `nxs.primitives.card`: one item in a grid of cards, such as a document in browse's or search's
 * card view. Text inputs arrive already translated.
 *
 * A host rendering the ID through `lib-extension-outlet` passes everything as an input — the
 * handlers and the templates for the media and actions — because the outlet sets inputs and neither
 * projects content nor binds outputs. A template is rendered where its host declared it, so it reads
 * the host's own context, such as the document of the loop that renders the card.
 */
export interface NxsCardInputs {
  /** The card's title: for a document, its title. */
  readonly heading: InputSignal<string>;
  /** One line under the heading, such as the document's type. Blank shows none. */
  readonly subheading: InputSignal<string>;
  /** Whether the item is selected. */
  readonly selected: InputSignalWithTransform<boolean, unknown>;
  /** The selection checkbox's accessible name. Blank renders no checkbox: the card is not selectable. */
  readonly selectionLabel: InputSignal<string>;
  /** Called with the checkbox's new state when the user toggles it. */
  readonly selectionHandler: InputSignal<((selected: boolean) => void) | null>;
  /** Called when the user opens the card. Without it the card opens nothing. */
  readonly openHandler: InputSignal<(() => void) | null>;
  /** Rendered at the top of the card: usually the document's thumbnail. */
  readonly media: InputSignal<TemplateRef<unknown> | null>;
  /** Rendered in the card's top corner: usually a menu button. */
  readonly headerAction: InputSignal<TemplateRef<unknown> | null>;
  /** Rendered at the foot of the card: buttons such as Favorite and Download. */
  readonly actions: InputSignal<TemplateRef<unknown> | null>;
}

/**
 * `nxs.primitives.emptyState`: what a list, panel or result set shows in place of content when it
 * has none. Text inputs arrive already translated.
 *
 * `actions` is a template because the outlet that renders an ID projects no content. A host using
 * the element instead may project the same buttons as content, which both implementations still
 * accept — the two are rendered in the same place, the template first.
 */
export interface NxsEmptyStateInputs {
  /** What is empty, in one line. */
  readonly heading: InputSignal<string>;
  /** The heading's level in the page outline, 1 to 6. */
  readonly headingLevel: InputSignal<NxsHeadingLevel>;
  /** An optional second line, usually what to do next. Blank shows none. */
  readonly message: InputSignal<string>;
  /** An optional icon name. Decorative, so hidden from assistive technology. */
  readonly icon: InputSignal<string>;
  /** Rendered under the message: buttons such as "Create folder" or "Clear filters". */
  readonly actions: InputSignal<TemplateRef<unknown> | null>;
}
