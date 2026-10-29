import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  DOMAIN_CONTAINER_GUIDANCE_KEY,
  isDomainParentType,
  isRepositoryRootPath,
} from '@nuxeo/satori-platform/nuxeo-client';

/**
 * The note shown where content cannot be created directly: inside a Domain, or at the
 * repository root. It tells the user to open Sections, Templates or Workspaces instead.
 *
 * Renders nothing anywhere else, so a host places it unconditionally and passes what it is
 * showing. The rule — a `Domain`, or the path `/` — is `nuxeo-client`'s, shared with the
 * Create / Import checks that refuse those locations.
 */
@Component({
  selector: 'nxs-domain-hint',
  standalone: true,
  templateUrl: './domain-hint.component.html',
  styleUrl: './domain-hint.component.scss',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The host carries the note's spacing, so it must collapse when there is no note. Browse mounts
  // this component unconditionally and the template renders its paragraph only for a Domain or the
  // repository root; left visible, an empty host reserved 24px of vertical space in every ordinary
  // workspace and folder, where it is a flex item whose margins do not collapse away.
  host: {
    class: 'nxs-domain-hint',
    '[class.nxs-domain-hint--empty]': '!visible()',
  },
})
export class NxsDomainHintComponent {
  /** The type of the document being shown. */
  readonly documentType = input<string | null | undefined>(null);
  /** The repository path being shown. */
  readonly path = input<string | null | undefined>(null);

  protected readonly guidanceKey = DOMAIN_CONTAINER_GUIDANCE_KEY;
  protected readonly visible = computed(
    () => isDomainParentType(this.documentType()) || isRepositoryRootPath(this.path()),
  );
}
