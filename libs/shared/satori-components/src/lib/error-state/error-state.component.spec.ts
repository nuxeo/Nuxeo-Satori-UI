import { HttpErrorResponse } from '@angular/common/http';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { NxsHeadingLevel } from '../heading-level';
import { NxsErrorStateComponent } from './error-state.component';
import { type NxsErrorStatus, nxsErrorStatus } from './error-status';

@Component({
  standalone: true,
  imports: [NxsErrorStateComponent],
  template: `
    <nxs-error-state
      [status]="status()"
      [heading]="heading()"
      [headingLevel]="level()"
      [retryable]="retryable()"
      (retry)="retries = retries + 1"
    >
      @if (projected()) {
        <button type="button" class="go-back">Go back</button>
      }
    </nxs-error-state>
  `,
})
class HostComponent {
  readonly status = signal<NxsErrorStatus>(500);
  readonly heading = signal('');
  readonly level = signal<NxsHeadingLevel>(2);
  readonly retryable = signal(false);
  readonly projected = signal(false);
  retries = 0;
}

@Component({
  standalone: true,
  imports: [NxsErrorStateComponent],
  template: `<nxs-error-state retryable />`,
})
class BareAttributeHostComponent {}

describe('NxsErrorStateComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const state = (): HTMLElement => el().querySelector('nxs-error-state') as HTMLElement;
  const heading = (): HTMLElement | null => state().querySelector('.nxs-error-state__heading');
  const text = (selector: string): string | undefined =>
    state().querySelector(selector)?.textContent?.trim();
  const retryButton = (): HTMLButtonElement | undefined =>
    [...state().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'refresh Retry');

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, BareAttributeHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it('is an alert carrying its status, so the failure is announced and addressable', () => {
    expect(state().getAttribute('role')).toBe('alert');
    expect(state().getAttribute('data-status')).toBe('500');
  });

  it.each([
    [500, 'error_outline', 'Something went wrong', 'The server could not complete the request.'],
    [401, 'lock', 'Your session has ended', 'Sign in again to continue.'],
    [403, 'block', 'You do not have access', 'You do not have permission to see this.'],
    [
      404,
      'search_off',
      'Not found',
      'It may have been moved or deleted, or the link may be wrong.',
    ],
  ] as const)('renders the %i variant', async (status, icon, title, message) => {
    host.status.set(status);
    await render();

    expect(state().getAttribute('data-status')).toBe(String(status));
    expect(text('.nxs-error-state__icon')).toBe(icon);
    expect(state().querySelector('.nxs-error-state__icon')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(heading()?.textContent?.trim()).toBe(title);
    expect(text('.nxs-error-state__message')).toContain(message);
  });

  it("puts the host's heading in place of the variant's and keeps the explanation", async () => {
    host.status.set(403);
    host.heading.set('Failed to load folder contents.');
    await render();

    expect(heading()?.textContent?.trim()).toBe('Failed to load folder contents.');
    expect(text('.nxs-error-state__message')).toContain('You do not have permission to see this.');
  });

  it.each([' \n\t ', '\u200b', '\u200b\u200d'])(
    "falls back to the variant's heading when the host's is only whitespace or zero-width characters (%j)",
    async (blank) => {
      host.status.set(404);
      host.heading.set(blank);
      await render();

      expect(heading()?.textContent?.trim()).toBe('Not found');
    },
  );

  it('renders the heading as an h2 by default', () => {
    expect(heading()?.tagName).toBe('H2');
  });

  it.each([1, 3, 4, 5, 6] as const)('renders the heading as a native h%i', async (level) => {
    host.level.set(level);
    await render();

    expect(heading()?.tagName).toBe(`H${level}`);
    expect(heading()?.textContent?.trim()).toBe('Something went wrong');
  });

  it('offers no Retry unless the host asks for it', () => {
    expect(retryButton()).toBeUndefined();
  });

  it('offers Retry for a server error and reports the press', async () => {
    host.retryable.set(true);
    await render();

    const button = retryButton();
    expect(button).toBeDefined();
    button?.click();
    expect(host.retries).toBe(1);
  });

  it.each([401, 403, 404] as const)(
    'offers no Retry for a %i, which would get the same answer',
    async (status) => {
      host.retryable.set(true);
      host.status.set(status);
      await render();

      expect(retryButton()).toBeUndefined();
    },
  );

  it("projects the host's own action beside Retry", async () => {
    host.retryable.set(true);
    host.projected.set(true);
    await render();

    const actions = state().querySelector('.nxs-error-state__actions');
    expect(actions?.querySelector('.go-back')?.textContent?.trim()).toBe('Go back');
    expect(actions?.querySelectorAll('button')).toHaveLength(2);
  });

  it('takes retryable as a bare attribute', async () => {
    const bare = TestBed.createComponent(BareAttributeHostComponent);
    bare.detectChanges();
    await bare.whenStable();

    const buttons = (bare.nativeElement as HTMLElement).querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent?.trim()).toBe('refresh Retry');
  });
});

describe('nxsErrorStatus', () => {
  it.each([401, 403, 404] as const)('keeps a %i', (status) => {
    expect(nxsErrorStatus(new HttpErrorResponse({ status }))).toBe(status);
  });

  it.each([
    ['a 500', new HttpErrorResponse({ status: 500 })],
    ['a 502', new HttpErrorResponse({ status: 502 })],
    ['a 400', { status: 400 }],
    ['a network failure (status 0)', new HttpErrorResponse({ status: 0 })],
    ['a status that is not a number', { status: '403' }],
    ['an Error with no status', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
  ])('treats %s as a server error', (_name, error) => {
    expect(nxsErrorStatus(error)).toBe(500);
  });
});
