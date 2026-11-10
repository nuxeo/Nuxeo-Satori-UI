<!-- Generated from packages/satori-ui/breadcrumbs/docs/breadcrumbs-overview.mdx. Do not edit here; edit the source MDX. -->

# Breadcrumbs

The Breadcrumbs component displays a navigation path, allowing users to easily navigate back to previous pages. It supports truncation of items into a menu when the available space is insufficient.

## Key features

### Truncation

When there is not enough space to display Breadcrumbs in a single line, Breadcrumbs follow the following logic to determine which breadcrumb item gets hidden from the trail and displayed in a menu instead:

When there are more than two visible items, or when Breadcrumbs have current location and more than three visible items, the item to hide is the second one, because for most users the first item is of more importance, following in importance the last item, and they are likely to want to return to it.

The Breadcrumbs component automatically recalculates which items are visible both on initialization and whenever the component is resized.
A `ResizeObserver` monitors changes to the component’s size.
For optimal behavior, ensure the Breadcrumbs component is rendered as a block, flex item, or grid item so it can resize when more space becomes available.

## Demo showcase

```html
<sat-breadcrumbs
  [items]="[{'label':'Home','href':'/'},{'label':'Products','href':'/products'},{'label':'Category','href':'/products/item1'},{'label':'Subcategory','href':'/products/item2'},{'label':'Specifications','href':'/products/item3'},{'label':'Reviews','href':'/products/item4'},{'label':'Questions & Answers','href':'/products/item5'},{'label':'Accessories','href':'/products/item6'},{'label':'Warranty','href':'/products/item7'},{'label':'Support','href':'/products/item8'},{'label':'FAQ','href':'/products/item9'},{'label':'Contact Support','href':'/products/item10'},{'label':'Item','href':'/products/item11'},{'label':'Details'}]"
>
</sat-breadcrumbs>
```

## Guidelines

### Breadcrumb Items

Represented by `SatBreadcrumbsItem`: data representing a single Breadcrumbs item. The last Breadcrumbs item can optionally not be a link, to represent the current page. In that case, the `href` property should be omitted. All other items must have `href` defined.

```ts
export type SatBreadcrumbsItem = {
  label: string;
  href?: string;
};
```

## API

```ts
import { SatBreadcrumbsModule } from '@hylandsoftware/satori-ui/breadcrumbs';
```

### `<sat-breadcrumbs>`

**Inputs**

- `items: SatBreadcrumbsItem[] = []` — Input signal for the breadcrumb items

### Types & interfaces

```ts
type SatBreadcrumbsItem =
  SatBreadcrumbsItemBase | SatBreadcrumbsItemWithHref | SatBreadcrumbsItemWithRouterLink;
```
