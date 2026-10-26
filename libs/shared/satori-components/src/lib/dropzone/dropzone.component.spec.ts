import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { NxsDropzoneComponent } from './dropzone.component';

@Component({
  standalone: true,
  imports: [NxsDropzoneComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-dropzone
    label="Drag and drop files here"
    [buttonLabel]="buttonLabel()"
    [multiple]="multiple()"
    [disabled]="disabled()"
    accept=".csv"
    (files)="received.push($event)"
  />`,
})
class HostComponent {
  readonly multiple = signal(true);
  readonly disabled = signal(false);
  readonly buttonLabel = signal('');
  readonly received: (readonly File[])[] = [];
}

@Component({
  standalone: true,
  imports: [NxsDropzoneComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-dropzone label="Drop invoices here" buttonLabel="Choose invoices" />
    <nxs-dropzone label="Drop receipts here" buttonLabel="Choose receipts" />`,
})
class TwoZonesComponent {}

function drag(type: string, files: File[] = [], kinds = ['Files']): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: kinds, files, dropEffect: 'none' },
  });
  return event;
}

describe('NxsDropzoneComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  const el = (): HTMLElement => fixture.nativeElement.querySelector('nxs-dropzone');
  const button = (): HTMLButtonElement => el().querySelector('button') as HTMLButtonElement;
  const input = (): HTMLInputElement => el().querySelector('input') as HTMLInputElement;

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

  it('says what to do and offers a button, the keyboard’s way in', () => {
    expect(el().textContent).toContain('Drag and drop files here');
    expect(button().textContent?.trim()).toBe('Choose files');
    expect(input().getAttribute('accept')).toBe('.csv');
    expect(input().multiple).toBe(true);
    expect(input().tabIndex).toBe(-1);
  });

  it('names the hidden file input by its button, and keeps it out of reach', () => {
    const labelledBy = input().getAttribute('aria-labelledby') ?? '';
    expect(labelledBy).not.toBe('');
    expect(document.getElementById(labelledBy)).toBe(button());
    expect(input().getAttribute('aria-hidden')).toBe('true');
    expect(input().tabIndex).toBe(-1);
  });

  it('names its button for one file when it takes one', async () => {
    host.multiple.set(false);
    await render();
    expect(button().textContent?.trim()).toBe('Choose a file');
    host.buttonLabel.set('Choose a CSV file');
    await render();
    expect(button().textContent?.trim()).toBe('Choose a CSV file');
  });

  it('opens the chooser from its button and emits what was chosen, then forgets it', async () => {
    const click = vi.spyOn(input(), 'click').mockImplementation(() => undefined);
    button().click();
    expect(click).toHaveBeenCalled();

    const chosen = [new File(['a'], 'a.csv'), new File(['b'], 'b.csv')];
    Object.defineProperty(input(), 'files', { configurable: true, value: chosen });
    input().dispatchEvent(new Event('change'));
    expect(host.received).toEqual([chosen]);
  });

  it('lights up while files are over it and emits them on drop', async () => {
    el().dispatchEvent(drag('dragenter'));
    await render();
    expect(el().classList).toContain('nxs-dropzone--over');
    const files = [new File(['a'], 'a.csv')];
    const drop = drag('drop', files);
    el().dispatchEvent(drop);
    await render();
    expect(drop.defaultPrevented).toBe(true);
    expect(host.received).toEqual([files]);
    expect(el().classList).not.toContain('nxs-dropzone--over');
  });

  it('keeps only the first file of a drop when it takes one', async () => {
    host.multiple.set(false);
    await render();
    const files = [new File(['a'], 'a.csv'), new File(['b'], 'b.csv')];
    el().dispatchEvent(drag('drop', files));
    expect(host.received).toEqual([[files[0]]]);
  });

  it('leaves a drag of text alone', async () => {
    const text = drag('dragenter', [], ['text/plain']);
    el().dispatchEvent(text);
    await render();
    expect(text.defaultPrevented).toBe(false);
    expect(el().classList).not.toContain('nxs-dropzone--over');
  });

  it('takes nothing while disabled', async () => {
    host.disabled.set(true);
    await render();
    expect(button().disabled).toBe(true);
    const drop = drag('drop', [new File(['a'], 'a.csv')]);
    el().dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
    expect(host.received).toEqual([]);
  });
});

describe('NxsDropzoneComponent, twice on a page', () => {
  it('gives each zone’s button its own id, so each input is named by its own button', async () => {
    await TestBed.configureTestingModule({
      imports: [TwoZonesComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    const fixture = TestBed.createComponent(TwoZonesComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const zones = [...(fixture.nativeElement as HTMLElement).querySelectorAll('nxs-dropzone')];
    const named = zones.map((zone) => {
      const input = zone.querySelector('input') as HTMLInputElement;
      const button = zone.querySelector('button') as HTMLButtonElement;
      const labelledBy = input.getAttribute('aria-labelledby') ?? '';
      return {
        id: button.id,
        labelledBy,
        name: document.getElementById(labelledBy)?.textContent?.trim(),
        isOwnButton: document.getElementById(labelledBy) === button,
      };
    });
    expect(named.map(({ name, isOwnButton }) => ({ name, isOwnButton }))).toEqual([
      { name: 'Choose invoices', isOwnButton: true },
      { name: 'Choose receipts', isOwnButton: true },
    ]);
    expect(named[0].id).not.toBe(named[1].id);
    expect(named.every(({ id, labelledBy }) => id !== '' && id === labelledBy)).toBe(true);
  });
});
