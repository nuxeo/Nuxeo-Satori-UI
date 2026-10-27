import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { provideTranslateService } from '@ngx-translate/core';
import { vi } from 'vitest';

import { NxsSatoriErrorStateComponent } from './satori-error-state.component';

describe('NxsSatoriErrorStateComponent', () => {
  let fixture: ComponentFixture<NxsSatoriErrorStateComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsSatoriErrorStateComponent, MatIconTestingModule],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideRouter([]),
        provideSatori(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NxsSatoriErrorStateComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  it('renders sat-500-error-state by default', async () => {
    await fixture.whenStable();
    expect(host.querySelector('sat-500-error-state')).not.toBeNull();
  });

  it('renders sat-401-error-state for status 401', async () => {
    fixture.componentRef.setInput('status', 401);
    await fixture.whenStable();
    expect(host.querySelector('sat-401-error-state')).not.toBeNull();
    expect(host.querySelector('sat-500-error-state')).toBeNull();
  });

  it('renders sat-403-error-state for status 403', async () => {
    fixture.componentRef.setInput('status', 403);
    await fixture.whenStable();
    expect(host.querySelector('sat-403-error-state')).not.toBeNull();
  });

  it('renders sat-404-error-state for status 404', async () => {
    fixture.componentRef.setInput('status', 404);
    await fixture.whenStable();
    expect(host.querySelector('sat-404-error-state')).not.toBeNull();
  });

  it('sets role="alert" and data-status on the host', async () => {
    fixture.componentRef.setInput('status', 403);
    await fixture.whenStable();
    expect(host.getAttribute('role')).toBe('alert');
    expect(host.getAttribute('data-status')).toBe('403');
  });

  it('ownHeading trims and normalizes the heading input', () => {
    fixture.componentRef.setInput('heading', '  Server error  ');
    fixture.detectChanges();
    expect(fixture.componentInstance['ownHeading']()).toBe('Server error');
  });

  it('ownHeading returns empty for whitespace-only input', () => {
    fixture.componentRef.setInput('heading', '   ');
    fixture.detectChanges();
    expect(fixture.componentInstance['ownHeading']()).toBe('');
  });

  it('canRetry is true only when retryable and status is 500', () => {
    expect(fixture.componentInstance['canRetry']()).toBe(false);

    fixture.componentRef.setInput('retryable', true);
    fixture.detectChanges();
    expect(fixture.componentInstance['canRetry']()).toBe(true);

    fixture.componentRef.setInput('status', 404);
    fixture.detectChanges();
    expect(fixture.componentInstance['canRetry']()).toBe(false);

    fixture.componentRef.setInput('status', 500);
    fixture.detectChanges();
    expect(fixture.componentInstance['canRetry']()).toBe(true);

    fixture.componentRef.setInput('retryable', false);
    fixture.detectChanges();
    expect(fixture.componentInstance['canRetry']()).toBe(false);
  });

  it('pressRetry calls retryHandler and emits retry', () => {
    const handler = vi.fn();
    fixture.componentRef.setInput('retryHandler', handler);
    fixture.detectChanges();

    const retrySpy = vi.fn();
    fixture.componentInstance.retry.subscribe(retrySpy);

    fixture.componentInstance['pressRetry']();

    expect(handler).toHaveBeenCalledOnce();
    expect(retrySpy).toHaveBeenCalledOnce();
  });

  it('pressRetry emits retry even without a retryHandler', () => {
    fixture.detectChanges();

    const retrySpy = vi.fn();
    fixture.componentInstance.retry.subscribe(retrySpy);

    fixture.componentInstance['pressRetry']();
    expect(retrySpy).toHaveBeenCalledOnce();
  });

  it('headingLevel defaults to 2', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.headingLevel()).toBe(2);
  });

  it('accepts headingLevel from 1 to 6', () => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      fixture.componentRef.setInput('headingLevel', level);
      fixture.detectChanges();
      expect(fixture.componentInstance.headingLevel()).toBe(level);
    }
  });

  // A bare custom element is `display: inline` in a browser, and this one wraps a block, so without
  // a display of its own the host's box measured 0x0: present in the DOM and invisible to anything
  // that measures it, which is how the comparison capture came to wait for it until it timed out.
  // Asserted on the declaration, not `getComputedStyle`: jsdom lays out an unknown element as a
  // block whether or not the component asks for one, so computing it passes with the style removed.
  it('declares a block display on the host, so it has a box of its own', async () => {
    await fixture.whenStable();
    expect(host.style.display).toBe('block');
  });
});
