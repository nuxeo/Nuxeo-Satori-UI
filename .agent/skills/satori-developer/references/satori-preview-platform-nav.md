<!-- Generated from packages/satori-preview/platform-nav/docs/platform-nav-overview.mdx. Do not edit here; edit the source MDX. -->

# Platform Nav

The Platform Nav is a standalone Angular component module that provides a structured and customizable vertical container for navigation links and user settings. Designed for applications with sidebar-based layouts, it enables developers to build consistent, scalable navigation systems using a combination of pre-built layout primitives and Angular Material.

## Key Features

- **Flexible Layout**: Composed of modular elements like containers, list items, avatars, and user sections.
- **Navigation Structure**: Supports static and dynamic nav items with optional icons and active state handling.
- **User Section**: Includes support for user profiles, avatars, and action menus (e.g., logout).
- **Custom Avatars**: Generates avatars from item labels using a customizable initials pipe.
- **Material Integration**: Built with Angular Material components like mat-menu, mat-icon, and mat-button.
- **Internationalization-Ready**: Fully compatible with ngx-translate for multilingual applications.
- **Mobile Support**: Supports users on mobile devices by hiding itself in the collapsed state on small viewports, as well as adding an additional collapse-action affordance in the form of a close icon button in the expanded state. This necessitates adding a trigger for expanding the Platform Nav on mobile devices, placed for example in the header, see the App Header component's integration in the App Header docs.

### Browser Events

- **Navigation Item Selection**: Clicking a navigation item will trigger an active state change. When a user clicks on an inactive item, it becomes the active item, and the previously active item is marked as inactive. This provides clear, focused navigation and updates the UI to reflect which section the user is currently interacting with.
- **User Profile Menu Interaction**: Clicking on the user profile avatar or name opens the user menu. The `matMenuTriggerFor` directive ensures smooth toggling of the dropdown menu. Clicking on the items inside the menu can be implemented by consumers.

## Demo Showcase

```html
<sat-platform-nav-container>
  <sat-platform-nav [neutralTheme]="neutralTheme">
    <sat-platform-nav-switcher
      [disabled]="disableEnvironmentSwitcher"
      [value]="defaultEnv"
      [environments]="environments"
      (environmentChange)="onEnvironmentChange($event)"
    >
    </sat-platform-nav-switcher>

    <sat-platform-nav-menu>
      <a sat-platform-nav-menu-item [href]="homeItem.path">
        <sat-platform-nav-avatar [item]="homeItem"></sat-platform-nav-avatar>
        {{ homeItem.label }}
      </a>
      @for (item of items; track $index) {
      <a
        sat-platform-nav-menu-item
        [href]="item.path"
        [id]="'sat-platform-nav-item-' + $index"
        [active]="item.active"
        (click)="onNavItemClick($event, item)"
      >
        <sat-platform-nav-avatar [item]="item"></sat-platform-nav-avatar>
        {{ item.label }}
      </a>
      }
    </sat-platform-nav-menu>
    <sat-platform-nav-user>
      <button satPlatformNavUserProfile [matMenuTriggerFor]="userMenu">
        <sat-avatar [size]="'28'" aria-hidden="true" [initials]="userName | satPlatformNavInitials">
          <img src="assets/person-200x200.jpg" alt="" />
        </sat-avatar>

        {{ userName }}
      </button>
      <mat-menu #userMenu="matMenu" satPlatformNavUserMenu>
        <sat-platform-nav-release-notes-link [url]="releaseNotesUrl" />
        <button mat-menu-item>
          <mat-icon svgIcon="logout"></mat-icon>
          <span>{{ 'logout' | translate }}</span>
        </button>
      </mat-menu>
    </sat-platform-nav-user>
  </sat-platform-nav>
  <sat-platform-nav-main-content>
    <sat-platform-nav-main-content-demo></sat-platform-nav-main-content-demo>
  </sat-platform-nav-main-content>
</sat-platform-nav-container>
```

## Responsive Design

The Platform Nav is designed to be responsive and will collapse on small viewports.
Remember to add a trigger for expanding the Platform Nav on mobile devices, placed in the header:

```html
<button
  mat-icon-button
  satAppHeaderPlatformNavMobileTrigger
  (click)="platformNavService.toggleCollapsed()"
>
  <mat-icon svgIcon="menu"></mat-icon>
</button>
```

```ts
import { SatPlatformNavStateService } from '@hylandsoftware/satori-preview/platform-nav';

@Component({/* ... */})
export class Component {
  readonly platformNavService = inject(SatPlatformNavStateService);
}
```

## Release Notes Link

Teams composing their own platform nav user menu can add a release notes link with
`sat-platform-nav-release-notes-link`. Pass the target URL through the optional `url` input. When no
URL is provided, the link opens the Hyland Community guides:

```html
<mat-menu #userMenu="matMenu" satPlatformNavUserMenu>
  <sat-platform-nav-release-notes-link [url]="releaseNotesUrl" />
  <button mat-menu-item>
    <mat-icon svgIcon="logout"></mat-icon>
    <span>{{ 'logout' | translate }}</span>
  </button>
</mat-menu>
```

## Guidelines

