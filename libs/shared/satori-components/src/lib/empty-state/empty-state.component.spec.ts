import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsEmptyStateComponent } from './empty-state.component';

/**
 * Hosted, because part of the contract is the projected action: a bare
 * `TestBed.createComponent(NxsEmptyStateComponent)` projects nothing.
 */
@Component({
  standalone: true,
  imports: [NxsEmptyStateComponent],
  template: `
    <nxs-empty-state
      [heading]="heading()"
      [headingLevel]="headingLevel()"
      [message]="message()"
      [icon]="icon()"
    >
      @if (withAction()) {
        <button type="button" class="probe-action">Create folder</button>
      }
    </nxs-empty-state>
  `,
})
class HostComponent {
  // Signals, so a change marks the host dirty under zoneless change detection.
  readonly heading = signal('This folder is empty');
  readonly headingLevel = signal<1 | 2 | 3 | 4 | 5 | 6>(3);
  readonly message = signal('');
  readonly icon = signal('');
  readonly withAction = signal(false);
}

describe('NxsEmptyStateComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function query<T extends HTMLElement>(selector: string): T | null {
    return fixture.nativeElement.querySelector(selector) as T | null;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it('renders the heading', () => {
    expect(query('.nxs-empty-state__heading')?.textContent?.trim()).toBe('This folder is empty');
  });

  it('renders the heading as a native heading, at the level the caller gives', async () => {
    expect(query('.nxs-empty-state__heading')?.tagName).toBe('H3');
    for (const level of [1, 2, 4, 5, 6] as const) {
      host.headingLevel.set(level);
      await render();
      const heading = query('.nxs-empty-state__heading');
      expect(heading?.tagName).toBe(`H${level}`);
      expect(heading?.textContent?.trim()).toBe('This folder is empty');
    }
  });

  it('is a polite status region, so the empty result is announced', () => {
    expect(query('nxs-empty-state')?.getAttribute('role')).toBe('status');
  });

  it('renders no message paragraph when the message is blank', () => {
    expect(query('.nxs-empty-state__message')).toBeNull();
  });

  it('renders the message when one is given', async () => {
    host.message.set('Upload a file or create a folder to get started.');
    await render();
    expect(query('.nxs-empty-state__message')?.textContent?.trim()).toBe(
      'Upload a file or create a folder to get started.',
    );
  });

  it('renders no icon when none is given', () => {
    expect(query('mat-icon')).toBeNull();
  });

  it('renders the icon as decoration hidden from assistive technology', async () => {
    host.icon.set('folder_open');
    await render();
    const icon = query('mat-icon');
    expect(icon?.textContent?.trim()).toBe('folder_open');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('follows a changed heading', async () => {
    host.heading.set('No results');
    await render();
    expect(query('.nxs-empty-state__heading')?.textContent?.trim()).toBe('No results');
  });

  it('leaves the actions container empty when nothing is projected', () => {
    expect(query('.nxs-empty-state__actions')?.children.length).toBe(0);
  });

  it('projects the caller’s action into the actions container', async () => {
    host.withAction.set(true);
    await render();
    expect(query('.nxs-empty-state__actions .probe-action')?.textContent?.trim()).toBe(
      'Create folder',
    );
  });
});

describe('NxsEmptyStateComponent bound directly', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsEmptyStateComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('refuses to render without a heading rather than show a blank region', () => {
    const fixture = TestBed.createComponent(NxsEmptyStateComponent);
    expect(() => fixture.detectChanges()).toThrow(/NG0950/);
  });

  it('is an h2 when the caller names no level', () => {
    const fixture = TestBed.createComponent(NxsEmptyStateComponent);
    fixture.componentRef.setInput('heading', 'No results');
    fixture.detectChanges();
    const heading = (fixture.nativeElement as HTMLElement).querySelector(
      '.nxs-empty-state__heading',
    );
    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent?.trim()).toBe('No results');
  });
});
