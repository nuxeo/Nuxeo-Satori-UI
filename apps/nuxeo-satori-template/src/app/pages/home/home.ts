import { Component, computed, inject, ChangeDetectionStrategy } from '@angular/core';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { AppExtensionsService } from '@nuxeo/satori-platform/extensions';

/**
 * A diagnostics page, which is the most useful thing a template's landing page
 * can be: it shows a fork what its own configuration actually resolved to.
 *
 * `inventory()` is the same call `docs/extension-reference.md` is generated from,
 * so a customer can see every id their build registered — including their own —
 * without reading our source.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './home.scss',
})
export class HomeComponent {
  private readonly config = inject(AppConfigService);
  private readonly extensions = inject(AppExtensionsService);

  protected readonly branding = computed(() => this.config.bootstrap().branding);

  /**
   * Where each half of the configuration came from, and why it fell back.
   *
   * Worth surfacing in a template: a fork that has not deployed `bootstrap.json`
   * yet gets the packaged defaults silently, and "why is my branding not
   * applying" is otherwise invisible.
   */
  protected readonly diagnostics = this.config.diagnostics;

  /** Every registered id, grouped by slot, plus the rule evaluator ids. */
  protected readonly inventory = computed(() => Object.entries(this.extensions.inventory()));
}
