import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  Sat401ErrorState,
  Sat403ErrorState,
  Sat404ErrorState,
  Sat500ErrorState,
  SatErrorStateHeadline,
} from '@hylandsoftware/satori-ui/empty-state';
import { TranslatePipe } from '@ngx-translate/core';
import {
  nxsVisibleText,
  type NxsErrorStateInputs,
  type NxsErrorStatus,
  type NxsHeadingLevel,
} from '@nuxeo/satori-platform/components';

@Component({
  selector: 'nxs-satori-error-state',
  standalone: true,
  templateUrl: './satori-error-state.component.html',
  imports: [
    Sat401ErrorState,
    Sat403ErrorState,
    Sat404ErrorState,
    Sat500ErrorState,
    SatErrorStateHeadline,
    MatButtonModule,
    MatIconModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-satori-error-state', role: 'alert', '[attr.data-status]': 'status()' },
})
export class NxsSatoriErrorStateComponent implements NxsErrorStateInputs {
  readonly status = input<NxsErrorStatus>(500);
  readonly heading = input('');
  readonly headingLevel = input<NxsHeadingLevel>(2);
  readonly retryable = input(false, { transform: booleanAttribute });
  readonly retryHandler = input<(() => void) | null>(null);
  readonly retry = output<void>();

  protected readonly ownHeading = computed(() => nxsVisibleText(this.heading()));
  protected readonly canRetry = computed(() => this.retryable() && this.status() === 500);

  protected pressRetry(): void {
    this.retryHandler()?.();
    this.retry.emit();
  }
}
