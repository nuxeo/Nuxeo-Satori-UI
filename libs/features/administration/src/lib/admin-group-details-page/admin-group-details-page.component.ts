import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import {
  NXS_ADMIN_GROUP_DETAILS_PAGE_ID,
  NxsAdminGroupDetailsPageComponent,
} from '@nuxeo/satori-platform/components';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';

/**
 * The group details administration route, for `users-groups/group/:groupId`. The page is rendered through
 * its registered ID, with the packaged component as the fallback. The route supplies `groupId` as an
 * input, and each choice on the page routes onward.
 */
@Component({
  selector: 'lib-admin-group-details-page',
  standalone: true,
  imports: [ExtensionOutletComponent, NxsAdminGroupDetailsPageComponent],
  templateUrl: './admin-group-details-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminGroupDetailsPageComponent {
  private readonly router = inject(Router);

  /** The group name from the route. */
  readonly groupId = input.required<string>();

  protected readonly pageId = NXS_ADMIN_GROUP_DETAILS_PAGE_ID;
  protected readonly callbacks = {
    deleted: (): void => {
      void this.router.navigate(['/administration/users-groups']);
    },
    userChosen: (username: string): void => {
      void this.router.navigate(['/administration/users-groups/user', username]);
    },
    groupChosen: (groupname: string): void => {
      void this.router.navigate(['/administration/users-groups/group', groupname]);
    },
    documentChosen: (documentId: string): void => {
      void this.router.navigate(['/doc', documentId]);
    },
  };
  protected readonly inputs = computed(() => ({ groupId: this.groupId(), ...this.callbacks }));
}
