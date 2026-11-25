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
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsBannerComponent,
  NxsConfirmDialogComponent,
  NxsSpinnerComponent,
  type NxsConfirmDialogData,
} from '@nuxeo/satori-platform/components';
import { type Observable, map, of, switchMap } from 'rxjs';

import {
  DeploymentLayerService,
  type LayerChange,
  type LayerReading,
} from './deployment-layer.service';
import {
  layerDifferences,
  type LayerAction,
  type LayerDifference,
  type LayerRefusal,
  type LayerState,
} from './layer-state';

/** Two versions of the file, compared: where the second differs from the first. */
export interface LayerComparison {
  /** The translation key that names the two. */
  readonly key: string;
  readonly differences: readonly LayerDifference[];
  readonly total: number;
}

/**
 * The app open's deployment layer for the file the designer has open: the package's, the live and
 * the draft versions side by side with their differences, and what may be done with them
 * (docs/business-apps/app-definition-v2.md, section 10, "The deployment layer").
 *
 * - **Save draft** sends the file as edited; **Submit for approval** puts the draft up; **Approve and
 *   publish** makes it live, for everyone in the app's groups; **Roll back** restores what was live
 *   before; **Discard draft** drops it. Each asks the server, which checks the person, the file and
 *   the approval itself, and answers with the file as it is then, or why not.
 * - **The buttons follow the server's answer** of what this person may do, and a button that may do
 *   nothing is turned off, not hidden, with the reason for Save draft and, in the server's words, for
 *   Approve and publish. That is not the control: the server refuses whatever is sent.
 * - **Approve, roll back and discard ask first**: the first two change the app for everyone.
 * - **Nothing is drawn as markup:** every version is shown as its JSON text.
 */
