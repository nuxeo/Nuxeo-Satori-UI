import { Component, ElementRef, inject, input, ChangeDetectionStrategy } from '@angular/core';
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
 * NXSAT-746. Found and loaded without complaint; throws NG0950 on the first change detection
 * of its host view, which is after `createComponent` has already returned.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p class="needy">{{ mandatory() }}</p>',
})
class RequiresInputComponent {
  readonly mandatory = input.required<string>();
}

/**
 * Records whether its host element was in the document when `ngAfterViewInit` ran.
 *
 * Review of PR 532: the guarded draw was originally run *before* insertion, which left this
 * `false` — so a custom view that focuses a field or measures layout in that hook was quietly
 * broken, and insertion does not re-run the hook to repair it.
 */
let connectedAtAfterViewInit: boolean | null = null;

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p class="measured">measured</p>',
})
class MeasuresOnInitComponent {
  private readonly host = inject(ElementRef);
  ngAfterViewInit(): void {
    connectedAtAfterViewInit = (this.host.nativeElement as HTMLElement).isConnected;
  }
}

/**
 * Throws while drawn *and* again while torn down.
 *
 * Review of PR 532: a component whose draw threw may never have finished initialising, so its
 * `ngOnDestroy` can throw on a resource it expected to hold — and that error propagates out of
 * `ViewContainerRef.clear()`. Unguarded it escaped the catch, leaving the slot blank with
 * `unresolved()` never set.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p class="hostile">{{ mandatory() }}</p>',
})
class HostileOnDestroyComponent {
  readonly mandatory = input.required<string>();
  ngOnDestroy(): void {
    throw new Error('teardown blew up too');
  }
}

/** Throws for one input value and draws for the others — one bad document, not a bad entry. */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p class="picky">{{ drawn() }}</p>',
})
class PickyViewComponent {
  readonly title = input('');
  drawn(): string {
    if (this.title() === 'undrawable') throw new Error('cannot draw this document');
    return this.title();
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
   * NXSAT-746 — a component that **renders** badly, as opposed to one that cannot be found or
   * loaded. Angular has no error boundary: the throw lands on the first change detection of
   * the inserted host view, which happens on a later tick, so neither `createComponent` nor
   * `outlet.insert` can see it and the enclosing view is torn down with it.
   *
   * Verified against Angular 22.2.3 rather than assumed, because the two obvious guards do
   * not work: `try { outlet.insert(…) }` catches nothing (the throw is not synchronous), and
   * `reflectComponentType(type).inputs` exposes `propName`, `templateName` and `isSignal` but
   * **not** whether an input is required, so the descriptor cannot be refused up front.
   * Running that first pass ourselves, on the not-yet-inserted view, is what is catchable.
   */
  describe('a component that throws while it is drawn', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warn.mockRestore();
    });

