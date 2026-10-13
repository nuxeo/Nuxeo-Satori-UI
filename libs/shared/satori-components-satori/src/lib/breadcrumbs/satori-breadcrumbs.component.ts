import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterEveryRender,
  computed,
  inject,
  input,
} from '@angular/core';
import { SatBreadcrumbs, type SatBreadcrumbsItem } from '@hylandsoftware/satori-ui/breadcrumbs';
import {
  nxsVisibleText,
  type NxsBreadcrumbItem,
  type NxsBreadcrumbsInputs,
} from '@nuxeo-satori/platform/components';

/**
 * `nxs.primitives.breadcrumbs` on Satori's `sat-breadcrumbs`, which collapses a long trail.
 *
 * Needs `provideSatori()` for the chevron icon, and Satori's `sat.*` catalogue loaded into
 * ngx-translate for the "Show more breadcrumbs" button, and for the landmark's name when `label`
 * is blank.
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
  /** The landmark's accessible name, already translated. Blank keeps Satori's own name. */
  readonly label = input('');

  protected readonly satoriItems = computed(() => this.items().map(toSatori));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The name Satori last wrote on its landmark, and the one this component left there. */
  private satoriName: string | null = null;
  private shownName: string | null = null;

  constructor() {
    // `sat-breadcrumbs` has no input for its landmark's name: its template binds the `<nav>` to its
    // own catalogue entry and writes it again whenever that translation changes. So it is set
    // after every render — to our label, or back to Satori's when the label is blank.
    afterEveryRender({
      write: () => {
        const nav = this.host.nativeElement.querySelector('nav');
        if (!nav) return;
        const current = nav.getAttribute('aria-label');
        if (current !== this.shownName) this.satoriName = current;
        this.shownName = nxsVisibleText(this.label()) || this.satoriName;
        if (this.shownName === null) nav.removeAttribute('aria-label');
        else if (this.shownName !== current) nav.setAttribute('aria-label', this.shownName);
      },
    });
  }
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
