import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SatInteractiveCard } from '@hylandsoftware/satori-ui/interactive-card';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { provideTranslateService } from '@ngx-translate/core';

import { NxsSatoriCardComponent } from './satori-card.component';

/**
 * The component on its own. What a click does, and the slots the outlet fills, are asserted in
 * `provide-nxs-satori-components.spec.ts`, where the card is rendered by its registered ID as
 * browse and search render it. These are the things that spec cannot reach: an input **changing**
 * after the first render, and what the wrapper hands to Satori's own inputs.
 */
describe('NxsSatoriCardComponent', () => {
  let fixture: ComponentFixture<NxsSatoriCardComponent>;

  /** Satori's card inside the wrapper: its inputs are bindings, not attributes. */
  function satoriCard(): SatInteractiveCard {
    return fixture.debugElement.query(By.directive(SatInteractiveCard))
      .componentInstance as SatInteractiveCard;
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function render(inputs: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsSatoriCardComponent],
      providers: [provideZonelessChangeDetection(), provideSatori(), provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsSatoriCardComponent);
  });

  it('marks the card active when it is selected, and not when it is not', () => {
    render({ heading: 'Claim 42', selected: true });
    expect(satoriCard().active()).toBe(true);
    render({ selected: false });
    expect(satoriCard().active()).toBe(false);
  });

  it('borders the card only while it has an openHandler', () => {
    render({ heading: 'Claim 42', openHandler: () => undefined });
    expect(satoriCard().border()).toBe(true);
    render({ openHandler: null });
    expect(satoriCard().border()).toBe(false);
  });

  it('turns the heading from a button into text when the openHandler is taken away', () => {
    render({ heading: 'Claim 42', openHandler: () => undefined });
    expect(host().querySelector('button.nxs-satori-card__heading')).not.toBeNull();
    render({ openHandler: null });
    expect(host().querySelector('button.nxs-satori-card__heading')).toBeNull();
    expect(host().querySelector('span.nxs-satori-card__heading')?.textContent?.trim()).toBe(
      'Claim 42',
    );
  });

  it('adds and removes the checkbox as the selection label gains and loses visible text', () => {
    render({ heading: 'Claim 42', selectionLabel: 'Select Claim 42' });
    expect(host().querySelector('mat-checkbox')).not.toBeNull();
    render({ selectionLabel: '  ' });
    expect(host().querySelector('mat-checkbox')).toBeNull();
  });

  it('trims the checkbox name, as the Material card does', () => {
    render({ heading: 'Claim 42', selectionLabel: ' Select Claim 42 ' });
    expect(
      host().querySelector('mat-checkbox input[type="checkbox"]')?.getAttribute('aria-label'),
    ).toBe('Select Claim 42');
  });

  it('reflects the selection on the host, for a grid that styles the selected cell', () => {
    render({ heading: 'Claim 42', selected: true });
    expect(host().classList).toContain('nxs-satori-card--selected');
    render({ selected: false });
    expect(host().classList).not.toContain('nxs-satori-card--selected');
  });

  it('calls the handler that is current when the checkbox is toggled, not the first one', () => {
    const first: boolean[] = [];
    const second: boolean[] = [];
    render({
      heading: 'Claim 42',
      selectionLabel: 'Select Claim 42',
      selectionHandler: (v: boolean) => first.push(v),
    });
    render({ selectionHandler: (v: boolean) => second.push(v) });
    host().querySelector<HTMLInputElement>('mat-checkbox input[type="checkbox"]')?.click();
    expect(first).toEqual([]);
    expect(second).toEqual([true]);
  });

  it('shows the heading in full as a tooltip, since the visible text is clamped to two lines', () => {
    const long = 'Supplier contract renewal — signed counterpart, scanned 2026-10-01.pdf';
    render({ heading: long, openHandler: () => undefined });
    expect(host().querySelector('button.nxs-satori-card__heading')?.getAttribute('title')).toBe(
      long,
    );
  });

  it('renders neither a checkbox nor a header slot for a card that is only a summary', () => {
    render({ heading: 'Q3 claims', selectionLabel: '', openHandler: null });
    expect(host().querySelector('.nxs-satori-card__corner')).toBeNull();
    expect(host().querySelector('mat-checkbox')).toBeNull();
    expect(host().querySelector('button')).toBeNull();
  });
});
