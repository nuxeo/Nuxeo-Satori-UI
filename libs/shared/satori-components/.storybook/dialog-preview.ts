import {
  DestroyRef,
  Directive,
  ElementRef,
  EnvironmentInjector,
  afterEveryRender,
  createComponent,
  inject,
} from '@angular/core';
import { MatDialogContainer, type MatDialogConfig } from '@angular/material/dialog';
import type { Meta } from '@storybook/angular';

/** The sizes a page passes to `MatDialog.open`, which are all the preview takes from its config. */
export type DialogPreviewSize = Pick<MatDialogConfig, 'width' | 'minWidth' | 'maxWidth'>;

/**
 * Makes its element the dialog container a `MatDialog` would open: Material's container classes,
 * and Material's dialog stylesheet.
 *
 * The stylesheet is `MatDialogContainer`'s own, which Angular adds to the document when a container
 * is created and removes when the last one is destroyed. Nothing else ships it: without a container
 * a dialog's title, content and actions have no padding and the title is the browser's default
 * heading. So the directive creates one, never attached and never shown, for as long as the
 * preview lives. It moves no focus, traps nothing and is not announced.
 *
 * `mat-mdc-dialog-container-with-actions` is set as Material sets it, when the dialog has
 * `mat-dialog-actions`, because it changes the content's padding. Material counts the actions
 * through the dialog's `MatDialogRef`, which in a story is a fake, so the directive looks.
 */
@Directive({
  selector: '[nxsDialogPreview]',
  standalone: true,
  host: { class: 'mat-mdc-dialog-container mdc-dialog mdc-dialog--open' },
})
export class NxsDialogPreviewDirective {
  constructor() {
    const stylesheet = createComponent(MatDialogContainer, {
      environmentInjector: inject(EnvironmentInjector),
    });
    inject(DestroyRef).onDestroy(() => stylesheet.destroy());
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterEveryRender({
      write: () =>
        host.classList.toggle(
          'mat-mdc-dialog-container-with-actions',
          !!host.querySelector('.mat-mdc-dialog-actions'),
        ),
    });
  }
}

const cssSize = (value: string | number | undefined): string | null =>
  value === undefined || value === '' ? null : typeof value === 'number' ? `${value}px` : value;

/**
 * A dialog story's `render`: the dialog `selector` shown as `MatDialog` opens it with `size`, the
 * sizes the page's `dialog.open` call passes. The markup is MatDialog's: the overlay pane, the
 * container and the surface, with the dialog component as the container's content, so the preview
 * is laid out by Material's own rules rather than a lookalike.
 *
 * Given to the meta as `render: dialogPreview(…)`, not spread into it: the review guardrails read
 * the meta to count a file's stories, and cannot read through a spread.
 */
export function dialogPreview(
  selector: string,
  size: DialogPreviewSize = {},
): NonNullable<Meta['render']> {
  const pane = [
    // What the overlay's global position strategy sets on the pane.
    'position: static',
    // What the CDK overlay's stylesheet gives the pane, which a story does not otherwise load.
    'display: flex',
    'box-sizing: border-box',
    ...Object.entries({ width: size.width, 'min-width': size.minWidth, 'max-width': size.maxWidth })
      .map(([property, value]) => [property, cssSize(value)])
      .filter(([, value]) => value)
      .map(([property, value]) => `${property}: ${value}`),
  ].join('; ');
  return () => ({
    moduleMetadata: { imports: [NxsDialogPreviewDirective] },
    template: `
      <div style="display: flex; justify-content: center; padding: 16px 0">
        <div class="cdk-overlay-pane mat-mdc-dialog-panel" style="${pane}">
          <div nxsDialogPreview>
            <div class="mat-mdc-dialog-inner-container mdc-dialog__container">
              <div class="mat-mdc-dialog-surface mdc-dialog__surface">
                <${selector} class="mat-mdc-dialog-component-host" />
              </div>
            </div>
          </div>
        </div>
      </div>
    `,
  });
}
