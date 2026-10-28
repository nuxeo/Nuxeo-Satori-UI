import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  input,
  output,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

import { NxsFileDropTracker } from '../file-drop';
import type { NxsUploadInputs } from '../primitives';

let nextId = 0;

/**
 * Where files are dropped from the computer, or chosen with a button — the same files either way.
 *
 * The button is the keyboard's way in, since dragging files has none. Only a drag of files is
 * taken: a drag of text or a link is left to the browser, and nothing lights up for it.
 *
 * Registered as `nxs.primitives.upload`, so a customer can replace it by ID. The outlet that
 * renders an ID binds no outputs, so the files also go to a `filesHandler` input; a host using the
 * element can keep binding `(files)`, and both are called.
 */
@Component({
  selector: 'nxs-dropzone',
  standalone: true,
  templateUrl: './dropzone.component.html',
  styleUrl: './dropzone.component.scss',
  imports: [MatButtonModule, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxs-dropzone',
    '[class.nxs-dropzone--over]': 'drop.over()',
    '[class.nxs-dropzone--disabled]': 'disabled()',
    '(dragenter)': 'drop.enter($event)',
    '(dragover)': 'drop.overTarget($event)',
    '(dragleave)': 'drop.leave($event)',
    '(drop)': 'onDrop($event)',
  },
})
export class NxsDropzoneComponent implements NxsUploadInputs {
  /** What the zone says, already translated, such as "Drag and drop files here". */
  readonly label = input.required<string>();
  /** The button's text, already translated. Blank says "Choose files" or "Choose a file". */
  readonly buttonLabel = input('');
  /** Takes several files at once. Accepts a bare attribute. */
  readonly multiple = input(false, { transform: booleanAttribute });
  /** The file types the chooser offers, as the `accept` attribute takes them: `.csv`. */
  readonly accept = input('');
  /** Takes nothing, from the button or a drop. Accepts a bare attribute. */
  readonly disabled = input(false, { transform: booleanAttribute });

  /**
   * Called with the files chosen or dropped. The outlet that renders this by ID binds no outputs,
   * so this is how the ID's host is told; it is called alongside `files`, never instead of it.
   */
  readonly filesHandler = input<((files: readonly File[]) => void) | null>(null);

  /** Files chosen or dropped: one when `multiple` is off, however many were dropped. */
  readonly files = output<readonly File[]>();

  protected readonly drop = new NxsFileDropTracker(() => !this.disabled());
  /**
   * The button's id, which also names the file input behind it. That input is hidden from
   * assistive technology and out of the Tab sequence, so the name is never announced; it states
   * which control the input stands behind, and gives it a label a template check can see.
   */
  protected readonly buttonId = `nxs-dropzone-${nextId++}-button`;
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('picker');

  protected choose(): void {
    if (!this.disabled()) this.input().nativeElement.click();
  }

  protected onPicked(event: Event): void {
    const picker = event.target as HTMLInputElement;
    const files = Array.from(picker.files ?? []);
    picker.value = '';
    this.emit(files);
  }

  protected onDrop(event: DragEvent): void {
    this.emit(this.drop.drop(event));
  }

  private emit(files: File[]): void {
    if (files.length === 0 || this.disabled()) return;
    const taken = this.multiple() ? files : files.slice(0, 1);
    this.filesHandler()?.(taken);
    this.files.emit(taken);
  }
}
