import { Injectable } from '@angular/core';

import type { ExtensionRuleContext } from '@nuxeo/satori-platform/extensions';

/**
 * The logic behind this library's rule and action.
 *
 * A plain injectable, on purpose: a Layer 2 contribution is ordinary Angular
 * code with ordinary dependencies, not a restricted expression language. Inject
 * an `HttpClient` here, or your own service, and the rule can consult anything.
 */
@Injectable({ providedIn: 'root' })
export class AcmeRulesService {
  /**
   * Whether this library's surfaces should be offered.
   *
   * Reads the supplied context rather than global state, so the same rule answers
   * correctly for a toolbar over a focused document and for a bulk bar over a
   * selection. Replace the body with your own condition.
   */
  canUse(context: ExtensionRuleContext): boolean {
    return context.user.username !== null;
  }

  /**
   * What `acme.actions.acmeExtensionsExport` does.
   *
   * Receives the same context the rules see. Returning nothing is fine; throwing
   * is not — an action that throws surfaces as an unhandled error in the shell.
   */
  exportSummary(context: ExtensionRuleContext): void {
    // `warn`, not `info`, and not arbitrarily: this is a generated placeholder,
    // so "you have not implemented this yet" is genuinely a warning. It is also
    // the level the workspace lint rule allows, which keeps a freshly generated
    // library warning-clean. Replace the whole body.
    console.warn('[acme] exportSummary is not implemented yet', {
      url: context.url,
      selectionCount: context.selectionCount,
      document: context.document?.uid ?? null,
    });
  }

  /**
   * `acme.rules.isLegalTeam`
   *
   * Reads the supplied context rather than global state, so the same rule answers
   * correctly for a toolbar over one document and a bulk bar over a selection.
   *
   * Replace the body. Returning `true` unconditionally makes the rule pointless;
   * returning `false` unconditionally makes the surface unreachable — and neither
   * shows up as a failure, so a spec asserting a *specific* answer is what catches it.
   *
   * This is a UI affordance, not a permission. Nuxeo decides what the server allows.
   */
  isLegalTeam(context: ExtensionRuleContext): boolean {
    return context.user.username !== null;
  }

  /**
   * `acme.actions.exportClaim`
   *
   * Receives the same context the rules see — the focused document, the selection,
   * the current URL, the signed-in user.
   *
   * Returning nothing is fine; **throwing is not**. An action that throws surfaces
   * as an unhandled error in the host's shell, and the host has no way to attribute
   * it to this library. Catch, and report through your own channel.
   */
  exportClaim(context: ExtensionRuleContext): void {
    // `warn`, not `info`: this is an unimplemented placeholder, which is genuinely
    // a warning, and it is the level the workspace lint rule allows.
    console.warn('[acme] exportClaim is not implemented yet', {
      url: context.url,
      selectionCount: context.selectionCount,
      document: context.document?.uid ?? null,
    });
  }
}
