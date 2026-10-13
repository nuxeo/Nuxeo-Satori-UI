import { Directive, TemplateRef, inject } from '@angular/core';

/** One tab, already resolved by the host. */
export interface NxsTab {
  /** The tab's registered ID; rendered as `data-tab-id` on its label and handed to the body. */
  readonly id: string;
  /** What the tab says, already translated. */
  readonly label: string;
  /** A Material icon ligature shown before the label. Decorative. */
  readonly icon?: string;
}

/** The context a tab body template receives: the tab, as `let-tab`. */
export interface NxsTabBodyContext {
  readonly $implicit: NxsTab;
}

/**
 * Marks the template every tab body renders from: `<ng-template nxsTabBody let-tab>`, usually an
 * `@switch (tab.id)` over the packaged bodies with an extension outlet as the default.
 */
@Directive({ selector: 'ng-template[nxsTabBody]', standalone: true })
export class NxsTabBodyDirective {
  readonly template = inject<TemplateRef<NxsTabBodyContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: NxsTabBodyDirective,
    _context: unknown,
  ): _context is NxsTabBodyContext {
    return true;
  }
}
