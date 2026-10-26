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

// `ContentLakeIngestService` and `SettingsService` resolve the messages they return from the
// catalogue, and `DocTypeLabelPipe` renders through it, so these tests need `TranslateService`
// with the real English catalogue — or assertions on those messages see raw keys. See
// tools/i18n/test-translate-setup.ts.
provideTestTranslations();
