import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ExtensionComponentRegistry } from './extension-component-registry.service';
import { ExtensionOutletComponent } from './extension-outlet.component';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p class="panel">registered panel</p>',
})
class RegisteredPanelComponent {}

let viewInstances = 0;

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p class="view">{{ title() }}</p>',
})
class DocumentViewComponent {
  readonly title = input('');
  constructor() {
    viewInstances += 1;
  }
}

/**
 * Drive one resolve-and-render cycle.
 *
 * Three phases, and all three are needed: `detectChanges()` runs the effect, which
 * *starts* the dynamic import; the macrotask lets that promise settle; the second
 * `detectChanges()` renders what it produced. `whenStable()` alone was not enough —
 * the load is a plain promise the fixture does not track.
 */
async function settle(fixture: { detectChanges: () => void }) {
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

/**
 * The outlet is how a manifest turns an ID into rendered UI, so the cases worth
 * pinning are the ones where the ID resolves to nothing useful.
 */
describe('ExtensionOutletComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [testTranslateModule(), ExtensionOutletComponent] });
  });

  it('renders a component registered under an ID', async () => {
    TestBed.inject(ExtensionComponentRegistry).register({
      'acme.panel.reports': () => Promise.resolve(RegisteredPanelComponent),
    });

    const fixture = TestBed.createComponent(ExtensionOutletComponent);
    fixture.componentRef.setInput('componentId', 'acme.panel.reports');
    await settle(fixture);

    expect(fixture.nativeElement.querySelector('.panel')).toBeTruthy();
    expect(fixture.componentInstance.unresolved()).toBe(false);
  });

  it('survives componentInputs being undefined, as router input binding makes it', async () => {
    // The regression this pins. `withComponentInputBinding()` sets *every* declared
    // input from route data, passing `undefined` for keys the route omits — which
    // overrides the `{}` default on the input. Routing straight to the outlet with
    // `data: { componentId: '...' }` therefore made `componentInputs()` `undefined`,
    // and `Object.entries(undefined)` threw inside `render()`, blanking the route.
    //
    // Watched fail on purpose: with the `?? {}` removed this throws
    // "Cannot convert undefined or null to object" and the panel never renders.
    TestBed.inject(ExtensionComponentRegistry).register({
      'acme.panel.reports': () => Promise.resolve(RegisteredPanelComponent),
    });

    const fixture = TestBed.createComponent(ExtensionOutletComponent);
    fixture.componentRef.setInput('componentId', 'acme.panel.reports');
    fixture.componentRef.setInput('componentInputs', undefined);
    await settle(fixture);

    expect(fixture.nativeElement.querySelector('.panel')).toBeTruthy();
  });

  it('reports unresolved rather than throwing for an unknown ID', async () => {
    // A manifest may name a component a newer build provides. That has to leave the
    // host able to render a fallback, not take the application down.
    const fixture = TestBed.createComponent(ExtensionOutletComponent);
    fixture.componentRef.setInput('componentId', 'acme.panel.doesNotExist');
    await settle(fixture);

    expect(fixture.componentInstance.unresolved()).toBe(true);
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  describe('inputs', () => {
    beforeEach(() => {
      viewInstances = 0;
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.claim': DocumentViewComponent,
      });
    });

    /**
     * A host may offer an input not every component declares — `documentView` always
     * offers `document`. Angular's `setInput` does not throw on an undeclared name: in a
     * development build it logs NG0303, so a `try/catch` around it never fired.
     */
    it('sets the inputs a component declares and skips the rest without logging', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.claim');
      fixture.componentRef.setInput('componentInputs', {
        title: 'Claim 42',
        document: { uid: 'x' },
      });
      await settle(fixture);

      expect(fixture.nativeElement.querySelector('.view')?.textContent).toBe('Claim 42');
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });

    /**
     * The focused document is a new object on every refetch. Recreating the component for
     * each one would throw away whatever state the rendered view holds.
     */
    it('updates the live component when only its inputs change', async () => {
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.claim');
      fixture.componentRef.setInput('componentInputs', { title: 'first' });
      await settle(fixture);

      fixture.componentRef.setInput('componentInputs', { title: 'second' });
      await settle(fixture);

      expect(fixture.nativeElement.querySelector('.view')?.textContent).toBe('second');
      expect(viewInstances).toBe(1);
    });

    it('recreates the component when the id changes', async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.case': DocumentViewComponent,
      });
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.claim');
      fixture.componentRef.setInput('componentInputs', { title: 'kept' });
      await settle(fixture);

      fixture.componentRef.setInput('componentId', 'acme.views.case');
      await settle(fixture);

      expect(viewInstances).toBe(2);
      expect(fixture.nativeElement.querySelectorAll('.view')).toHaveLength(1);
      expect(fixture.nativeElement.querySelector('.view')?.textContent).toBe('kept');
    });

    /**
     * Two descriptors can share a component and differ in inputs. Updating in place would
     * leave a key the second one omits at the first one's value, so a changed key set
     * recreates instead.
     */
    it('does not keep the value of an input the new inputs omit', async () => {
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.claim');
      fixture.componentRef.setInput('componentInputs', { title: 'Claim summary' });
      await settle(fixture);

      fixture.componentRef.setInput('componentInputs', { document: { uid: 'y' } });
      await settle(fixture);

      expect(fixture.nativeElement.querySelector('.view')?.textContent).toBe('');
    });

    /**
     * Switching to a component that is still loading must not leave the previous one on
     * screen: it would be interactive, and the in-place input path would hand it the new
     * document.
     */
    it('removes the previous component while the next one loads', async () => {
      let finishLoad: (type: typeof RegisteredPanelComponent) => void = () => undefined;
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.slow': () =>
          new Promise<typeof RegisteredPanelComponent>((resolve) => (finishLoad = resolve)),
      });
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.claim');
      fixture.componentRef.setInput('componentInputs', { title: 'Claim 42' });
      await settle(fixture);

      fixture.componentRef.setInput('componentId', 'acme.views.slow');
      await settle(fixture);

      expect(fixture.componentInstance.loading()).toBe(true);
      expect(fixture.nativeElement.querySelector('.view')).toBeNull();

      finishLoad(RegisteredPanelComponent);
      await settle(fixture);

      expect(fixture.nativeElement.querySelector('.panel')).toBeTruthy();
    });
  });

  /**
   * The registry retries a loader that rejected (its spec pins that), so the outlet must ask
   * again rather than staying unresolved for as long as it lives. A transient chunk failure
   * would otherwise pin a `documentView` to the packaged fallback across every refetch.
   */
  describe('after a failed load', () => {
    let attempts = 0;

    function registerLoader(load: (attempt: number) => Promise<typeof DocumentViewComponent>) {
      attempts = 0;
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.flaky': () => load(++attempts),
      });
    }

    async function renderFlaky() {
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.flaky');
      fixture.componentRef.setInput('componentInputs', { title: 'first' });
      await settle(fixture);
      return fixture;
    }

    it('retries on the next inputs change and renders once the loader recovers', async () => {
      registerLoader((attempt) =>
        attempt === 1
          ? Promise.reject(new Error('chunk load failed'))
          : Promise.resolve(DocumentViewComponent),
      );
      const fixture = await renderFlaky();
      expect(fixture.componentInstance.unresolved()).toBe(true);

      fixture.componentRef.setInput('componentInputs', { title: 'second' });
      await settle(fixture);

      expect(attempts).toBe(2);
      expect(fixture.componentInstance.unresolved()).toBe(false);
      expect(fixture.nativeElement.querySelector('.view')?.textContent).toBe('second');
    });

    it('stays unresolved while the retry is in flight, so the host fallback stays up', async () => {
      let finishRetry: (type: typeof DocumentViewComponent) => void = () => undefined;
      registerLoader((attempt) =>
        attempt === 1
          ? Promise.reject(new Error('chunk load failed'))
          : new Promise((resolve) => (finishRetry = resolve)),
      );
      const fixture = await renderFlaky();

      fixture.componentRef.setInput('componentInputs', { title: 'second' });
      await settle(fixture);

      expect(attempts).toBe(2);
      expect(fixture.componentInstance.unresolved()).toBe(true);
      expect(fixture.componentInstance.loading()).toBe(false);

      finishRetry(DocumentViewComponent);
      await settle(fixture);

      expect(fixture.componentInstance.unresolved()).toBe(false);
      expect(fixture.nativeElement.querySelector('.view')?.textContent).toBe('second');
    });

    it('stops retrying a loader that keeps failing', async () => {
      registerLoader(() => Promise.reject(new Error('chunk load failed')));
      const fixture = await renderFlaky();

      for (let change = 0; change < 5; change += 1) {
        fixture.componentRef.setInput('componentInputs', { title: `change ${change}` });
        await settle(fixture);
      }

      expect(attempts).toBe(3);
      expect(fixture.componentInstance.unresolved()).toBe(true);
    });

    /**
     * The registry folds a resolve made while one is pending onto the same promise, so an
     * update during an in-flight retry starts no new attempt and must not spend the budget.
     */
    it('spends no retry on an update made while a retry is still loading', async () => {
      let failRetry: (error: Error) => void = () => undefined;
      registerLoader((attempt) =>
        attempt === 2
          ? new Promise((_resolve, reject) => (failRetry = reject))
          : attempt === 1
            ? Promise.reject(new Error('chunk load failed'))
            : Promise.resolve(DocumentViewComponent),
      );
      const fixture = await renderFlaky();

      fixture.componentRef.setInput('componentInputs', { title: 'second' });
      await settle(fixture);
      fixture.componentRef.setInput('componentInputs', { title: 'third' });
      await settle(fixture);
      expect(attempts).toBe(2);

      failRetry(new Error('chunk load failed'));
      await settle(fixture);
      fixture.componentRef.setInput('componentInputs', { title: 'fourth' });
      await settle(fixture);

      expect(attempts).toBe(3);
      expect(fixture.nativeElement.querySelector('.view')?.textContent).toBe('fourth');
    });

    it('gives a new id its own retries', async () => {
      registerLoader(() => Promise.reject(new Error('chunk load failed')));
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.alsoFlaky': () => {
          attempts += 1;
          return Promise.reject(new Error('chunk load failed'));
        },
      });
      const fixture = await renderFlaky();
      for (let change = 0; change < 3; change += 1) {
        fixture.componentRef.setInput('componentInputs', { title: `change ${change}` });
        await settle(fixture);
      }
      expect(attempts).toBe(3);

      fixture.componentRef.setInput('componentId', 'acme.views.alsoFlaky');
      await settle(fixture);
      fixture.componentRef.setInput('componentInputs', { title: 'after switch' });
      await settle(fixture);

      expect(attempts).toBe(5);
    });

    it('does not retry an id nothing registered', async () => {
      const resolve = vi.spyOn(TestBed.inject(ExtensionComponentRegistry), 'resolve');
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.notShipped');
      await settle(fixture);

      fixture.componentRef.setInput('componentInputs', { title: 'again' });
      await settle(fixture);

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.unresolved()).toBe(true);
    });
  });
});
