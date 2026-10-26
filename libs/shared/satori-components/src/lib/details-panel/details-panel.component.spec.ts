import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsDetailsPanelComponent, type NxsDetailsPanelTab } from './details-panel.component';

const TABS: readonly NxsDetailsPanelTab[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'comments', label: 'Comments' },
  { id: 'activity', label: 'Activity' },
];

@Component({
  standalone: true,
  imports: [NxsDetailsPanelComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-details-panel
      [heading]="heading()"
      [label]="label()"
      [tabs]="tabs()"
      [closeLabel]="closeLabel()"
      [(selected)]="selected"
      (closed)="closes = closes + 1"
    >
      <p class="body">{{ selected() }} body</p>
    </nxs-details-panel>
  `,
})
class HostComponent {
  readonly heading = signal('Quarterly report.pdf');
  readonly label = signal('');
  readonly tabs = signal<readonly NxsDetailsPanelTab[]>(TABS);
  readonly closeLabel = signal('');
  readonly selected = signal('properties');
  closes = 0;
}

describe('NxsDetailsPanelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const panel = (): HTMLElement => el().querySelector('nxs-details-panel') as HTMLElement;
  const tabs = (): HTMLButtonElement[] => [
    ...el().querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ];
  const tabpanel = (): HTMLElement => el().querySelector('[role="tabpanel"]') as HTMLElement;
  const close = (): HTMLButtonElement =>
    el().querySelector('.nxs-details-panel__close') as HTMLButtonElement;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function press(target: HTMLElement, key: string): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    await render();
  });

  afterEach(() => (fixture.nativeElement as HTMLElement).remove());

  it('is a complementary region named by its heading unless given a label', async () => {
    expect(panel().getAttribute('role')).toBe('complementary');
    expect(panel().getAttribute('aria-label')).toBe('Quarterly report.pdf');
    host.label.set('Document properties');
    await render();
    expect(panel().getAttribute('aria-label')).toBe('Document properties');
  });

  it('shows the heading and projects the body into the tab panel', () => {
    expect(el().querySelector('.nxs-details-panel__title')?.textContent?.trim()).toBe(
      'Quarterly report.pdf',
    );
    expect(tabpanel().querySelector('.body')?.textContent).toContain('properties body');
  });

  it('marks the selected view as the selected tab and labels the panel by it', () => {
    const [properties, comments] = tabs();
    expect(properties.getAttribute('aria-selected')).toBe('true');
    expect(properties.tabIndex).toBe(0);
    expect(comments.getAttribute('aria-selected')).toBe('false');
    expect(comments.tabIndex).toBe(-1);
    expect(tabpanel().getAttribute('aria-labelledby')).toBe(properties.id);
    expect(properties.getAttribute('aria-controls')).toBe(tabpanel().id);
  });

  it('selects a view on click and writes it back', async () => {
    tabs()[1].click();
    await render();
    expect(host.selected()).toBe('comments');
    expect(tabs()[1].classList).toContain('nxs-details-panel__tab--active');
  });

  it('moves and selects with the arrow keys, wrapping, and jumps with Home and End', async () => {
    tabs()[0].focus();
    press(tabs()[0], 'ArrowRight');
    await render();
    expect(host.selected()).toBe('comments');
    expect(document.activeElement).toBe(tabs()[1]);
    press(tabs()[1], 'End');
    await render();
    expect(host.selected()).toBe('activity');
    press(tabs()[2], 'ArrowRight');
    await render();
    expect(host.selected()).toBe('properties');
    press(tabs()[0], 'ArrowLeft');
    await render();
    expect(host.selected()).toBe('activity');
    press(tabs()[2], 'Home');
    await render();
    expect(host.selected()).toBe('properties');
  });

  it('reverses the arrow keys right to left', async () => {
    panel().style.direction = 'rtl';
    press(tabs()[0], 'ArrowLeft');
    await render();
    expect(host.selected()).toBe('comments');
  });

  it('ignores other keys', async () => {
    press(tabs()[0], 'a');
    await render();
    expect(host.selected()).toBe('properties');
  });

  it('selects the first view when the selected one is not offered', async () => {
    host.tabs.set(TABS.filter((tab) => tab.id !== 'properties'));
    await render();
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[0].textContent?.trim()).toBe('Comments');
  });

  it('names the close button and reports it, leaving closing to the host', async () => {
    expect(close().getAttribute('aria-label')).toBe('Close details');
    close().click();
    expect(host.closes).toBe(1);
    host.closeLabel.set('Close panel');
    await render();
    expect(close().getAttribute('aria-label')).toBe('Close panel');
  });
});
