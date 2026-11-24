import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  type ConnectedPosition,
} from '@angular/cdk/overlay';
import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  LOCALE_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CURRENT_USERNAME } from '@nuxeo/satori-platform/nuxeo-client';
import { lifecycleLabel } from '@nuxeo/satori-platform/ui';
import { merge } from 'rxjs';

import type { ChangeNotification, NotificationItem, TaskNotification } from '../notification.model';
import { NotificationCenter } from '../notification-center';
import { NOTIFICATION_TIME_ZONE } from '../notification-settings';
import { instant } from '../notification-sources';

/** One item as the panel shows it. */
interface Shown<T extends NotificationItem> {
  readonly item: T;
  /** What happened, written out. */
  readonly what: string;
  /** When, in the reader's own zone. */
  readonly when: string;
  readonly isNew: boolean;
}

/** The badge shows at most this; the accessible name says the number. */
const BADGE_MAX = 99;

let nextId = 0;

/**
 * The notification centre's bell, for the shell's header: a button with the number of unread
 * items, which opens a panel listing the signed-in user's open tasks and the recent changes other
 * people made to the records they follow. Each item says when it happened, in the reader's zone,
 * and opens its task or its record.
 *
 * The button's accessible name carries the count. The panel is a dialog that takes the focus when
 * it opens, keeps it while it is open, and gives it back to the bell when it is closed with Escape
 * or its close button; a click outside closes it too.
 *
 * Read state stays in this browser (`NotificationReadState`): opening the panel marks what it shows
 * as seen, and closing it, or "Mark all as read", marks what arrived while it was open as well.
 */
@Component({
  selector: 'lib-notification-bell',
  standalone: true,
  imports: [
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    CdkTrapFocus,
    MatButton,
    MatIcon,
    MatIconButton,
    RouterLink,
    TranslatePipe,
  ],
  providers: [NotificationCenter],
  templateUrl: './notification-bell.html',
  styleUrl: './notification-bell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBellComponent {
  protected readonly center = inject(NotificationCenter);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly timeZone = inject(NOTIFICATION_TIME_ZONE);

  private readonly injector = inject(Injector);
  // `read: ElementRef`: on a `mat-icon-button` the reference is otherwise the Material component.
  private readonly bell = viewChild.required<string, ElementRef<HTMLButtonElement>>('bell', {
    read: ElementRef,
  });
  private readonly dialog = viewChild<string, ElementRef<HTMLElement>>('dialog', {
    read: ElementRef,
  });

  protected readonly panelId = `lib-notification-panel-${nextId++}`;
  protected readonly headingId = `${this.panelId}-heading`;
  protected readonly open = signal(false);

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];

  /** Bumped when the language or a catalogue changes, so text resolved with `instant` follows. */
  private readonly translations = signal(0);

  protected readonly unread = this.center.unread;
  protected readonly badge = computed(() => {
    const count = this.unread();
    return count > BADGE_MAX ? `${BADGE_MAX}+` : String(count);
  });

  protected readonly tasks = computed((): readonly Shown<TaskNotification>[] => {
    this.translations();
    return this.center.tasks().map((item) => ({
      item,
      what: item.record
        ? this.translate.instant('notifications.task.on-record', { record: item.record })
        : '',
      when: this.when(item.at),
      isNew: this.center.isNew(item),
    }));
  });

  protected readonly changes = computed((): readonly Shown<ChangeNotification>[] => {
    this.translations();
    return this.center.changes().map((item) => ({
      item,
      what: this.whatHappened(item),
      when: this.when(item.at),
      isNew: this.center.isNew(item),
    }));
  });

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));
    // The user the bell checks for is the one signed in: another user, or none, starts it again.
    const currentUser = inject(CURRENT_USERNAME);
    effect(() => {
      currentUser();
      untracked(() => {
        this.close(false);
        this.center.start();
      });
    });
  }

  protected toggle(): void {
    if (this.open()) {
      this.close(true);
      return;
    }
    this.open.set(true);
    this.center.opened();
    // The dialog itself takes the focus, so that its name is read first and Tab goes on to its
    // items. Asked for directly: the focus trap's own first focus skips what it judges invisible.
    afterNextRender(() => this.dialog()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Closes the panel; `refocus` gives the focus back to the bell. */
  protected close(refocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    this.center.closed();
    if (refocus) this.bell().nativeElement.focus();
  }

  /** A click outside the panel. A click on the bell is the bell's own, which toggles. */
  protected outsideClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Node && this.bell().nativeElement.contains(target)) return;
    this.close(false);
  }

  protected markAllRead(): void {
    this.center.markAllRead();
  }

  private when(at: string): string {
    const time = instant(at);
    return time === 0 ? at : formatDate(time, 'medium', this.locale, this.timeZone);
  }

  /** Who did what: "Modified by jsmith", "State changed to Approved by jsmith". */
  private whatHappened(item: ChangeNotification): string {
    const who = item.who;
    switch (item.event) {
      case 'documentModified':
        return this.translate.instant('notifications.change.modified', { who });
      case 'lifecycle_transition_event':
        return item.state
          ? this.translate.instant('notifications.change.transition', {
              who,
              state: lifecycleLabel('state', item.state, (key) => this.translate.instant(key)),
            })
          : this.translate.instant('notifications.change.transition-unknown', { who });
    }
  }
}
