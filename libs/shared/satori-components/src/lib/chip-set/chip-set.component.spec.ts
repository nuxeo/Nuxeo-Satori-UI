import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { NxsChipItem } from '../primitives';
import { NxsChipSetComponent } from './chip-set.component';

@Component({
  standalone: true,
  imports: [NxsChipSetComponent],
  template: `
    <nxs-chip-set
      [items]="items()"
      [label]="label()"
      [removeHandler]="handler()"
      (removed)="removed.push($event.id)"
    />
  `,
})
class HostComponent {
  readonly items = signal<readonly NxsChipItem[]>([
    { id: 'europe', label: 'Europe', removeLabel: 'Remove Europe' },
    { id: 'africa', label: 'Africa', removeLabel: 'Remove Africa', disabled: true },
  ]);
  readonly label = signal('Coverage');
  readonly handler = signal<((item: NxsChipItem) => void) | null>(null);
  readonly removed: string[] = [];
}

describe('NxsChipSetComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const set = (): HTMLElement => fixture.nativeElement.querySelector('mat-chip-set');
  const chips = (): HTMLElement[] => [...fixture.nativeElement.querySelectorAll('mat-chip')];
  const removeButtons = (): HTMLButtonElement[] => [
    ...fixture.nativeElement.querySelectorAll('button.mat-mdc-chip-remove'),
  ];

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

  it('renders one chip per item, in order, labelled by its label', () => {
    expect(chips().map((c) => c.textContent?.trim())).toEqual([
      expect.stringContaining('Europe'),
      expect.stringContaining('Africa'),
    ]);
  });

  it('names the set with its label, and names no set when the label is blank', async () => {
    expect(set().getAttribute('aria-label')).toBe('Coverage');
    host.label.set('');
    await render();
    expect(set().hasAttribute('aria-label')).toBe(false);
  });

  it('labels each remove button by its removeLabel', () => {
    expect(removeButtons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove Europe',
      'Remove Africa',
    ]);
  });

  it('emits removed with the chip when its remove button is pressed', () => {
    removeButtons()[0].click();
    expect(host.removed).toEqual(['europe']);
  });

  it('calls removeHandler with the chip, before it emits removed', () => {
    const handler = vi.fn();
    host.handler.set(handler);
    fixture.detectChanges();
    removeButtons()[0].click();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'europe' }));
    expect(host.removed).toEqual(['europe']);
  });

  it('disables the remove button of a disabled chip and does not emit for it', () => {
    expect(removeButtons()[1].disabled).toBe(true);
    removeButtons()[1].click();
    expect(host.removed).toEqual([]);
  });

  it('renders no chip for an empty list', async () => {
    host.items.set([]);
    await render();
    expect(chips()).toHaveLength(0);
  });
});
