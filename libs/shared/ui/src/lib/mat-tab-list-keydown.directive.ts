import { Directive, ElementRef, DestroyRef, afterNextRender, inject } from '@angular/core';
import { observeMatTabListKeyboardA11y } from './mat-tab-list-keyboard-a11y';

/**
 * Sets IBM-detectable inline `onkeydown` on Material tablists inside `mat-tab-group`.
 * Apply as `libMatTabListKeydown` on the group host.
 */
@Directive({
  selector: 'mat-tab-group[libMatTabListKeydown]',
  standalone: true,
})
export class MatTabListKeydownDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const cleanup = observeMatTabListKeyboardA11y(this.host.nativeElement);
      if (cleanup) {
        this.destroyRef.onDestroy(cleanup);
      }
    });
  }
}
