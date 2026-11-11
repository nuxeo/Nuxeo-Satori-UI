import { DIR_DOCUMENT, Directionality } from '@angular/cdk/bidi';
import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, DestroyRef, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { LangChangeEvent } from '@ngx-translate/core';
import { Subject } from 'rxjs';

import { syncDocumentDirection } from './provide-app-config';

@Component({
  standalone: true,
  imports: [MatDialogModule],
  template: `<p>dialog body</p>`,
})
class DialogBodyComponent {}

@Component({
  standalone: true,
  imports: [MatMenuModule],
  template: `
    <button type="button" [matMenuTriggerFor]="menu">Open</button>
    <mat-menu #menu><button mat-menu-item type="button">Item</button></mat-menu>
  `,
})
class MenuHostComponent {}

/**
 * NXSAT-752 asked for overlay direction to be **established rather than assumed**, because
 * satori-ui carries a `syncOverlayDirection`, which suggested CDK overlay content does not
 * inherit direction from the document on its own. Measured here, and the answer is not the one
 * the ticket expected — in two ways.
 *
 * First, that helper is a **private** method of upstream's own rich tooltip, not an exported
 * helper a consumer could call, so it was never evidence about our overlays.
 *
 * Second, CDK 22 does default the direction: `createOverlayRef()` runs
 * `overlayConfig.direction = overlayConfig.direction || directionality.value`, so a dialog that
 * passes no direction of its own — which is all 299 `MatDialog` call sites in this repository —
 * picks up the root `Directionality`. No provider is needed and none was added.
 *
 * **But that is exactly why `syncDocumentDirection` writes `Directionality` and not only the
 * attribute.** CDK reads the service, not `<html dir>`, and the service reads the attribute once
 * at construction. The third test is the negative control for that: with the attribute set and
 * the service left alone — what a `document.documentElement.dir = …` one-liner would have
 * produced — every dialog and menu in a right-to-left application opens left-to-right.
 *
 * Known limit, not worth code today: `createOverlayRef` snapshots the direction as a string when
 * the overlay is **created**, so an overlay already open when the language changes keeps the old
 * direction. There is no language picker yet (NXSAT-294), so no user can reach that state.
 */
describe('CDK overlay direction, right to left', () => {
  /** A document in the state `index.html` ships: a language, no `dir`. */
  function ltrDocument(): Document {
    return document.implementation.createHTMLDocument('direction');
  }

  function configure(dirDocument: Document): void {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: DIR_DOCUMENT, useValue: dirDocument },
      ],
    });
  }

  /** Applies a language the way the shell does, against the same document CDK was given. */
  function useLanguage(dirDocument: Document, lang: string): void {
    const onLangChange = new Subject<LangChangeEvent>();
    const destroyRef: DestroyRef = { destroyed: false, onDestroy: () => () => undefined };
    syncDocumentDirection(
      { onLangChange, getCurrentLang: () => 'en' },
      dirDocument,
      TestBed.inject(Directionality),
      destroyRef,
    );
    onLangChange.next({ lang, translations: {} });
  }

  /**
   * The overlay **host** — the wrapper CDK puts around the pane — because that is the element
   * `OverlayRef._updateElementDirection()` writes `dir` to, not the pane itself.
   */
  function overlayHost(): HTMLElement {
    const container = TestBed.inject(OverlayContainer).getContainerElement();
    const host = container.querySelector<HTMLElement>('.cdk-overlay-pane')?.parentElement;
    if (!host) throw new Error(`no overlay attached; container was ${container.innerHTML}`);
    return host;
  }

  afterEach(() => TestBed.inject(OverlayContainer).getContainerElement().remove());

  it('mirrors a Material menu, which fills its own direction in from Directionality', async () => {
    const doc = ltrDocument();
    configure(doc);
    useLanguage(doc, 'ar');

    const fixture = TestBed.createComponent(MenuHostComponent);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();

    expect(overlayHost().getAttribute('dir')).toBe('rtl');
  });

  it('mirrors a dialog that passes no direction, as every call site in this repository does', async () => {
    const doc = ltrDocument();
    configure(doc);
    useLanguage(doc, 'he');

    TestBed.inject(MatDialog).open(DialogBodyComponent);
    await Promise.resolve();

    expect(overlayHost().getAttribute('dir')).toBe('rtl');
  });

  it('leaves every overlay left-to-right if only the attribute is set — why Directionality is written', async () => {
    const doc = ltrDocument();
    configure(doc);
    // Construct `Directionality` while the document is still left-to-right, as it is at boot,
    // then set the attribute without telling it. This is the whole of what a bare
    // `documentElement.dir = 'rtl'` would do.
    expect(TestBed.inject(Directionality).value).toBe('ltr');
    doc.documentElement.dir = 'rtl';

    TestBed.inject(MatDialog).open(DialogBodyComponent);
    await Promise.resolve();

    expect(overlayHost().getAttribute('dir')).toBe('ltr');
  });
});
