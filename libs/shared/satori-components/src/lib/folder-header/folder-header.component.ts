import { ChangeDetectionStrategy, Component, input, type InputSignal } from '@angular/core';

import { NxsDocTypeIconComponent } from '../doc-type-icon/doc-type-icon.component';
import type { NxsHeadingLevel } from '../heading-level';

/**
 * The header above a container's contents: its type icon, its title as the page heading, an
 * optional second line, and the container's actions on the right.
 *
 * The actions are the host's, projected as they are, so a host keeps its own buttons, menus and
 * their handlers. Anything marked `nxsFolderHeaderDetail` — a breadcrumb trail, say — is
 * projected under the title instead. On a narrow screen the actions drop below the title.
 *
 * The title is the page's level-one heading unless `headingLevel` says otherwise; omit it (blank)
 * while the container is loading rather than announce an empty heading.
 */
@Component({
  selector: 'nxs-folder-header',
  standalone: true,
  templateUrl: './folder-header.component.html',
  styleUrl: './folder-header.component.scss',
  imports: [NxsDocTypeIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-folder-header' },
})
export class NxsFolderHeaderComponent {
  /** The container's title. Blank renders no heading. */
  readonly heading = input('');
  /**
   * The title's level in the page outline, rendered as the native `<h1>`–`<h6>`. The header is
   * usually the page's own heading, so level one; lower it where the header sits inside a section
   * that already has one.
   */
  // Annotated rather than inferred, as `nxs-empty-state`'s is, to keep the published API snapshot
  // stable.
  readonly headingLevel: InputSignal<NxsHeadingLevel> = input<NxsHeadingLevel>(1);
  /** A second line under the title — usually the type's name — already translated. */
  readonly subheading = input('');
  /** The container's Nuxeo type, which picks the icon. Blank renders no icon. */
  readonly documentType = input('');
}
