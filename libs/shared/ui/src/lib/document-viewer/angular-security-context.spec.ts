import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';

const RAW = 'blob:http://localhost/real-object-url';

/**
 * Pins Angular's DOM security context for the media bindings this repository cares about, by
 * observation rather than by assertion in prose.
 *
 * ## Why this file exists
 *
 * The claim "`source[src]`, `audio[src]` and `video[poster]` are `SecurityContext.NONE`, so a
 * `Safe*` value bound there stringifies" underpins `DocumentViewerComponent.rawBlobUrl`, the
 * `NONE_CONTEXT_BINDINGS` list in `scripts/beta-harness/sanitizer-audit.mjs`, and six binding fixes
 * in this PR. It was challenged in review as a premise Angular does not support — the counter-claim
 * being that these are URL contexts where a `SafeResourceUrl` is accepted and unwrapped.
 *
 * Prose cannot settle that and neither can reading the framework source, because both sides were
 * quoting it. So this renders a **real** `DomSanitizer.bypassSecurityTrustResourceUrl` value into
 * each binding and reads the attribute back out of the DOM. If a future Angular version changes the
 * schema, this file fails and says which binding moved — which is the only way the claim stays true
 * rather than merely repeated.
 *
 * ## What it found
 *
 * The three NONE bindings stringify. `video[src]`, `img[src]` and `a[href]` do not: Angular registers
 * those as `SecurityContext.URL`, and `allowSanitizationBypassAndThrow` deliberately admits a
 * ResourceURL in a URL context ("they are strictly more trusted"). Both halves matter — the second is
 * why `video[src]` is correctly *absent* from `NONE_CONTEXT_BINDINGS`, and why the audit is not simply
 * "every media attribute is NONE".
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './angular-security-context.spec.html',
})
class SecurityContextHost {
  readonly safe = signal<SafeResourceUrl | null>(null);
}

describe("Angular's security context for media bindings", () => {
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SecurityContextHost],
    });
    const fixture = TestBed.createComponent(SecurityContextHost);
    fixture.componentInstance.safe.set(
      TestBed.inject(DomSanitizer).bypassSecurityTrustResourceUrl(RAW),
    );
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  const attr = (selector: string, name: string): string =>
    host.querySelector(selector)?.getAttribute(name) ?? '(missing)';

  describe('SecurityContext.NONE — no sanitizer runs, so the wrapper is coerced by toString()', () => {
    const noneBindings: Array<[label: string, selector: string, name: string]> = [
      ['audio > source[src]', 'audio source', 'src'],
      ['video[poster]', 'video[poster]', 'poster'],
      ['video > source[src]', 'video source', 'src'],
    ];

    for (const [label, selector, name] of noneBindings) {
      it(`writes the SafeValue placeholder into ${label}`, () => {
        const rendered = attr(selector, name);
        // The exact failure users saw: an unusable attribute value, not a broken-looking URL.
        expect(rendered).toContain('SafeValue must use [property]=binding');
        expect(rendered).not.toBe(RAW);
      });
    }
  });

  describe('SecurityContext.URL — a ResourceURL is admitted as strictly more trusted', () => {
    const urlBindings: Array<[label: string, selector: string, name: string]> = [
      ['video[src]', 'video.plain-src', 'src'],
      ['img[src]', 'img', 'src'],
      ['a[href]', 'a', 'href'],
    ];

    for (const [label, selector, name] of urlBindings) {
      it(`unwraps the value into ${label}`, () => {
        const rendered = attr(selector, name);
        expect(rendered).toBe(RAW);
        expect(rendered).not.toContain('SafeValue must use');
      });
    }
  });

  it('distinguishes the two groups, so this file cannot pass by asserting one behaviour twice', () => {
    // A control. If a schema change made every binding behave alike, each group's assertions could
    // still be individually satisfiable by a suitably wrong expectation; this states the contrast.
    expect(attr('audio source', 'src')).not.toBe(attr('video.plain-src', 'src'));
  });
});
