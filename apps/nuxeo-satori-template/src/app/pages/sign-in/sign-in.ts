import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';

import { TemplateSessionService } from '../../template-session.service';

/**
 * Sign in to Nuxeo.
 *
 * The shell renders this instead of the router outlet while there is no session,
 * so no page has to defend itself against an unauthenticated request. A fork on
 * SSO deletes this component and redirects instead — nothing in
 * `@nuxeo/satori-platform` knows it exists.
 *
 * The credential is never a default, a placeholder or a compiled-in value: it is
 * typed by the person signing in and handed straight to
 * `TemplateSessionService`.
 */
@Component({
  selector: 'app-sign-in',
  standalone: true,
  templateUrl: './sign-in.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './sign-in.scss',
})
export class SignInComponent {
  private readonly session = inject(TemplateSessionService);
  private readonly config = inject(AppConfigService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly applicationTitle = () => this.config.bootstrap().branding.applicationTitle;

  protected onUsername(event: Event): void {
    this.username.set((event.target as HTMLInputElement).value);
  }

  protected onPassword(event: Event): void {
    this.password.set((event.target as HTMLInputElement).value);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.pending()) return;
    this.error.set(null);
    this.pending.set(true);

    this.session
      .signIn(this.username().trim(), this.password())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.pending.set(false),
        error: (error: unknown) => {
          this.pending.set(false);
          this.error.set(describeSignInFailure(error));
        },
      });
  }
}

/**
 * Distinguish the three failures that look identical to a user but need
 * different action: wrong credential, no server, and everything else.
 */
function describeSignInFailure(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return 'Nuxeo rejected that username and password.';
    if (error.status === 0) {
      return 'Could not reach Nuxeo. Check that the server is running and that this application is served through its proxy.';
    }
    return `Nuxeo answered HTTP ${error.status}.`;
  }
  return 'Sign-in failed.';
}
