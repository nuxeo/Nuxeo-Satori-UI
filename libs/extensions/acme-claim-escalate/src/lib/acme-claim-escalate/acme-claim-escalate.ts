import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NxsButtonComponent } from '@nuxeo/satori-platform/components';
import { DocumentChangesService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { finalize } from 'rxjs';

import { ACME_CLAIM_ESCALATE_TEXTS, textOf } from '../texts';
import { ClaimEscalationService } from './claim-escalation.service';

/** What `claim-escalated` carries: the claim, and the level the operation answered with. */
export interface ClaimEscalated {
  readonly claim: string;
  readonly level: unknown;
}

/** What `notify` carries: the message Web UI would have shown as a toast. */
export interface ClaimNotice {
  readonly message: string;
}

/**
 * `acme.components.claimEscalate`: the plugin of the custom element `acme-claim-escalate`, from
 * Acme-Claims 1.0.0's custom bundle (web/nuxeo.war/ui/nuxeo-Acme-Claims-custom-bundle.html).
 *
 * As the element did, it offers its button only to someone who may write the claim, never on a
 * closed one; pressed, it runs `Claim.Escalate` on the claim with its `reason`, then emits
 * `claimEscalated` and `documentUpdated`, or `notify` with the failure's message, which it also
 * shows beside the button (README, "Shown differently"). The button is disabled while the operation
 * runs. None of the element's code runs.
 *
 * Registered by ID behind a lazy import, so nothing in the host imports this class: a manifest
 * places it, and `ExtensionOutletComponent` resolves it.
 */
@Component({
  selector: 'acme-claim-escalate',
  standalone: true,
  templateUrl: './acme-claim-escalate.html',
  styleUrl: './acme-claim-escalate.scss',
  imports: [NxsButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcmeClaimEscalateComponent {
  private readonly escalation = inject(ClaimEscalationService);
  private readonly changes = inject(DocumentChangesService);
  private readonly destroyRef = inject(DestroyRef);

  /** The element's `document` (Object): the claim. */
  readonly document = input<NuxeoDocument | null>(null);
  /** The element's `reason` (String), by default `'manual'` in the element. */
  readonly reason = input<string>('manual');
  /** Fired as the element fires `claim-escalated`, with the claim and the level the operation answered. */
  readonly claimEscalated = output<ClaimEscalated>();
  /** Fired as the element fires `document-updated`, once the operation has answered. */
  readonly documentUpdated = output<void>();
  /** Fired as the element fires `notify`, with the failure's message. */
  readonly notify = output<ClaimNotice>();

  /** The element's `_running`. */
  protected readonly running = signal(false);
  /**
   * The failure's message, shown beside the button. Web UI showed it as a toast; a slot that places
   * this component binds none of its outputs, and the template provides no toast.
   */
  protected readonly failure = signal<string | null>(null);
  /** The element's `_canEscalate(document)`, its button's `dom-if`. */
  protected readonly canEscalate = computed(() => canEscalate(this.document()));

  protected escalate(): void {
    const claim = this.document();
    if (!claim || this.running()) return;
    this.running.set(true);
    this.failure.set(null);
    this.escalation
      .escalate(claim.uid, this.reason())
      .pipe(
        finalize(() => this.running.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (answer) => {
          this.claimEscalated.emit({ claim: claim.uid, level: answer?.properties?.['cl:level'] });
          this.documentUpdated.emit();
          // Web UI's `document-updated` has the page read the claim again. In the app the record
          // page and its lists follow this service, and read theirs again.
          this.changes.notify();
        },
        error: () => {
          const message = ACME_CLAIM_ESCALATE_TEXTS.label.claim.escalateFailed;
          this.failure.set(message);
          this.notify.emit({ message });
        },
      });
  }

  /** A text of the element, in the package's language; the key itself for one it does not hold, as Web UI's `i18n` shows it. */
  protected text(key: string): string {
    return textOf(key);
  }
}

/**
 * The element's `_canEscalate`: a claim, not closed, that the user may write, as Web UI's
 * `hasPermission(document, 'Write')` reads it, from the document's `permissions` enricher. It
 * decides what the screen offers; the server still refuses what the user may not do.
 */
export function canEscalate(document: NuxeoDocument | null): boolean {
  if (!document || document.state === 'closed') return false;
  const permissions = document.contextParameters?.['permissions'];
  return Array.isArray(permissions) && permissions.includes('Write');
}
