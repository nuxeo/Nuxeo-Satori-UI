/**
 * NXSAT-547 / IBM 2906830030 — the browse drawer's Root back control keeps a keyboard focus
 * indicator (WCAG 2.4.7). The drawer renders `nxs-document-tree`, whose stylesheet holds the rule;
 * IBM `style_focus_visible` reads `:focus` only.
 *
 * What these tests do NOT cover: focus visibility on a live document-detail route. That verdict
 * belongs to a11y-scout; this Karma suite renders the real tree and asserts its computed outline.
 */
import { Component, provideZonelessChangeDetection, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslatePipe } from '@ngx-translate/core';
import { NxsDocumentTreeComponent } from '@nuxeo/satori-platform/components';
import { BrowseService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { of } from 'rxjs';

import { testTranslateModule } from '../i18n/translate-testing';

const ROOT = {
  uid: 'root',
  title: 'Root',
  type: 'Root',
  path: '/',
  lastModified: '',
  properties: {},
} as NuxeoDocument;
const DOMAIN = {
  uid: 'domain',
  title: 'Domain',
  type: 'Domain',
  path: '/default-domain',
  lastModified: '',
  properties: {},
  facets: ['Folderish'],
} as NuxeoDocument;

@Component({
  standalone: true,
  imports: [NxsDocumentTreeComponent, TranslatePipe],
  styleUrls: ['./tree-back-focus-ring.fixture.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './tree-back-focus-ring.spec.html',
})
class TreeBackFocusHostComponent {}

describe('Browse drawer Root back — keyboard focus indicator (NXSAT-547)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TreeBackFocusHostComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: BrowseService,
          useValue: {
            getNavTreeBootstrap: () => of({ root: ROOT, entries: [DOMAIN] }),
            getNavTreeChildren: () => of({ entries: [] }),
            getFolderIdsWithSubfolders: () => of(new Set<string>()),
          },
        },
      ],
    }).compileComponents();
  });

  async function mount(): Promise<{
    fixture: ComponentFixture<TreeBackFocusHostComponent>;
    button: HTMLButtonElement;
  }> {
    const fixture = TestBed.createComponent(TreeBackFocusHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      'nxs-document-tree .nxs-document-tree__back',
    ) as HTMLButtonElement | null;
    expect(button)
      .withContext('the tree must show its Root back control inside a domain')
      .toBeTruthy();
    return { fixture, button: button as HTMLButtonElement };
  }

  it('draws no outline while unfocused', async () => {
    const { fixture, button } = await mount();
    try {
      expect(getComputedStyle(button).outlineStyle).toBe('none');
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  it('draws a 2px solid outline on the button once focused', async () => {
    const { fixture, button } = await mount();
    try {
      button.focus();
      expect(document.activeElement).toBe(button);

      const style = getComputedStyle(button);
      expect(style.outlineStyle).toBe('solid');
      expect(style.outlineWidth).toBe('2px');
      expect(style.outlineOffset).toBe('-2px');
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  it('draws a visible ring on :focus when :focus-visible is false (IBM style_focus_visible)', async () => {
    const { fixture, button } = await mount();
    try {
      button.focus({ focusVisible: false } as FocusOptions);
      expect(button.matches(':focus')).toBe(true);
      expect(button.matches(':focus-visible')).toBe(false);

      const style = getComputedStyle(button);
      expect(style.outlineStyle).toBe('solid');
      expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  it('declares a standalone :focus rule that IBM style_focus_visible can read', async () => {
    const { fixture, button } = await mount();
    try {
      const focusSelectors: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let sheetRules: CSSRuleList;
        try {
          sheetRules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(sheetRules)) {
          const selector = (rule as CSSStyleRule).selectorText;
          if (selector?.includes('.nxs-document-tree__back') && selector.includes(':focus')) {
            focusSelectors.push(selector);
          }
        }
      }

      const canonical = focusSelectors.map((selector) =>
        selector.replace(/\[_ngcontent-[^\]]+\]/g, '').trim(),
      );
      expect(canonical).toContain('.nxs-document-tree__back:focus');
      expect(canonical.some((s) => s.includes('.nxs-document-tree__back:focus,'))).toBe(false);
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  it('rings a tree row on :focus when :focus-visible is false (IBM style_focus_visible)', async () => {
    const { fixture } = await mount();
    const item = fixture.nativeElement.querySelector(
      'nxs-document-tree [role="treeitem"]',
    ) as HTMLElement | null;
    expect(item).withContext('the tree must render a treeitem inside a domain').toBeTruthy();
    const row = item?.querySelector('.nxs-document-tree__row') as HTMLElement;
    try {
      expect(getComputedStyle(row).outlineStyle).toBe('none');
      item?.focus({ focusVisible: false } as FocusOptions);
      expect(item?.matches(':focus')).toBe(true);
      expect(item?.matches(':focus-visible')).toBe(false);

      const style = getComputedStyle(row);
      expect(style.outlineStyle).toBe('solid');
      expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
    } finally {
      item?.blur();
      fixture.nativeElement.remove();
    }
  });
});
