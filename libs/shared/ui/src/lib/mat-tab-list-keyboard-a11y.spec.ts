import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RIGHT_ARROW } from '@angular/cdk/keycodes';

import { MatTabsModule } from '@angular/material/tabs';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';

import {
  MAT_TAB_LIST_IBM_ONKEYDOWN,
  MAT_TAB_LIST_KEYDOWN_ATTR,
  observeMatTabListKeyboardA11y,
  wireMatTabListKeyboardA11y,
} from './mat-tab-list-keyboard-a11y';
import { MatTabListKeydownDirective } from './mat-tab-list-keydown.directive';

@Component({
  standalone: true,
  imports: [MatTabsModule, MatTabListKeydownDirective, TranslateModule],
  templateUrl: './mat-tab-list-keyboard-a11y.host.html',
})
class MatTabListKeyboardA11yHostComponent {}

globalThis.ResizeObserver ??= class implements ResizeObserver {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
};

function materialTabHeaderMarkup(): HTMLElement {
  const root = document.createElement('mat-tab-group');

  root.innerHTML = `

    <div class="mat-mdc-tab-label-container">

      <div class="mat-mdc-tab-list" role="tablist">

        <div class="mat-mdc-tab-labels">

          <button type="button" role="tab">View</button>

          <button type="button" role="tab">History</button>

        </div>

      </div>

    </div>

  `;

  document.body.appendChild(root);

  return root;
}

function keydownWithKeyCode(target: EventTarget, key: string, keyCode: number): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

  Object.defineProperty(event, 'keyCode', { get: () => keyCode });

  Object.defineProperty(event, 'which', { get: () => keyCode });

  target.dispatchEvent(event);

  return event;
}

describe('wireMatTabListKeyboardA11y', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('marks the tablist with IBM-detectable onkeydown and removes it on cleanup', () => {
    const root = materialTabHeaderMarkup();

    const tabList = root.querySelector<HTMLElement>('.mat-mdc-tab-list')!;

    const cleanup = wireMatTabListKeyboardA11y(root);

    expect(cleanup).not.toBeNull();

    expect(tabList.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBe('true');
    expect(tabList.getAttribute('onkeydown')).toBe(MAT_TAB_LIST_IBM_ONKEYDOWN);

    cleanup!();

    expect(tabList.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBeNull();
    expect(tabList.hasAttribute('onkeydown')).toBe(false);
  });

  it('does not move focus when keydown targets the tablist itself', () => {
    const root = materialTabHeaderMarkup();

    const tabList = root.querySelector<HTMLElement>('.mat-mdc-tab-list')!;

    const firstTab = root.querySelector<HTMLElement>('[role="tab"]')!;

    wireMatTabListKeyboardA11y(root);

    firstTab.focus();

    tabList.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    expect(document.activeElement).toBe(firstTab);
  });

  it('returns null when the tablist is missing', () => {
    const root = document.createElement('mat-tab-group');

    document.body.appendChild(root);

    expect(wireMatTabListKeyboardA11y(root)).toBeNull();
  });

  it('does not overwrite a pre-existing onkeydown handler attribute', () => {
    const root = materialTabHeaderMarkup();
    const tabList = root.querySelector<HTMLElement>('.mat-mdc-tab-list')!;
    tabList.setAttribute('onkeydown', 'return customHandler(event)');

    expect(wireMatTabListKeyboardA11y(root)).toBeNull();
    expect(tabList.getAttribute('onkeydown')).toBe('return customHandler(event)');
    expect(tabList.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBeNull();
  });

  it('cleanup removes onkeydown only when it is still the IBM placeholder', () => {
    const root = materialTabHeaderMarkup();
    const tabList = root.querySelector<HTMLElement>('.mat-mdc-tab-list')!;
    const cleanup = wireMatTabListKeyboardA11y(root)!;

    tabList.setAttribute('onkeydown', 'return customHandler(event)');
    cleanup();

    expect(tabList.getAttribute('onkeydown')).toBe('return customHandler(event)');
    expect(tabList.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBeNull();
  });

  it('does not remove a pre-existing IBM-equivalent onkeydown on cleanup', () => {
    const root = materialTabHeaderMarkup();
    const tabList = root.querySelector<HTMLElement>('.mat-mdc-tab-list')!;
    tabList.setAttribute('onkeydown', MAT_TAB_LIST_IBM_ONKEYDOWN);

    const cleanup = wireMatTabListKeyboardA11y(root)!;
    expect(cleanup).not.toBeNull();
    expect(tabList.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBe('true');

    cleanup();
    expect(tabList.getAttribute('onkeydown')).toBe(MAT_TAB_LIST_IBM_ONKEYDOWN);
    expect(tabList.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBeNull();
  });
});

describe('observeMatTabListKeyboardA11y', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('rewires when Material replaces the tablist node', async () => {
    const root = materialTabHeaderMarkup();
    const labelContainer = root.querySelector<HTMLElement>('.mat-mdc-tab-label-container')!;
    const cleanup = observeMatTabListKeyboardA11y(root);
    expect(cleanup).not.toBeNull();

    const firstTabList = root.querySelector<HTMLElement>('.mat-mdc-tab-list[role="tablist"]')!;
    expect(firstTabList.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBe('true');

    firstTabList.remove();
    const replacement = document.createElement('div');
    replacement.className = 'mat-mdc-tab-list';
    replacement.setAttribute('role', 'tablist');
    replacement.innerHTML =
      '<div class="mat-mdc-tab-labels"><button type="button" role="tab">Next</button></div>';
    labelContainer.appendChild(replacement);

    await vi.waitFor(() => {
      expect(replacement.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBe('true');
    });
    expect(firstTabList.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBeNull();

    cleanup!();
    expect(replacement.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBeNull();
  });
});

describe('MatTabListKeydownDirective on Material tab group', () => {
  let fixture: ComponentFixture<MatTabListKeyboardA11yHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), MatTabListKeyboardA11yHostComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(MatTabListKeyboardA11yHostComponent);

    document.body.appendChild(fixture.nativeElement);

    fixture.detectChanges();

    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
  });

  it('marks the tablist after the directive wires on a real mat-tab-group', () => {
    const tabList = fixture.nativeElement.querySelector<HTMLElement>(
      '.mat-mdc-tab-list[role="tablist"]',
    );

    expect(tabList).toBeTruthy();

    expect(tabList!.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBe('true');
    expect(tabList!.getAttribute('onkeydown')).toBe(MAT_TAB_LIST_IBM_ONKEYDOWN);
  });

  it('preserves Material ArrowRight navigation when keydown originates on a tab', async () => {
    const host = fixture.nativeElement as HTMLElement;

    const tabs = host.querySelectorAll<HTMLElement>('[role="tab"]');

    expect(tabs.length).toBeGreaterThanOrEqual(2);

    tabs[0].focus();

    expect(document.activeElement).toBe(tabs[0]);

    keydownWithKeyCode(tabs[0], 'ArrowRight', RIGHT_ARROW);

    fixture.detectChanges();

    await fixture.whenStable();

    expect(document.activeElement).toBe(tabs[1]);
  });
});
