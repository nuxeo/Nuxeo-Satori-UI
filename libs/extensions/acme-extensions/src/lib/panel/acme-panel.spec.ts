import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { vi } from 'vitest';

import {
  AppExtensionsService,
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionActionRegistry,
  ExtensionRuleContextService,
  type ExtensionRuleContext,
} from '@nuxeo/satori-platform/extensions';

import { AcmePanelComponent } from './acme-panel';
import { ACME_EXTENSIONS_EXTENSION_IDS } from '../extensions';

describe('AcmePanelComponent', () => {
  let component: AcmePanelComponent;
  let fixture: ComponentFixture<AcmePanelComponent>;
  let mockActions: { has: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> };
  let mockRuleContext: { context: ReturnType<typeof vi.fn> };
  let mockExtensions: { evaluateRule: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockActions = {
      has: vi.fn().mockReturnValue(true),
      execute: vi.fn().mockReturnValue(true),
    };

    mockRuleContext = {
      context: vi.fn().mockReturnValue(EMPTY_EXTENSION_RULE_CONTEXT),
    };

    mockExtensions = {
      evaluateRule: vi.fn().mockReturnValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [AcmePanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ExtensionActionRegistry, useValue: mockActions },
        { provide: ExtensionRuleContextService, useValue: mockRuleContext },
        { provide: AppExtensionsService, useValue: mockExtensions },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AcmePanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeDefined();
  });

  it('exposes the action label', () => {
    expect(component['actionLabel']).toBe('Export summary');
  });

  it('checks if handler is registered', () => {
    expect(mockActions.has).toHaveBeenCalledWith(ACME_EXTENSIONS_EXTENSION_IDS.actions[0]);
    expect(component['handlerRegistered']).toBe(true);
  });

  it('detects when handler is not registered', () => {
    mockActions.has.mockReturnValue(false);

    // Create new component with updated mock
    const newFixture = TestBed.createComponent(AcmePanelComponent);
    const newComponent = newFixture.componentInstance;

    expect(newComponent['handlerRegistered']).toBe(false);
  });

  it('evaluates the rule through computed signal', () => {
    const enabled = component['enabled']();

    expect(mockExtensions.evaluateRule).toHaveBeenCalledWith(
      ACME_EXTENSIONS_EXTENSION_IDS.rules[0],
      EMPTY_EXTENSION_RULE_CONTEXT,
    );
    expect(enabled).toBe(true);
  });

  it('returns false when rule evaluation fails', () => {
    mockExtensions.evaluateRule.mockReturnValue(false);

    // Create a new component instance with the mock already returning false
    const newFixture = TestBed.createComponent(AcmePanelComponent);
    const newComponent = newFixture.componentInstance;

    const enabled = newComponent['enabled']();

    expect(mockExtensions.evaluateRule).toHaveBeenCalled();
    expect(enabled).toBe(false);
  });

  it('executes the action when run is called', () => {
    component['run']();

    expect(mockActions.execute).toHaveBeenCalledWith(
      {
        id: ACME_EXTENSIONS_EXTENSION_IDS.actions[0],
        label: 'Export summary',
      },
      EMPTY_EXTENSION_RULE_CONTEXT,
    );
  });

  it('calls execute with current context', () => {
    // Declared `ExtensionRuleContext`, not inferred. `document` is a full `NuxeoDocument | null` on
    // the model, and a `{ uid }` literal only slipped through because `mockRuleContext.context` is an
    // untyped `vi.fn` — so `spec-types` could not see the mismatch.
    const specificContext: ExtensionRuleContext = {
      ...EMPTY_EXTENSION_RULE_CONTEXT,
      url: '/documents/test',
      document: {
        uid: 'doc-1',
        title: 'doc-1',
        type: 'File',
        path: '/default-domain/workspaces/doc-1',
        lastModified: '2026-01-01T00:00:00.000Z',
        properties: {},
      },
    };

    mockRuleContext.context.mockReturnValue(specificContext);

    component['run']();

    expect(mockActions.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ACME_EXTENSIONS_EXTENSION_IDS.actions[0],
      }),
      specificContext,
    );
  });
});
