import '@angular/compiler';
import { NgModule, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

// The panel runs without zone.js, in another system's page, so its specs do too.
@NgModule({ providers: [provideZonelessChangeDetection()] })
class ZonelessTestingModule {}
TestBed.initTestEnvironment(
  [BrowserDynamicTestingModule, ZonelessTestingModule],
  platformBrowserDynamicTesting(),
);
