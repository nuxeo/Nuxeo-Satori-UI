import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AppConfigService, type AppThemeConfig } from '@nuxeo/satori-platform/app-config';

import {
  APP_THEME_STORAGE_KEY,
  AppThemeId,
  isAppThemeId,
  migrateLegacyThemeId,
  resolveThemeAttribute,
} from './app-theme';
import { ThemingFeatureFlagService } from './theming-feature-flag.service';

@Injectable({ providedIn: 'root' })
export class AppThemeService {
  private readonly config = inject(AppConfigService);
  private readonly themingFlags = inject(ThemingFeatureFlagService);

  private readonly selectedId = signal<AppThemeId | null>(null);

  /** Available themes, packaged and configured. Drives the theme picker. */
  readonly themes = this.config.themes;

  /** Resolved through the configured list, so it never points at a theme that no longer exists. */
  readonly theme = computed<AppThemeConfig>(() => this.config.resolveTheme(this.selectedId()));

  readonly themeId = computed<AppThemeId>(() => this.theme().id);

  constructor() {
    // An effect rather than a call inside the initializer: the configuration
    // load is asynchronous, so the tokens have to be reapplied when it lands,
    // and again whenever the user picks a different theme.
    effect(() => this.applyTheme(this.theme()));
  }

  /**
   * Adopt the stored preference, or the configured default.
   *
   * Runs synchronously at startup so the first paint is not unthemed. The stored
   * id is validated against the configured theme list — but only once the list
   * has actually been loaded, otherwise a customer's own theme would be
   * discarded for not being one of the four packaged ones.
   */
  applyStoredOrDefault(): void {
    // Theme selection is gated to local development. Where it is off, the stored
    // preference is ignored and the configured default applies — `null` resolves
    // through the configured list rather than hardcoding the packaged `nuxeo` id,
    // so a customer who ships their own default still gets it.
    if (!this.themingFlags.themingEnabled()) {
      this.selectedId.set(null);
      return;
    }

    try {
      const raw = localStorage.getItem(APP_THEME_STORAGE_KEY);
      const migrated = migrateLegacyThemeId(raw);
      this.selectedId.set(raw ?? migrated);
      if (raw === null && migrated !== null) this.setTheme(migrated);
    } catch {
      // Private browsing modes throw on localStorage access; the configured
      // default is still correct.
      this.selectedId.set(null);
    }
  }

  setTheme(id: AppThemeId, persist = true): void {
    this.selectedId.set(id);
    if (!persist) return;
    try {
      localStorage.setItem(APP_THEME_STORAGE_KEY, id);
    } catch {
      /* preference is not persistable in this browser mode; the theme still applies */
    }
  }

  /** True once the configured theme list is known to contain the stored id. */
  isKnownTheme(id: string | null): boolean {
    return isAppThemeId(id, this.themes());
  }

  /**
   * Write the theme's palette selector and its token overrides onto `<html>`.
   *
   * Tokens are set as inline custom properties, which outrank the generated
   * stylesheet without needing `!important`. That is what lets a customer
   * rebrand from JSON: the built bundle is unchanged, only the values are.
   */
  private applyTheme(theme: AppThemeConfig): void {
    const root = document.documentElement;
    root.setAttribute('data-app-theme', resolveThemeAttribute(theme));
    root.dataset['appThemeId'] = theme.id;

    for (const property of this.appliedTokens) {
      if (!(property in theme.tokens)) root.style.removeProperty(property);
    }
    this.appliedTokens = Object.keys(theme.tokens);
    for (const [property, value] of Object.entries(theme.tokens)) {
      // Only custom properties: a token map must not be able to set `display`
      // or `position` on the root element.
      if (property.startsWith('--')) root.style.setProperty(property, value);
    }
  }

  /** Tokens set by the previous theme, so switching themes removes what it no longer defines. */
  private appliedTokens: readonly string[] = [];
}
