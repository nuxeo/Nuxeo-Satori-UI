<!-- Generated from packages/satori-ui/rich-tooltip/docs/rich-tooltip-overview.mdx. Do not edit here; edit the source MDX. -->

# Rich Tooltip

A rich tooltip displays detailed content, including titles, descriptions, and interactive actions.

## Key Features

### Browser Events

- **Mouse Hover**: Transient tooltips appear when hovered and disappear when moved away.
- **Focus**: Transient tooltips appear on focus and disappear when the trigger loses focus.
- **Click**: Persistent tooltips appear on click and disappear when another UI element is interacted with or Escape is pressed.

### Visual Behavior

- **Default Position**: Displays below and after the trigger.
- **Customizable Positions**: Controlled via `positionX` and `positionY`.
- **Smooth Fade-In/Out Animation**: Uses Material Design animations.

### One Rich Tooltip open at a time

Only one Rich Tooltip can be open at the same time. When a new tooltip opens, any previously open tooltip is closed immediately, regardless of any configured `hideDelay`.

## Demo Showcase

```html
<button mat-button type="button" [satRichTooltipTriggerFor]="tooltip" id="click-target">
  Click
</button>

<sat-rich-tooltip #tooltip="satRichTooltip">
  <sat-rich-tooltip-title>Rich Tooltip</sat-rich-tooltip-title>
  <sat-rich-tooltip-content>
    Lorem ipsum dolor sit amet consectetur adipisicing elit. Corporis fuga dignissimos distinctio et
    inventore dolore accusantium, consequatur facere dolores praesentium laudantium aspernatur
    incidunt odio eligendi quas, culpa tempora in ut.
  </sat-rich-tooltip-content>
</sat-rich-tooltip>
```

## Guidelines

- Rich tooltips provide additional context about a UI element. They can optionally contain a title, buttons, and hyperlinks.
- The content is mandatory for Rich Tooltip. But Title and Text buttons are optional.

* Rich tooltips are best used for longer text like definitions or explanations.
* Keep titles brief, ideally to one line (avoid wrapping to more than one line). They should summarize or describe the message of the rich tooltip.

- Rich tooltips can have up to two text buttons. These should be brief and relevant to the message in the content. **Actions are only allowed in persistent tooltips.**
- Persistent rich tooltips appear when the parent element is clicked.
- Persistent rich tooltips remain active even when leaving the target region. They only disappear once you interact with another UI element. Hovering doesn’t trigger the tooltip.
- Avoid using persistent rich tooltips on icon buttons.

* Rich tooltip disappear 1.5 seconds after navigating away from the target region.
* Pair the rich tooltip with an icon (i or ?) where more info about the text/ label is required.
* Don’t hide critical information within tooltips as it’s easy to miss. Use an interruptive dialog instead.

## Behavior Types

Rich tooltips have two behavior types that determine their interaction model and ARIA role:

### Transient (default)

- Appears on hover or focus
- Informational only - **should not contain interactive elements like buttons or links**
- Automatically assigned `role="tooltip"`
- Disappears after navigating away

### Persistent

- Appears on click
- Can contain interactive elements (buttons, links)
- Automatically assigned `role="dialog"`
- Remains visible until dismissed or another element is interacted with
- Focus is trapped within the tooltip

```html
<!-- Transient tooltip (informational only) -->
<sat-rich-tooltip>
  <sat-rich-tooltip-title>Feature Info</sat-rich-tooltip-title>
  <sat-rich-tooltip-content>This is informational content.</sat-rich-tooltip-content>
</sat-rich-tooltip>

<!-- Persistent tooltip (with actions) -->
<sat-rich-tooltip behavior="persistent">
  <sat-rich-tooltip-title>Take Action</sat-rich-tooltip-title>
  <sat-rich-tooltip-content>Would you like to proceed?</sat-rich-tooltip-content>
  <sat-rich-tooltip-actions>
    <button mat-button>Learn More</button>
  </sat-rich-tooltip-actions>
</sat-rich-tooltip>
```

## API

```ts
import { SatRichTooltipModule } from '@hylandsoftware/satori-ui/rich-tooltip';
```

### `<sat-rich-tooltip>`

**Inputs**

- `behavior: SatRichTooltipBehavior = 'transient'` — RichTooltip behavior type 'transient'
- `disableAnimation: boolean = false` — Disable animations of richTooltip and all child elements false
- `focusTrapAutoCaptureEnabled: boolean = true` — Rich Tooltip focus trap auto capture using cdkTrapFocusAutoCapture true
- `focusTrapEnabled: boolean = true` — Rich Tooltip focus trap using cdkTrapFocus true
- `hideDelay: number = 1500` — RichTooltip leave delay (milliseconds) 1500
- `overlapTrigger: boolean = false` — RichTooltip overlap trigger false
- `positionX: SatRichTooltipPositionX = 'after'` — Position of the richTooltip in the X axis
- `positionY: SatRichTooltipPositionY = 'below'` — Position of the richTooltip in the Y axis
- `scrollStrategy: SatRichTooltipScrollStrategy = 'reposition'` — RichTooltip scroll strategy 'reposition'
- `showDelay: number = 200` — RichTooltip enter delay (milliseconds) 200
- `targetOffsetX: number = 0` — RichTooltip horizontal target offset (px) 0
- `targetOffsetY: number = 20` — RichTooltip vertical target offset (px) 20

**Outputs**

- `closed: SatRichTooltipCloseReason` — Event emitted when the richTooltip is closed

### `<sat-rich-tooltip-actions>`

**Inputs**

- `align: SatRichTooltipActionAlignment = 'start'` — Alignment of the actions 'start'

### `<sat-rich-tooltip-content>`

### `<sat-rich-tooltip-title>`

**Content slots** (project via directive)

- `satRichTooltipClose` — Directive for closing the rich tooltip
- `satRichTooltipTriggerFor` — Directive for triggering the rich tooltip
  - `satRichTooltipBackdropCloseOnClick: boolean = true` — RichTooltip backdrop close on click
  - `satRichTooltipDisabled: boolean = false` — RichTooltip won't open on trigger
  - `satRichTooltipTriggerFor: SatRichTooltip (required)` — References the richTooltip instance that the trigger is associated with
  - `tooltipClosed: void` — Event emitted when the associated richTooltip is closed
  - `tooltipOpened: void` — Event emitted when the associated richTooltip is opened

### Types & interfaces

```ts
type SatRichTooltipActionAlignment = 'start' | 'center' | 'end';
```

```ts
type SatRichTooltipBehavior = 'transient' | 'persistent';
```

```ts
type SatRichTooltipCloseReason = void | 'click' | 'keydown' | 'focusout';
```

```ts
type SatRichTooltipPositionX = 'before' | 'after';
```

```ts
type SatRichTooltipPositionY = 'above' | 'below';
```

```ts
type SatRichTooltipScrollStrategy = 'noop' | 'close' | 'block' | 'reposition';
```