@Component({
  selector: 'lib-layer-panel',
  standalone: true,
  imports: [MatButtonModule, NxsBannerComponent, NxsSpinnerComponent, TranslatePipe],
  templateUrl: './layer-panel.html',
  styleUrl: './layer-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayerPanelComponent {
  private readonly service = inject(DeploymentLayerService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  /** The file's path below the app's root, `layouts/<Type>/<mode>.layout.json` or `queues/<id>.json`. */
  readonly path = input<string | null>(null);

  /** The file as the designer has it now, which Save draft sends. */
  readonly file = input<unknown>(null);

  /** Whether the designer's own check finds nothing in the file: the server checks again. */
  readonly saveable = input(false);

  /** A version to open in the designer: the draft's content, or the live one's. */
  readonly openVersion = output<unknown>();

  /** What the server last answered for the file. */
  readonly reading = signal<LayerReading>({ kind: 'reading' });

  /** The server's last refusal of a change, shown until the next change or file. */
  readonly refusal = signal<LayerRefusal | null>(null);

  /** The change the server last made, announced. */
  readonly done = signal<LayerAction | null>(null);

  /** Whether a change is on its way to the server. */
  readonly busy = signal(false);

  readonly state = computed<LayerState | null>(() => {
    const reading = this.reading();
    return reading.kind === 'state' ? reading.state : null;
  });

  readonly canSave = computed(
    () =>
      !this.busy() &&
      this.state()?.permissions.write === true &&
      this.saveable() &&
      this.file() !== null,
  );

  readonly canSubmit = computed(() => {
    const state = this.state();
    return (
      !this.busy() && state?.permissions.write === true && !!state.draft && !state.draft.submittedBy
    );
  });

  readonly canApprove = computed(() => !this.busy() && this.state()?.permissions.approve === true);

  /**
   * A rollback undoes the last change to what is live: something live to take out, or a version
   * the package's file was put back over.
   */
  readonly canRollBack = computed(() => {
    const state = this.state();
    return (
      !this.busy() &&
      state?.permissions.write === true &&
      (state.live !== null || state.previous > 0)
    );
  });

  readonly canDiscard = computed(() => {
    const state = this.state();
    return !this.busy() && state?.permissions.write === true && state.draft !== null;
  });

  /** Package to live, live (or the package) to draft, and the newest of them to the file as edited. */
  readonly comparisons = computed<readonly LayerComparison[]>(() => {
    const state = this.state();
    if (!state) return [];
    const packaged = state.package?.content;
    const compared: LayerComparison[] = [];
    if (state.live)
      compared.push(this.compare('layout-designer.layer.diff-live', packaged, state.live.content));
    if (state.draft)
      compared.push(
        this.compare(
          state.live
            ? 'layout-designer.layer.diff-draft'
            : 'layout-designer.layer.diff-draft-package',
          state.live ? state.live.content : packaged,
          state.draft.content,
        ),
      );
    const newest = state.draft?.content ?? state.live?.content ?? packaged;
    if (this.file() !== null)
      compared.push(this.compare('layout-designer.layer.diff-edited', newest, this.file()));
    return compared;
  });

  constructor() {
    toObservable(this.path)
      .pipe(
        switchMap((path) =>
          path
            ? this.service.state(path)
            : of<LayerReading>({ kind: 'unavailable', reason: 'no-app' }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((reading) => {
        this.reading.set(reading);
        if (reading.kind !== 'state') return;
        this.refusal.set(null);
        this.done.set(null);
      });
  }

  /** A version as JSON text, two spaces deep, as the download writes it. */
  json(content: unknown): string {
    return content === undefined ? '' : JSON.stringify(content, null, 2);
  }

  save(): void {
    const state = this.state();
    if (!state || !this.canSave()) return;
    this.send({ action: 'save', revision: state.revision, content: this.file() });
  }

  submit(): void {
    const state = this.state();
    if (!state || !this.canSubmit()) return;
    this.send({ action: 'submit', revision: state.revision });
  }

  approve(): void {
    const state = this.state();
    if (!state || !this.canApprove()) return;
    this.confirm('approve').subscribe((agreed) => {
      if (agreed) this.send({ action: 'approve', revision: state.revision });
    });
  }

  rollBack(): void {
    const state = this.state();
    if (!state || !this.canRollBack()) return;
    this.confirm('rollback').subscribe((agreed) => {
      if (agreed) this.send({ action: 'rollback', revision: state.revision });
    });
  }

  discard(): void {
    const state = this.state();
    if (!state || !this.canDiscard()) return;
    this.confirm('discard').subscribe((agreed) => {
      if (agreed) this.send({ action: 'discard', revision: state.revision });
    });
  }

  /** Opens the draft in the designer, or the live version when there is no draft. */
  openNewest(): void {
    const state = this.state();
    const content = state?.draft?.content ?? state?.live?.content;
    if (content !== undefined) this.openVersion.emit(structuredClone(content));
  }

  private compare(key: string, before: unknown, after: unknown): LayerComparison {
    const { differences, total } = layerDifferences(before, after);
    return { key, differences, total };
  }

  private confirm(action: 'approve' | 'rollback' | 'discard'): Observable<boolean> {
    const data: NxsConfirmDialogData = {
      title: this.translate.instant(`layout-designer.layer.confirm-${action}-title`),
      message: this.translate.instant(`layout-designer.layer.confirm-${action}-message`, {
        path: this.path() ?? '',
      }),
      confirmLabel: this.translate.instant(`layout-designer.layer.${action}`),
    };
    return this.dialog
      .open(NxsConfirmDialogComponent, { data })
      .afterClosed()
      .pipe(
        map((agreed) => agreed === true),
        takeUntilDestroyed(this.destroyRef),
      );
  }

  private send(change: LayerChange): void {
    const path = this.path();
    if (!path) return;
    this.busy.set(true);
    this.refusal.set(null);
    this.done.set(null);
    this.service
      .act(path, change)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((reading) => {
        this.busy.set(false);
        if (reading.kind === 'refused') {
          this.refusal.set(reading.refusal);
          if (reading.refusal.state)
            this.reading.set({ kind: 'state', state: reading.refusal.state });
          return;
        }
        this.reading.set(reading);
        if (reading.kind === 'state') this.done.set(change.action);
      });
  }
}
