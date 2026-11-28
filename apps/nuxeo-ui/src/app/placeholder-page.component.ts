import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/** PoC placeholder for routes not yet backed by feature libraries. */
@Component({
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './placeholder-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .placeholder {
        padding: 1.5rem;
      }
    `,
  ],
})
export class PlaceholderPageComponent {
  private readonly route = inject(ActivatedRoute);
  readonly descriptionKey = this.route.snapshot.data['descriptionKey'] ?? '';
  readonly messageKey =
    this.route.snapshot.data['messageKey'] ?? 'app.placeholder-page.coming-soon';
}
