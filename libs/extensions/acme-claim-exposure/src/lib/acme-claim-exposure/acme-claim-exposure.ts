import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { textOf } from '../texts';

/**
 * `acme.components.claimExposure`: the plugin of the custom element `acme-claim-exposure`, from
 * Acme-Claims 1.0.0's custom bundle (web/nuxeo.war/ui/nuxeo-Acme-Claims-custom-bundle.html).
 *
 * It shows what the element showed on a claim: its number, what is outstanding (its amount less
 * its reserve), the reserve as a share of the amount, and a warning at or above `threshold`. Each
 * value is computed as the element's own method computed it, and none of its code runs.
 *
 * Registered by ID behind a lazy import, so nothing in the host imports this class: a manifest
 * places it, and `ExtensionOutletComponent` resolves it.
 */
@Component({
  selector: 'acme-claim-exposure',
  standalone: true,
  templateUrl: './acme-claim-exposure.html',
  styleUrl: './acme-claim-exposure.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcmeClaimExposureComponent {
  /** The element's `document` (Object): the claim. */
  readonly document = input<NuxeoDocument | null>(null);
  /** The element's `threshold` (Number), by default `10000` in the element. */
  readonly threshold = input<number>(10000);

  private readonly amount = computed(() => this.document()?.properties?.['cl:amount']);
  private readonly reserve = computed(() => this.document()?.properties?.['cl:reserve']);

  /** `[[document.properties.cl:number]]`: Polymer shows `null` and `undefined` as nothing. */
  protected readonly number = computed(() => {
    const value = this.document()?.properties?.['cl:number'];
    return value === null || value === undefined ? '' : String(value);
  });
  protected readonly outstanding = computed(() => outstanding(this.amount(), this.reserve()));
  protected readonly ratio = computed(() => reserveRatio(this.amount(), this.reserve()));
  protected readonly high = computed(() => isHigh(this.amount(), this.threshold()));

  /** A text of the element, in the package's language; the key itself for one it does not hold, as Web UI's `i18n` shows it. */
  protected text(key: string): string {
    return textOf(key);
  }
}

/** A reserve as the element read it, `reserve || 0`: nothing, or zero, counts as zero. */
function reserveOf(reserve: unknown): number {
  return typeof reserve === 'number' && reserve ? reserve : 0;
}

/** The element's `_outstanding`: the amount less the reserve, to two decimals; nothing without an amount. */
export function outstanding(amount: unknown, reserve: unknown): string {
  if (typeof amount !== 'number') return '';
  return (amount - reserveOf(reserve)).toFixed(2);
}

/** The element's `_ratio`: the reserve as a whole percentage of the amount; a dash without one. */
export function reserveRatio(amount: unknown, reserve: unknown): string {
  if (typeof amount !== 'number' || amount === 0) return '–';
  return `${Math.round((reserveOf(reserve) / amount) * 100)}%`;
}

/** The element's `_isHigh`: an amount at or above the threshold. */
export function isHigh(amount: unknown, threshold: number): boolean {
  return typeof amount === 'number' && amount >= threshold;
}
