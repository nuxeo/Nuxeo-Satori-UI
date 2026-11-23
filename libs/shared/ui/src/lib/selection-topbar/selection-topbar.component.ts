import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  AppExtensionsService,
  DescriptorLabelPipe,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionRuleContextService,
  type ExtensionActionDescriptor,
} from '@nuxeo/satori-platform/extensions';
import { TranslatePipe } from '@ngx-translate/core';
import { NxsThumbnailComponent, provideNxsThumbnailCache } from '@nuxeo/satori-platform/components';

@Component({
  selector: 'lib-selection-topbar',
  standalone: true,
  imports: [
    DescriptorLabelPipe,
    NxsThumbnailComponent,
    TranslatePipe,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  providers: [provideNxsThumbnailCache()],
  templateUrl: './selection-topbar.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './selection-topbar.component.scss',
})
export class SelectionTopbarComponent {
  @ViewChild('selectionPopupPanel')
  private selectionPopupPanel?: ElementRef<HTMLElement>;

  private lastFocusedElement: HTMLElement | null = null;

  readonly selectedCount = input.required<number>();
  /**
   * The selected documents. The popup draws each preview itself from `id`, so a `preview` URL
   * whose owner has since revoked it cannot break the popup; the field is kept for existing callers.
   */
  readonly selectedItems = input<
    Array<{ id: string; name: string; preview: SafeUrl | string | null }>
  >([]);
  /** Collapses the bar to its label and Clear button — no bulk actions, no popup. */
  readonly clearOnly = input(false);
  /**
   * The bulk actions to offer, by id, or `null`, the default, for every one the slot resolves.
   * Given a list, the bar offers those of it that the slot resolves and that have a handler, in
   * the slot's order, as a queue offers its row actions: one with nothing to run it would do
   * nothing when chosen.
   */
  readonly offered = input<readonly string[] | null>(null);
  /** Chrome, not an action: clearing the selection dismisses the bar itself. */
  readonly cleared = output<void>();
  readonly selectionPopupOpen = signal(false);

  private readonly closePopupInClearOnlyMode = effect(() => {
    if (this.clearOnly()) {
      this.selectionPopupOpen.set(false);
    }
  });

  private readonly extensions = inject(AppExtensionsService);
  private readonly actions = inject(ExtensionActionRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);

  /**
   * The bulk actions to offer, resolved from the registry.
   *
   * There is no `@Output()` per action any more. Each of the six used to be a
   * fixed button here, a named output, and a handler threaded through the app
   * shell — three files across two projects to add one action. A registration
   * now does it, and the shell owns the behaviour as an action service.
   */
  readonly bulkActions = computed(() => {
    const resolved = this.extensions.resolve<ExtensionActionDescriptor>(
      EXTENSION_SLOTS['bulk-actions'],
      this.ruleContext.context(),
    );
    const offered = this.offered();
    if (offered === null) return resolved;
    const listed = new Set(offered);
    return resolved.filter(
      (action) => listed.has(action.id) && this.actions.has(action.action ?? action.id),
    );
  });

  /** `enabledRule` renders the control disabled rather than hiding it. */
  isEnabled(action: ExtensionActionDescriptor): boolean {
    return this.extensions.evaluateRule(action.enabledRule, this.ruleContext.context());
  }

  run(action: ExtensionActionDescriptor): void {
    this.actions.execute(action, this.ruleContext.context());
  }

  openSelectionPopup(): void {
    this.lastFocusedElement = document.activeElement as HTMLElement | null;
    this.selectionPopupOpen.set(true);
    queueMicrotask(() => {
      this.selectionPopupPanel?.nativeElement.focus();
    });
  }

  closeSelectionPopup(): void {
    this.selectionPopupOpen.set(false);
    const elementToFocus = this.lastFocusedElement;
    this.lastFocusedElement = null;
    if (elementToFocus) {
      queueMicrotask(() => elementToFocus.focus());
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.selectionPopupOpen()) {
      this.closeSelectionPopup();
    }
  }
}
