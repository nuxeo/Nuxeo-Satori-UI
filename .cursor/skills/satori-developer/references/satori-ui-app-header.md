<!-- Generated from packages/satori-ui/app-header/docs/header-overview.mdx. Do not edit here; edit the source MDX. -->

# App Header

The `App Header` component is a customizable and responsive header designed to provide a consistent look and feel across applications. It supports navigation, branding, and action items.

## Key Features

- **Customizable Title**: Displays a configurable title.
- **Branding Support**: Shows a logo through a slot inside the header.
- **Hyland Word Mark Logo Integration**: Integrates seamlessly with `sat-word-mark-logo` when used for the App Header logo slot.
- **Navigation Tabs**: Optionally displays navigation tabs based on configuration.
- **Responsive Layout**: Designed to provide a consistent and full screen header across applications.
- **Mobile Platform Nav Integration**: Provides a feature for integrating with Platform Nav for a responsive experience.
- **Sticky**: Sticks to the top of the viewport, which can be optionally turned off.

## Guidelines

- Use the `satAppHeaderPlatformNavMobileTrigger` directive for the Icon Button trigger that will toggle Platform Nav expansion on mobile viewports. The directive is responsible for placing the trigger in the App Header layout, as well as hiding it on wider viewports.
- Use the `satAppHeaderLeadingAction` directive for the back button or another action that should be placed in the leading position of the App Header and visible on all devices, the leading action takes precedence over the App Header Platform Nav Mobile Trigger when determining which to display when both are present.
- Use the `satAppHeaderTitle` directive for the main title.
- Use the `satAppHeaderLogo` directive for the logo.
- Use the `satAppHeaderActions` directive for action items like buttons or menus.
- Use the `satAppHeaderNavigation` directive for navigation elements.
- App Header sticky behavior requires a full-height scrollable `<main>` element in the document.
- Set the `sticky` input to `false` if you want to opt-out of the sticky behavior.

## Examples

```html
<main class="mat-typography" style="height: 100vh; overflow: auto;">
  <sat-app-header [sticky]="true">
    <button
      mat-icon-button
      satAppHeaderPlatformNavMobileTrigger
      aria-label="Open Platform Navigation Menu"
      [matTooltip]="'Open Platform Navigation Menu'"
      [attr.aria-expanded]="false"
    >
      <mat-icon svgIcon="menu"></mat-icon>
    </button>
    <h2 satAppHeaderTitle>{{ title }}</h2>
    <sat-word-mark-logo satAppHeaderLogo></sat-word-mark-logo>
    <div satAppHeaderActions>
      <button mat-icon-button [matMenuTriggerFor]="menu" aria-label="Settings" title="Settings">
        <mat-icon svgIcon="gear" />
      </button>
      <mat-menu #menu="matMenu">
        <button mat-menu-item>
          <mat-icon svgIcon="gear" />
          <span>Feature Flags</span>
        </button>
        <button mat-menu-item>
          <mat-icon svgIcon="help" />
          <span>Help</span>
        </button>
        <button mat-menu-item>
          <mat-icon svgIcon="info" />
          <span>About</span>
        </button>
      </mat-menu>
    </div>

    <nav mat-tab-nav-bar satAppHeaderNavigation [tabPanel]="tabPanel" mat-stretch-tabs="false">
      <a mat-tab-link routerLink="#" [active]="true">Tasks</a>
      <a mat-tab-link routerLink="#">Configuration</a>
      <a mat-tab-link routerLink="#">Reports</a>
    </nav>
  </sat-app-header>
  <mat-tab-nav-panel #tabPanel>
    <div style="padding: 0 1rem;">
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p>
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
      <p id="scroll-to-element">
        This is an example of content below the App Header. Scroll down to see the sticky behavior
        in action.
      </p>
    </div>
  </mat-tab-nav-panel>
</main>
```

```html
<sat-app-header>
  <button mat-icon-button satAppHeaderLeadingAction aria-label="Back">
    <mat-icon svgIcon="arrow_left"></mat-icon>
  </button>
  <button
    mat-icon-button
    satAppHeaderPlatformNavMobileTrigger
    (click)="platformNavService.toggleCollapsed()"
    aria-label="Expand Navigation"
  >
    <mat-icon svgIcon="menu"></mat-icon>
  </button>
  <h2 satAppHeaderTitle>Application Title</h2>
  <img satAppHeaderLogo src="/assets/logo.svg" alt="Logo" />
  <div satAppHeaderActions>
    <button mat-icon-button aria-label="Settings">
      <mat-icon svgIcon="gear"></mat-icon>
    </button>
  </div>
  <nav mat-tab-nav-bar satAppHeaderNavigation [tabPanel]="tabPanel" mat-stretch-tabs="false">
    <a mat-tab-link routerLink="#" routerLinkActive #rla="routerLinkActive" [active]="rla.isActive"
      >Tasks</a
    >
    ...
  </nav>
</sat-app-header>
<mat-tab-nav-panel #tabPanel></mat-tab-nav-panel>
```

## SatAppHeaderService

The `SatAppHeaderService` provides a reactive way to access information about the App Header's current state. It's particularly useful when you need to position content relative to the header.

### verticalSpace

The `verticalSpace` signal returns how much vertical space (in pixels) the App Header is taking up at the top of the viewport. This value updates automatically on scroll and resize events.

**Use cases:**

- Positioning sticky elements below the App Header
- Calculating available viewport height for scrollable content
- See Nested Scrollviews

**Example usage:**

```typescript
import { Component, inject } from '@angular/core';
import { SatAppHeaderService } from '@hylandsoftware/satori-ui/app-header';

@Component({
  selector: 'app-my-component',
  template: `
    <div style="position: absolute" [style.top.px]="appHeaderService.verticalSpace()">
      Content positioned below the header
    </div>
  `,
})
export class MyComponent {
  readonly appHeaderService = inject(SatAppHeaderService);
}
```

**Return values:**

- `number` - The vertical space in pixels when an App Header is present
- `undefined` - When no App Header element exists in the document

## API

```ts
import { SatAppHeaderModule } from '@hylandsoftware/satori-ui/app-header';
```

### `<sat-app-header>`

**Inputs**

- `sticky: boolean = true` — Whether the header should stick to the top of the viewport

**Content slots** (project via directive)

- `satAppHeaderActions` — You can use this directive to create action buttons and items in the app header
- `satAppHeaderLeadingAction` — You can use this directive to position a leading action icon button in the App Header
- `satAppHeaderLogo` — You can use this directive to create a Hyland logo in the app header
- `satAppHeaderNavigation` — You can use this directive to create navigation in the app header
- `satAppHeaderPlatformNavMobileTrigger` — You can use this directive to insert a Platform Nav trigger in the app header, that is only visible when viewed on small viewports
- `satAppHeaderTitle` — You can use this directive to create a title in the app header

**Service** `SatAppHeaderService`

- `verticalSpace: Signal<unknown>` — How much vertical space the App Header is taking up in total at the top of the viewport

_Deprecated: `<sat-header>` (use `<sat-app-header>`); `satHeaderActions` (use `satAppHeaderActions`); `satHeaderLogo` (use `satAppHeaderLogo`); `satHeaderNavigation` (use `satAppHeaderNavigation`); `satHeaderTitle` (use `satAppHeaderTitle`)._
