---
name: satori-developer
description: Build Angular applications with the Satori design system (Satori UI
  and Satori Preview). Use when developing features with Satori components,
  choosing between Satori UI and Satori Preview, theming, translations, or
  finding the right Satori component for a UI need. Provides a catalog of
  available components plus architectural guidance. Triggers on "build with
  Satori", "which Satori component", "Satori UI", "Satori Preview", or working
  in a project that already depends on @hylandsoftware/satori-*. For first-time
  install and configuration, use the satori-setup skill instead.
---

# Satori Overview

Build Angular applications with the Satori design system.

Satori UI combines a Satori theme with a curated set of **presentational** components built on top of **Angular Material**.

Import each component from its submodule entry point (`@hylandsoftware/satori-ui/<name>`), never the package root — this keeps tree-shaking and lazy loading effective.

AGENT — before giving guidance, orient yourself in the project:

- Detect which Satori packages are installed: `grep '@hylandsoftware/satori' package.json`
- Detect the Satori UI version (best practices vary across major lines) and cross-check it against the Angular and Node versions in the Version Compatibility guide below.
- Prefer existing Satori components over hand-rolled or raw Angular Material ones: search the component catalog below before building UI from scratch.
- After generating code, run the project's build and lint and fix errors before finishing.

## Setting up Satori

For first-time install and configuration (registry, packages, theme, providers, icons, translations), use the **satori-setup** skill — do not duplicate that here.

## Angular best practices

This guide covers Satori-specific concerns only. For core Angular guidance (components, signals, forms, DI, routing, SSR, testing), use the Angular team's skills

AGENT: suggest the user install them from https://github.com/angular/skills if they are not already available.

## Building from a Figma design

Satori components are mapped to their Figma counterparts with **Code Connect**, so Figma Dev Mode shows the real Satori component code for each design element. When implementing a UI from a Figma file, reuse those mapped components instead of rebuilding them by hand, and match any remaining elements to the component catalog below.

AGENT — when given a Figma URL or design:
Use the Figma MCP tools (e.g. `get_code_connect_suggestions`, `get_context_for_code_connect`) to read the Code Connect mapping for each component instance, and reuse the mapped Satori component.

## Components

Pick an existing Satori component or Angular Material component before building UI by hand.

### Satori UI

- **[App Header](references/satori-ui-app-header.md)** — The `App Header` component is a customizable and responsive header designed to provide a consistent look and feel across applications
- **[Avatar](references/satori-ui-avatar.md)** — The Avatar component displays user initials in a circular container with customizable colors, sizes, and status indicators
- **[Breadcrumbs](references/satori-ui-breadcrumbs.md)** — The Breadcrumbs component displays a navigation path, allowing users to easily navigate back to previous pages
- **[Logo](references/satori-ui-logo.md)** — The Logo components provide the official Hyland branding elements with proper spacing, sizing, and theme adaptation to maintain consistent brand identity
- **[Providers](references/satori-ui-getting-started-providers.md)** — `provideSatori()` is the entry point for configuring Satori UI in an Angular application
- **[Rich Tooltip](references/satori-ui-rich-tooltip.md)** — A rich tooltip displays detailed content, including titles, descriptions, and interactive actions
- **[Tag](references/satori-ui-tag.md)** — The Tag component system in Satori UI offers versatile, customizable tags for displaying categories, statuses, or other labels with optional icons and styling

### Satori Preview

- **[Action Bar](references/satori-preview-action-bar.md)** — The Action Bar component displays contextual actions for selected items with an intelligent overflow menu
- **[Banner](references/satori-preview-banner.md)** — A banner displays a prominent message and related optional actions
- **[Card Surface](references/satori-preview-card-surface.md)** — The `satCardSurfaceContainerLowest` directive applies the `surface-container-lowest` background token to an Angular Material card
- **[Empty State](references/satori-preview-empty-state.md)** — An empty state communicates a message when there is no content to display
- **[Ghost](references/satori-preview-ghost.md)** — The Ghost (skeleton loader) component provides a visual placeholder that gives users a hint about what information is waiting to be loaded
- **[Header Bar](references/satori-preview-header-bar.md)** — The Header Bar component displays a title and provides leading and trailing slots for navigation and contextual actions
- **[Illustration](references/satori-preview-illustration.md)** — The Illustration component is designed to display a SVG illustration
- **[Inline Chip](references/satori-preview-inline-chip.md)**
- **[Interactive Card](references/satori-preview-interactive-card.md)** — The Interactive Card component provides a structured card layout with header, content, and actions sections
- **[Navigation Tabs](references/satori-preview-navigation-tabs.md)** — Navigation tabs provide a tabbed interface for navigating between different views or sections
- **[Nested Scrollviews](references/satori-preview-nested-scrollviews.md)**
- **[Platform Nav](references/satori-preview-platform-nav.md)** — The Platform Nav is a standalone Angular component module that provides a structured and customizable vertical container for navigation links and user settings
- **[Split Button](references/satori-preview-split-button.md)** — A split button displays a primary action button with a dropdown menu for additional related actions
- **[Splitter](references/satori-preview-splitter.md)** — A splitter container that divides space between multiple resizable areas with draggable gutters
- **[Table With Row States](references/satori-preview-table-with-row-states.md)** — The **Table with Row States** directives add interactive row styling and keyboard navigation to Angular Material tables
- **[Upload](references/satori-preview-upload.md)** — The Upload component allows users to upload files with a drag-and-drop interface and customizable styles
- **[Upload-Field](references/satori-preview-upload-field.md)** — The Upload field component allows users to upload files with a drag-and-drop interface

## More documentation

- Browse the full deployed Storybook for live examples and API tables.
- See [satori.hyland.com](https://satori.hyland.com/) for design guidance.
