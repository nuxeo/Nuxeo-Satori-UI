import { Component, computed, inject } from '@angular/core';

import {
  AppExtensionsService,
  ExtensionActionRegistry,
  ExtensionRuleContextService,
} from '@nuxeo/satori-platform/extensions';

import { ACME_EXTENSIONS_EXTENSION_IDS } from '../extensions';

/**
 * A component this library owns, contributed to the platform **by ID**.
 *
 * Registered as `acme.panel.acmeExtensions`, so a manifest can place it in a
 * drawer or a tab without an application importing this class. That indirection is
 * the whole point of Layer 2: contributing UI is registration, not wiring.
 *
 * It dispatches its action by ID rather than calling a method, so a manifest can
 * move the affordance elsewhere — or a later release replace the handler — with no
 * change here.
 */
@Component({
  selector: 'acme-panel',
  standalone: true,
  templateUrl: './acme-panel.html',
  styleUrl: './acme-panel.scss',
})
export class AcmePanelComponent {
  private readonly actions = inject(ExtensionActionRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly extensions = inject(AppExtensionsService);

  /** `label` is required: a descriptor is also what a menu renders. */
  private readonly descriptor = {
    id: ACME_EXTENSIONS_EXTENSION_IDS.actions[0],
    label: 'Export summary',
  } as const;

  protected readonly actionLabel = this.descriptor.label;

  /** False when no handler is registered — an application/manifest mismatch. */
  protected readonly handlerRegistered = this.actions.has(this.descriptor.id);

  /**
   * A `computed`, not a field: the rule reads the rule context, which tracks the
   * signed-in user and the current route, so evaluating once at construction
   * would freeze the answer.
   */
  protected readonly enabled = computed(() =>
    this.extensions.evaluateRule(
      ACME_EXTENSIONS_EXTENSION_IDS.rules[0],
      this.ruleContext.context(),
    ),
  );

  protected run(): void {
    // Returns false rather than throwing for an unregistered ID, so a manifest
    // naming an action a newer build provides degrades quietly.
    this.actions.execute(this.descriptor, this.ruleContext.context());
  }
}
