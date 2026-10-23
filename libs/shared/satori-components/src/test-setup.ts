import '@angular/compiler';
import '@analogjs/vitest-angular/setup-zone';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

import { provideTestTranslations } from '@agentic-ui/testing/i18n';

TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

// A component's own chrome text (a button, a dialog name) binds a `satori-components.*` key
// through `| translate`, so its test needs `TranslateService` and the real catalogue — otherwise
// an assertion on visible text sees the key. See tools/i18n/test-translate-setup.ts.
provideTestTranslations();
