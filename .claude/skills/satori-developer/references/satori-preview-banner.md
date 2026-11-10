<!-- Generated from packages/satori-preview/banner/docs/banner-overview.mdx. Do not edit here; edit the source MDX. -->

# Banner

A banner displays a prominent message and related optional actions.

## Key Features

- **Status variants**: Supports `info`, `warning`, `important`, and `success` variants with corresponding status icons.
- **Responsive layout**: Automatically switches between inline and stacked orientation based on available width. Use the `orientationBreakpoint` input (in pixels) to control the switch point, or set `[orientationBreakpoint]="Infinity"` to always use stacked.
- **Optional border**: Display a border around the banner for additional emphasis.
- **Flexible content**: Compose banners with a message and optional actions.

## Demo Showcase

```html
@if (isBannerDisplayed()) {
<sat-banner [border]="border" [variant]="variant" [orientationBreakpoint]="orientationBreakpoint">
  <sat-banner-message>{{ message }}</sat-banner-message>
  <button mat-button satBannerAction #moreInformationButton>More Information</button>
  @if (showDismissButton) {
  <button mat-icon-button satBannerDismissButton (click)="hideBanner()">
    <mat-icon svgIcon="x_large"></mat-icon>
  </button>
  }
</sat-banner>
}
<button mat-button (click)="showBanner()" id="click-target">Show Banner</button>
```

```typescript
export class BannerExample {
  border = false;
  variant: 'info' | 'warning' | 'important' | 'success' = 'info';
  orientationBreakpoint: number | undefined = undefined;
  message = '';
  showDismissButton = true;
  readonly isBannerDisplayed = signal(false);
  private readonly moreInformationButton = viewChild('moreInformationButton', { read: ElementRef });

  showBanner(): void {
    this.isBannerDisplayed.set(true);
    // In order to bring the users attention to this important message,
    // we want to move focus to the banner message when the banner is shown.
    setTimeout(() => {
      this.moreInformationButton()?.nativeElement.focus();
    }, 0);
  }

  hideBanner(): void {
    this.isBannerDisplayed.set(false);
  }
}
```

## Orientation

By default, the banner automatically switches between inline and stacked orientation when the banner message text overflows. This provides an optimal layout across all viewport sizes without any configuration.

### `[orientationBreakpoint]="Infinity"`

Use `[orientationBreakpoint]="Infinity"` when the banner should always display actions below the message, regardless of available width. This is a safe choice for all screen sizes and results in no adaptive behavior.

```html
<sat-banner [orientationBreakpoint]="Infinity">
  <sat-banner-message>Always stacked</sat-banner-message>
  <button mat-button satBannerAction>Action</button>
</sat-banner>
```

### `[orientationBreakpoint]` with a pixel value

Use the `orientationBreakpoint` input with a pixel value to specify the width at which the banner switches from inline to stacked orientation. This allows the banner message to wrap to multiple lines while in inline orientation (instead of immediately switching to stacked on overflow), but switches to stacked at the given breakpoint to accommodate small screens.

When using `orientationBreakpoint`, the consumer is responsible for providing a sensible threshold — consider the banner message length, understand how deviating from the default affects the layout, and preferably test in different languages.

```html
<sat-banner [orientationBreakpoint]="600">
  <sat-banner-message>Stacked below 600px</sat-banner-message>
  <button mat-button satBannerAction>Action</button>
</sat-banner>
```

### Why `orientation` is deprecated

> **Deprecated**: The `orientation` input is deprecated and has no effect.

Locking the banner to inline orientation is not supported because on mobile viewports the inline action takes up too much horizontal space, causing the banner message to wrap to an unnecessary number of lines. This results in a poor reading experience and wasted vertical space. Use the default adaptive behavior or the `orientationBreakpoint` input instead.

## Components

### `sat-banner`

The main container component for displaying prominent messages.

**Inputs**

- **`border: boolean`**: Whether to display a border around the banner. Defaults to `false`.
- **`variant: 'info' | 'warning' | 'important' | 'success'`**: The status variant of the banner. Defaults to `info`.
- **`orientationBreakpoint: number`**: Optional. A pixel width at which the banner switches from inline to stacked orientation. Set to `Infinity` to always use stacked orientation. When not set, the banner automatically switches based on content overflow.
- ~~**`orientation: 'inline' | 'stacked'`**~~: **Deprecated.** Has no effect. See [Why `orientation` is deprecated](#why-orientation-is-deprecated).

### `sat-banner-message`

Container for the banner's main message text. Automatically receives a unique `id` attribute for accessibility purposes.

### `satBannerAction`

Directive to mark a button as a banner action. Apply this to the optional action button inside a Banner. Automatically sets `aria-describedby` to reference the banner message.

### `satBannerDismissButton`

Directive for the banner's dismiss button. Automatically provides a translated `aria-label` via `@ngx-translate/core` using the key `sat-preview.banner.dismiss-button.aria-label`. Consumers can override this by providing their own `aria-label` attribute.

## Basic Usage

```html
<sat-banner variant="info" [border]="true">
  <sat-banner-message>
    User Mapping is currently disabled. Enable to configure and begin synchronizing user data.
  </sat-banner-message>
  <button mat-button satBannerAction>More Information</button>
  <button mat-icon-button satBannerDismissButton>
    <mat-icon svgIcon="x_large"></mat-icon>
  </button>
</sat-banner>
```

## API

```ts
import { SatBannerModule } from '@hylandsoftware/satori-preview/banner';
```

### `<sat-banner>`

**Inputs**

- `border: boolean = false` — Whether to display a border around the banner, defaults to `false`
- `orientationBreakpoint: number` — A pixel width at which the banner switches from inline to stacked orientation
- `variant: "info" | "warning" | "important" | "success" = 'info'` — The variant style of the banner, corresponds to Satori status palettes, defaults to `info`

### `<sat-banner-message>`

**Content slots** (project via directive)

- `satBannerAction` — Marks a button as a banner action
- `satBannerDismissButton` — The dismiss button for a Banner
  - `ariaLabel: string | null = null` — Overrides the default aria-label
