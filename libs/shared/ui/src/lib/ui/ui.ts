import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'lib-ui',
  imports: [TranslatePipe],
  templateUrl: './ui.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './ui.scss',
})
export class UiComponent {}
