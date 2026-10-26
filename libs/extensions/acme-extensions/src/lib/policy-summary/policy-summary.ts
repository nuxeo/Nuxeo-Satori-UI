import { Component, ChangeDetectionStrategy } from '@angular/core';

/**
 * `acme.panel.policySummary`
 *
 * Contributed to the platform **by ID**, behind a lazy import. Nothing in the host
 * imports this class — a manifest or a host route names the ID and
 * `ExtensionOutletComponent` resolves it. That is what leaves the class name free to
 * change without being a breaking change.
 */
@Component({
  selector: 'acme-policy-summary',
  standalone: true,
  templateUrl: './policy-summary.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './policy-summary.scss',
})
export class PolicySummaryComponent {}