    /** The warnings this outlet emitted, so an unrelated warning cannot pad the count. */
    function reported(): string[] {
      return warn.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes('[agentic-ui-extensions]'));
    }

    it('reports unresolved, renders nothing, and names the id once', async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.needy': RequiresInputComponent,
      });

      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.needy');
      await settle(fixture);

      expect(fixture.componentInstance.unresolved()).toBe(true);
      expect(fixture.componentInstance.loading()).toBe(false);
      expect(fixture.nativeElement.querySelector('.needy')).toBeNull();
      expect(reported()).toHaveLength(1);
      expect(reported()[0]).toContain('acme.views.needy');
    });

    /**
     * The catch has to fire for the *inserted* case too, which is the only one that reproduces
     * the ticket. Driving another change detection after the failure must not throw: before the
     * fix this is where NG0950 surfaced and took the host view with it.
     */
    it('leaves the host able to keep rendering', async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.needy': RequiresInputComponent,
      });
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.needy');
      await settle(fixture);

      expect(() => fixture.detectChanges()).not.toThrow();
      expect(fixture.componentInstance.unresolved()).toBe(true);
    });

    /**
     * Deliberate, not inherited: a render failure does **not** go back to the registry.
     * `retryUnresolved` exists because the registry does not cache a loader *rejection*, so
     * asking again can genuinely succeed. This component loaded fine, so the registry would
     * hand back the identical type and the re-render would throw in the same place — three
     * attempts and three warnings bought nothing. A new `componentInputs` value still re-renders
     * it (the test below), which is the case that can actually recover.
     */
    it('does not ask the registry again for a type that loaded and then threw', async () => {
      const resolve = vi.spyOn(TestBed.inject(ExtensionComponentRegistry), 'resolve');
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.needy': () => Promise.resolve(RequiresInputComponent),
      });
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.needy');
      fixture.componentRef.setInput('componentInputs', { title: 'first' });
      await settle(fixture);
      expect(resolve).toHaveBeenCalledTimes(1);

      fixture.componentRef.setInput('componentInputs', { title: 'second' });
      await settle(fixture);
      fixture.componentRef.setInput('componentInputs', { title: 'third' });
      await settle(fixture);

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.unresolved()).toBe(true);
    });

    /**
     * The other half of that decision. One document a view cannot draw must not poison the
     * view for every later document: the outlet instance survives navigating from one document
     * of a type to the next, so a sticky refusal would leave the customer on the packaged
     * viewer for the rest of the session.
     */
    it('renders again on a new inputs value, so one bad document does not poison the rest', async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.picky': PickyViewComponent,
      });
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.picky');
      fixture.componentRef.setInput('componentInputs', { title: 'undrawable' });
      await settle(fixture);

      expect(fixture.componentInstance.unresolved()).toBe(true);
      expect(fixture.nativeElement.querySelector('.picky')).toBeNull();

      fixture.componentRef.setInput('componentInputs', { title: 'the next document' });
      await settle(fixture);

      expect(fixture.componentInstance.unresolved()).toBe(false);
      expect(fixture.nativeElement.querySelector('.picky')?.textContent).toBe('the next document');
    });

    /**
     * Review of PR 532. The other direction, and the one the documentation had already promised:
     * a view that draws one document and throws on the **next**. That update goes through
     * `applyInputs` on the live instance, where `setInput` only marks the view dirty — so before
     * this, the throw landed on Angular's next pass with nothing guarding it, and the host got no
     * fallback. Seen red by dropping the `drawInserted` call from the same-keys branch.
     */
    it('falls back when a live component throws on the next document', async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.picky': PickyViewComponent,
      });
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.picky');
      fixture.componentRef.setInput('componentInputs', { title: 'the first document' });
      await settle(fixture);

      expect(fixture.nativeElement.querySelector('.picky')?.textContent).toBe('the first document');
      expect(fixture.componentInstance.unresolved()).toBe(false);

      // Same declared key, so this is the live-instance update path, not a recreate.
      fixture.componentRef.setInput('componentInputs', { title: 'undrawable' });
      await settle(fixture);

      expect(fixture.componentInstance.unresolved()).toBe(true);
      expect(fixture.nativeElement.querySelector('.picky')).toBeNull();
      expect(reported()).toHaveLength(1);
      expect(() => fixture.detectChanges()).not.toThrow();

      // And it comes back for the document after that, rather than staying fallen back.
      fixture.componentRef.setInput('componentInputs', { title: 'the third document' });
      await settle(fixture);

      expect(fixture.componentInstance.unresolved()).toBe(false);
      expect(fixture.nativeElement.querySelector('.picky')?.textContent).toBe('the third document');
    });

    /** Reported once per broken entry, not once per refetch of a document it cannot draw. */
    it('does not repeat the warning for the same component on every refetch', async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.picky': PickyViewComponent,
      });
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.picky');
      fixture.componentRef.setInput('componentInputs', { title: 'undrawable' });
      await settle(fixture);

      for (const refetch of [1, 2, 3]) {
        fixture.componentRef.setInput('componentInputs', { title: 'undrawable', refetch });
        await settle(fixture);
      }

      expect(fixture.componentInstance.unresolved()).toBe(true);
      expect(reported()).toHaveLength(1);
    });

    /**
     * Review of PR 532. The containment must not cost a valid component its connected DOM: the
     * guarded pass runs the component's lifecycle hooks, and a view that focuses a field or
     * measures layout in `ngAfterViewInit` needs its host element to be in the document by then.
     *
     * Seen red on purpose by moving the guarded `detectChanges()` back above `outlet.insert(…)`,
     * which is how this shipped for review: `isConnected` was `false`.
     */
    it('runs the component’s lifecycle hooks against DOM that is in the document', async () => {
      connectedAtAfterViewInit = null;
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.measured': MeasuresOnInitComponent,
      });
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.measured');
      await settle(fixture);

      expect(fixture.nativeElement.querySelector('.measured')).toBeTruthy();
      expect(connectedAtAfterViewInit).toBe(true);
      expect(reported()).toHaveLength(0);
    });

    /**
     * Review of PR 532. A failed draw leaves a half-initialised component, so its `ngOnDestroy`
     * can throw as well — and that error comes out of `ViewContainerRef.clear()`. The fallback
     * must not depend on the teardown succeeding.
     *
     * Seen red on purpose by tearing down before setting `unresolved()`: the teardown's throw
     * escaped `render()` and the outlet reported nothing, so the host had no fallback signal.
     */
    it('still falls back when the component’s own teardown throws as well', async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.hostile': HostileOnDestroyComponent,
      });
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.hostile');
      await settle(fixture);

      expect(fixture.componentInstance.unresolved()).toBe(true);
      expect(fixture.componentInstance.loading()).toBe(false);
      expect(fixture.nativeElement.querySelector('.hostile')).toBeNull();
      // One report, naming the entry, covering both errors rather than reading as two problems.
      expect(reported()).toHaveLength(1);
      expect(reported()[0]).toContain('acme.views.hostile');
      expect(reported()[0]).toContain('discarded');
      expect(() => fixture.detectChanges()).not.toThrow();
    });

    /**
     * The guard must not swallow a working render. `detectChanges()` on the inserted host view
     * runs the component's first pass a step earlier than the enclosing view would have; a valid
     * component has to come out the other side rendered, with its inputs applied and no warning.
     */
    it('renders a valid component through the same guarded pass', async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.views.needy': RequiresInputComponent,
      });
      const fixture = TestBed.createComponent(ExtensionOutletComponent);
      fixture.componentRef.setInput('componentId', 'acme.views.needy');
      fixture.componentRef.setInput('componentInputs', { mandatory: 'supplied' });
      await settle(fixture);

      expect(fixture.componentInstance.unresolved()).toBe(false);
      expect(fixture.nativeElement.querySelector('.needy')?.textContent).toBe('supplied');
      expect(reported()).toHaveLength(0);
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
