import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SearchService } from '@nuxeo/satori-platform/nuxeo-client';
import { WidgetGridComponent, WidgetContainerComponent } from '@nuxeo/satori-platform/ui';

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [WidgetGridComponent, WidgetContainerComponent],
  templateUrl: './stats.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './stats.scss',
})
export class StatsComponent {
  private search = inject(SearchService);

  private totalResult = toSignal(this.search.search({ pageSize: 40 }));

  protected totalDocs = computed(() => this.totalResult()?.items.length);
  protected recentDocs = 0; // TODO: Add date filter
  protected myDocs = 0; // TODO: Add user filter
}
