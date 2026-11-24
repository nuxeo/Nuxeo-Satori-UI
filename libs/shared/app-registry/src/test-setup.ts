import '@angular/compiler';
import '@analogjs/vitest-angular/setup-zone';
import { NgModule, provideZoneChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

// Angular 21's TestBed defaults to zoneless; the application runs on zone.js, so a spec does too
// unless it provides provideZonelessChangeDetection(). Angular's own test runners add the same.
@NgModule({ providers: [provideZoneChangeDetection()] })
class ZoneChangeDetectionTestingModule {}
TestBed.initTestEnvironment(
  [BrowserDynamicTestingModule, ZoneChangeDetectionTestingModule],
  platformBrowserDynamicTesting(),
);
