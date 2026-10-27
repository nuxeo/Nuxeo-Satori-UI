import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatLabel } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { SatUploadField, SatUploadFieldInput } from '@hylandsoftware/satori-ui/upload-field';
import { TranslatePipe } from '@ngx-translate/core';
import type { NxsUploadInputs } from '@nuxeo/satori-platform/components';

/**
 * `nxs.primitives.upload` on Satori's `sat-upload-field`.
 *
 * ## Why the upload field and not the upload area
 *
 * Satori ships two: `sat-upload-area`, which overlays arbitrary content while a file is dragged
 * anywhere over the window, and `sat-upload-field`, a labelled control shaped like a form field.
 * The field is what `nxs-dropzone` is — a labelled target with a way in from the keyboard — so it
 * is the one wrapped.
 *
 * The area was rejected for a second reason worth writing down: its overlay reads
 * **"Drop files here."** as a literal in its own template, with no key in Satori's catalogue —
 * `sat.upload-field.*` exists, `sat.upload-area.*` does not. Wrapping it would have shown English
 * to every other locale on a component whose whole text is otherwise translated by the caller.
 *
 * ## How our two labels map
 *
 * Satori's field is one control: a `<label>` above, and a button that is both the chooser and the
 * drop target. So `label` becomes that `<mat-label>`, and `buttonLabel` becomes the button's own
 * text, replacing Satori's `sat.upload-field.browse-or-drop` fallback. Both arrive translated, and
 * `buttonLabel` falls back to the same two keys the Material implementation uses, so a blank one
 * reads the same in both.
 *
 * `multiple`, `accept` and `disabled` go on the projected `input[type=file]`, which is where
 * Satori's field reads them from — it mirrors the input's `disabled` onto its own button.
 *
 * The files reach the host twice over, as they do on Material: through `filesHandler`, which is the
 * only route an outlet-rendered ID has, and through the `files` output for a host using the
 * element.
 *
 * One thing Satori adds that Material does not: a polite live region announcing what was uploaded.
 * `uploadedFiles` is what feeds it, so the last files are passed back in rather than left unset —
 * an announcement Material's dropzone does not make, kept because switching off a component's own
 * accessibility would be the worse call.
 */
@Component({
  selector: 'nxs-satori-upload',
  standalone: true,
  templateUrl: './satori-upload.component.html',
  styleUrl: './satori-upload.component.scss',
  // `MatLabel` is not decoration: Satori's field queries its content for that directive to decide
  // whether to render its `<label>` at all, so without it the label is projected into nothing.
  imports: [MatIconModule, MatLabel, SatUploadField, SatUploadFieldInput, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-satori-upload', '[class.nxs-satori-upload--disabled]': 'disabled()' },
})
export class NxsSatoriUploadComponent implements NxsUploadInputs {
  /** What the zone says, already translated, such as "Drag and drop files here". */
  readonly label = input.required<string>();
  /** The control's text, already translated. Blank says "Choose files" or "Choose a file". */
  readonly buttonLabel = input('');
  /** Takes several files at once. Accepts a bare attribute. */
  readonly multiple = input(false, { transform: booleanAttribute });
  /** The file types the chooser offers, as the `accept` attribute takes them: `.csv`. */
  readonly accept = input('');
  /** Takes nothing, from the control or a drop. Accepts a bare attribute. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Called with the files chosen or dropped, alongside the `files` output. */
  readonly filesHandler = input<((files: readonly File[]) => void) | null>(null);

  /** Files chosen or dropped: one when `multiple` is off, however many were dropped. */
  readonly files = output<readonly File[]>();

  protected readonly ownButtonLabel = computed(() => this.buttonLabel().trim());
  /** What Satori's own live region announces; empty until something is taken. */
  protected readonly uploaded = signal<File[]>([]);

  private readonly field = viewChild.required(SatUploadField);

  constructor() {
    // `SatUploadField.disabled` is a writable signal rather than an input, so it cannot be bound in
    // a template. The field mirrors the projected input's `disabled` through a MutationObserver of
    // its own, and this keeps the two in step from the first render rather than only after a
    // mutation — the projected input is set from the same signal, so they cannot disagree.
    effect(() => this.field().disabled.set(this.disabled()));
  }

  /**
   * Both routes in. Satori's `satUpload` registers a change handler on the input it is pointed at,
   * so a file chosen from the dialog arrives here too, not only a dropped one — which is why this
   * component listens for no `change` of its own. A second listener would emit every pick twice.
   */
  protected onFilesLoaded(files: readonly File[]): void {
    this.emit([...files]);
  }

  /** The same rule the Material implementation applies: nothing empty, nothing while disabled. */
  private emit(files: File[]): void {
    if (files.length === 0 || this.disabled()) return;
    const taken = this.multiple() ? files : files.slice(0, 1);
    this.uploaded.set([...taken]);
    this.filesHandler()?.(taken);
    this.files.emit(taken);
  }
}
