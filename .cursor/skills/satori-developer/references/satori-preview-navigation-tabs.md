<!-- Generated from packages/satori-preview/navigation-tabs/docs/navigation-tabs-overview.mdx. Do not edit here; edit the source MDX. -->

# Navigation Tabs

Navigation tabs provide a tabbed interface for navigating between different views or sections.

## Key Features

- **Simple API**: Easy to use with `sat-navigation-tabs` container and `satNavigationTab` directive on anchor elements.
- **Active state**: Highlight the currently active tab using the `active` input.
- **Accessible**: Built with ARIA roles for screen reader compatibility.
- **Arrow-keys keyboard navigation**

## Demo Showcase

```html
<sat-navigation-tabs>
  <a
    satNavigationTab
    [active]="activeTab() === firstTabLabel()"
    href="#"
    (click)="onTabClick($event, firstTabLabel())"
  >
    {{ firstTabLabel() }}
  </a>
  <a
    satNavigationTab
    [active]="activeTab() === 'Dashboard'"
    href="#"
    (click)="onTabClick($event, 'Dashboard')"
  >
    Dashboard
  </a>
  <a
    satNavigationTab
    [active]="activeTab() === 'Reports'"
    href="#"
    (click)="onTabClick($event, 'Reports')"
  >
    Reports
  </a>
  <a
    satNavigationTab
    [active]="activeTab() === 'Analytics'"
    href="#"
    (click)="onTabClick($event, 'Analytics')"
  >
    Analytics
  </a>
  <a
    satNavigationTab
    [active]="activeTab() === 'Settings'"
    href="#"
    (click)="onTabClick($event, 'Settings')"
  >
    Settings
  </a>
</sat-navigation-tabs>
```

```typescript
export class NavigationTabsExample {
  readonly firstTabLabel = input('Users');
  readonly activeTab = signal('Users');

  constructor() {
    effect(() => {
      this.activeTab.set(this.firstTabLabel());
    });
  }

  onTabClick(event: Event, tab: string): void {
    event.preventDefault();
    this.activeTab.set(tab);
  }
}
```

## Components

### `sat-navigation-tabs`

The main container component for navigation tabs.

### `satNavigationTab`

A directive applied to anchor (`<a>`) elements within the navigation tabs container.

**Inputs**

- **`active: boolean`**: Whether this tab is currently active. Defaults to `false`.

## Basic Usage

```html
<sat-navigation-tabs>
  <a satNavigationTab [active]="true" href="/overview">Overview</a>
  <a satNavigationTab href="/details">Details</a>
  <a satNavigationTab href="/settings">Settings</a>
</sat-navigation-tabs>
```

## API

```ts
import { SatNavigationTabsModule } from '@hylandsoftware/satori-preview/navigation-tabs';
```

### `<sat-navigation-tabs>`

**Content slots** (project via directive)

- `satNavigationTab` — A directive applied to anchor elements to create navigation tabs
  - `active: boolean = false` — Whether the tab is active
