import '@angular/compiler';
import '@analogjs/vitest-angular/setup-zone';
import { NgModule, provideZoneChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

// Satori's breadcrumbs measure themselves with a ResizeObserver, which jsdom does not have.
globalThis.ResizeObserver ??= class {
  observe(): void {
    /* jsdom lays nothing out, so there is nothing to observe */
  }
  unobserve(): void {
    /* as above */
  }
  disconnect(): void {
    /* as above */
  }
};

// Angular 21's TestBed defaults to zoneless; the application runs on zone.js, so a spec does too
// unless it provides provideZonelessChangeDetection(). Angular's own test runners add the same.
@NgModule({ providers: [provideZoneChangeDetection()] })
class ZoneChangeDetectionTestingModule {}
TestBed.initTestEnvironment(
  [BrowserDynamicTestingModule, ZoneChangeDetectionTestingModule, MatIconTestingModule],
  platformBrowserDynamicTesting(),
);
