import type { AppThemeConfig } from '@nuxeo/satori-platform/app-config';

/**
 * Theme identifiers are open, not a closed union.
 *
 * They used to be `'nuxeo' | 'dark' | 'kawaii' | 'light'`, which meant a
 * customer could not add a theme without a rebuild — the definition of a Layer 0
 * failure. The set now comes from configuration, so the type is a string and
 * validation is a membership test against the configured list.
 */
export type AppThemeId = string;

export const APP_THEME_STORAGE_KEY = 'agentic_ui_color_theme';

/** The compiled `html[data-app-theme=...]` palettes. A configured theme names one of these as its base. */
export const COMPILED_THEME_BASES = ['nuxeo', 'dark', 'kawaii', 'light'] as const;

export type AppThemeDefinition = AppThemeConfig;

export function isAppThemeId(
  value: string | null,
  themes: readonly AppThemeConfig[],
): value is AppThemeId {
  return value !== null && themes.some((theme) => theme.id === value);
}

/**
 * Earlier releases stored palette names rather than theme ids. Kept so an
 * upgrade does not silently reset a user's chosen theme.
 */
export function migrateLegacyThemeId(raw: string | null): AppThemeId | null {
  if (!raw) return null;
  const legacy: Record<string, AppThemeId> = {
    satori: 'nuxeo',
    azure: 'light',
    emerald: 'kawaii',
    violet: 'dark',
  };
  return legacy[raw] ?? null;
}

/**
 * The `data-app-theme` attribute value to put on `<html>`.
 *
 * A configured theme with an unrecognised `base` still has to render, so it
 * falls back to the packaged Nuxeo palette and relies on its own token
 * overrides for the parts a customer cares about.
 */
export function resolveThemeAttribute(theme: AppThemeConfig): string {
  return (COMPILED_THEME_BASES as readonly string[]).includes(theme.base) ? theme.base : 'nuxeo';
}
