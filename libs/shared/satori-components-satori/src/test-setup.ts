import '@angular/compiler';
import '@analogjs/vitest-angular/setup-zone';
import { TestBed } from '@angular/core/testing';
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

TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
