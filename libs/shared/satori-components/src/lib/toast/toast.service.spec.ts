import { Component, inject, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { NxsToastComponent } from './toast.component';
import { NXS_TOAST_DURATION, NxsToastService, provideNxsToast } from './toast.service';

/** A consumer, so the service is reached the way the core slice reaches it: from `providers`. */
@Component({ standalone: true, template: '', providers: [provideNxsToast()] })
class ConsumerComponent {
  readonly toast = inject(NxsToastService);
}

describe('NxsToastService', () => {
  let consumer: ComponentFixture<ConsumerComponent>;
  let toast: NxsToastService;
  let snackBar: MatSnackBar;
  let open: MockInstance<MatSnackBar['openFromComponent']>;

  function container(): HTMLElement | null {
    return document.querySelector('mat-snack-bar-container');
  }

  function toastElement(): HTMLElement | null {
    return document.querySelector('nxs-toast');
  }

  function lastConfig(): MatSnackBarConfig | undefined {
    return open.mock.calls.at(-1)?.[1];
  }

  /** Lets `MatSnackBar` attach, then move the content into its live region (150 ms later). */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    TestBed.tick();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ConsumerComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    });
    consumer = TestBed.createComponent(ConsumerComponent);
    toast = consumer.componentInstance.toast;
    snackBar = TestBed.inject(MatSnackBar);
    open = vi.spyOn(snackBar, 'openFromComponent');
  });

  afterEach(() => {
    snackBar.dismiss();
  });

  it('is not a root singleton: a component that does not list it cannot inject it', () => {
    expect(() => TestBed.inject(NxsToastService)).toThrow(/No provider/);
  });

  describe('show', () => {
    it('opens the library toast with the message, politely, for the default duration', async () => {
      toast.show('Moved to trash');
      await settle();

      expect(open).toHaveBeenCalledWith(NxsToastComponent, expect.anything());
      expect(lastConfig()).toMatchObject({
        duration: NXS_TOAST_DURATION,
        politeness: 'polite',
        panelClass: 'nxs-toast-panel',
      });
      expect(toastElement()?.querySelector('.nxs-toast__message')?.textContent?.trim()).toBe(
        'Moved to trash',
      );
      expect(container()?.querySelector('[aria-live]')?.getAttribute('aria-live')).toBe('polite');
    });

    it('waits for Web UI’s four seconds even when the caller asks for less', () => {
      toast.show('Tag added', { duration: 2000 });
      expect(lastConfig()?.duration).toBe(4000);
    });

    it('keeps a longer duration the caller asks for', () => {
      toast.show('Remove all collections from this folder first', { duration: 6000 });
      expect(lastConfig()?.duration).toBe(6000);
    });

    it('stays until dismissed when the caller passes 0', () => {
      toast.show('Preparing the download', { duration: 0 });
      expect(lastConfig()?.duration).toBe(0);
    });

    it('takes the floor for a negative duration rather than staying forever', () => {
      toast.show('Saved', { duration: -1 });
      expect(lastConfig()?.duration).toBe(NXS_TOAST_DURATION);
    });

    it('opens nothing for a blank message, as Web UI does', () => {
      toast.show('');
      toast.show('   ');
      expect(open).not.toHaveBeenCalled();
      expect(container()).toBeNull();
    });

    it('renders no action button without an action, only Dismiss', async () => {
      toast.show('Saved');
      await settle();
      expect(toastElement()?.querySelector('.nxs-toast__action')).toBeNull();
      expect(toastElement()?.querySelectorAll('button')).toHaveLength(1);
    });
  });

  describe('error', () => {
    it('is announced assertively and marked as an error for theming', async () => {
      toast.error('Failed to delete');
      await settle();

      expect(lastConfig()).toMatchObject({
        duration: NXS_TOAST_DURATION,
        politeness: 'assertive',
        panelClass: ['nxs-toast-panel', 'nxs-toast-panel--error'],
      });
      expect(container()?.querySelector('[aria-live]')?.getAttribute('aria-live')).toBe(
        'assertive',
      );
      expect(toastElement()?.classList.contains('nxs-toast--error')).toBe(true);
    });

    it('offers a translated Retry that runs the callback and closes the toast', async () => {
      const retry = vi.fn();
      toast.error('Failed to save the search', { retry });
      await settle();

      const button = toastElement()?.querySelector<HTMLButtonElement>('.nxs-toast__action');
      expect(button?.textContent?.trim()).toBe('Retry');
      button?.click();
      await settle();

      expect(retry).toHaveBeenCalledTimes(1);
      expect(toastElement()).toBeNull();
    });

    it('stays until dismissed when it offers Retry, so the button can be reached', () => {
      toast.error('Failed to save the search', { retry: vi.fn() });
      expect(lastConfig()?.duration).toBe(0);
    });

    it('lets Retry take the place of a caller’s own action', async () => {
      const run = vi.fn();
      const retry = vi.fn();
      toast.error('Upload failed', { retry, action: { label: 'Details', run } });
      await settle();

      const buttons = toastElement()?.querySelectorAll<HTMLButtonElement>('.nxs-toast__action');
      expect(buttons).toHaveLength(1);
      expect(buttons?.[0].textContent?.trim()).toBe('Retry');
      buttons?.[0].click();
      await settle();
      expect(retry).toHaveBeenCalledTimes(1);
      expect(run).not.toHaveBeenCalled();
    });

    it('opens nothing for a blank message', () => {
      toast.error('');
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe('action', () => {
    it('renders the caller’s label and runs it once when pressed', async () => {
      const run = vi.fn();
      toast.show('Moved to trash', { action: { label: 'Undo', run } });
      await settle();

      expect(lastConfig()?.duration).toBe(0);
      const button = toastElement()?.querySelector<HTMLButtonElement>('.nxs-toast__action');
      expect(button?.textContent?.trim()).toBe('Undo');
      button?.click();
      await settle();
      expect(run).toHaveBeenCalledTimes(1);
      expect(toastElement()).toBeNull();
    });

    it('runs the action just before the toast closes', async () => {
      let openWhenRun: boolean | null = null;
      toast.show('Moved to trash', {
        action: { label: 'Undo', run: () => (openWhenRun = toastElement() !== null) },
      });
      await settle();
      toastElement()?.querySelector<HTMLButtonElement>('.nxs-toast__action')?.click();
      await settle();

      expect(openWhenRun).toBe(true);
      expect(toastElement()).toBeNull();
    });

    it('keeps the caller’s duration for a toast with an action', () => {
      toast.show('Moved to trash', { action: { label: 'Undo', run: vi.fn() }, duration: 8000 });
      expect(lastConfig()?.duration).toBe(8000);
    });

    it('closes a toast with an action when the component that opened it is destroyed', async () => {
      const run = vi.fn();
      toast.show('Moved to trash', { action: { label: 'Undo', run } });
      await settle();
      expect(toastElement()).not.toBeNull();

      consumer.destroy();
      await settle();

      // No button is left on screen that would run against the destroyed component.
      expect(toastElement()).toBeNull();
      expect(run).not.toHaveBeenCalled();
    });

    it('leaves a toast without an action to its own timer when its component is destroyed', async () => {
      toast.show('Saved');
      await settle();

      consumer.destroy();
      await settle();

      expect(toastElement()).not.toBeNull();
    });

    it('does not run the action when the toast is dismissed instead', async () => {
      const run = vi.fn();
      toast.show('Moved to trash', { action: { label: 'Undo', run } });
      await settle();
      toastElement()?.querySelector<HTMLButtonElement>('.nxs-toast__dismiss')?.click();
      await settle();
      expect(run).not.toHaveBeenCalled();
      expect(toastElement()).toBeNull();
    });
  });

  describe('dismissing', () => {
    it('has a Dismiss icon button named for assistive technology', async () => {
      toast.show('Saved');
      await settle();
      const dismiss = toastElement()?.querySelector<HTMLButtonElement>('.nxs-toast__dismiss');
      expect(dismiss?.getAttribute('aria-label')).toBe('Dismiss');
      expect(dismiss?.getAttribute('type')).toBe('button');
      expect(dismiss?.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('closes when Dismiss is pressed', async () => {
      toast.show('Saved');
      await settle();
      toastElement()?.querySelector<HTMLButtonElement>('.nxs-toast__dismiss')?.click();
      await settle();
      expect(toastElement()).toBeNull();
    });

    it('closes on Escape from inside the toast', async () => {
      toast.show('Saved');
      await settle();
      const dismiss = toastElement()?.querySelector<HTMLButtonElement>('.nxs-toast__dismiss');
      dismiss?.focus();
      dismiss?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(toastElement()).toBeNull();
    });

    it('keeps Escape from reaching a dialog underneath, which would close it too', async () => {
      // The CDK's overlay keyboard dispatcher listens on the body; a dialog closes from there.
      const bodyKeydown = vi.fn();
      document.body.addEventListener('keydown', bodyKeydown);
      toast.error('Failed to update document');
      await settle();

      toastElement()
        ?.querySelector<HTMLButtonElement>('.nxs-toast__dismiss')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      document.body.removeEventListener('keydown', bodyKeydown);

      expect(bodyKeydown).not.toHaveBeenCalled();
      expect(toastElement()).toBeNull();
    });

    it('replaces the toast on screen rather than stacking a second one', async () => {
      toast.show('First');
      await settle();
      toast.error('Second');
      await settle();
      expect(document.querySelectorAll('nxs-toast')).toHaveLength(1);
      expect(toastElement()?.textContent).toContain('Second');
    });
  });
});
