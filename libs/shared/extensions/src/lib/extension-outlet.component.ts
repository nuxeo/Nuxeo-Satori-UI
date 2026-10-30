import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EnvironmentInjector,
  Injector,
  ViewChild,
  ViewContainerRef,
  createComponent,
  effect,
  inject,
  input,
  reflectComponentType,
  signal,
  untracked,
  type ComponentRef,
  type Type,
} from '@angular/core';

import { ExtensionComponentRegistry } from './extension-component-registry.service';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Renders a component resolved from the registry, by ID or by type.
 *
 * This is the **shared component-resolution primitive** that route, tab, viewer
 * and drawer extensions all need. It generalises the shell's
 * `DynamicDrawerComponent`, which took only an eagerly imported
 * `Type<unknown>`, in three ways that each unblock a slot:
 *
 * - accepts a registered **ID**, which is what a manifest can name;
 * - resolves **lazily loaded** components, so a tab or route panel in a
 *   lazy feature library does not have to be statically imported by the shell;
 * - binds **inputs**, so a descriptor can pass configuration to the component it
 *   names.
 *
 * It uses `createComponent()` rather than `ViewContainerRef.createComponent()`
 * because the former accepts `bindings`/`environmentInjector` explicitly, which
 * is what makes input binding to a dynamically chosen component possible at all.
 *
 * A change to `componentInputs` values is applied to the live instance. The `documentView`
 * slot feeds the focused document, which is a new object on every refetch, and recreating
 * on each one would discard whatever state the rendered view holds. A change of component,
 * or of which declared inputs are set, recreates it: in place, an input the new inputs
 * omit would keep its previous value. While a lazy component loads, nothing is shown.
 * After a loader rejects, the next `componentInputs` change retries it, at most twice.
 *
 * A component that is found and loaded and then **throws while being drawn** leaves the outlet
 * unresolved too, rather than taking the enclosing view down with it — see
 * {@link drawInserted} for why that needs its own change-detection pass, and for the limit on
 * how much of the failure it can contain.
 */
