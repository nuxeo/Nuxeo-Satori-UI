import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { MatChipInputEvent } from '@angular/material/chips';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { testTranslateProviders } from '@agentic-ui/testing/i18n';
import { CURRENT_USERNAME, TagService } from '@nuxeo/satori-platform/nuxeo-client';

import { NxsToastService } from '../toast/toast.service';
import { NxsTagEditorComponent } from './tag-editor.component';
import { provideNxsTagWrites } from './tag-writes.service';

@Component({
  standalone: true,
  imports: [NxsTagEditorComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-tag-editor
      [documentUid]="uid()"
      [tags]="tags()"
      [readOnly]="readOnly()"
      (tagsChange)="changes.push($event)"
    />
  `,
})
class HostComponent {
  readonly uid = signal('doc-1');
  readonly tags = signal<readonly string[]>(['contract', 'q3']);
  readonly readOnly = signal(false);
  readonly changes: (readonly string[])[] = [];
}

type TagCall = (uid: string, label: string) => Observable<string[]>;

describe('NxsTagEditorComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let tags: {
    addTag: ReturnType<typeof vi.fn<TagCall>>;
    removeTag: ReturnType<typeof vi.fn<TagCall>>;
    suggestTags: ReturnType<typeof vi.fn<(term: string) => Observable<string[]>>>;
  };
  let toastShow: ReturnType<typeof vi.spyOn>;
  let toastError: ReturnType<typeof vi.spyOn>;
  /** Who is signed in, as the app shell reports it through `CURRENT_USERNAME`. */
  const user = signal<string | null>('alice');

  const el = (): HTMLElement => fixture.nativeElement;
  const chips = (): string[] =>
    [...el().querySelectorAll('mat-chip-row')].map((chip) =>
      (chip.querySelector('.mat-mdc-chip-action-label')?.textContent ?? '').trim(),
    );
  const box = (): HTMLInputElement => el().querySelector('input') as HTMLInputElement;
  const options = (): HTMLElement[] => [
    ...document.querySelectorAll<HTMLElement>('.mat-mdc-autocomplete-panel mat-option'),
  ];
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const type = async (value: string): Promise<void> => {
    box().focus();
    box().value = value;
    box().dispatchEvent(new Event('input'));
    await settle();
  };
  const key = (target: HTMLElement, keyCode: number, name: string): void => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { get: () => keyCode });
    target.dispatchEvent(event);
  };
  const enter = async (): Promise<void> => {
    key(box(), 13, 'Enter');
    await settle();
  };
  const removeButton = (tag: string): HTMLButtonElement =>
    el().querySelector(`button[aria-label="Remove tag ${tag}"]`) as HTMLButtonElement;

  /** Renders a host, on `tags` when given: the document as the host loaded it. */
  async function mount(tags?: readonly string[]): Promise<void> {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    if (tags) host.tags.set(tags);
    await settle();
  }

  /**
   * As the app runs it: with `provideNxsTagWrites()` at the root, unless told otherwise. It resets
   * the module, so it lists the translations the test setup would otherwise have provided.
   */
  async function configure({ writes = true } = {}): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        testTranslateProviders(),
        { provide: TagService, useValue: tags },
        { provide: CURRENT_USERNAME, useValue: () => user() },
        ...(writes ? [provideNxsTagWrites()] : []),
      ],
    }).compileComponents();
  }

  beforeEach(async () => {
    tags = { addTag: vi.fn(), removeTag: vi.fn(), suggestTags: vi.fn(() => of([])) };
    user.set('alice');
    toastShow = vi.spyOn(NxsToastService.prototype, 'show').mockImplementation(() => undefined);
    toastError = vi.spyOn(NxsToastService.prototype, 'error').mockImplementation(() => undefined);
    await configure();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('read-only', () => {
    it('lists the tags with no box and no remove buttons', async () => {
      await mount();
      host.readOnly.set(true);
      await settle();

      const list = el().querySelector('ul.nxs-tag-editor__chips');
      expect(list?.getAttribute('aria-label')).toBe('Tags');
      expect([...el().querySelectorAll('nxs-tag')].map((tag) => tag.textContent?.trim())).toEqual([
        'contract',
        'q3',
      ]);
      expect(el().querySelector('input')).toBeNull();
      expect(el().querySelector('button')).toBeNull();
    });

    it('shows a dash for no tags, read out as "No tags"', async () => {
      await mount();
      host.readOnly.set(true);
      host.tags.set([]);
      await settle();

      const empty = el().querySelector('.nxs-tag-editor__empty');
      expect(empty?.querySelector('[aria-hidden="true"]')?.textContent).toBe('—');
      expect(empty?.textContent).toContain('No tags');
    });
  });

  describe('editing', () => {
    it('shows each tag as a chip with a labelled remove button, and a box to add one', async () => {
      await mount();

      expect(chips()).toEqual(['contract', 'q3']);
      const icon = removeButton('contract').querySelector('mat-icon');
      expect(icon?.classList).toContain('nxs-tag-editor__remove-icon');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.textContent?.trim()).toBe('');
      expect(el().querySelector('mat-chip-grid')?.getAttribute('aria-label')).toBe('Tags');
      expect(box().placeholder).toBe('Add tags to this document');
      expect(box().getAttribute('aria-label')).toBe('Add tags to this document');
    });

    it('keeps the box, a combobox, out of the chip grid, which may hold only rows', async () => {
      await mount();

      expect(box().getAttribute('role')).toBe('combobox');
      expect(box().closest('[role="grid"]')).toBeNull();
      const grid = el().querySelector('[role="grid"]');
      expect(
        [...(grid?.querySelectorAll('[role]') ?? [])].map((child) => child.getAttribute('role')),
      ).not.toContain('combobox');
    });

    it('follows the tags the host passes in', async () => {
      await mount();
      host.tags.set(['invoice']);
      await settle();

      expect(chips()).toEqual(['invoice']);
    });

    it('adds the typed text on Enter, then shows the label Nuxeo stored and says so', async () => {
      const answer = new Subject<string[]>();
      tags.addTag.mockReturnValue(answer);
      await mount();

      await type('Q3 Report');
      key(box(), 27, 'Escape');
      await enter();

      expect(tags.addTag).toHaveBeenCalledWith('doc-1', 'q3 report');
      expect(box().value).toBe('');
      const pending = el().querySelector('mat-chip-row.nxs-tag-editor__pending');
      expect(pending?.textContent).toContain('q3 report');
      expect(pending?.querySelector('[aria-label="Adding tag q3 report"]')).toBeTruthy();

      answer.next(['contract', 'q3', 'q3report']);
      answer.complete();
      await settle();

      expect(chips()).toEqual(['contract', 'q3', 'q3report']);
      expect(el().querySelector('.nxs-tag-editor__pending')).toBeNull();
      expect(host.changes).toEqual([['contract', 'q3', 'q3report']]);
      expect(toastShow).toHaveBeenCalledWith('The tag q3report has been added to the document.');
    });

    it('names the typed label without its spaces when the tag was already there', async () => {
      tags.addTag.mockReturnValue(of(['contract', 'q3', 'q3report']));
      await mount();
      host.tags.set(['contract', 'q3', 'q3report']);
      await settle();

      await type('Q3 Report');
      key(box(), 27, 'Escape');
      await enter();

      expect(toastShow).toHaveBeenCalledWith('The tag q3report has been added to the document.');
    });

    it('does not send a tag the document already has, whatever its case', async () => {
      await mount();

      await type('Contract');
      key(box(), 27, 'Escape');
      await enter();

      expect(tags.addTag).not.toHaveBeenCalled();
      expect(box().value).toBe('');
    });

    it('ignores Enter in an empty box', async () => {
      await mount();

      await type('   ');
      await enter();

      expect(tags.addTag).not.toHaveBeenCalled();
    });

    it('takes a chip away at once and keeps it away once Nuxeo confirms', async () => {
      const answer = new Subject<string[]>();
      tags.removeTag.mockReturnValue(answer);
      await mount();

      removeButton('contract').click();
      await settle();

      expect(tags.removeTag).toHaveBeenCalledWith('doc-1', 'contract');
      expect(chips()).toEqual(['q3']);

      answer.next(['q3']);
      answer.complete();
      await settle();

      expect(chips()).toEqual(['q3']);
      expect(host.changes).toEqual([['q3']]);
      expect(toastShow).toHaveBeenCalledWith(
        'The tag contract has been removed from the document.',
      );
    });

    it('sends one removal per tag even if asked twice before the answer', async () => {
      tags.removeTag.mockReturnValue(new Subject<string[]>());
      await mount();
      const editor = fixture.debugElement.children[0].componentInstance as unknown as {
        remove(tag: string): void;
      };

      editor.remove('contract');
      editor.remove('contract');
      await settle();

      expect(tags.removeTag).toHaveBeenCalledTimes(1);
    });
  });

  describe('suggestions', () => {
    it('suggests existing tags through Tag.Suggestion, after the typed text as a new tag', async () => {
      vi.useFakeTimers();
      tags.suggestTags.mockReturnValue(of(['contract', 'contoso', 'control']));
      await mount();

      await type('con');
      vi.advanceTimersByTime(300);
      await settle();

      expect(tags.suggestTags).toHaveBeenCalledWith('con');
      expect(options().map((option) => option.textContent?.trim())).toEqual([
        '+ con',
        'contoso',
        'control',
      ]);
      expect(options()[0].getAttribute('aria-label')).toBe('New tag con');
      expect(options()[1].getAttribute('aria-label')).toBeNull();
    });

    it('offers no new tag when the typed text is an existing tag', async () => {
      vi.useFakeTimers();
      tags.suggestTags.mockReturnValue(of(['contoso']));
      await mount();

      await type('Contoso');
      vi.advanceTimersByTime(300);
      await settle();

      expect(options().map((option) => option.textContent?.trim())).toEqual(['contoso']);
    });

    it('still offers the new tag when suggesting fails', async () => {
      vi.useFakeTimers();
      tags.suggestTags.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      await mount();

      await type('con');
      vi.advanceTimersByTime(300);
      await settle();

      expect(options().map((option) => option.textContent?.trim())).toEqual(['+ con']);
    });

    it('adds a suggestion picked with the mouse, as listed', async () => {
      vi.useFakeTimers();
      tags.suggestTags.mockReturnValue(of(['contoso']));
      tags.addTag.mockReturnValue(of(['contract', 'q3', 'contoso']));
      await mount();

      await type('con');
      vi.advanceTimersByTime(300);
      await settle();
      options()[1].click();
      await settle();

      expect(tags.addTag).toHaveBeenCalledWith('doc-1', 'contoso');
      expect(tags.addTag).toHaveBeenCalledTimes(1);
      expect(box().value).toBe('');
      expect(chips()).toEqual(['contract', 'q3', 'contoso']);
    });

    it('adds the typed text once on Enter while its "+" entry is highlighted', async () => {
      tags.addTag.mockReturnValue(of(['contract', 'q3', 'invoice']));
      await mount();

      await type('Invoice');
      expect(options()[0].classList).toContain('mat-mdc-option-active');
      await enter();

      expect(tags.addTag).toHaveBeenCalledTimes(1);
      expect(tags.addTag).toHaveBeenCalledWith('doc-1', 'invoice');
      expect(box().value).toBe('');
    });

    it('adds only the highlighted suggestion on Enter, not the typed text as well', async () => {
      vi.useFakeTimers();
      tags.suggestTags.mockReturnValue(of(['contoso']));
      tags.addTag.mockReturnValue(of(['contract', 'q3', 'contoso']));
      await mount();

      await type('con');
      vi.advanceTimersByTime(300);
      await settle();
      key(box(), 40, 'ArrowDown');
      await settle();
      await enter();

      expect(tags.addTag).toHaveBeenCalledTimes(1);
      expect(tags.addTag).toHaveBeenCalledWith('doc-1', 'contoso');
    });

    it('leaves Enter to the suggestion list whichever of the two hears it first', async () => {
      await mount();
      const editor = fixture.debugElement.children[0].componentInstance as unknown as {
        entered(event: MatChipInputEvent): void;
      };

      await type('con');
      expect(options()[0].classList).toContain('mat-mdc-option-active');
      editor.entered({ value: 'con' } as MatChipInputEvent);
      await settle();

      expect(tags.addTag).not.toHaveBeenCalled();
    });

    it('asks for nothing once the box is cleared', async () => {
      vi.useFakeTimers();
      await mount();

      await type('   ');
      vi.advanceTimersByTime(300);
      await settle();

      expect(tags.suggestTags).not.toHaveBeenCalled();
      expect(options()).toEqual([]);
    });
  });

  describe('ordering', () => {
    it('sends changes one at a time, so a later answer always wins', async () => {
      const added = new Subject<string[]>();
      tags.addTag.mockReturnValue(added);
      tags.removeTag.mockReturnValue(of(['q3', 'invoice']));
      await mount();

      await type('invoice');
      key(box(), 27, 'Escape');
      await enter();
      removeButton('contract').click();
      await settle();

      expect(tags.removeTag).not.toHaveBeenCalled();
      expect(chips()).toEqual(['q3', 'invoice']);

      added.next(['contract', 'q3', 'invoice']);
      added.complete();
      await settle();

      expect(tags.removeTag).toHaveBeenCalledWith('doc-1', 'contract');
      expect(chips()).toEqual(['q3', 'invoice']);
      expect(host.changes).toEqual([
        ['contract', 'q3', 'invoice'],
        ['q3', 'invoice'],
      ]);
    });

    it('keeps a change going when the document changes, and shows it on the way back', async () => {
      const added = new Subject<string[]>();
      tags.addTag.mockReturnValue(added);
      await mount();

      await type('invoice');
      key(box(), 27, 'Escape');
      await enter();
      host.uid.set('doc-2');
      host.tags.set(['other']);
      await settle();

      expect(el().querySelector('.nxs-tag-editor__pending')).toBeNull();
      added.next(['contract', 'q3', 'invoice']);
      added.complete();
      await settle();

      // Not doc-2's tags, so neither the chips nor the host hear it here.
      expect(chips()).toEqual(['other']);
      expect(host.changes).toEqual([]);
      expect(toastShow).toHaveBeenCalledWith('The tag invoice has been added to the document.');

      host.uid.set('doc-1');
      host.tags.set(['contract', 'q3']);
      await settle();

      expect(chips()).toEqual(['contract', 'q3', 'invoice']);
      expect(host.changes).toEqual([['contract', 'q3', 'invoice']]);
    });

    it('finishes every change when the editor is closed mid-write, for the next one to show', async () => {
      const added = new Subject<string[]>();
      tags.addTag.mockReturnValue(added);
      tags.removeTag.mockReturnValue(of(['q3', 'invoice']));
      await mount();

      await type('invoice');
      key(box(), 27, 'Escape');
      await enter();
      removeButton('contract').click();
      await settle();
      const closed = host;
      fixture.destroy();

      added.next(['contract', 'q3', 'invoice']);
      added.complete();

      // The queued removal still went out, after the add, and nothing reached the closed host.
      expect(tags.removeTag).toHaveBeenCalledExactlyOnceWith('doc-1', 'contract');
      expect(closed.changes).toEqual([]);
      expect(toastShow).toHaveBeenCalledWith('The tag invoice has been added to the document.');
      expect(toastShow).toHaveBeenCalledWith(
        'The tag contract has been removed from the document.',
      );

      // Reopened with the tags the host loaded before the change: it catches up once, and only once.
      await mount();
      expect(chips()).toEqual(['q3', 'invoice']);
      expect(host.changes).toEqual([['q3', 'invoice']]);

      host.tags.set(['q3', 'invoice']);
      await settle();
      expect(host.changes).toEqual([['q3', 'invoice']]);
    });

    it('without provideNxsTagWrites, still finishes the changes of a closed editor', async () => {
      await configure({ writes: false });
      const added = new Subject<string[]>();
      tags.addTag.mockReturnValue(added);
      tags.removeTag.mockReturnValue(of(['q3', 'invoice']));
      await mount();

      await type('invoice');
      key(box(), 27, 'Escape');
      await enter();
      removeButton('contract').click();
      await settle();
      fixture.destroy();

      added.next(['contract', 'q3', 'invoice']);
      added.complete();

      expect(tags.removeTag).toHaveBeenCalledExactlyOnceWith('doc-1', 'contract');
      expect(toastShow).toHaveBeenCalledWith(
        'The tag contract has been removed from the document.',
      );

      // The documented limit: the next editor has its own writes, so it shows what the host passes.
      await mount();
      expect(chips()).toEqual(['contract', 'q3']);
      expect(host.changes).toEqual([]);
    });

    it('still says a change failed when the editor was closed before the answer', async () => {
      const added = new Subject<string[]>();
      tags.addTag.mockReturnValue(added);
      await mount();

      await type('invoice');
      key(box(), 27, 'Escape');
      await enter();
      fixture.destroy();
      added.error(new HttpErrorResponse({ status: 500 }));

      expect(toastError).toHaveBeenCalledWith('The tag invoice could not be added.');

      await mount();
      expect(chips()).toEqual(['contract', 'q3']);
      expect(host.changes).toEqual([]);
    });

    it('does not replay a stored answer over tags the host has loaded again since', async () => {
      tags.addTag.mockReturnValue(of(['contract', 'q3', 'invoice']));
      const added = new Subject<string[]>();
      tags.addTag.mockReturnValueOnce(added);
      await mount();

      await type('invoice');
      key(box(), 27, 'Escape');
      await enter();
      fixture.destroy();
      added.next(['contract', 'q3', 'invoice']);
      added.complete();

      // Another client changed the tags after that answer, and the host reloaded the document.
      await mount(['contract', 'q3', 'invoice', 'urgent']);

      expect(chips()).toEqual(['contract', 'q3', 'invoice', 'urgent']);
      expect(host.changes).toEqual([]);
    });

    it("never sends one user's queued change as the next, nor says another's answer", async () => {
      const added = new Subject<string[]>();
      tags.addTag.mockReturnValue(added);
      tags.removeTag.mockReturnValue(of(['q3', 'invoice']));
      await mount();

      await type('invoice');
      key(box(), 27, 'Escape');
      await enter();
      removeButton('contract').click();
      await settle();

      // alice signs out and bob signs in while her add is still on its way.
      user.set(null);
      user.set('bob');
      await settle();
      expect(el().querySelector('.nxs-tag-editor__pending')).toBeNull();
      expect(chips()).toEqual(['contract', 'q3']);

      added.next(['contract', 'q3', 'invoice']);
      added.complete();
      await settle();

      // Her queued removal was never sent with bob's session, and her answer is not his to hear.
      expect(tags.removeTag).not.toHaveBeenCalled();
      expect(toastShow).not.toHaveBeenCalled();
      expect(host.changes).toEqual([]);

      fixture.destroy();
      await mount();
      expect(chips()).toEqual(['contract', 'q3']);
      expect(host.changes).toEqual([]);
    });
  });

  describe('failures', () => {
    it('puts a chip back and says so when removing fails', async () => {
      tags.removeTag.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      await mount();

      removeButton('contract').click();
      await settle();

      expect(chips()).toEqual(['contract', 'q3']);
      expect(toastError).toHaveBeenCalledWith('The tag contract could not be removed.');
      expect(host.changes).toEqual([]);
    });

    it('drops the pending chip and says so when adding fails', async () => {
      tags.addTag.mockReturnValue(throwError(() => new Error('offline')));
      await mount();

      await type('invoice');
      key(box(), 27, 'Escape');
      await enter();

      expect(chips()).toEqual(['contract', 'q3']);
      expect(toastError).toHaveBeenCalledWith('The tag invoice could not be added.');
    });

    it('reads a 403 as a refusal, not a failure', async () => {
      tags.addTag.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
      await mount();

      await type('invoice');
      key(box(), 27, 'Escape');
      await enter();

      expect(toastError).toHaveBeenCalledWith(
        "You do not have permission to change this document's tags.",
      );
    });

    it('keeps going after a failure', async () => {
      tags.addTag
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
        .mockReturnValueOnce(of(['contract', 'q3', 'invoice']));
      await mount();

      await type('broken');
      key(box(), 27, 'Escape');
      await enter();
      await type('invoice');
      key(box(), 27, 'Escape');
      await enter();

      expect(chips()).toEqual(['contract', 'q3', 'invoice']);
    });
  });
});
