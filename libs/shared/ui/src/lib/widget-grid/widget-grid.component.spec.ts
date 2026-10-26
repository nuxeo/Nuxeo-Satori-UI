import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WidgetGridComponent } from './widget-grid.component';

/** Hosted so the single `<ng-content>` slot can be asserted at all. */
@Component({
  standalone: true,
  imports: [WidgetGridComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <lib-widget-grid [columns]="columns()">
      <div class="probe-widget">One</div>
      <div class="probe-widget">Two</div>
    </lib-widget-grid>
  `,
})
class HostComponent {
  // A signal, so a change marks the host view dirty. A plain field does not under
  // `provideZonelessChangeDetection`, and the re-render assertion below becomes an NG0100.
  readonly columns = signal(2);
}

describe('WidgetGridComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function grid(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.widget-grid') as HTMLElement | null;
  }

  it('lays out two equal columns by default', () => {
    expect(host.columns()).toBe(2);
    // The default is what every dashboard relies on for half-width widgets, so it is asserted as
    // the resolved CSS value rather than just "the property is set".
    expect(grid()?.style.gridTemplateColumns).toBe('repeat(2, 1fr)');
  });

  it('rebuilds the template columns when the column count changes', async () => {
    host.columns.set(4);
    await fixture.whenStable();
    expect(grid()?.style.gridTemplateColumns).toBe('repeat(4, 1fr)');

    host.columns.set(1);
    await fixture.whenStable();
    expect(grid()?.style.gridTemplateColumns).toBe('repeat(1, 1fr)');
  });

  it('projects its children into the grid', () => {
    const widgets = [...(grid()?.querySelectorAll('.probe-widget') ?? [])] as HTMLElement[];
    expect(widgets.map((widget) => widget.textContent?.trim())).toEqual(['One', 'Two']);
  });
});
