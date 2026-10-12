import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsRichTooltipComponent } from './rich-tooltip.component';

/** Hosted beside a second focusable, so focus can genuinely leave the component. */
@Component({
  standalone: true,
  imports: [NxsRichTooltipComponent],
  template: `
    <nxs-rich-tooltip
      heading="Versioning"
      content="A new version is created each time you check in."
      triggerLabel="About versioning"
    />
    <button type="button" class="outside">Elsewhere</button>
  `,
})
class HostComponent {}

describe('NxsRichTooltipComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;

  /** The element, or a failure naming the selector — never a silent `null`. */
  function required<T extends Element>(selector: string, root: ParentNode = host): T {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Expected ${selector} to be rendered`);
    return element;
  }

  const trigger = () => required<HTMLButtonElement>('.nxs-rich-tooltip__trigger');
  const panel = () => host.querySelector<HTMLElement>('.nxs-rich-tooltip__panel');

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    await settle();
  });

  afterEach(() => host.remove());

  it('starts closed, with a named trigger that says so', () => {
    expect(panel()).toBeNull();
    expect(trigger().getAttribute('aria-label')).toBe('About versioning');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the default info icon, hidden from assistive technology', () => {
    const icon = trigger().querySelector('mat-icon');
    expect(icon?.textContent?.trim()).toBe('info');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  // A live region is announced when content enters it, so it must exist, empty, before the panel.
  it('opens its panel inside a live region, which the trigger controls, and keeps focus on the trigger', async () => {
    const live = required<HTMLElement>('.nxs-rich-tooltip__live');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent?.trim()).toBe('');
    trigger().focus();
    trigger().click();
    await settle();
    const opened = required<HTMLElement>('.nxs-rich-tooltip__panel', live);
    expect(opened.hasAttribute('role')).toBe(false);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(opened.id);
    expect(required('.nxs-rich-tooltip__heading', opened).textContent?.trim()).toBe('Versioning');
    expect(opened.querySelector('.nxs-rich-tooltip__content')?.textContent?.trim()).toBe(
      'A new version is created each time you check in.',
    );
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on a second click', async () => {
    trigger().click();
    await settle();
    trigger().click();
    await settle();
    expect(panel()).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    trigger().click();
    await settle();
    required('.nxs-rich-tooltip__panel').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('ignores Escape while closed, leaving focus where it was', async () => {
    const outside = required<HTMLButtonElement>('.outside');
    outside.focus();
    required('nxs-rich-tooltip').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(document.activeElement).toBe(outside);
  });

  it('closes when focus leaves the component', async () => {
    trigger().click();
    await settle();
    const outside = required<HTMLButtonElement>('.outside');
    trigger().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    await settle();
    expect(panel()).toBeNull();
  });

  it('stays open while focus moves within the component', async () => {
    trigger().click();
    await settle();
    trigger().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: panel() }));
    await settle();
    expect(panel()).not.toBeNull();
  });

  it('gives each instance its own panel id', async () => {
    const second = TestBed.createComponent(NxsRichTooltipComponent);
    second.componentRef.setInput('heading', 'h');
    second.componentRef.setInput('content', 'c');
    second.componentRef.setInput('triggerLabel', 't');
    second.detectChanges();
    const ids = [trigger(), second.nativeElement.querySelector('button')].map((b) =>
      b.getAttribute('aria-controls'),
    );
    expect(new Set(ids).size).toBe(2);
  });

  it('refuses to render without its text inputs', () => {
    const bare = TestBed.createComponent(NxsRichTooltipComponent);
    expect(() => bare.detectChanges()).toThrow(/NG0950/);
  });
});
