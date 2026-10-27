import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { provideTranslateService } from '@ngx-translate/core';
import { vi } from 'vitest';

import { NxsSatoriUploadComponent } from './satori-upload.component';

/**
 * The component on its own. Which implementation the ID resolves to, and the file rules it shares
 * with the Material dropzone, are asserted in `provide-nxs-satori-components.spec.ts`. These are
 * the things that spec cannot reach: an input **changing** after the first render, and the `files`
 * output a host gets when it uses the element rather than the ID.
 */
describe('NxsSatoriUploadComponent', () => {
  let fixture: ComponentFixture<NxsSatoriUploadComponent>;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function picker(): HTMLInputElement {
    return host().querySelector('input[type="file"]') as HTMLInputElement;
  }

  function render(inputs: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }

  function dropOn(el: Element, files: File[]): void {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], files, dropEffect: 'none' },
    });
    el.dispatchEvent(event);
  }

  const file = (name: string) => new File(['x'], name, { type: 'text/plain' });

  function chooserButton(): HTMLButtonElement {
    return host().querySelector('button.sat-upload-field-interactive') as HTMLButtonElement;
  }

  /**
   * A pick, the way `dropzone.component.spec.ts` stages one: `files` is read-only, so it is defined
   * on the element, then `change` is dispatched **on the input** — Satori's handler reads
   * `event.currentTarget`, so an event dispatched anywhere else would be ignored for the wrong
   * reason and the test would pass while proving nothing.
   */
  function choose(files: File[]): void {
    Object.defineProperty(picker(), 'files', { configurable: true, value: files });
    picker().dispatchEvent(new Event('change'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsSatoriUploadComponent],
      providers: [provideZonelessChangeDetection(), provideSatori(), provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsSatoriUploadComponent);
  });

  it('follows a changed label, not the first one', () => {
    render({ label: 'Drag and drop files here' });
    render({ label: 'Déposez vos fichiers ici' });
    expect(host().querySelector('mat-label')?.textContent?.trim()).toBe('Déposez vos fichiers ici');
  });

  it('switches the chooser between one file and several as multiple changes', () => {
    render({ label: 'Drop files', multiple: false });
    expect(picker().multiple).toBe(false);
    render({ multiple: true });
    expect(picker().multiple).toBe(true);
  });

  it('adds and removes accept as the input comes and goes', () => {
    render({ label: 'Drop files', accept: '.csv' });
    expect(picker().getAttribute('accept')).toBe('.csv');
    render({ accept: '' });
    expect(picker().hasAttribute('accept')).toBe(false);
  });

  // `SatUploadField.disabled` is a writable signal, not an input, so the component sets it in an
  // effect. This is the assertion behind that: disabling after the first render has to reach
  // Satori's own button, not just the projected input.
  it('disables and re-enables Satori’s own control, not only the projected input', () => {
    render({ label: 'Drop files' });
    const button = host().querySelector<HTMLButtonElement>('button.sat-upload-field-interactive');
    expect(button?.disabled).toBe(false);
    render({ disabled: true });
    expect(picker().disabled).toBe(true);
    expect(
      host().querySelector<HTMLButtonElement>('button.sat-upload-field-interactive')?.disabled,
    ).toBe(true);
    render({ disabled: false });
    expect(
      host().querySelector<HTMLButtonElement>('button.sat-upload-field-interactive')?.disabled,
    ).toBe(false);
  });

  it('emits the files output for a host that uses the element', () => {
    const emitted: (readonly File[])[] = [];
    render({ label: 'Drop files' });
    fixture.componentInstance.files.subscribe((files) => emitted.push(files));
    dropOn(host().querySelector('.sat-upload-field-interactive')!, [file('claim.pdf')]);
    expect(emitted.map((f) => f.map((x) => x.name))).toEqual([['claim.pdf']]);
  });

  it('calls the handler and emits the output for the same drop, so a host never has to pick', () => {
    const handled: (readonly File[])[] = [];
    const emitted: (readonly File[])[] = [];
    render({ label: 'Drop files', filesHandler: (files: readonly File[]) => handled.push(files) });
    fixture.componentInstance.files.subscribe((files) => emitted.push(files));
    dropOn(host().querySelector('.sat-upload-field-interactive')!, [file('claim.pdf')]);
    expect(handled).toHaveLength(1);
    expect(emitted).toHaveLength(1);
    expect(handled[0]).toEqual(emitted[0]);
  });

  // The region's own text is `sat.upload-field.files-loaded` interpolated with the file names, and
  // this TestBed has no catalogue, so what is asserted is that the announcement happens at all:
  // silent before anything is taken, speaking afterwards. That is the half `uploadedFiles` decides,
  // and the half this component is responsible for.
  it('feeds Satori’s live region once files are taken, so the upload is announced', () => {
    render({ label: 'Drop files' });
    const region = () => host().querySelector('[aria-live="polite"]');
    expect(region()?.textContent?.trim()).toBe('');
    dropOn(host().querySelector('.sat-upload-field-interactive')!, [file('claim.pdf')]);
    fixture.detectChanges();
    expect(region()?.textContent?.trim()).not.toBe('');
  });

  it('reflects disabled on its own host, for a parent that styles the state', () => {
    render({ label: 'Drop files', disabled: true });
    const wrapper = fixture.componentRef.location.nativeElement as HTMLElement;
    expect(wrapper.classList).toContain('nxs-satori-upload--disabled');
  });

  // The chooser path, which the drop tests do not reach. This component registers no `change`
  // listener of its own, on the grounds that Satori's `satUpload` already has one on the input it
  // is pointed at — so these are what hold that claim up. Without them, a second listener could be
  // added back and nothing would notice until every pick arrived twice.
  it('opens the chooser from the field, so the keyboard has a way in', () => {
    render({ label: 'Drop files' });
    const click = vi.spyOn(picker(), 'click').mockImplementation(() => undefined);
    chooserButton().click();
    expect(click).toHaveBeenCalled();
  });

  it('delivers a chosen file to both routes exactly once', () => {
    const handled: (readonly File[])[] = [];
    const emitted: (readonly File[])[] = [];
    render({ label: 'Drop files', filesHandler: (files: readonly File[]) => handled.push(files) });
    fixture.componentInstance.files.subscribe((files) => emitted.push(files));
    choose([file('claim.pdf')]);
    expect(handled).toHaveLength(1);
    expect(emitted).toHaveLength(1);
    expect(handled[0].map((f) => f.name)).toEqual(['claim.pdf']);
    expect(emitted[0]).toEqual(handled[0]);
  });

  it('takes only the first chosen file when multiple is off, as Material does', () => {
    const handled: (readonly File[])[] = [];
    render({ label: 'Drop files', filesHandler: (files: readonly File[]) => handled.push(files) });
    choose([file('a.pdf'), file('b.pdf')]);
    expect(handled[0].map((f) => f.name)).toEqual(['a.pdf']);
  });

  it('takes every chosen file when multiple is on', () => {
    const handled: (readonly File[])[] = [];
    render({
      label: 'Drop files',
      multiple: true,
      filesHandler: (files: readonly File[]) => handled.push(files),
    });
    choose([file('a.pdf'), file('b.pdf')]);
    expect(handled[0].map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('takes nothing from the chooser while disabled', () => {
    const handled: (readonly File[])[] = [];
    render({
      label: 'Drop files',
      disabled: true,
      filesHandler: (files: readonly File[]) => handled.push(files),
    });
    choose([file('claim.pdf')]);
    expect(handled).toEqual([]);
  });

  // So the same file can be chosen again after being removed: without the reset the second pick
  // fires no `change` at all. Satori's handler does this; the Material dropzone does it itself, and
  // this is the assertion that the two agree.
  it('forgets the pick, so choosing the same file twice is two picks', () => {
    const handled: (readonly File[])[] = [];
    render({ label: 'Drop files', filesHandler: (files: readonly File[]) => handled.push(files) });
    choose([file('claim.pdf')]);
    expect(picker().value).toBe('');
    choose([file('claim.pdf')]);
    expect(handled).toHaveLength(2);
  });
});
