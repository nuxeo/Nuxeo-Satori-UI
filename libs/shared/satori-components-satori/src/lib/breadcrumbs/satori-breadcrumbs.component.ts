import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SatBreadcrumbs, type SatBreadcrumbsItem } from '@hylandsoftware/satori-ui/breadcrumbs';
import type { NxsBreadcrumbItem, NxsBreadcrumbsInputs } from '@nuxeo-satori/platform/components';

/**
 * `nxs.primitives.breadcrumbs` on Satori's `sat-breadcrumbs`, which collapses a long trail.
 *
 * Satori names its navigation landmark from its own `sat.*` catalogue, so `label` is accepted for
 * the shared contract and not read. Needs `provideSatori()` for the chevron icon, and that
 * catalogue loaded into ngx-translate.
 */
@Component({
  selector: 'nxs-satori-breadcrumbs',
  standalone: true,
  templateUrl: './satori-breadcrumbs.component.html',
  imports: [SatBreadcrumbs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-satori-breadcrumbs', style: 'display: block' },
})
export class NxsSatoriBreadcrumbsComponent implements NxsBreadcrumbsInputs {
  readonly items = input.required<readonly NxsBreadcrumbItem[]>();
  readonly label = input('');

  protected readonly satoriItems = computed(() => this.items().map(toSatori));
}

function toSatori(item: NxsBreadcrumbItem): SatBreadcrumbsItem {
  if (item.routerLink !== undefined) {
    return {
      label: item.label,
      routerLink: typeof item.routerLink === 'string' ? item.routerLink : [...item.routerLink],
      queryParams: item.queryParams ? { ...item.queryParams } : undefined,
    };
  }
  if (item.href !== undefined) return { label: item.label, href: item.href };
  return { label: item.label };
}