@Component({
  selector: 'lib-extension-outlet',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './extension-outlet.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExtensionOutletComponent {
  /** Registered component ID to render. Takes precedence over `componentType`. */
  readonly componentId = input<string | null>(null);
  /** An already-imported component, for callers that have one in hand. */
  readonly componentType = input<Type<unknown> | null>(null);
  /**
   * Inputs to set on the rendered component. Unknown keys are ignored.
   *
   * The `?? {}` in the effect below is not defensive padding. `withComponentInputBinding()`
   * sets **every declared input** from route data, passing `undefined` for keys the
   * route does not supply — which overrides this default. So routing straight to this
   * component with `data: { componentId: '...' }` made `componentInputs()` `undefined`
   * and `Object.entries()` threw, blanking the route. Both this template and the
   * product bootstrap with `withComponentInputBinding()`, so the crash was reachable
   * from either.
   */
  readonly componentInputs = input<Readonly<Record<string, unknown>> | null | undefined>({});

  readonly loading = signal(false);
  /**
   * True when there is nothing rendered here, so the host can render a fallback.
   *
   * Three ways to get there: no component is registered under the id, its loader rejected, or
   * it threw while being drawn ({@link drawInserted}). The name reads as the first two, and the
   * third is deliberately folded in rather than given a signal of its own: what a host needs to
   * know is the same in all three cases — the slot is empty, show your own content — and a
   * second signal would mean every host had to read both and would quietly miss one of them.
   */
  readonly unresolved = signal(false);

  @ViewChild('outlet', { static: true, read: ViewContainerRef })
  private outlet!: ViewContainerRef;

  private readonly registry = inject(ExtensionComponentRegistry);
  private readonly injector = inject(Injector);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private componentRef: ComponentRef<unknown> | null = null;
  private renderedType: Type<unknown> | null = null;
  /** Public names of the inputs the rendered component declares. */
  private declaredInputs: ReadonlySet<string> = new Set();
  /** The declared input names last set, from {@link declaredKeysOf}. */
  private appliedKeys: ReadonlySet<string> = new Set();
  /** Bumped on every request so a slow load cannot overwrite a newer one. */
  private generation = 0;
  /** Retries left for the requested id after its loader rejected — {@link retryUnresolved}. */
  private retriesLeft = 0;
  /** A retry's load is pending; updates meanwhile ride on it rather than starting another. */
  private retrying = false;
  private static readonly MAX_RETRIES = 2;
  /** The type whose draw threw — {@link drawInserted}. Not reloaded; redrawn on new inputs. */
  private failedType: Type<unknown> | null = null;
  /** The `componentInputs` value that draw was given, so the same one is not drawn twice. */
  private failedInputs: Readonly<Record<string, unknown>> | null | undefined = undefined;
  /** The id {@link reportFailedDraw} has already warned about. */
  private warnedFor: string | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clear());

    effect(() => {
      const id = this.componentId();
      const type = this.componentType();
      const generation = ++this.generation;

      if (type) {
        untracked(() => this.render(type, generation));
        return;
      }
      if (!id) {
        this.clear();
        this.loading.set(false);
        this.unresolved.set(false);
        return;
      }

      const immediate = this.registry.peek(id);
      if (immediate) {
        untracked(() => this.render(immediate, generation));
        return;
      }

      this.retriesLeft = ExtensionOutletComponent.MAX_RETRIES;
      this.retrying = false;
      untracked(() => this.load(id, generation, false));
    });

    effect(() => {
      const requested = this.componentInputs();
      const inputs = requested ?? {};
      untracked(() => {
        const failed = this.failedType;
        if (failed) {
          // Draw it again, rather than resolving it again. A draw that threw is not a load
          // that rejected: the registry holds the type and would hand back the same one, so
          // {@link retryUnresolved} could only reach the same throw. A new inputs value can
          // genuinely differ — it is usually the next document — so that is what retries,
          // and the value already tried is not tried twice.
          if (requested !== this.failedInputs) this.render(failed, this.generation);
          return;
        }
        if (!this.componentRef || !this.renderedType) {
          this.retryUnresolved();
          return;
        }
        if (this.setsAppliedKeys(inputs)) {
          this.applyInputs(this.componentRef, inputs);
          // Draw it here too. `setInput` only marks the view dirty, so a component that drew one
          // document and throws on the next would otherwise throw on Angular's next pass, with
          // nothing to catch it — the live-instance update was the one way back into the defect
          // after the first draw was guarded. Caught in review of PR 532.
          this.drawInserted(this.componentRef, this.renderedType);
        } else {
          this.render(this.renderedType, this.generation);
        }
      });
    });
  }

  /**
   * Resolve `id` and render it, or mark the outlet unresolved.
   *
   * A `retry` leaves the outlet as it is — unresolved, nothing rendered, no loading state —
   * until the load settles, so a host showing its fallback keeps showing it rather than
   * blanking for the length of a chunk request that may fail again.
   */
  private load(id: string, generation: number, retry: boolean): void {
    if (!retry) {
      this.clear();
      this.loading.set(true);
      this.unresolved.set(false);
    }
    void this.registry.resolve(id).then((resolvedType) => {
      if (generation !== this.generation) return;
      if (retry) this.retrying = false;
      this.loading.set(false);
      if (!resolvedType) {
        this.clear();
        this.unresolved.set(true);
        return;
      }
      this.render(resolvedType, generation);
    });
  }

  /**
   * Ask again for a registered component whose loader rejected.
   *
   * The registry does not cache a rejection, so a transient chunk failure is recoverable —
   * but only if something asks. A new `componentInputs` value is a fresh render request
   * (for `documentView`, a refetched or different document), so it retries. Bounded by
   * {@link MAX_RETRIES} per requested id, so a loader that always fails is called three
   * times in all rather than on every refetch. An id nothing registered is not retried:
   * that is a missing library, not a transient failure.
   *
   * An update while a retry is still loading starts nothing and spends nothing: the
   * registry would fold it onto the pending load, and the retry renders with whatever
   * inputs are current when it lands.
   *
   * This is for a loader that **rejected**. A component that loaded and then threw while being
   * drawn does not come through here at all — {@link drawInserted} redraws it instead, because
   * the registry is holding the type and would only hand back the same one.
   */
  private retryUnresolved(): void {
    const id = this.componentId();
    if (this.retrying || !this.unresolved() || !id || this.componentType()) return;
    if (this.retriesLeft <= 0 || !this.registry.has(id)) return;
    this.retriesLeft -= 1;
    this.retrying = true;
    this.load(id, ++this.generation, true);
  }

  private render(type: Type<unknown>, generation: number): void {
    if (generation !== this.generation) return;
    this.clear();

    const ref = createComponent(type, {
      environmentInjector: this.environmentInjector,
      elementInjector: this.injector,
    });
    this.declaredInputs = new Set(
      reflectComponentType(type)?.inputs.map((declared) => declared.templateName) ?? [],
    );
    this.applyInputs(ref, this.componentInputs() ?? {});

    // Insert first, then draw — see {@link drawInserted}. The component's lifecycle hooks must
    // run against DOM that is in the document, which only insertion makes true.
    this.outlet.insert(ref.hostView);

    if (!this.drawInserted(ref, type)) return;

    this.componentRef = ref;
    this.renderedType = type;
    this.loading.set(false);
    this.unresolved.set(false);
  }

  /**
   * Drive the inserted component's first change detection ourselves, where a throw is catchable.
   *
   * Angular has no error boundary. Insertion attaches the host view to the **enclosing** view's
   * change detection, so a component that throws while being drawn — a required input the
   * descriptor never supplies, a mistyped input name, a document it cannot read — throws on a
   * later tick, and whatever that pass was drawing is abandoned with it. That is how one
   * `documentView` entry emptied the View tab, with no fallback and nothing reported: 33
   * uncaught NG0950s in a single page load (NXSAT-746). How much goes with it depends on where
   * the enclosing view's boundaries fall — the ticket reported the whole tab group, and on the
   * build this landed on the tab strip survives and only the body is lost — so the useful
   * guarantee is about what the throw cannot reach, not about which neighbours happened to live.
   *
   * Three shapes of guard that look right, and what each actually does — all measured against
   * Angular 22.2.3 rather than reasoned about:
   *
   * - `try { this.outlet.insert(…) } catch {}` catches nothing. `insert` does not detect changes
   *   synchronously, so the throw arrives after the `try` has returned — the same "catch that
   *   never fires" {@link applyInputs} is pointed about.
   * - refusing the descriptor up front needs to know an input is required, and
   *   `reflectComponentType(type).inputs` exposes `propName`, `templateName`, `transform` and
   *   `isSignal` and nothing else. There is no public metadata to read.
   * - detecting changes **before** inserting also catches it, and was how this first shipped for
   *   review. It is wrong: the host element is not in the document until insertion, so
   *   `ngAfterViewInit` ran against a disconnected tree — measured `isConnected === false` — and
   *   insertion does not re-run the hook. Any custom view that focuses a field or measures
   *   layout there would have been quietly broken, which is a steep price for containing a
   *   failure. Caught in review of PR 532.
   *
   * So: insert, then draw. Forcing that pass is what puts the throw inside a `try`, and it is
   * work the enclosing view's next pass would have done anyway — a valid component pays only for
   * the order of two statements.
   *
   * Called for **both** ways a draw happens: a newly created component, and a live one whose
   * inputs have just changed. `setInput` only marks the view dirty, so without the second call a
   * component that drew one document and threw on the next was back to throwing on a pass nobody
   * guarded. Review of PR 532 found that gap, which the documentation had already promised away.
   *
   * **What it still does not contain:** a throw on a change detection *we* did not trigger — the
   * component's own asynchronous state settling, or a signal it writes to itself. That tick
   * belongs to Angular, and catching it needs an error boundary Angular does not have.
   *
   * **And one thing it costs, on the recovery path only.** A draw that follows an earlier failure
   * runs while `unresolved()` is still true, because only a successful draw clears it. A host may
   * be hiding the outlet on exactly that signal — `document-detail` does, with `display: none` —
   * so a recovering component's `ngAfterViewInit` can run in a hidden subtree, where a
   * one-shot `getBoundingClientRect()` reads zero and `focus()` does nothing. Raised in review of
   * PR 532 and **not fixed here**: the class belongs to the host's template, so clearing the
   * signal first would not remove it synchronously, and coordinating properly needs a third
   * outlet state — public API this ticket is not the place to widen. NXSAT-758.
   *
   * @returns whether the component drew, and may therefore be kept.
   */
  private drawInserted(ref: ComponentRef<unknown>, type: Type<unknown>): boolean {
    try {
      ref.changeDetectorRef.detectChanges();
      // Here rather than in `render`, so a draw that recovers clears the key whichever call site
      // drew it — a component that breaks again after working is news again.
      this.warnedFor = null;
      return true;
    } catch (error) {
      // The fallback state goes first, before anything that could throw again: the host reads
      // `unresolved()` to decide what to render, and reaching the teardown is not a precondition
      // for the slot being empty.
      this.failedType = type;
      this.failedInputs = this.componentInputs();
      // Null for the same reason: called for a live instance, this leaves nothing rendered, and
      // a stale `componentRef` would send the next inputs change to a destroyed component.
      this.componentRef = null;
      this.renderedType = null;
      this.declaredInputs = new Set();
      this.appliedKeys = new Set();
      this.loading.set(false);
      this.unresolved.set(true);
      this.reportFailedDraw(type, error, this.discard(ref));
      return false;
    }
  }

  /**
   * Remove and destroy a view that could not be drawn, surviving a teardown that throws too.
   *
   * A component whose draw threw may never have finished initialising, so its `ngOnDestroy` can
   * throw on a resource it expected to hold — measured: a throwing `ngOnDestroy` propagates out
   * of `ViewContainerRef.clear()`. Unguarded, that escaped the `catch` above and left the slot
   * blank with `unresolved()` never set, which is the defect this method exists inside. Each step
   * is attempted whatever the other did, because skipping the second would leak the one the first
   * failed to clean up. Caught in review of PR 532.
   *
   * @returns the first error the teardown threw, for the diagnostic, or `null`.
   */
  private discard(ref: ComponentRef<unknown>): unknown {
    let thrown: unknown = null;
    try {
      this.outlet.clear();
    } catch (error) {
      thrown = error;
    }
    try {
      ref.destroy();
    } catch (error) {
      thrown ??= error;
    }
    return thrown;
  }

  /**
   * Say so once, naming the component, because nothing else reports this.
   *
   * Keyed on the id so a document the component cannot draw is reported when it is first seen
   * and not again on every refetch of it — the symptom is a configuration mistake, and
   * repeating it per change-detection cycle would bury it. A successful draw clears the key,
   * so a component that breaks again after working is news again.
   *
   * One call, both errors: a failed teardown is a consequence of the failed draw, and reporting
   * it separately would read as two unrelated problems.
   */
  private reportFailedDraw(type: Type<unknown>, error: unknown, teardownError: unknown): void {
    const label = this.componentId() ?? type.name;
    if (this.warnedFor === label) return;
    this.warnedFor = label;
    if (teardownError) {
      console.warn(
        `[agentic-ui-extensions] "${label}" threw while it was being drawn, and again while it ` +
          `was being discarded, so the slot kept its packaged content instead. Check the inputs ` +
          `the manifest entry sets for it.`,
        error,
        teardownError,
      );
      return;
    }
    console.warn(
      `[agentic-ui-extensions] "${label}" threw while it was being drawn, so the slot kept its ` +
        `packaged content instead. Check the inputs the manifest entry sets for it.`,
      error,
    );
  }

  /**
   * Set the inputs the component declares, and only those.
   *
   * A descriptor's inputs are customer-authored, and a host may offer an input not every
   * component wants — `documentView` always offers `document`. `setInput` does not throw
   * on an undeclared name; in a development build it logs NG0303 to the console, so the
   * filter is what keeps an unused key silent rather than a `catch` that never fires.
   */
  private applyInputs(ref: ComponentRef<unknown>, inputs: Readonly<Record<string, unknown>>): void {
    this.appliedKeys = this.declaredKeysOf(inputs);
    for (const [name, value] of Object.entries(inputs)) {
      if (!this.declaredInputs.has(name)) continue;
      // A declared input's `transform` is the component's code, run on customer data;
      // a value it rejects must not blank the panel.
      try {
        ref.setInput(name, value);
      } catch {
        /* keep the rest of the inputs and the rendered component */
      }
    }
  }

  /** The declared input names `inputs` sets. */
  private declaredKeysOf(inputs: Readonly<Record<string, unknown>>): ReadonlySet<string> {
    return new Set(Object.keys(inputs).filter((name) => this.declaredInputs.has(name)));
  }

  /** Whether `inputs` sets exactly the declared inputs last applied. */
  private setsAppliedKeys(inputs: Readonly<Record<string, unknown>>): boolean {
    const keys = this.declaredKeysOf(inputs);
    return (
      keys.size === this.appliedKeys.size && [...keys].every((name) => this.appliedKeys.has(name))
    );
  }

  private clear(): void {
    this.outlet?.clear();
    this.componentRef?.destroy();
    this.componentRef = null;
    this.renderedType = null;
    this.declaredInputs = new Set();
    this.appliedKeys = new Set();
    this.failedType = null;
    this.failedInputs = undefined;
  }
}
