import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';

import { BrowseService } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

/**
 * Resolves the current user's personal workspace and opens it in browse view,
 * matching Nuxeo Web UI (`User.GetUserWorkspace` + `navigateTo('browse', path)`).
 */
@Component({
  standalone: true,
  imports: [TranslatePipe, MatProgressSpinnerModule, MatButtonModule],
  templateUrl: './personal-space-page.component.html',
  styleUrl: './personal-space-page.component.scss',
})
export class PersonalSpacePageComponent {
  private readonly browseService = inject(BrowseService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    this.loadPersonalWorkspace();
  }

  retry(): void {
    this.loadPersonalWorkspace();
  }

  private loadPersonalWorkspace(): void {
    this.loading.set(true);
    this.error.set(null);

    this.browseService
      .getUserWorkspace()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (workspace) => {
          void this.router.navigateByUrl(`/browse${workspace.path}`, { replaceUrl: true });
        },
        error: () => {
          this.error.set(
            this.translate.instant('app.message.unable-to-load-your-personal-workspace'),
          );
          this.loading.set(false);
        },
      });
  }
}
