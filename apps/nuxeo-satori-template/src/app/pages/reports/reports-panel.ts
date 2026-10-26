import { Component, computed, inject, ChangeDetectionStrategy } from '@angular/core';

import {
  AppExtensionsService,
  ExtensionActionRegistry,
  ExtensionRuleContextService,
} from '@nuxeo/satori-platform/extensions';

/**
 * A customer-owned component, reachable two ways at once.
 *
 * It is a **route** (`/reports`) and it is registered in the component registry
 * under `template.sidebar.reports`, so a manifest can also place it in a drawer
 * without this file or the route table changing. That dual reachability is the
 * point of Layer 2: contributing a component is registration, not wiring.
 *
 * It also fires a registered **action** by id rather than calling a method, which
 * is what lets a manifest move the affordance elsewhere — or a later release
 * replace the handler — with no change here.
 */
@Component({
  selector: 'app-reports-panel',
  standalone: true,
  templateUrl: './reports-panel.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './reports-panel.scss',
})
export class ReportsPanelComponent {
  private readonly actions = inject(ExtensionActionRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly extensions = inject(AppExtensionsService);

  /**
   * The descriptor naming the handler. `label` is required — a descriptor is
   * also what a menu renders, so it always has an accessible name.
   */
  private readonly descriptor = {
    id: 'template.actions.exportSummary',
    label: 'Export summary',
  } as const;

  protected readonly actionId = this.descriptor.id;
  protected readonly actionLabel = this.descriptor.label;

  /** False when nothing is registered under the id — a build/manifest mismatch. */
  protected readonly handlerRegistered = this.actions.has(this.descriptor.id);

  /**
   * A `computed`, not a field: the rule closes over the session and the rule
   * context tracks the current route, so evaluating once at construction would
   * freeze the answer.
   */
  protected readonly signedIn = computed(() =>
    this.extensions.evaluateRule('template.rules.isSignedIn', this.ruleContext.context()),
  );

  protected runExport(): void {
    // Returns false rather than throwing when the id is unregistered, so a
    // manifest naming an action a newer build provides degrades quietly.
    this.actions.execute(this.descriptor, this.ruleContext.context());
  }
}
