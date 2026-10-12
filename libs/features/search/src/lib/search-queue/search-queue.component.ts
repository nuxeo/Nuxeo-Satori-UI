import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  SearchAggregationService,
  type SearchResultItem,
} from '@nuxeo-satori/platform/nuxeo-client';
import { NxsThumbnailComponent, provideNxsThumbnailCache } from '@nuxeo-satori/platform/components';
import { TranslatePipe } from '@ngx-translate/core';

interface ActiveFilter {
  label: string;
  value: string;
  selected: boolean;
}

@Component({
  selector: 'lib-search-queue',
  standalone: true,
  imports: [NxsThumbnailComponent, TranslatePipe, CommonModule, MatButtonModule, MatIconModule],
  providers: [provideNxsThumbnailCache()],
  templateUrl: './search-queue.component.html',
  styleUrl: './search-queue.component.scss',
})
export class SearchQueueComponent {
  private readonly searchAggregationService = inject(SearchAggregationService);

  readonly items = computed(() => this.searchAggregationService.items());
  readonly selectedItemId = input<string>('');
  readonly activeFilters = input<ActiveFilter[]>([]);
  readonly switchToFilter = output<void>();
  readonly quickFilterToggled = output<string>();
  readonly itemSelected = output<SearchResultItem>();

  onSwitchToFilter(): void {
    this.switchToFilter.emit();
  }

  onItemClick(item: SearchResultItem): void {
    this.itemSelected.emit(item);
  }

  onQuickFilterClick(value: string): void {
    this.quickFilterToggled.emit(value);
  }
}
