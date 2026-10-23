import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { docTypeIcon } from '@nuxeo/satori-platform/nuxeo-client';

import { NxsIconComponent } from '../icon/icon.component';

/**
 * The icon for a Nuxeo document type — `Folder`, `File`, `Picture`, `Collection` …
 *
 * The type-to-icon table is `docTypeIcon()` in `nuxeo-client`, so a type added there gets its
 * icon everywhere this is used, and an unknown type gets the generic file icon rather than
 * nothing. Decorative unless given a `label`, because it almost always sits beside the type's
 * name or the document's title.
 */
@Component({
  selector: 'nxs-doc-type-icon',
  standalone: true,
  templateUrl: './doc-type-icon.component.html',
  styleUrl: './doc-type-icon.component.scss',
  imports: [NxsIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-doc-type-icon' },
})
export class NxsDocTypeIconComponent {
  /** The document's type, as Nuxeo names it. */
  readonly type = input.required<string>();
  /** What the icon means, already translated. Blank makes it decorative. */
  readonly label = input('');

  protected readonly icon = computed(() => docTypeIcon(this.type()));
}
