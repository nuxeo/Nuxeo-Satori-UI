import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsSpinnerComponent } from './spinner.component';

@Component({
  standalone: true,
  imports: [NxsSpinnerComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-spinner [label]="label()" [diameter]="diameter()" />`,
})
class HostComponent {
  readonly label = signal('Loading');
  readonly diameter = signal(36);
}

@Component({
  standalone: true,
  imports: [NxsSpinnerComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-spinner diameter="24" />`,
})
class StaticAttributeHostComponent {}

describe('NxsSpinnerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function progressbar(): HTMLElement {
    const el = fixture.nativeElement.querySelector('[role="progressbar"]') as HTMLElement | null;
    if (!el) throw new Error('no progressbar rendered');
    return el;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, StaticAttributeHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it('renders an indeterminate Material progress spinner', () => {
    const spinner = fixture.nativeElement.querySelector('mat-progress-spinner');
    expect(spinner).not.toBeNull();
    expect(spinner.getAttribute('mode')).toBe('indeterminate');
  });

  it('names the progressbar with the label, so a screen reader says what is loading', () => {
    expect(progressbar().getAttribute('aria-label')).toBe('Loading');
    expect(progressbar().getAttribute('aria-hidden')).toBeNull();
  });

  it('follows a changed label', async () => {
    host.label.set('Loading permissions');
    await render();
    expect(progressbar().getAttribute('aria-label')).toBe('Loading permissions');
  });

  it('is decorative without a label — hidden, and never an unnamed progressbar', async () => {
    host.label.set('');
    await render();
    expect(progressbar().getAttribute('aria-hidden')).toBe('true');
    expect(progressbar().hasAttribute('aria-label')).toBe(false);
  });

  it.each(['  \n ', '\u200b'])(
    'treats a label of only whitespace or zero-width characters (%j) as no label',
    async (label) => {
      host.label.set(label);
      await render();
      expect(progressbar().getAttribute('aria-hidden')).toBe('true');
      expect(progressbar().hasAttribute('aria-label')).toBe(false);
    },
  );

  it('names the progressbar with the label trimmed', async () => {
    host.label.set('  Loading versions ');
    await render();
    expect(progressbar().getAttribute('aria-label')).toBe('Loading versions');
  });

  it('sizes the spinner to the diameter', async () => {
    host.diameter.set(48);
    await render();
    expect(progressbar().style.width).toBe('48px');
    expect(progressbar().style.height).toBe('48px');
  });

  it('accepts the diameter as a static attribute', async () => {
    const staticFixture = TestBed.createComponent(StaticAttributeHostComponent);
    staticFixture.detectChanges();
    await staticFixture.whenStable();
    const el = staticFixture.nativeElement.querySelector('[role="progressbar"]') as HTMLElement;
    expect(el.style.width).toBe('24px');
  });

  it('defaults to a 32px decorative spinner', async () => {
    const bare = TestBed.createComponent(NxsSpinnerComponent);
    bare.detectChanges();
    await bare.whenStable();
    const el = bare.nativeElement.querySelector('[role="progressbar"]') as HTMLElement;
    expect(el.style.width).toBe('32px');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});