- We strongly recommend using the `satPlatformNavInitials` pipe to generate initials for both navigation avatars and the user profile avatar, ensuring a visually consistent layout across the navigation UI.
- Avoid nesting multiple interactive regions in nav items to prevent click ambiguity.
- The user profile menu can be extended to support more actions (e.g., Languages, settings).

### Accessibility

For screen reader users, we must avoid too long menu item labels and keep them concise and descriptive.

## Examples

### Custom Image/Icon for Nav Items

The nav items can render images or icons to enhance the visual appeal and usability of the navigation. Consumers can use `SatNavigationItem` as a type for the nav items, which can be `SatBaseNavigationItem` or `SatNavigationItemWithIcon` or `SatNavigationItemWithImage`. This allows for flexibility in how nav items are displayed, whether with icons, images, or just initials. Then they can use `sat-platform-nav-avatar` to display images or icons in the nav items. This allows for a more personalized and visually engaging navigation experience.

- **SatNavigationItemWithIcon**: If the item includes an icon, the avatar component will render the icon using Angular Material’s`mat-icon` component. The icon can be specified using the `svgIcon` attribute, which allows for SVG icons to be used.

  ```typescript
  @Component({
    selector: 'app-component',
    imports: [SatPlatformNavAvatarComponent],
  })
  export class Component {
    homeItem: SatNavigationItemWithIcon = {
      label: 'Home',
      path: '/home',
      icon: 'home',
      active: false,
    };
  }
  ```

  ```html
  <sat-platform-nav-container>
    <sat-platform-nav>
      <sat-platform-nav-list-item>
        <sat-platform-nav-avatar [item]="homeItem"></sat-platform-nav-avatar>
        {{ homeItem.label | translate }}
      </sat-platform-nav-list-item>
      ....
    </sat-platform-nav>
    <sat-platform-nav-main-content></sat-platform-nav-main-content>
  </sat-platform-nav-container>
  ```

- **SatNavigationItemWithImage**: If the item includes an image, the avatar component will render the image using an `<img>` tag. The image source can be specified using the `src` attribute, allowing for custom images to be displayed in the nav items.

  ```ts
  @Component({
    selector: 'app-component',
    imports: [SatPlatformNavAvatarComponent],
  })
  export class Component {
    homeItem: SatNavigationItemWithImage = {
      label: 'Home',
      path: '/home',
      image: 'https://example.com/dummy-image.png',
      active: false,
    };
  }
  ```

- **SatBaseNavigationItem**: If the item does not include an icon or image, the avatar component will render initials generated from the label using the `satPlatformNavInitials` pipe. This ensures that even without a specific icon or image, the layout remains consistent and visually appealing.

  ```ts
  @Component({
    selector: 'app-component',
    imports: [SatPlatformNavAvatarComponent],
  })
  export class Component {
    homeItem: SatBaseNavigationItem = {
      label: 'Home',
      path: '/home',
      active: false,
    };
  }
  ```

- If the user does not provide `sat-platform-nav-avatar`, the nav item will be rendered with a default avatar with initials generated from the label. This ensures that the layout remains consistent and visually appealing, even when no specific icon or image is present.

  ```html
  <sat-platform-nav-container>
    <sat-platform-nav>
      <sat-platform-nav-list-item> {{ homeItem.label | translate }} </sat-platform-nav-list-item>
      ....
    </sat-platform-nav>
    <sat-platform-nav-main-content></sat-platform-nav-main-content>
  </sat-platform-nav-container>
  ```

## API

```ts
import { SatPlatformNavModule } from '@hylandsoftware/satori-preview/platform-nav';
```

### `<sat-platform-nav>`

**Inputs**

- `neutralTheme: boolean = false` — Activates the neutral look of the platform navigation dedicated to administration context

### `<sat-platform-nav-avatar>`

**Inputs**

- `item: SatNavigationItem (required)` — The navigation item associated with this avatar

### `<sat-platform-nav-container>`

### `<sat-platform-nav-switcher>`

**Inputs**

- `disabled: boolean = false` — Denotes whether the switcher is disabled
- `environments: SatPlatformNavEnvironmentType[] (required)` — The available environments
- `value: string (required)` — The currently selected environment

**Outputs**

- `environmentChange: SatPlatformNavEnvironmentType` — An event emitted when the environment is changed

### `<sat-platform-nav-main-content>`

### `<sat-platform-nav-menu>`

### `satPlatformNavMenuItem`

**Inputs**

- `active: boolean = false` — Determines whether the menu item should be rendered in an active/selected state

### `<sat-platform-nav-release-notes-link>`

**Inputs**

- `url: string | null` — URL of the release notes

### `<sat-platform-nav-user>`

### `satPlatformNavUserProfile`

**Content slots** (project via directive)

- `satPlatformNavUserMenu` — This directive is applied to an Angular Material mat-menu to define a custom-styled user menu that appears when the user profile is clicked

**Service** `SatPlatformNavState`

- `toggleCollapsed: () => void` — Call this to toggle the sidebar between collapsed and expanded

### Types & interfaces

```ts
type SatNavigationItem =
  SatBaseNavigationItem | SatNavigationItemWithIcon | SatNavigationItemWithImage;
```

**SatPlatformNavEnvironmentType**

- `disabled: boolean` — Indicates whether the environment option is disabled
- `label: string` — The name of the environment
- `value: string` — The value associated with the environment
