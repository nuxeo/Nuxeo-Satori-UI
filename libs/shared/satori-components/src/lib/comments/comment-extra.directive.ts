import { Directive, inject, TemplateRef } from '@angular/core';
import type { NuxeoComment } from '@nuxeo/satori-platform/nuxeo-client';

/** What a projected `[nxsCommentExtra]` template receives: the comment or reply it sits under. */
export interface NxsCommentContext {
  readonly $implicit: NuxeoComment;
}

/**
 * Content rendered under each comment's and reply's text — a sentiment badge, a translation:
 * `<ng-template nxsCommentExtra let-comment>…</ng-template>`.
 */
@Directive({ selector: 'ng-template[nxsCommentExtra]', standalone: true })
export class NxsCommentExtraDirective {
  readonly template = inject<TemplateRef<NxsCommentContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: NxsCommentExtraDirective,
    _context: unknown,
  ): _context is NxsCommentContext {
    return true;
  }
}
