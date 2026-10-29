import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, inject } from '@angular/core';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';

/**
 * Reports a configured `branding.logo` the browser cannot show, so the header and the login page
 * go back to the packaged Satori marks instead of holding a zero-width image (NXSAT-721).
 *
 * Put on the `<img>` itself rather than wrapping it: the header logo carries `satAppHeaderLogo`
 * for Satori's slot projection, and the stylesheets target `img.app-brand-logo`, so a wrapper
 * element would change the layout as well as the behaviour.
 *
 * Two events, because one does not cover it. `error` catches a missing file, bytes that are not an
 * image, and a cross-origin response without `Access-Control-Allow-Origin`. An image with no
 * intrinsic size, such as a 0x0 SVG, does not fire `error` at all: it loads and draws nothing, so
 * `load` has to measure it. Verified in Chrome — a 0x0 SVG reports `naturalWidth` 0, while a
 * legitimate `viewBox`-only SVG reports the 300x150 default corrected to its aspect ratio, so the
 * measurement does not reject a logo that would have rendered.
 */
@Directive({
  selector: 'img[appBrandLogoFallback]',
  standalone: true,
  host: {
    '(error)': 'loadFailed()',
    '(load)': 'loaded()',
  },
})
export class BrandLogoFallbackDirective {
  private readonly appConfig = inject(AppConfigService);
  private readonly document = inject(DOCUMENT);
  private readonly element: ElementRef<HTMLImageElement> = inject(ElementRef);

  /**
   * `src` is read off the element, so the reported address is the one the browser requested.
   *
   * A cross-origin logo is named as such: both `<img>` elements carry `crossorigin="anonymous"`,
   * so a redirect from a remote logo to a Nuxeo URL cannot take the session cookie with it — and
   * the cost of that is that a remote logo only renders if its host sends
   * `Access-Control-Allow-Origin`. A missing header is the most likely cause of a failure on
   * another origin and the hardest to guess at, so the message says so rather than making someone
   * find it in DevTools.
   */
  protected loadFailed(): void {
    const src = this.element.nativeElement.src;
    this.appConfig.reportBrandingLogoUnavailable(
      src,
      this.isCrossOrigin(src)
        ? 'the image could not be loaded; a logo on another origin is requested without ' +
            'credentials, so its host must send an Access-Control-Allow-Origin header'
        : 'the image could not be loaded',
    );
  }

  protected loaded(): void {
    const img = this.element.nativeElement;
    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
      this.appConfig.reportBrandingLogoUnavailable(
        img.src,
        'the image loaded but has no intrinsic size',
      );
    }
  }

  /** `data:` and the other non-HTTP forms are never subject to CORS, so they are not cross-origin. */
  private isCrossOrigin(src: string): boolean {
    try {
      const url = new URL(src, this.document.baseURI);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return url.origin !== new URL(this.document.baseURI).origin;
    } catch {
      return false;
    }
  }
}
