import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import {
  NXS_ADMIN_USER_DETAILS_PAGE_ID,
  NxsAdminUserDetailsPageComponent,
} from '@nuxeo/satori-platform/components';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';

/**
 * The user details administration route, for `users-groups/user/:userId`. The page is rendered through
 * its registered ID, with the packaged component as the fallback. The route supplies `userId` as an
 * input, and each choice on the page routes onward.
 */
@Component({
  selector: 'lib-admin-user-details-page',
  standalone: true,
  imports: [ExtensionOutletComponent, NxsAdminUserDetailsPageComponent],
  templateUrl: './admin-user-details-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUserDetailsPageComponent {
  private readonly router = inject(Router);

  /** The username from the route. */
  readonly userId = input.required<string>();

  protected readonly pageId = NXS_ADMIN_USER_DETAILS_PAGE_ID;
  protected readonly callbacks = {
    deleted: (): void => {
      void this.router.navigate(['/administration/users-groups']);
    },
    groupChosen: (groupname: string): void => {
      void this.router.navigate(['/administration/users-groups/group', groupname]);
    },
    documentChosen: (documentId: string): void => {
      void this.router.navigate(['/doc', documentId]);
    },
  };
  protected readonly inputs = computed(() => ({ userId: this.userId(), ...this.callbacks }));
}
