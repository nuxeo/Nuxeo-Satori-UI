import { Injectable, effect, inject, signal } from '@angular/core';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';

/**
 * Applies Layer 0 theme tokens to `<html>`, so a rebrand is a JSON edit.
 *
 * ## Why this exists at all
 *
 * Without it, the `themes` and `defaultThemeId` keys in `bootstrap.json` are
 * **inert**. The first cut of this template shipped both keys and a comment
 * claiming "a rebrand needs no rebuild", while nothing read them — config that
 * looks live and does nothing, which is worse than config that is absent.
 *
 * ## Why an `effect` rather than a one-shot call
 *
 * `AppConfigService.load()` is asynchronous, and `bootstrap()` is a signal that
 * starts on the packaged defaults. Applying tokens once at construction would
 * capture the defaults and never see the deployed file. The product's
 * `AppThemeService` has the same shape for the same reason.
 *
 * ## What it does not do
 *
 * It writes CSS custom properties only. It does not switch a compiled Material
 * palette — those come from Sass mixins and cannot be changed from JSON, which
 * is why `AppThemeConfig.base` exists in the product and is ignored here. A fork
 * that adds Material should read `base` and set `data-app-theme` too.
 */
@Injectable({ providedIn: 'root' })
export class TemplateThemeService {
  private readonly config = inject(AppConfigService);

  /** The active theme id. `null` means "whatever Layer 0 nominates as default". */
  private readonly requested = signal<string | null>(null);

  /** Properties written on the last apply, so switching themes removes stale ones. */
  private applied: readonly string[] = [];

  constructor() {
    effect(() => {
      // Both dependencies are signals: re-runs when the config lands *and* when
      // a caller switches theme.
      const theme = this.config.resolveTheme(this.requested());
      const root = document.documentElement;

      // Remove properties the previous theme set that this one does not, or a
      // switch would leave the old palette half in place.
      for (const property of this.applied) {
        if (!(property in theme.tokens)) root.style.removeProperty(property);
      }

      const written: string[] = [];
      for (const [property, value] of Object.entries(theme.tokens)) {
        // Guard the prefix: `tokens` is customer-supplied JSON, and
        // `setProperty` on a non-custom property would silently do nothing.
        if (!property.startsWith('--')) continue;
        root.style.setProperty(property, value);
        written.push(property);
      }
      this.applied = written;
    });
  }

  /** Switch theme by id. Unknown ids fall back to the Layer 0 default. */
  use(id: string | null): void {
    this.requested.set(id);
  }
}
