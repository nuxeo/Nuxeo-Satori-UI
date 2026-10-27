import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { NxsBannerAction, NxsBannerAnnounce, NxsBannerTone } from '../primitives';
import { NxsBannerComponent } from './banner.component';

@Component({
  standalone: true,
  imports: [NxsBannerComponent],
  template: `
    <nxs-banner
      [message]="message()"
      [tone]="tone()"
      [announce]="announce()"
      [actions]="actions()"
    />
  `,
})
class HostComponent {
  readonly message = signal('You are viewing a trashed document.');
  readonly tone = signal<NxsBannerTone>('info');
  readonly announce = signal<NxsBannerAnnounce>('none');
  readonly actions = signal<readonly NxsBannerAction[]>([]);
}

describe('NxsBannerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const banner = (): HTMLElement => fixture.nativeElement.querySelector('nxs-banner');
  const icon = (): string | undefined =>
    banner().querySelector('.nxs-banner__icon')?.textContent?.trim();
  const buttons = (): HTMLButtonElement[] => [...banner().querySelectorAll('button')];

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
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

  it('is an info notice by default, with no live region, and shows its message', () => {
    expect(banner().getAttribute('data-tone')).toBe('info');
    expect(icon()).toBe('info');
    expect(banner().hasAttribute('role')).toBe(false);
    expect(banner().querySelector('.nxs-banner__message')?.textContent).toBe(
      'You are viewing a trashed document.',
    );
  });

  it.each<[NxsBannerTone, string]>([
    ['info', 'info'],
    ['warning', 'warning'],
    ['error', 'error_outline'],
  ])('shows the %s icon for its tone, decorative to a reader', async (tone, name) => {
    host.tone.set(tone);
    await render();
    expect(banner().getAttribute('data-tone')).toBe(tone);
    expect(icon()).toBe(name);
    expect(banner().querySelector('.nxs-banner__icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it.each<[NxsBannerAnnounce, string | null]>([
    ['none', null],
    ['status', 'status'],
    ['alert', 'alert'],
  ])('announces %s as the %s role', async (announce, role) => {
    host.announce.set(announce);
    await render();
    expect(banner().getAttribute('role')).toBe(role);
  });

  it('renders no actions container when it offers none', () => {
    expect(banner().querySelector('.nxs-banner__actions')).toBeNull();
  });

  it('renders each action in order, with its icon and label, and presses it on click', async () => {
    const restore = vi.fn();
    const remove = vi.fn();
    host.actions.set([
      { label: 'Restore', icon: 'restore', emphasis: 'filled', press: restore },
      { label: 'Delete permanently', emphasis: 'outlined', danger: true, press: remove },
    ]);
    await render();

    const [first, second] = buttons();
    expect(buttons().length).toBe(2);
    expect(first.textContent?.trim()).toBe('restore Restore');
    expect(second.textContent?.trim()).toBe('Delete permanently');

    first.click();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it.each<[NxsBannerAction['emphasis'], string]>([
    ['filled', 'mat-mdc-unelevated-button'],
    ['outlined', 'mat-mdc-outlined-button'],
    ['text', 'mat-mdc-button'],
  ])('draws a %s action with its Material button', async (emphasis, className) => {
    host.actions.set([{ label: 'Go', emphasis, press: () => undefined }]);
    await render();
    expect(buttons()[0].classList).toContain(className);
  });

  it('marks a danger action so its error-token styling applies', async () => {
    host.actions.set([
      { label: 'Delete', emphasis: 'outlined', danger: true, press: () => undefined },
    ]);
    await render();
    expect(buttons()[0].classList).toContain('nxs-banner__danger');
  });

  it('disables an action the host disables, and does not press it', async () => {
    const press = vi.fn();
    host.actions.set([{ label: 'Restore', emphasis: 'filled', disabled: true, press }]);
    await render();
    expect(buttons()[0].disabled).toBe(true);
    buttons()[0].click();
    expect(press).not.toHaveBeenCalled();
  });

  it("adds the action's own class to its button, for the host's styling or a test", async () => {
    host.actions.set([
      { label: 'Restore', emphasis: 'filled', cssClass: 'restore-btn', press: () => undefined },
    ]);
    await render();
    expect(buttons()[0].classList).toContain('restore-btn');
    expect(buttons()[0].classList).toContain('mat-mdc-unelevated-button');
  });
});
