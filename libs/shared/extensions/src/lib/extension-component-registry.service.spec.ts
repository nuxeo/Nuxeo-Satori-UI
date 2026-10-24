import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ExtensionComponentRegistry } from './extension-component-registry.service';

@Component({
  selector: 'lib-eager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: 'eager',
})
class EagerComponent {}

@Component({
  selector: 'lib-lazy',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: 'lazy',
})
class LazyComponent {}

describe('ExtensionComponentRegistry', () => {
  let registry: ExtensionComponentRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ExtensionComponentRegistry);
  });

  it('returns an eagerly registered component without awaiting', () => {
    registry.register({ 'app.sidebar.eager': EagerComponent });
    expect(registry.peek('app.sidebar.eager')).toBe(EagerComponent);
  });

  it('resolves a component behind a dynamic import', async () => {
    registry.register({ 'app.sidebar.lazy': () => Promise.resolve(LazyComponent) });
    expect(registry.peek('app.sidebar.lazy')).toBeNull();
    await expect(registry.resolve('app.sidebar.lazy')).resolves.toBe(LazyComponent);
    expect(registry.peek('app.sidebar.lazy')).toBe(LazyComponent);
  });

  it('shares an in-flight load rather than fetching the chunk twice', async () => {
    let calls = 0;
    registry.register({
      'app.sidebar.lazy': () => {
        calls += 1;
        return Promise.resolve(LazyComponent);
      },
    });

    await Promise.all([registry.resolve('app.sidebar.lazy'), registry.resolve('app.sidebar.lazy')]);
    expect(calls).toBe(1);
  });

  it('lists registered ids for the reference doc', () => {
    registry.register({ 'b.two': EagerComponent, 'a.one': EagerComponent });
    expect(registry.registeredComponentIds()).toEqual(['a.one', 'b.two']);
  });

  it('lets a later registration replace an already resolved component', async () => {
    registry.register({ 'app.sidebar.x': () => Promise.resolve(LazyComponent) });
    await registry.resolve('app.sidebar.x');
    registry.register({ 'app.sidebar.x': EagerComponent });
    expect(registry.peek('app.sidebar.x')).toBe(EagerComponent);
  });

  describe('error paths', () => {
    it('resolves an unregistered id to null rather than throwing', async () => {
      expect(registry.has('app.sidebar.absent')).toBe(false);
      await expect(registry.resolve('app.sidebar.absent')).resolves.toBeNull();
    });

    it('resolves to null when the chunk fails to load, and retries next time', async () => {
      let attempt = 0;
      registry.register({
        'app.sidebar.flaky': () => {
          attempt += 1;
          return attempt === 1
            ? Promise.reject(new Error('chunk load failed'))
            : Promise.resolve(LazyComponent);
        },
      });

      await expect(registry.resolve('app.sidebar.flaky')).resolves.toBeNull();
      await expect(registry.resolve('app.sidebar.flaky')).resolves.toBe(LazyComponent);
      expect(attempt).toBe(2);
    });
  });
});
