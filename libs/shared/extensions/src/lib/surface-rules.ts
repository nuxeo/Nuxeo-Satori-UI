import { documentTypeIsOneOf } from './document-rules';
import type { ExtensionRuleEvaluator } from './extension-rules';

/**
 * Rules over `ExtensionRuleContext.flags` — the interface state a surface
 * publishes about itself.
 *
 * These exist so a **toggle** is two descriptors rather than one descriptor with
 * a host-rewritten label. `app.toolbar.addToFavorites` and
 * `app.toolbar.removeFromFavorites` are separate ids gated by opposite rules, so
 * a customer can hide, reorder or relabel either half independently, and the
 * label a manifest sets is the label that renders. A single descriptor whose
 * label the component swapped at runtime would silently discard that override.
 *
 * Only the positive form of each is registered: the negative half is
 * `{ type: 'core.not', parameters: ['app.rules.isFavorite'] }`, which is an
 * ordinary composite a manifest can write too.
 *
 * As with every rule here, this decides what the interface offers and nothing
 * else. Nuxeo evaluates the real permission server-side on every operation.
 */
export const SURFACE_RULE_EVALUATORS: Readonly<Record<string, ExtensionRuleEvaluator>> = {
  'app.rules.isFavorite': (context) => context.flags['favorite'] === true,
  'app.rules.isLocked': (context) => context.flags['locked'] === true,
  'app.rules.isSubscribed': (context) => context.flags['subscribed'] === true,
  'app.rules.isInClipboard': (context) => context.flags['inClipboard'] === true,
  /** The focused document has at least one version, which is what publishing needs. */
  'app.rules.hasVersion': (context) => context.flags['hasVersion'] === true,
  /** The AI feature flag, so the AI tab is gateable from a manifest as well as from config. */
  'app.rules.isAiEnabled': (context) => context.flags['aiEnabled'] === true,
  /**
   * The focused document is a Note.
   *
   * A Note's body is edited inline in the View tab, so the toolbar's pencil
   * reaches only its metadata — which is why it is labelled "Edit properties"
   * there and plain "Edit" everywhere else. That is the same shape as the
   * favourite and subscription toggles: two descriptors gated by opposite
   * rules, so a customer relabelling one does not silently lose the other.
   *
   * The one rule in this map that reads the document rather than a flag: it is
   * exactly `app.rules.isType` with `["Note"]`. It read a `note` flag the page
   * derived from that same document, which `ExtensionRuleContext.flags` exists
   * to exclude. It stays in this map so that code registering either map on
   * its own still gets the ids it always did.
   */
  'app.rules.isNote': (context) => documentTypeIsOneOf(context.document, ['Note']),
  /**
   * No named operation is in flight — the `enabledRule` behind every control
   * that used to carry `[disabled]="actionInProgress() === 'trash'"`.
   *
   * Parameterised rather than one id per operation because the operation name is
   * data, not a contract: `{ type: 'app.rules.isNotBusy', parameters: ['trash'] }`.
   * With no parameters it is vacuously true, matching `core.every`'s identity.
   */
  'app.rules.isNotBusy': (context, parameters) =>
    !parameters.some(
      (parameter) => typeof parameter === 'string' && context.flags[`busy.${parameter}`] === true,
    ),
};
