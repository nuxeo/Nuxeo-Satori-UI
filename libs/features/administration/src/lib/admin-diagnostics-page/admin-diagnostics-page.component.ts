import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DOCUMENT } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsBannerComponent,
  NxsButtonComponent,
  NxsErrorStateComponent,
  NxsSpinnerComponent,
  NxsStatusTagComponent,
  nxsErrorStatus,
  type NxsErrorStatus,
  type NxsTagStatus,
} from '@nuxeo/satori-platform/components';

import {
  type DiagnosticsAppLayers,
  type DiagnosticsCheck,
  type DiagnosticsCheckId,
  type DiagnosticsMessage,
  type DiagnosticsPackage,
  type DiagnosticsReport,
  supportText,
} from './diagnostics-report';
import { DiagnosticsService } from './diagnostics.service';

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: NxsErrorStatus }
  | { readonly status: 'loaded'; readonly report: DiagnosticsReport };

/** How each check's state is shown: its tag's tone. */
const TONES: Readonly<Record<string, NxsTagStatus>> = {
  present: 'success',
  intact: 'success',
  absent: 'warning',
  replaced: 'important',
  on: 'info',
  off: 'neutral',
};

/** Each state's words. */
const STATUS_KEYS: Readonly<Record<string, string>> = {
  present: 'admin.diagnostics.status.present',
  absent: 'admin.diagnostics.status.absent',
  on: 'admin.diagnostics.status.on',
  off: 'admin.diagnostics.status.off',
  intact: 'admin.diagnostics.status.intact',
  replaced: 'admin.diagnostics.status.replaced',
};

/** Each check's name, and what it means for the apps. */
const CHECK_KEYS: Readonly<Record<DiagnosticsCheckId, { name: string; meaning: string }>> = {
  retention: {
    name: 'admin.diagnostics.check.retention',
    meaning: 'admin.diagnostics.check.retention-meaning',
  },
  'template-rendering': {
    name: 'admin.diagnostics.check.template-rendering',
    meaning: 'admin.diagnostics.check.template-rendering-meaning',
  },
  ai: { name: 'admin.diagnostics.check.ai', meaning: 'admin.diagnostics.check.ai-meaning' },
  'deployment-layer': {
    name: 'admin.diagnostics.check.deployment-layer',
    meaning: 'admin.diagnostics.check.deployment-layer-meaning',
  },
  'development-overrides': {
    name: 'admin.diagnostics.check.development-overrides',
    meaning: 'admin.diagnostics.check.development-overrides-meaning',
  },
  'operation-allow-list': {
    name: 'admin.diagnostics.check.operation-allow-list',
    meaning: 'admin.diagnostics.check.operation-allow-list-meaning',
  },
};

/** Why the package list could not be read whole. */
const PROBLEM_KEYS: Readonly<Record<string, string>> = {
  'no-directory': 'admin.diagnostics.packages.problem.no-directory',
  'no-list': 'admin.diagnostics.packages.problem.no-list',
  'list-too-large': 'admin.diagnostics.packages.problem.list-too-large',
  'list-unreadable': 'admin.diagnostics.packages.problem.list-unreadable',
  'id-skipped': 'admin.diagnostics.packages.problem.id-skipped',
  'too-many': 'admin.diagnostics.packages.problem.too-many',
  'descriptor-unreadable': 'admin.diagnostics.packages.problem.descriptor-unreadable',
};

/** Each package's role. */
const ROLE_KEYS: Readonly<Record<DiagnosticsPackage['role'], string>> = {
  app: 'admin.diagnostics.packages.role.app',
  kit: 'admin.diagnostics.packages.role.kit',
  'add-on': 'admin.diagnostics.packages.role.add-on',
};

/**
 * The diagnostics page, `/administration/diagnostics`: what an administrator, or support, needs to
 * know of this server's apps, read only.
 *
 * Its route is for full administrators, as `cloud-services` is, but that guard is for the menu: the
 * server answers the report to administrators alone, so anyone else who reaches the page sees the
 * server's refusal, 403, and nothing of the report.
 */
@Component({
  selector: 'lib-admin-diagnostics-page',
  standalone: true,
  imports: [
    TranslatePipe,
    NxsBannerComponent,
    NxsButtonComponent,
    NxsErrorStateComponent,
    NxsSpinnerComponent,
    NxsStatusTagComponent,
  ],
  templateUrl: './admin-diagnostics-page.component.html',
  styleUrl: './admin-diagnostics-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDiagnosticsPageComponent implements OnInit {
  private readonly diagnostics = inject(DiagnosticsService);
  private readonly translate = inject(TranslateService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = signal<State>({ status: 'loading' });

  /** What the copy button last did, said in a live region: `copied`, `failed`, or nothing yet. */
  readonly copyOutcome = signal<'copied' | 'failed' | null>(null);

  readonly report = computed(() => {
    const state = this.state();
    return state.status === 'loaded' ? state.report : null;
  });

  readonly support = computed(() => {
    const report = this.report();
    return report === null ? '' : supportText(report);
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.state.set({ status: 'loading' });
    this.copyOutcome.set(null);
    this.diagnostics
      .load()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => this.state.set({ status: 'loaded', report }),
        error: (error: unknown) =>
          this.state.set({ status: 'failed', error: nxsErrorStatus(error) }),
      });
  }

  readonly retry = (): void => this.load();

  messagesFor(app: DiagnosticsAppLayers): readonly DiagnosticsMessage[] {
    return this.report()?.diagnostics.filter((entry) => entry.app === app.id) ?? [];
  }

  tone(check: DiagnosticsCheck): NxsTagStatus {
    if (check.id === 'development-overrides' && check.status === 'on') return 'important';
    return TONES[check.status] ?? 'neutral';
  }

  /**
   * Copies the support text with the Clipboard API. Where it is refused or missing, the text stays
   * selected in its field, so that the person can copy it themselves, and the live region says so.
   */
  async copy(field: HTMLTextAreaElement): Promise<void> {
    const text = this.support();
    const clipboard = this.document.defaultView?.navigator?.clipboard;
    try {
      if (!clipboard) throw new Error('no clipboard');
      await clipboard.writeText(text);
      this.copyOutcome.set('copied');
    } catch {
      field.focus();
      field.select();
      this.copyOutcome.set('failed');
    }
  }

  /** The words for a check's state, in the person's language. */
  statusLabel(check: DiagnosticsCheck): string {
    return this.translate.instant(STATUS_KEYS[check.status] ?? 'admin.diagnostics.status.unknown');
  }

  checkName(check: DiagnosticsCheck): string {
    return CHECK_KEYS[check.id].name;
  }

  checkMeaning(check: DiagnosticsCheck): string {
    return CHECK_KEYS[check.id].meaning;
  }

  problemKey(problem: string): string {
    return PROBLEM_KEYS[problem] ?? 'admin.diagnostics.packages.problem.unknown';
  }

  roleKey(entry: DiagnosticsPackage): string {
    return ROLE_KEYS[entry.role];
  }

  /**
   * What the server says of a package's signature: `not-recorded` on Nuxeo LTS 2025, and anything
   * else, which this page does not know, as not known rather than as verified.
   */
  signatureKey(entry: DiagnosticsPackage): string {
    return entry.signature === 'not-recorded'
      ? 'admin.diagnostics.packages.signature-not-recorded'
      : 'admin.diagnostics.packages.signature-unknown';
  }
}
