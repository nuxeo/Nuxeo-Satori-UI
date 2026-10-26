import { Component, input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'lib-widget-grid',
  standalone: true,
  templateUrl: './widget-grid.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './widget-grid.component.scss',
})
export class WidgetGridComponent {
  /** Number of columns in the grid (default 2 for half-width widgets). */
  readonly columns = input<number>(2);
}
