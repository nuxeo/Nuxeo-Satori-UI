import { Injectable, computed, signal } from '@angular/core';

import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import type { ExtensionRuleContext } from './extension-rules';

/**
 * The live rule context, as signals.
 *
 * Rules need the focused document, the selection, the signed-in user and the
 * current URL. Those are owned by four different places in the shell, and a
 * slot consumer should not have to know any of them — it asks for
 * `context()` and re-resolves when it changes.
 *
 * The shell writes into this service; slot consumers only read. Keeping the
 * writes in one place is what stops the toolbar and the bulk bar disagreeing
 * about what is selected.
 */
@Injectable({ providedIn: 'root' })
export class ExtensionRuleContextService {
  readonly document = signal<NuxeoDocument | null>(null);
  readonly selection = signal<readonly NuxeoDocument[]>([]);
  readonly selectionCount = signal(0);
  readonly username = signal<string | null>(null);
  readonly isAdministrator = signal(false);
  readonly url = signal('');
  /**
   * Interface state published by whichever surface is in focus. See
   * {@link ExtensionRuleContext.flags}.
   *
   * The publishing surface owns the whole bag and must clear it on destroy, the
   * same contract `document` already has: a stale `favorite: true` left behind
   * by a closed document would gate the next surface's actions on it.
   */
  readonly flags = signal<Readonly<Record<string, boolean>>>({});

  readonly context = computed<ExtensionRuleContext>(() => ({
    document: this.document(),
    selection: this.selection(),
    selectionCount: this.selectionCount(),
    user: { username: this.username(), isAdministrator: this.isAdministrator() },
    url: this.url(),
    flags: this.flags(),
  }));
}
