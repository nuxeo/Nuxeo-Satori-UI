import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionRuleContextService,
  type NavItemDescriptor,
} from '@nuxeo/satori-platform/extensions';

import { SignInComponent } from './pages/sign-in/sign-in';
import { TemplateSessionService } from './template-session.service';

/**
 * The template shell.
 *
 * The navigation is **resolved from the extension registry**, not written here.
 * That is the single most important line in the template: it is what makes the
 * nav addressable, so a manifest can hide, reorder, relabel or add an entry with
 * no change to this component.
 *
 * It calls `AppExtensionsService.resolve()` directly rather than injecting
 * `APP_NAV_ITEMS`. That token's factory registers the *product's* own nav entries
 * as a side effect of being injected, which would point a fork at routes it does
 * not have.
 *
 * The brand comes from Layer 0. It used to be the literal string "Nuxeo Satori"
 * in the template, which quietly weakened the whole rebrand claim: `bootstrap.json`
 * carried `branding.applicationTitle`, the browser tab honoured it, and the one
 * place a viewer actually looks did not.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SignInComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly extensions = inject(AppExtensionsService);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly config = inject(AppConfigService);
  private readonly session = inject(TemplateSessionService);

  protected readonly brand = computed(() => this.config.bootstrap().branding.applicationTitle);

  protected readonly signedIn = this.session.isSignedIn;
  protected readonly username = this.session.username;

  /**
   * A `computed`, not a field, because both halves change after construction:
   * the manifest lands asynchronously, and rule results depend on the rule
   * context, which tracks the signed-in user and the current route.
   */
  protected readonly navItems = computed<readonly NavItemDescriptor[]>(() =>
    this.extensions.resolve<NavItemDescriptor>(EXTENSION_SLOTS.navbar, this.ruleContext.context()),
  );

  /** Surfaced so a fork notices a manifest naming a `$layer` that does not resolve. */
  protected readonly missingLayers = this.extensions.missingLayers;

  /** Same, for a `routes` entry whose path the router would never have matched. */
  protected readonly invalidRoutes = this.extensions.invalidRoutes;

  /** Which half of the configuration came from where — worth seeing while demoing. */
  protected readonly manifestSource = computed(() => this.config.diagnostics().manifestSource);

  protected signOut(): void {
    this.session.signOut();
  }
}
