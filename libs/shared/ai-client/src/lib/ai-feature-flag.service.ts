import { Injectable, Signal, computed, signal } from '@angular/core';

const STORAGE_KEY = 'ai-features-enabled';
const MIGRATION_KEY = 'ai-features-default-enabled-v1';

/**
 * Every `AI.*` feature is switched OFF here, for all users, with no way to turn it back on
 * at runtime.
 *
 * The feature code is deliberately left in place — components, templates, gateway methods and
 * their tests are all untouched. This service is the single point that decides whether any of
 * it is reachable, so flipping this to `true` and restoring the commented-out Settings entry in
 * `app-shell.component.html` is the whole of re-enabling, with the original opt-out semantics
 * intact.
 *
 * Three things have to hold for "off" to mean off, and each is load-bearing:
 *
 *   1. `aiEnabled` does not read `localStorage` while AI is off. Browser storage is
 *      user-writable, so as long as the flag was derived from it, anyone could set
 *      `ai-features-enabled` to `true` in devtools and have the whole AI surface back on the
 *      next reload.
 *   2. While AI is off, `aiEnabled` is {@link ALWAYS_OFF} — a module-level `computed` over
 *      nothing. It is not a view onto an instance field, because `private` is a compile-time
 *      fiction: a console session holding the service can call `service.state.set(true)`, and
 *      a read-only *view* of that field would faithfully report `true`. Nothing writable backs
 *      the signal consumers actually read, so there is no field to reach for.
 *   3. The stored keys are purged on construction, so a browser that opted in before this change
 *      does not keep a stale `true` on disk waiting to take effect if the flag is ever restored.
 *      Purging also means the user-visible state and the stored state cannot disagree.
 *
 * `AiGatewayService` refuses to issue a request while this is off, so a caller that forgets to
 * check the flag still cannot put AI traffic on the wire. That backstop is what makes "disabled"
 * true at the network layer and not just visually.
 */
const AI_FEATURES_ENABLED = false;

/**
 * The flag consumers read while AI is off.
 *
 * Module-level and derived from a constant, so there is no per-instance writable signal behind
 * it — see point 2 above. `computed` rather than `signal(false).asReadonly()` for exactly that
 * reason: the latter would leave a writable signal in a module closure.
 */
const ALWAYS_OFF: Signal<boolean> = computed(() => false);

/**
 * The user's persisted choice, honoured only while AI is enabled.
 *
 * Module-level so it stays testable while the feature is off — it is the half of the re-enable
 * path that no running code exercises, and therefore the half most likely to rot unnoticed.
 */
export function readStoredAiPreference(): boolean {
  try {
    const migrated = localStorage.getItem(MIGRATION_KEY) === 'true';
    const stored = localStorage.getItem(STORAGE_KEY);

    if (!migrated) {
      // Product decision for the PoC: make AI visible after upgrade even for old local opt-outs.
      // User choices made after this migration are preserved by the migration marker.
      localStorage.setItem(MIGRATION_KEY, 'true');
      localStorage.setItem(STORAGE_KEY, 'true');
      return true;
    }

    return stored === null ? true : stored === 'true';
  } catch {
    // If storage is unavailable, keep the PoC default-on for the current session.
    return true;
  }
}

@Injectable({ providedIn: 'root' })
export class AiFeatureFlagService {
  /**
   * Backs `aiEnabled` only while AI is enabled, and reads the persisted opt-out when it does —
   * otherwise restoring the feature would silently ignore every user who had turned it off.
   */
  private readonly state = signal<boolean>(AI_FEATURES_ENABLED ? readStoredAiPreference() : false);

  /**
   * Declared without an initialiser and installed in the constructor so it can be made
   * non-writable and non-configurable.
   *
   * `readonly` is erased at runtime just as `private` is, so a field initialiser would leave
   * `service.aiEnabled = () => true` available at a console — replacing the flag wholesale
   * rather than mutating anything behind it, after which the gateway permits requests. Sealing
   * the property closes that, and because modules are strict mode the assignment now throws
   * rather than failing quietly.
   */
  declare readonly aiEnabled: Signal<boolean>;

  constructor() {
    Object.defineProperty(this, 'aiEnabled', {
      value: AI_FEATURES_ENABLED ? this.state.asReadonly() : ALWAYS_OFF,
      writable: false,
      configurable: false,
      enumerable: true,
    });
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
      // nothing writable backs `aiEnabled`, so an unpurged key cannot enable anything anyway.
    }
  }
}
