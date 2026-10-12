import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import type { NxsBreadcrumbItem, NxsBreadcrumbsInputs } from '../primitives';

/**
 * A breadcrumb trail — the Material implementation of `nxs.primitives.breadcrumbs`.
 *
 * Satori's collapses the middle of a long trail into a menu; this one wraps instead. A router
 * item needs the host to provide the router, as `routerLink` always does.
 */
@Component({
  selector: 'nxs-breadcrumbs',
  standalone: true,
  templateUrl: './breadcrumbs.component.html',
  styleUrl: './breadcrumbs.component.scss',
  imports: [MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-breadcrumbs' },
})
export class NxsBreadcrumbsComponent implements NxsBreadcrumbsInputs {
  readonly items = input.required<readonly NxsBreadcrumbItem[]>();
  readonly label = input('');

  protected linkKind(item: NxsBreadcrumbItem): 'router' | 'href' | 'text' {
    if (item.routerLink !== undefined) return 'router';
    if (item.href !== undefined) return 'href';
    return 'text';
  }
}
