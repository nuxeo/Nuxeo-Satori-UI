import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { NxsErrorStateComponent } from '@nuxeo/satori-platform/components';

/**
 * The page an unmatched route lands on.
 *
 * The router declared no `**` route, which `retired-routes.ts` already noted in passing: "the
 * router has no wildcard route, so an unmatched path is a navigation error rather than a fallback
 * page". Measured, that meant a **blank page** — under 120 characters of text, no header, no way
 * back — for any stale bookmark or mistyped URL.
 *
 * It renders `nxs-error-state` at 404 rather than inventing its own empty page, so a not-found
 * route looks like every other not-found surface in the application.
 */
@Component({
  standalone: true,
  imports: [MatButtonModule, TranslatePipe, NxsErrorStateComponent],
  templateUrl: './not-found-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .not-found {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 2rem 1.5rem;
      }
    `,
  ],
})
export class NotFoundPageComponent {
  private readonly router = inject(Router);

  goToDashboard(): void {
    void this.router.navigateByUrl('/dashboard');
  }
}
