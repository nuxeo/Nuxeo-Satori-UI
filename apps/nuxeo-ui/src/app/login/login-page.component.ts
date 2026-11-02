import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { MatButtonModule } from '@angular/material/button';

import { MatFormFieldModule } from '@angular/material/form-field';

import { MatInputModule } from '@angular/material/input';

import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { SatLogoModule } from '@hylandsoftware/satori-ui/logo';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';

import type { NuxeoSamlLoginEndpoint } from '@nuxeo/satori-platform/nuxeo-client';

import { observeStripRedundantMatInputAriaRequired } from '@nuxeo/satori-platform/ui';

import { AuthService, SignInError } from '../auth/auth.service';

import { BrandLogoFallbackDirective } from '../config/brand-logo-fallback.directive';

const LAST_USER_KEY = 'agentic_ui_last_username';

@Component({
  selector: 'app-login-page',

  imports: [
    TranslatePipe,

    RouterLink,

    ReactiveFormsModule,

    MatButtonModule,

    MatFormFieldModule,

    MatInputModule,

    MatProgressSpinnerModule,

    MatSnackBarModule,

    TranslatePipe,

    SatLogoModule,

    BrandLogoFallbackDirective,
  ],

  templateUrl: './login-page.component.html',

  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './login-page.component.scss',
})
export class LoginPageComponent implements AfterViewInit, OnDestroy {
  private readonly fb = inject(FormBuilder);

  private readonly translate = inject(TranslateService);

  private readonly auth = inject(AuthService);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  private readonly snackBar = inject(MatSnackBar);

  private readonly host = inject(ElementRef<HTMLElement>);

  private readonly cdr = inject(ChangeDetectorRef);

  private readonly appConfig = inject(AppConfigService);

  /** Layer 0 `branding.logo`; `null` keeps the Satori lockup. */
  protected readonly brandLogo = this.appConfig.brandingLogo;

  /** Accessible name of the brand link when a logo replaces the lockup. */
  protected readonly brandLabel = computed(
    () => this.brandLogo()?.alt || this.appConfig.bootstrap().branding.applicationTitle,
  );

  private readonly autofillSyncTimeouts: ReturnType<typeof setTimeout>[] = [];

  private usernameAriaRequiredObserver: MutationObserver | null = null;

  private passwordAriaRequiredObserver: MutationObserver | null = null;

  readonly submitting = signal(false);

  /** SSO entry points from `nuxeo-sso.providers.ts` / app config. */

  readonly samlEndpoints = this.auth.samlLoginOptions;

