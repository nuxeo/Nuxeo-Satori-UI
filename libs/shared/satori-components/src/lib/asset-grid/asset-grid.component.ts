import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  output,
} from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

import { DocTypeLabelPipe } from '@nuxeo/satori-platform/nuxeo-client';

import { nxsVisibleText } from '../visible-text';

/** The ID the host renders the asset grid under, through `lib-extension-outlet`. */
export const NXS_ASSET_GRID_ID = 'nxs.components.assetGrid';

/** One card in the asset grid: a document, as the grid needs to draw it. */
export interface NxsAssetCard {
  /** The document's UID. Identifies the card in `selectedIds` and in the events. */
  readonly id: string;
  /** The document's title, already the text to show. */
  readonly name: string;
  /** The Nuxeo document type, e.g. `Picture`. Shown as a pill, through `docTypeLabel`. */
  readonly type: string;
  /** The `svgIcon` name to show when there is no thumbnail. */
  readonly icon: string;
  /**
   * An object URL for the document's thumbnail, or `null` to show the icon instead.
   *
   * **The host owns this URL.** The grid only reads it, and never makes or revokes one, so a host
   * that made it with `createObjectURL()` revokes it itself. A Nuxeo URL does not work here: the
   * browser loads an image without credentials, so the request is unauthenticated and nothing
   * appears — fetch the blob through the authenticated client and pass the object URL.
   *
   * `null` is the icon fallback, not a slot: the grid projects no content and takes no template, so
   * there is nowhere to put an `nxs-thumbnail`. A host that would rather not own URLs registers its
   * own component under {@link NXS_ASSET_GRID_ID} and places one there.
   */
  readonly thumbnailUrl: string | null;
}

/**
 * A grid of asset cards: a thumbnail, the document's name and its type, with a checkbox that
 * appears on hover, on focus and while selected.
 *
 * It reads nothing, fetches nothing and navigates nowhere. The host owns the search, the selection
 * and the thumbnails, and the grid reports what the user did — which is what lets the asset search
 * screen and any other listing draw the same cards over different queries.
 *
 * The card itself is **not** a button. It holds a checkbox and a name button, and a control
 * containing controls is `nested-interactive` (WCAG 4.1.2), so the name is the button that opens
 * the document and the card is a plain list item.
 */
@Component({
  selector: 'nxs-asset-grid',
  standalone: true,
  templateUrl: './asset-grid.component.html',
  styleUrl: './asset-grid.component.scss',
  imports: [DocTypeLabelPipe, MatCheckboxModule, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-asset-grid' },
})
export class NxsAssetGridComponent {
  /** The cards, in the order they are shown. The host sorts them. */
  readonly assets = input<readonly NxsAssetCard[]>([]);
  /**
   * Which cards are selected, by id. A `Set` — `SelectionService.selectedIds()` passes straight in —
   * or a list, for a host or a story that has one.
   */
  readonly selectedIds = input<ReadonlySet<string> | readonly string[]>([]);
  /** Whether to offer the checkboxes at all. A read-only listing passes `false`. */
  readonly selectable = input(true, { transform: booleanAttribute });
  /**
   * The grid's accessible name, already translated. Blank, or only whitespace or zero-width
   * characters, names it "Assets".
   */
  readonly label = input('');

  /**
   * The card whose name was pressed — the same fact as `assetOpen`, as a callback.
   *
   * The callback forms exist because `lib-extension-outlet` sets **inputs only**: a host rendering
   * this through `NXS_ASSET_GRID_ID` cannot bind an output, so it passes handlers, exactly as the
   * trash list takes `openHandler`. A host with the element in its own template binds the outputs
   * instead. Every interaction does both, so neither path is the special case.
   */
  readonly openHandler = input<((asset: NxsAssetCard) => void) | null>(null);
  /** The id whose checkbox was changed — the same fact as `selectionToggle`, as a callback. */
  readonly selectionToggleHandler = input<((id: string) => void) | null>(null);

  /** The card whose name was pressed. The host navigates. */
  readonly assetOpen = output<NxsAssetCard>();
  /** The id whose checkbox was changed. The host owns the selection and flips it. */
  readonly selectionToggle = output<string>();

  protected readonly ownLabel = computed(() => nxsVisibleText(this.label()));

  /**
   * The selection as a `Set`, whichever form it arrived in, so a card's lookup is constant-time
   * rather than a scan of the list per card per change detection.
   */
  private readonly selected = computed((): ReadonlySet<string> => {
    const ids = this.selectedIds();
    return ids instanceof Set ? ids : new Set(ids as readonly string[]);
  });

  protected isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  protected open(asset: NxsAssetCard): void {
    this.assetOpen.emit(asset);
    this.openHandler()?.(asset);
  }

  protected toggle(id: string): void {
    this.selectionToggle.emit(id);
    this.selectionToggleHandler()?.(id);
  }
}
