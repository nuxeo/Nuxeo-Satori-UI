import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { provideTranslateService } from '@ngx-translate/core';

import { NxsSatoriEmptyStateComponent } from './satori-empty-state.component';

/**
 * The component on its own. Which implementation the ID resolves to, and the live-region parity
 * with Material, are asserted in `provide-nxs-satori-components.spec.ts`. These are the things that
 * spec cannot reach: an input **changing** after the first render, and the host's own attributes.
 */
describe('NxsSatoriEmptyStateComponent', () => {
  let fixture: ComponentFixture<NxsSatoriEmptyStateComponent>;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function render(inputs: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsSatoriEmptyStateComponent],
      providers: [provideZonelessChangeDetection(), provideSatori(), provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsSatoriEmptyStateComponent);
  });

  // The design decision, asserted rather than only written down: Satori's own element is the live
  // region, so a second one here would announce the same text twice.
  it('leaves the live region to sat-empty-state and adds none of its own', () => {
    render({ heading: 'No documents here' });
    // `componentRef.location` is the wrapper's own element, rather than the fixture's root, so this
    // reads the role the wrapper itself carries.
    // TestBed builds a root `div` and applies the host bindings to it, so the class identifies it
    // rather than the tag name — and `role` would be on it too if the wrapper declared one.
    const wrapper = fixture.componentRef.location.nativeElement as HTMLElement;
    expect(wrapper.classList).toContain('nxs-satori-empty-state');
    expect(wrapper.getAttribute('role')).toBeNull();
    expect(wrapper.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(wrapper.querySelector('sat-empty-state')?.getAttribute('role')).toBe('status');
  });

  it('moves the heading to a new level without leaving the old one behind', () => {
    render({ heading: 'No results', headingLevel: 2 });
    expect(host().querySelector('h2[satEmptyStateHeadline]')).not.toBeNull();
    render({ headingLevel: 4 });
    expect(host().querySelector('h2[satEmptyStateHeadline]')).toBeNull();
    expect(host().querySelector('h4[satEmptyStateHeadline]')?.textContent?.trim()).toBe(
      'No results',
    );
  });

  it('follows a changed heading, not the first one', () => {
    render({ heading: 'No results' });
    render({ heading: 'No matching documents' });
    expect(host().querySelector('[satEmptyStateHeadline]')?.textContent?.trim()).toBe(
      'No matching documents',
    );
  });

  it('adds and removes the description as the message comes and goes', () => {
    render({ heading: 'No results' });
    expect(host().querySelector('[satEmptyStateDescription]')).toBeNull();
    render({ message: 'Try a different filter.' });
    expect(host().querySelector('[satEmptyStateDescription]')?.textContent?.trim()).toBe(
      'Try a different filter.',
    );
    render({ message: '' });
    expect(host().querySelector('[satEmptyStateDescription]')).toBeNull();
  });

  it('adds and removes the illustration as the icon comes and goes', () => {
    render({ heading: 'No results' });
    expect(host().querySelector('[satEmptyStateIllustration]')).toBeNull();
    render({ icon: 'search_off' });
    expect(host().querySelector('[satEmptyStateIllustration]')).not.toBeNull();
    render({ icon: '' });
    expect(host().querySelector('[satEmptyStateIllustration]')).toBeNull();
  });

  // Matching the Material implementation, which renders on truthiness. Trimming would be the better
  // behaviour, and is deliberately not introduced on one side only — see the component's comment.
  it('renders a whitespace-only message as the Material implementation does: an empty line', () => {
    render({ heading: 'No results', message: '   ' });
    expect(host().querySelector('[satEmptyStateDescription]')).not.toBeNull();
  });

  it('renders the action slot even with nothing in it, so a host can project later', () => {
    render({ heading: 'No results' });
    expect(host().querySelector('[satEmptyStateAction]')).not.toBeNull();
  });
});
