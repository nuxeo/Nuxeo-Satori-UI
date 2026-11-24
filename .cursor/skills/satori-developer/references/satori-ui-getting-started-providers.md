<!-- Generated from packages/satori-ui/providers/docs/providers-overview.mdx. Do not edit here; edit the source MDX. -->

# Providers

`provideSatori()` is the entry point for configuring Satori UI in an Angular application. Call it once in your `ApplicationConfig` providers array.

```typescript
import { ApplicationConfig } from '@angular/core';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';

export const appConfig: ApplicationConfig = {
  providers: [provideSatori()],
};
```

## What it configures by default

All three sub-providers are enabled when `provideSatori()` is called without arguments.

### Theme (`theme: true`)

Sets Angular Material component defaults aligned to the Satori design language:

| Token                                              | Default value | Reason                                                                  |
| -------------------------------------------------- | ------------- | ----------------------------------------------------------------------- |
| `MAT_FORM_FIELD_DEFAULT_OPTIONS.appearance`        | `'outline'`   | Satori form field visual style                                          |
| `MAT_FORM_FIELD_DEFAULT_OPTIONS.floatLabel`        | `'always'`    | Labels are always visible above the field                               |
| `MAT_FORM_FIELD_DEFAULT_OPTIONS.subscriptSizing`   | `'dynamic'`   | Accessible subscript that expands to fit any number of hint/error lines |
| `MAT_PROGRESS_SPINNER_DEFAULT_OPTIONS.diameter`    | `48`          | Satori default spinner size                                             |
| `MAT_PROGRESS_SPINNER_DEFAULT_OPTIONS.strokeWidth` | `4`           | Satori default spinner stroke                                           |

### Icons (`icons: true`)

Registers the full Satori icon set into Angular Material's `MatIconRegistry` so icons are available via `svgIcon` on any `<mat-icon>`.

Additionally adds an error icon prefix to Form Field error messages for superior accessibility.

```html
<mat-icon svgIcon="add_folder"></mat-icon>
```

### Subscript sizing (`subscriptSizing: true`)

Activates a minimum height on Form Field subscripts, ensuring visual balance between fields that have and do not have hint or error text — without sacrificing the accessibility benefits of `'dynamic'` subscript sizing.

## Configuration

Each sub-provider can be disabled individually by passing a `SatoriConfig` object.

```typescript
export interface SatoriConfig {
  theme?: boolean; // default: true
  icons?: boolean; // default: true
  subscriptSizing?: boolean; // default: true
}
```

### Disable icons

Use this when your application registers icons through its own mechanism, or when you want to load only a subset of the icon set.

```typescript
providers: [provideSatori({ icons: false })];
```

### Disable theme defaults

Use this when your application provides its own `MAT_FORM_FIELD_DEFAULT_OPTIONS` or `MAT_PROGRESS_SPINNER_DEFAULT_OPTIONS` tokens and you do not want Satori's values to conflict.

```typescript
providers: [provideSatori({ theme: false })];
```

### Disable subscript sizing

Use this when your application applies its own Form Field subscript height rules and you do not want the Satori's dynamic with min height subscript sizing.

```typescript
providers: [provideSatori({ subscriptSizing: false })];
```

To disable Satori subscript sizing for any one particular Form Field, use its `subscriptSizing` input:

```html
<mat-form-field subscriptSizing="dynamic">...</mat-form-field>
```
