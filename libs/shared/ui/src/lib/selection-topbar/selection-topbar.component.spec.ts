import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionRuleContextService,
  PACKAGED_BULK_ACTIONS,
} from '@nuxeo/satori-platform/extensions';

import { SelectionTopbarComponent } from './selection-topbar.component';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

/**
 * The bulk-action surface, which moved from six fixed buttons wired to six named
 * `@Output()`s into the `bulk-actions` slot.
 *
 * The first spec is the "a customer who changes nothing sees no difference"
 * proof: exact ids in exact order against the list transcribed from the markup
 * this replaced, not a count.
 */
describe('SelectionTopbarComponent — bulk-actions slot', () => {
  /** The ids and order the fixed markup rendered, before the conversion. */
  const MARKUP_ORDER = [
    'app.bulkActions.downloadZip',
    'app.bulkActions.addToCollection',
    'app.bulkActions.compare',
    'app.bulkActions.addToClipboard',
    'app.bulkActions.publish',
    'app.bulkActions.delete',
  ];

  const manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });

  function render(selectionCount = 3) {
    manifest.set(manifest());
    TestBed.configureTestingModule({
      // `testTranslateModule()` is repeated here because this spec calls
      // `TestBed.resetTestingModule()` mid-test, which discards what the project's test setup
      // configured. Without it the second render fails with NG0201.
      imports: [SelectionTopbarComponent, NoopAnimationsModule, testTranslateModule()],
      providers: [{ provide: AppConfigService, useValue: { manifest } }],
    });
    TestBed.inject(AppExtensionsService).register(
      EXTENSION_SLOTS['bulk-actions'],
      PACKAGED_BULK_ACTIONS,
    );
    TestBed.inject(ExtensionRuleContextService).selectionCount.set(selectionCount);

    const fixture = TestBed.createComponent(SelectionTopbarComponent);
    fixture.componentRef.setInput('selectedCount', selectionCount);
    fixture.detectChanges();
    return fixture;
  }

  function renderedButtons(fixture: ReturnType<typeof render>): HTMLButtonElement[] {
    return [
      ...fixture.nativeElement.querySelectorAll('.topbar-actions button[data-action-id]'),
    ] as HTMLButtonElement[];
  }

  beforeEach(() => manifest.set({ extensionLayers: [] }));

  it('renders the packaged six in the order the fixed markup had', () => {
    const buttons = renderedButtons(render());
    expect(buttons.map((button) => button.getAttribute('data-action-id'))).toEqual(MARKUP_ORDER);
  });

  it('labels each control for assistive technology, as the markup did', () => {
    const buttons = renderedButtons(render());
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Download All as Zip',
      'Add to Collection',
      'Compare',
      'Add to Clipboard',
      'Publish Document',
      'Delete selected',
    ]);
  });

  it('runs the registered handler on click', () => {
    const fixture = render();
    const calls: string[] = [];
    TestBed.inject(ExtensionActionRegistry).register({
      'app.bulkActions.delete': { execute: () => calls.push('delete') },
    });
    renderedButtons(fixture)
      .find((button) => button.getAttribute('data-action-id') === 'app.bulkActions.delete')
      ?.click();
    expect(calls).toEqual(['delete']);
  });

  it('disables Compare below two selected documents, and enables it at two', () => {
    const compare = (fixture: ReturnType<typeof render>) =>
      renderedButtons(fixture).find(
        (button) => button.getAttribute('data-action-id') === 'app.bulkActions.compare',
      );
    expect(compare(render(1))?.disabled).toBe(true);
    TestBed.resetTestingModule();
    expect(compare(render(2))?.disabled).toBe(false);
  });

  it('lets a manifest hide one action without disturbing the rest', () => {
    manifest.set({
      extensionLayers: [{ overrides: { 'app.bulkActions.publish': { visible: false } } }],
    });
    const ids = renderedButtons(render()).map((button) => button.getAttribute('data-action-id'));
    expect(ids).toEqual(MARKUP_ORDER.filter((id) => id !== 'app.bulkActions.publish'));
  });

  it('lets a manifest add an action, which dispatches to its registered handler', () => {
    manifest.set({
      extensionLayers: [
        {
          slots: {
            'bulk-actions': [
              { id: 'acme.bulkActions.archive', label: 'Archive', icon: 'archive', order: 15 },
            ],
          },
        },
      ],
    });
    const fixture = render();
    const calls: string[] = [];
    TestBed.inject(ExtensionActionRegistry).register({
      'acme.bulkActions.archive': { execute: () => calls.push('archive') },
    });

    const buttons = renderedButtons(fixture);
    expect(buttons.map((button) => button.getAttribute('data-action-id'))[1]).toBe(
      'acme.bulkActions.archive',
    );
    buttons[1].click();
    expect(calls).toEqual(['archive']);
  });

  it('renders a manifest action with no handler as inert rather than throwing', () => {
    manifest.set({
      extensionLayers: [
        {
          slots: {
            'bulk-actions': [
              { id: 'acme.bulkActions.ghost', label: 'Ghost', icon: 'help', order: 5 },
            ],
          },
        },
      ],
    });
    const button = renderedButtons(render())[0];
    expect(button.getAttribute('data-action-id')).toBe('acme.bulkActions.ghost');
    expect(() => button.click()).not.toThrow();
  });
});
