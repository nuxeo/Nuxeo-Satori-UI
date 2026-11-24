import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import {
  NXS_ADMIN_USERS_GROUPS_PAGE_ID,
  NxsAdminUsersGroupsPageComponent,
} from '@nuxeo/satori-platform/components';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';

/**
 * The users and groups administration route. The page is rendered through its registered ID, so a
 * customer library can replace it, and the packaged component is the fallback when nothing resolves.
 * Choosing a user or a group routes to its details page.
 */
@Component({
  selector: 'lib-admin-users-groups-page',
  standalone: true,
  imports: [ExtensionOutletComponent, NxsAdminUsersGroupsPageComponent],
  templateUrl: './admin-users-groups-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsersGroupsPageComponent {
  private readonly router = inject(Router);

  protected readonly pageId = NXS_ADMIN_USERS_GROUPS_PAGE_ID;
  protected readonly inputs = {
    userChosen: (username: string): void => {
      void this.router.navigate(['/administration/users-groups/user', username]);
    },
    groupChosen: (groupname: string): void => {
      void this.router.navigate(['/administration/users-groups/group', groupname]);
    },
  };
}
