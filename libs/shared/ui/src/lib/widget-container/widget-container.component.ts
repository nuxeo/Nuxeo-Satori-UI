import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'lib-widget-container',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './widget-container.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './widget-container.component.scss',
})
export class WidgetContainerComponent {
  readonly title = input.required<string>();
  readonly icon = input<string>();
  readonly iconColor = input<string>('');
  /** Level under the shell `<h1>` (2) or under a page section `<h2>` (3). */
  readonly headingLevel = input<2 | 3>(2);
}
