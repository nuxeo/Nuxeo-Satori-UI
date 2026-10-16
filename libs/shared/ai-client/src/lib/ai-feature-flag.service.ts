import { Injectable, Signal, signal } from '@angular/core';

const STORAGE_KEY = 'ai-features-enabled';
const MIGRATION_KEY = 'ai-features-default-enabled-v1';

/**
 * Every `AI.*` feature is switched OFF here, for all users, with no way to turn it back on
 * at runtime.
 *
 * The feature code is deliberately left in place — components, templates, gateway methods and
 * their tests are all untouched. This service is the single point that decides whether any of
 * it is reachable, so flipping `AI_FEATURES_ENABLED` back to `true` restores the previous
 * behaviour without touching a feature file.
 *
 * Three things have to hold for "off" to mean off, and each is load-bearing:
 *
 *   1. `aiEnabled` is a CONSTANT, not a read of `localStorage`. Browser storage is user-writable,
 *      so as long as the flag was derived from it, anyone could set `ai-features-enabled` to
 *      `true` in devtools and have the whole AI surface back on the next reload.
 *   2. `aiEnabled` is exposed as a read-only `Signal`, not the `WritableSignal` it used to be.
 *      A public `WritableSignal` is a `.set()` away from being flipped by anything holding the
 *      service, including a console session that reaches it through Angular's debug API.
 *   3. The stored keys are purged on construction, so a browser that opted in before this change
 *      does not keep a stale `true` on disk waiting to take effect if the flag is ever restored.
 *      Purging also means the user-visible state and the stored state cannot disagree.
 *
 * The Settings menu entry that used to call `toggle()` is commented out in
 * `app-shell.component.html` for the same reason: no UI path may contradict this.
 *
 * `AiGatewayService` refuses to issue a request while this is off, so a caller that forgets to
 * check the flag still cannot put AI traffic on the wire. That backstop is what makes "disabled"
 * true at the network layer and not just visually.
 */
const AI_FEATURES_ENABLED = false;

@Injectable({ providedIn: 'root' })
export class AiFeatureFlagService {
  private readonly state = signal<boolean>(AI_FEATURES_ENABLED);

  /**
   * Read-only on purpose — see point 2 above. Consumers only ever call it.
   */
  readonly aiEnabled: Signal<boolean> = this.state.asReadonly();

  constructor() {
    this.purgeStoredPreference();
  }

  /**
   * Retained so the previous call sites still compile, and inert while AI is off.
   *
   * Kept rather than deleted because restoring the feature should be a one-line change to
   * `AI_FEATURES_ENABLED`, not a re-implementation of the toggle. When the flag is off this
   * cannot enable anything; the argument is accepted and discarded.
   */
  setEnabled(value: boolean): void {
    if (!AI_FEATURES_ENABLED) return;
    this.state.set(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* localStorage unavailable */
    }
  }

  toggle(): void {
    if (!AI_FEATURES_ENABLED) return;
    this.setEnabled(!this.aiEnabled());
  }

  /**
   * Clears the opt-in a browser may already be carrying.
   *
   * Both keys go: `MIGRATION_KEY` as well as `STORAGE_KEY`. Leaving the migration marker behind
   * would mean that if AI is ever restored, the one-time "make AI visible again" migration would
   * be considered already done for these browsers and would not run for them.
   */
  private purgeStoredPreference(): void {
    if (AI_FEATURES_ENABLED) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(MIGRATION_KEY);
    } catch {
      // Safari private mode and sandboxed embeddings throw on storage access. Nothing to do:
      // the flag is a constant, so an unpurged key cannot enable anything anyway.
    }
  }
}