  readonly form = this.fb.nonNullable.group({
    username: [
      typeof localStorage !== 'undefined' ? (localStorage.getItem(LAST_USER_KEY) ?? '') : '',

      Validators.required,
    ],

    password: ['', Validators.required],
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      if (params.get('reason') === 'session-expired') {
        this.snackBar.open(
          this.translate.instant('app.message.your-session-has-expired-please-sign-in'),

          this.translate.instant('common.dismiss'),

          {
            duration: 8000,
          },
        );
      }
    });
  }

  ngAfterViewInit(): void {
    // Password managers often autofill after first paint without updating reactive form state.

    this.scheduleAutofillSync();

    this.watchUsernameRequiredAccessibility();

    this.watchPasswordRequiredAccessibility();
  }

  /**

   * `withHashLocation()` treats `#login-main` as the router URL; focus the first sign-in

   * control without changing the hash (WCAG 2.4.1 skip navigation).

   */

  skipToSignIn(event: MouseEvent): void {
    event.preventDefault();

    const usernameInput = this.host.nativeElement.querySelector(
      'input[formcontrolname="username"]',
    ) as HTMLInputElement | null;

    usernameInput?.focus();
  }

  ngOnDestroy(): void {
    this.usernameAriaRequiredObserver?.disconnect();

    this.usernameAriaRequiredObserver = null;

    this.passwordAriaRequiredObserver?.disconnect();

    this.passwordAriaRequiredObserver = null;

    for (const timeoutId of this.autofillSyncTimeouts) {
      clearTimeout(timeoutId);
    }
  }

  /** NXENG-753: keep native required, drop MatInput's duplicate aria-required on username. */

  private watchUsernameRequiredAccessibility(): void {
    this.usernameAriaRequiredObserver?.disconnect();

    this.usernameAriaRequiredObserver = observeStripRedundantMatInputAriaRequired(
      this.getCredentialInputs().usernameInput,
    );
  }

  /** NXENG-755: keep native required, drop MatInput's duplicate aria-required on password. */

  private watchPasswordRequiredAccessibility(): void {
    this.passwordAriaRequiredObserver?.disconnect();

    this.passwordAriaRequiredObserver = observeStripRedundantMatInputAriaRequired(
      this.getCredentialInputs().passwordInput,
    );
  }

  private scheduleAutofillSync(): void {
    for (const delayMs of [0, 100, 300, 800, 1500]) {
      const timeoutId = setTimeout(() => {
        this.syncAutofillFromDom();

        this.cdr.markForCheck();
      }, delayMs);

      this.autofillSyncTimeouts.push(timeoutId);
    }
  }

  /** Keeps reactive form values aligned when the browser autofills credentials. */

  onCredentialInput(): void {
    this.syncAutofillFromDom();

    this.cdr.markForCheck();
  }

  onAutofillAnimation(event: AnimationEvent): void {
    if (event.animationName.endsWith('login-autofill-start')) {
      this.syncAutofillFromDom();

      this.cdr.markForCheck();
    }
  }

  private getCredentialInputs(): {
    usernameInput: HTMLInputElement | null;

    passwordInput: HTMLInputElement | null;
  } {
    return {
      usernameInput: this.host.nativeElement.querySelector(
        'input[formcontrolname="username"]',
      ) as HTMLInputElement | null,

      passwordInput: this.host.nativeElement.querySelector(
        'input[formcontrolname="password"]',
      ) as HTMLInputElement | null,
    };
  }

  /** Browsers may paint autofill without exposing input.value to JavaScript yet. */

  private isBrowserAutofilled(input: HTMLInputElement): boolean {
    try {
      return input.matches(':-webkit-autofill') || input.matches(':autofill');
    } catch {
      return false;
    }
  }

  private syncAutofillFromDom(): void {
    const { usernameInput, passwordInput } = this.getCredentialInputs();

    if (!usernameInput || !passwordInput) {
      return;
    }

    const username = usernameInput.value.trim();

    const password = passwordInput.value;

    if (username && username !== this.form.controls.username.value) {
      this.form.controls.username.setValue(username);
    }

    if (password && password !== this.form.controls.password.value) {
      this.form.controls.password.setValue(password);
    }
  }

  /**
   * Right-panel art from `apps/nuxeo-ui/public/images/Login-background.svg`. Relative, so it
   * resolves against `<base href>`: the Marketplace package serves the app from
   * `/nuxeo/agentic-ui/`, where a root-absolute path 404s.
   */
  protected readonly heroImagePath = 'images/Login-background.svg';

  submit(): void {
    this.syncAutofillFromDom();

    const { username, password } = this.readCredentials();

    this.form.controls.username.setValue(username);

    this.form.controls.password.setValue(password);

    if (!username || !password || this.submitting()) {
      this.form.markAllAsTouched();

      return;
    }

    this.submitting.set(true);

    localStorage.setItem(LAST_USER_KEY, username);

    // Web UI uses a server cookie session; do not persist credentials in localStorage.

    this.auth.login(username, password, false).subscribe({
      next: () => {
        this.submitting.set(false);

        void this.router.navigateByUrl('/dashboard');
      },

      error: (err: Error) => {
        this.submitting.set(false);

        const message =
          err instanceof SignInError ? this.translate.instant(err.messageKey) : err.message;
        this.snackBar.open(message, this.translate.instant('common.dismiss'), {
          duration: 6000,
        });
      },
    });
  }

  startSamlLogin(endpoint: NuxeoSamlLoginEndpoint): void {
    this.auth.startSamlLogin(endpoint);
  }

  submitDisabled(): boolean {
    if (this.submitting()) {
      return true;
    }

    return !this.hasValidCredentials();
  }

  private hasValidCredentials(): boolean {
    const { username, password } = this.readCredentials();

    if (!username) {
      return false;
    }

    if (password) {
      return true;
    }

    const { passwordInput } = this.getCredentialInputs();

    return passwordInput !== null && this.isBrowserAutofilled(passwordInput);
  }

  private readCredentials(): { username: string; password: string } {
    const fromForm = this.form.getRawValue();

    const { usernameInput, passwordInput } = this.getCredentialInputs();

    return {
      username: (fromForm.username || usernameInput?.value || '').trim(),

      password: fromForm.password || passwordInput?.value || '',
    };
  }
}
