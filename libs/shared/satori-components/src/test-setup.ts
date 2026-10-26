import '@angular/compiler';
import '@analogjs/vitest-angular/setup-zone';
import { NgModule, provideZoneChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

import { provideTestTranslations } from '@agentic-ui/testing/i18n';

// Angular 21's TestBed defaults to zoneless; the application runs on zone.js, so a spec does too
// unless it provides provideZonelessChangeDetection(). Angular's own test runners add the same.
@NgModule({ providers: [provideZoneChangeDetection()] })
class ZoneChangeDetectionTestingModule {}
TestBed.initTestEnvironment(
  [BrowserDynamicTestingModule, ZoneChangeDetectionTestingModule],
  platformBrowserDynamicTesting(),
);

// A component's own chrome text (a button, a dialog name) binds a `satori-components.*` key
// through `| translate`, so its test needs `TranslateService` and the real catalogue — otherwise
// an assertion on visible text sees the key. See tools/i18n/test-translate-setup.ts.
provideTestTranslations();
