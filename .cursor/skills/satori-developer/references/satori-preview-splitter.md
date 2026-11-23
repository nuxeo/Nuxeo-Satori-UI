<!-- Generated from packages/satori-preview/splitter/docs/splitter-overview.mdx. Do not edit here; edit the source MDX. -->

# Splitter

The Splitter component allows users to divide a container into two or more resizable panels
separated by a draggable gutter. Drag the gutter to redistribute space between adjacent panels.

## Key Features

- **Drag to resize** — pointer events (mouse, touch, stylus)
- **Keyboard accessible** — WAI-ARIA Window Splitter pattern; Arrow keys, Home, End, Enter, Space
- **Collapse/expand** — outermost areas can be collapsed by dragging past their minimum size, expanded by clicking the gutter or pressing Enter/Space
- **Min/max constraints** — prevent areas from shrinking or growing beyond configured limits
- **Nested splits** — horizontal and vertical splits nest independently

## Collapse

Set `[collapsible]="true"` on an outermost (first and/or last) area to enable collapse. When dragging past the area's minimum size, the area collapses to zero. Click the gutter or press Enter/Space to expand it back to its previous size.

## Accessibility

Follows the [WAI-ARIA Window Splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/). Gutters have `role="separator"` with full ARIA labeling (`aria-label`, `aria-valuenow`, `aria-valuemin/max`) and are keyboard focusable.

**Keyboard:** Arrow keys move by step size (default 20px, configurable via `keyboardStepPx`), Home/End jump to min/max positions, Enter/Space toggle collapse on collapsible areas.

**Screen readers:** Announce gutter label, current position percentage, and boundaries.

## Basic Usage

```html
<div
  style="height: 400px; background: var(--mat-sys-surface-container-low); padding: 16px; box-sizing: border-box;"
>
  <sat-splitter data-testid="outer-splitter" direction="horizontal">
    <sat-splitter-area data-testid="outer-area-0" areaName="Left" [size]="'40%'">
      <sat-splitter data-testid="inner-splitter" direction="vertical">
        <sat-splitter-area
          data-testid="inner-area-0"
          areaName="Top-left"
          [size]="'50%'"
          style="padding: 6px;"
          ><div
            style="background: var(--mat-sys-surface-container-lowest, white); border-radius: 16px; padding: 16px; height: 100%; box-sizing: border-box; overflow: auto;"
          >
            Top-left
          </div></sat-splitter-area
        >
        <sat-splitter-area
          data-testid="inner-area-1"
          areaName="Bottom-left"
          [size]="'50%'"
          style="padding: 6px;"
          ><div
            style="background: var(--mat-sys-surface-container-lowest, white); border-radius: 16px; padding: 16px; height: 100%; box-sizing: border-box; overflow: auto;"
          >
            Bottom-left
          </div></sat-splitter-area
        >
      </sat-splitter>
    </sat-splitter-area>
    <sat-splitter-area
      data-testid="outer-area-1"
      areaName="Right"
      [size]="'60%'"
      style="padding: 6px;"
      ><div
        style="background: var(--mat-sys-surface-container-lowest, white); border-radius: 16px; padding: 16px; height: 100%; box-sizing: border-box; overflow: auto;"
      >
        Right
      </div></sat-splitter-area
    >
  </sat-splitter>
</div>
```

## API

```ts
import { SatSplitterModule } from '@hylandsoftware/satori-preview/splitter';
```

### `<sat-splitter>`

**Inputs**

- `animateCollapse: boolean = true` — Whether collapse/expand animates the size transition
- `direction: SatSplitterDirection = 'horizontal'` — Orientation of the split
- `gutterAriaLabel: string | undefined` — Optional accessible label override for the gutter separator
- `gutterAriaLabelledBy: string | undefined` — ID of the element whose text content labels the gutters
- `keyboardStepPx: number = 20` — Step size in pixels for keyboard navigation (Arrow keys)

**Outputs**

- `dragEnd: SatSplitterGutterEvent` — Emitted when the user releases a gutter after dragging or completes a keyboard navigation
- `dragStart: SatSplitterGutterEvent` — Emitted when the user begins dragging a gutter or presses a keyboard navigation key

### `<sat-splitter-area>`

**Inputs**

- `areaName: string (required)` — Accessible name for this area (e.g., "Code Editor")
- `collapsible: boolean = false` — Whether this area can be collapsed by dragging past its minSize
- `maxSize: string = '100%'` — Maximum size as percentage ('100%') or pixels ('500px')
- `minSize: string = '0%'` — Minimum size as percentage ('20%') or pixels ('100px')
- `size: string = 'auto'` — Initial size of the area as percentage ('40%'), pixels ('250px'), or 'auto' to share remaining space equally

**Outputs**

- `collapsed: boolean = false` — Two-way bindable collapsed state

### Types & interfaces

```ts
type SatSplitterDirection = 'horizontal' | 'vertical';
```

**SatSplitterGutterEvent**

- `sizes: number[]` — Size of each area at the time of the event, as percentages
