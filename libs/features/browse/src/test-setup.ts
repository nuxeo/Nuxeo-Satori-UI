import '@angular/compiler';
// Zone.js, as `libs/features/document-detail` loads it. Without it `TestBed.createComponent` of any
// component whose providers reach `NgZone` fails with
// `NG0908: In this configuration Angular requires Zone.js`.
import '@analogjs/vitest-angular/setup-zone';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

import { provideTestTranslations } from '@agentic-ui/testing/i18n';

// jsdom does not implement ResizeObserver — provide a no-op stub
global.ResizeObserver = class ResizeObserver {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  observe() {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  unobserve() {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  disconnect() {}
};

TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

// Templates here bind through `| translate`, so component tests need `TranslateService`
// or they fail with NG0201 — and need the real catalogue, or assertions on visible text see
// raw keys instead of English. See tools/i18n/test-translate-setup.ts.
provideTestTranslations();
