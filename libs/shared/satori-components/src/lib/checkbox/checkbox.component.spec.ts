import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsCheckboxComponent } from './checkbox.component';

@Component({
  standalone: true,
  imports: [NxsCheckboxComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<p id="who">Ticked by Jane Doe</p>
    <nxs-checkbox
      [checked]="checked()"
      [disabled]="disabled()"
      [describedBy]="describedBy()"
      (checkedChange)="asked.push($event)"
      ><span class="words">Medical records received</span></nxs-checkbox
    >`,
})
class HostComponent {
  readonly checked = signal(false);
  readonly disabled = signal(false);
  readonly describedBy = signal<string | null>(null);
  readonly asked: boolean[] = [];
}

@Component({
  standalone: true,
  imports: [NxsCheckboxComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-checkbox checked disabled>Sent</nxs-checkbox>`,
})
class StaticAttributesHostComponent {}

describe('NxsCheckboxComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const box = (): HTMLInputElement => {
    const input = fixture.nativeElement.querySelector('input[type="checkbox"]');
    if (!input) throw new Error('no native checkbox rendered');
    return input as HTMLInputElement;
  };

  /** Its accessible name: the text of the label its native box is labelled by. */
  const nameOf = (input: HTMLInputElement): string =>
    [...(input.labels ?? [])].map((label) => label.textContent?.trim() ?? '').join(' ');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, StaticAttributesHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it('is a native checkbox, in the tab order, named by its words', () => {
    expect(box().checked).toBe(false);
    expect(box().disabled).toBe(false);
    expect(box().tabIndex).toBe(0);
    expect(nameOf(box())).toBe('Medical records received');
    expect(box().hasAttribute('aria-disabled')).toBe(false);
  });

  it('asks for the other state on a click, and shows what it showed until its owner says', async () => {
    box().click();
    await render();
    expect(host.asked).toEqual([true]);
    expect(box().checked).toBe(false);

    host.checked.set(true);
    await render();
    expect(box().checked).toBe(true);

    box().click();
    await render();
    expect(host.asked).toEqual([true, false]);
    expect(box().checked).toBe(true);
  });

  it('asks once when its words are clicked, as the box is', async () => {
    (fixture.nativeElement.querySelector('.words') as HTMLElement).click();
    await render();
    expect(host.asked).toEqual([true]);
    expect(box().checked).toBe(false);
  });

  it('asks nothing while disabled, and stays focusable, saying it is unavailable', async () => {
    host.disabled.set(true);
    await render();
    box().focus();
    expect(document.activeElement).toBe(box());
    expect(box().disabled).toBe(false);
    expect(box().tabIndex).toBe(0);
    expect(box().getAttribute('aria-disabled')).toBe('true');

    box().click();
    await render();
    expect(host.asked).toEqual([]);
    expect(box().checked).toBe(false);
    expect(document.activeElement).toBe(box());
  });

  it('is described by the element it names, and by none without one', async () => {
    expect(box().hasAttribute('aria-describedby')).toBe(false);
    host.describedBy.set('who');
    await render();
    expect(box().getAttribute('aria-describedby')).toBe('who');
  });

  it('takes checked and disabled as static attributes', async () => {
    const staticFixture = TestBed.createComponent(StaticAttributesHostComponent);
    staticFixture.detectChanges();
    await staticFixture.whenStable();
    const input = staticFixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.checked).toBe(true);
    expect(input.getAttribute('aria-disabled')).toBe('true');
  });
});
