import { LiveAnnouncer } from '@angular/cdk/a11y';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TagService } from '@nuxeo-satori/platform/nuxeo-client';

import { NXS_SEARCH_DEBOUNCE_MS } from '../pickers/search-as-you-type';
import { NxsTagInputComponent } from './tag-input.component';

@Component({
  standalone: true,
  imports: [NxsTagInputComponent, ReactiveFormsModule],
  template: `<nxs-tag-input label="Tags" [allowNew]="allowNew()" [formControl]="tags" />`,
})
class HostComponent {
  readonly allowNew = signal(true);
  readonly tags = new FormControl<readonly string[]>([], Validators.required);
}

describe('NxsTagInputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let suggestTags: ReturnType<typeof vi.fn>;
  let announce: ReturnType<typeof vi.fn>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const input = (): HTMLInputElement => root().querySelector('input') as HTMLInputElement;
  const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('mat-option')];
  const optionTexts = (): string[] => options().map((option) => option.textContent?.trim() ?? '');
  const chips = (): string[] =>
    [...root().querySelectorAll('mat-chip-row')].map(
      (chip) => chip.querySelector('.mat-mdc-chip-action-label')?.textContent?.trim() ?? '',
    );

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function type(value: string): Promise<void> {
    input().focus();
    input().value = value;
    input().dispatchEvent(new Event('input'));
    await render();
    vi.advanceTimersByTime(NXS_SEARCH_DEBOUNCE_MS);
    await render();
  }

  async function press(keyCode: number, key: string): Promise<void> {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { get: () => keyCode });
    input().dispatchEvent(event);
    await render();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    suggestTags = vi.fn(() => of(['contract', 'claims']));
    announce = vi.fn(() => Promise.resolve());
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TagService, useValue: { suggestTags } },
        { provide: LiveAnnouncer, useValue: { announce } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  afterEach(() => vi.useRealTimers());

  it('suggests existing tags from the first character, as Web UI does', async () => {
    await type('c');
    expect(suggestTags).toHaveBeenCalledExactlyOnceWith('c');
    expect(optionTexts()).toEqual(['Add “c”', 'contract', 'claims']);
    expect(announce).toHaveBeenLastCalledWith('2 results', 'polite');
  });

  it('adds a suggestion chosen as a chip', async () => {
    await type('con');
    options()
      .find((option) => option.getAttribute('data-tag') === 'contract')
      ?.click();
    await render();
    expect(host.tags.value).toEqual(['contract']);
    expect(chips()).toEqual(['contract']);
    expect(input().value).toBe('');
  });

  it('adds what was typed with Enter, or with a comma', async () => {
    await type('urgent ');
    await press(ENTER, 'Enter');
    await type('q4');
    await press(COMMA, ',');
    expect(host.tags.value).toEqual(['urgent', 'q4']);
  });

  it('offers to add a tag no document has yet, and adds it from that entry', async () => {
    suggestTags.mockReturnValue(of([]));
    await type('renewal');
    expect(optionTexts()).toEqual(['Add “renewal”']);
    options()[0].click();
    await render();
    expect(host.tags.value).toEqual(['renewal']);
  });

  it('adds nothing new when new tags are not allowed', async () => {
    host.allowNew.set(false);
    suggestTags.mockReturnValue(of([]));
    await type('renewal');
    expect(optionTexts()).toEqual(['No results']);
    await press(ENTER, 'Enter');
    expect(host.tags.value).toEqual([]);
  });

  it('does not add a tag twice, whatever its case, nor suggest one it holds', async () => {
    host.tags.setValue(['Contract']);
    await render();
    await type('contract');
    await press(ENTER, 'Enter');
    expect(host.tags.value).toEqual(['Contract']);
    await type('c');
    expect(optionTexts()).toEqual(['Add “c”', 'claims']);
  });

  it('removes a tag with its named button', async () => {
    host.tags.setValue(['contract', 'claims']);
    await render();
    const remove = root().querySelector<HTMLButtonElement>(
      'mat-chip-row[data-tag="contract"] button[matChipRemove]',
    );
    expect(remove?.getAttribute('aria-label')).toBe('Remove contract');
    remove?.click();
    await render();
    expect(host.tags.value).toEqual(['claims']);
  });

  it('says the search failed, and still adds what was typed', async () => {
    suggestTags.mockReturnValue(throwError(() => ({ status: 500 })));
    await type('urgent');
    expect(optionTexts()).toEqual(['Add “urgent”', 'Search failed. Try again.']);
    await press(ENTER, 'Enter');
    expect(host.tags.value).toEqual(['urgent']);
  });

  it('shows the form’s required error once the user has left the field empty', async () => {
    input().dispatchEvent(new Event('blur'));
    await render();
    expect(root().querySelector('mat-error')?.textContent?.trim()).toBe('Required');
  });
});
