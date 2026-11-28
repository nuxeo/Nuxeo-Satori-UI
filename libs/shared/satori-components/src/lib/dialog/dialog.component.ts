import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatDialogActions, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';

/**
 * The frame of a dialog `MatDialog` opens: its title, its content and its row of actions, laid out
 * and spaced as Angular Material's dialog is, in the theme's colours.
 *
 * Put it at the root of the component you open with `MatDialog.open`. `heading` is the title,
 * already translated: a level-two heading, which names the dialog, since Material's title sets the
 * dialog's `aria-labelledby`. What you put inside is the content, which scrolls when it is taller
 * than the dialog; what you mark `nxsDialogActions` is the row of actions under it, at its end, in
 * the order you write them:
 *
 * ```html
 * <nxs-dialog [heading]="data.title">
 *   <p>{{ data.question }}</p>
 *   <ng-container nxsDialogActions>
 *     <nxs-button (press)="cancel()">Cancel</nxs-button>
 *     <nxs-button appearance="filled" (press)="run()">Run</nxs-button>
 *   </ng-container>
 * </nxs-dialog>
 * ```
 *
 * It draws the frame and nothing else: opening the dialog, its data, its focus and closing it are
 * `MatDialog`'s, as for any dialog component.
 */
@Component({
  selector: 'nxs-dialog',
  standalone: true,
  templateUrl: './dialog.component.html',
  styleUrl: './dialog.component.scss',
  imports: [MatDialogActions, MatDialogContent, MatDialogTitle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-dialog' },
})
export class NxsDialogComponent {
  /** The dialog's title, already translated: a level-two heading that names the dialog. Required. */
  readonly heading = input.required<string>();
}
