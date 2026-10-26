import { Component, provideZonelessChangeDetection, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsRichTooltipComponent } from './rich-tooltip.component';

/** Hosted beside a second focusable, so focus can genuinely leave the component. */
@Component({
  standalone: true,
  imports: [NxsRichTooltipComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-rich-tooltip
      heading="Versioning"
      content="A new version is created each time you check in."
      triggerLabel="About versioning"
    />
    <button type="button" class="outside">Elsewhere</button>
  `,
})
class HostComponent {}

describe('NxsRichTooltipComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;

  /** The element, or a failure naming the selector — never a silent `null`. */
  function required<T extends Element>(selector: string, root: ParentNode = host): T {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Expected ${selector} to be rendered`);
    return element;
  }

  const trigger = () => required<HTMLButtonElement>('.nxs-rich-tooltip__trigger');
  const panel = () => host.querySelector<HTMLElement>('.nxs-rich-tooltip__panel');

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    await settle();
  });

  afterEach(() => host.remove());

  it('starts closed, with a named trigger that says so', () => {
    expect(panel()).toBeNull();
    expect(trigger().getAttribute('aria-label')).toBe('About versioning');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the default info icon, hidden from assistive technology', () => {
    const icon = trigger().querySelector('mat-icon');
    expect(icon?.getAttribute('data-mat-icon-name')).toBe('info');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  // A live region is announced when content enters it, so it must exist, empty, before the panel.
  it('opens its panel inside a live region, which the trigger controls, and keeps focus on the trigger', async () => {
    const live = required<HTMLElement>('.nxs-rich-tooltip__live');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent?.trim()).toBe('');
    trigger().focus();
    trigger().click();
    await settle();
    const opened = required<HTMLElement>('.nxs-rich-tooltip__panel', live);
    expect(opened.hasAttribute('role')).toBe(false);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(opened.id);
    expect(required('.nxs-rich-tooltip__heading', opened).textContent?.trim()).toBe('Versioning');
    expect(opened.querySelector('.nxs-rich-tooltip__content')?.textContent?.trim()).toBe(
      'A new version is created each time you check in.',
    );
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on a second click', async () => {
    trigger().click();
    await settle();
    trigger().click();
    await settle();
    expect(panel()).toBeNull();
  });

  it('closes on Escape and keeps focus on the trigger', async () => {
    trigger().focus();
    trigger().click();
    await settle();
    required('.nxs-rich-tooltip__panel').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('ignores Escape while closed, leaving focus where it was', async () => {
    const outside = required<HTMLButtonElement>('.outside');
    outside.focus();
    required('nxs-rich-tooltip').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(document.activeElement).toBe(outside);
  });

  it('closes when focus leaves the component', async () => {
    trigger().click();
    await settle();
    const outside = required<HTMLButtonElement>('.outside');
    trigger().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    await settle();
    expect(panel()).toBeNull();
  });

  it('stays open while focus moves within the component', async () => {
    trigger().click();
    await settle();
    trigger().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: panel() }));
    await settle();
    expect(panel()).not.toBeNull();
  });

  // Satori's defaults, which the built-in one copies: `showDelay` 200 ms, `hideDelay` 1500 ms.
  describe('on hover and focus, as Satori’s opens', () => {
    const component = () => required<HTMLElement>('nxs-rich-tooltip');
    const pointer = (type: string, target: Element = component(), pointerType = 'mouse') =>
      target.dispatchEvent(
        new PointerEvent(type, { pointerType, bubbles: !/^pointer(enter|leave)$/.test(type) }),
      );
    /** Lets `ms` pass, then renders what the timers changed. */
    const wait = (ms: number) => {
      vi.advanceTimersByTime(ms);
      fixture.detectChanges();
    };
    /**
     * A press as a mouse reports it: the button takes focus as it goes down, and the click follows
     * the release.
     */
    const press = (pointerType: string, hold = 0) => {
      pointer('pointerdown', trigger(), pointerType);
      trigger().focus();
      wait(hold);
      pointer('pointerup', trigger(), pointerType);
      trigger().click();
      wait(0);
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('opens once the pointer has rested on it for 200 ms', () => {
      pointer('pointerenter');
      wait(199);
      expect(panel()).toBeNull();
      wait(1);
      expect(panel()).not.toBeNull();
      expect(trigger().getAttribute('aria-expanded')).toBe('true');
    });

    it('opens nothing when the pointer leaves before then', () => {
      pointer('pointerenter');
      wait(100);
      pointer('pointerleave');
      wait(1000);
      expect(panel()).toBeNull();
    });

    it('closes 1.5 s after the pointer leaves, so the pointer can reach the panel first', () => {
      pointer('pointerenter');
      wait(200);
      pointer('pointerleave');
      wait(1499);
      expect(panel()).not.toBeNull();
      wait(1);
      expect(panel()).toBeNull();
    });

    it('stays open when the pointer comes back within 1.5 s', () => {
      pointer('pointerenter');
      wait(200);
      pointer('pointerleave');
      wait(1000);
      pointer('pointerenter');
      wait(5000);
      expect(panel()).not.toBeNull();
    });

    it('opens 200 ms after keyboard focus reaches the button, and leaves focus there', () => {
      trigger().focus();
      wait(199);
      expect(panel()).toBeNull();
      wait(1);
      expect(panel()).not.toBeNull();
      expect(document.activeElement).toBe(trigger());
    });

    it('stays open when the pointer leaves a panel that focus opened', () => {
      trigger().focus();
      wait(200);
      pointer('pointerenter');
      pointer('pointerleave');
      wait(5000);
      expect(panel()).not.toBeNull();
    });

    it('stays open when focus arrives while the pointer is the one waiting to open it', () => {
      pointer('pointerenter');
      trigger().focus();
      pointer('pointerleave');
      wait(200);
      expect(panel()).not.toBeNull();
      wait(5000);
      expect(panel()).not.toBeNull();
    });

    it('stays open when focus reaches a panel the pointer opened and has left', () => {
      pointer('pointerenter');
      wait(200);
      pointer('pointerleave');
      wait(1000);
      trigger().focus();
      wait(5000);
      expect(panel()).not.toBeNull();
    });

    it('closes when activated, as Enter or Space does by a click, once focus opened it', () => {
      trigger().focus();
      wait(200);
      trigger().click();
      wait(0);
      expect(panel()).toBeNull();
      expect(trigger().getAttribute('aria-expanded')).toBe('false');
    });

    it('cancels an opening on Escape', () => {
      trigger().focus();
      component().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      wait(1000);
      expect(panel()).toBeNull();
    });

    // WCAG 1.4.13: content the pointer opened must be dismissible without moving the pointer or
    // focus, so Escape has to reach the component from wherever focus is.
    describe('with focus on another control', () => {
      const outside = () => required<HTMLButtonElement>('.outside');
      const escape = () =>
        outside().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      beforeEach(() => outside().focus());

      it('closes a panel the pointer opened on Escape, and leaves focus there', () => {
        pointer('pointerenter');
        wait(200);
        expect(panel()).not.toBeNull();
        escape();
        wait(0);
        expect(panel()).toBeNull();
        expect(document.activeElement).toBe(outside());
      });

      it('stops the pointer opening it on Escape, and leaves focus there', () => {
        pointer('pointerenter');
        wait(100);
        escape();
        wait(1000);
        expect(panel()).toBeNull();
        expect(document.activeElement).toBe(outside());
      });

      it('ignores other keys', () => {
        pointer('pointerenter');
        wait(200);
        outside().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        wait(0);
        expect(panel()).not.toBeNull();
      });
    });

    it('cancels an opening when focus leaves', () => {
      trigger().focus();
      required<HTMLButtonElement>('.outside').focus();
      wait(1000);
      expect(panel()).toBeNull();
    });

    it('keeps open a panel the pointer opened once it is clicked, until a second click', () => {
      pointer('pointerenter');
      wait(200);
      press('mouse');
      pointer('pointerleave');
      wait(5000);
      expect(panel()).not.toBeNull();
      pointer('pointerenter');
      press('mouse');
      expect(panel()).toBeNull();
    });

    it('opens on a click held past 200 ms, and keeps the panel open', () => {
      pointer('pointerenter');
      press('mouse', 300);
      pointer('pointerleave');
      wait(5000);
      expect(panel()).not.toBeNull();
    });

    it('opens at once on a click before the pointer’s 200 ms are up', () => {
      pointer('pointerenter');
      wait(50);
      trigger().click();
      wait(0);
      expect(panel()).not.toBeNull();
      pointer('pointerleave');
      wait(5000);
      expect(panel()).not.toBeNull();
    });

    // A tap focuses the button on Android before its click; that focus must not open the panel
    // for the click to close it again.
    describe('on a touch screen', () => {
      /** A finger held for 300 ms, longer than the focus's own 200 ms. */
      const tap = () => {
        pointer('pointerenter', component(), 'touch');
        press('touch', 300);
        pointer('pointerleave', component(), 'touch');
        wait(5000);
      };

      it('opens on a tap and stays open', () => {
        tap();
        expect(panel()).not.toBeNull();
      });

      it('closes on a second tap', () => {
        tap();
        tap();
        expect(panel()).toBeNull();
      });

      it('opens nothing while a finger only rests on the button', () => {
        pointer('pointerenter', component(), 'touch');
        wait(300);
        expect(panel()).toBeNull();
      });

      // Android focuses the button after the finger lifts, just before the click.
      describe('when focus follows the release', () => {
        const tapAndroid = () => {
          pointer('pointerdown', trigger(), 'touch');
          wait(300);
          pointer('pointerup', trigger(), 'touch');
          if (document.activeElement !== trigger()) trigger().focus();
          trigger().click();
          wait(5000);
        };

        it('opens on a tap and stays open', () => {
          tapAndroid();
          expect(panel()).not.toBeNull();
        });

        it('closes on a second tap', () => {
          tapAndroid();
          tapAndroid();
          expect(panel()).toBeNull();
        });
      });
    });

    // A press that never clicks must not leave the next keyboard focus ignored.
    describe('after a press that does not click', () => {
      it('opens on keyboard focus once a touch turned into a scroll', () => {
        pointer('pointerdown', trigger(), 'touch');
        pointer('pointercancel', trigger(), 'touch');
        trigger().focus();
        wait(200);
        expect(panel()).not.toBeNull();
      });

      it('opens on keyboard focus once a press was released off the button', () => {
        // Safari does not focus a button it presses, so no focus event marks the press's end.
        pointer('pointerdown', trigger(), 'mouse');
        pointer('pointerup', required<HTMLButtonElement>('.outside'), 'mouse');
        trigger().focus();
        wait(200);
        expect(panel()).not.toBeNull();
      });
    });

    // Angular's scheduler keeps timers of its own, so the count of pending timers proves nothing;
    // what a timer left running would do, once the component is gone, does.
    const state = () =>
      fixture.debugElement.query((el) => el.name === 'nxs-rich-tooltip').componentInstance as {
        open(): boolean;
      };

    it('stops its closing timer when it is destroyed', () => {
      pointer('pointerenter');
      wait(200);
      pointer('pointerleave');
      const tooltip = state();
      fixture.destroy();
      vi.advanceTimersByTime(5000);
      expect(tooltip.open()).toBe(true);
    });

    it('stops its opening timer when it is destroyed', () => {
      pointer('pointerenter');
      const tooltip = state();
      fixture.destroy();
      vi.advanceTimersByTime(5000);
      expect(tooltip.open()).toBe(false);
    });
  });

  it('gives each instance its own panel id', async () => {
    const second = TestBed.createComponent(NxsRichTooltipComponent);
    second.componentRef.setInput('heading', 'h');
    second.componentRef.setInput('content', 'c');
    second.componentRef.setInput('triggerLabel', 't');
    second.detectChanges();
    const ids = [trigger(), second.nativeElement.querySelector('button')].map((b) =>
      b.getAttribute('aria-controls'),
    );
    expect(new Set(ids).size).toBe(2);
  });

  // jsdom has no layout, so each case states the geometry a browser would report: a viewport of
  // `viewport` px, the component's box at `left`–`right`, and a panel `panel` px wide.
  describe('inside a narrow viewport', () => {
    function layout(geometry: { viewport: number; left: number; right: number; panel: number }) {
      vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(geometry.viewport);
      vi.spyOn(required<HTMLElement>('nxs-rich-tooltip'), 'getBoundingClientRect').mockReturnValue(
        new DOMRect(geometry.left, 0, geometry.right - geometry.left, 40),
      );
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.classList.contains('nxs-rich-tooltip__panel') ? geometry.panel : 0;
      });
    }

    async function openPanel(): Promise<HTMLElement> {
      trigger().click();
      await settle();
      return required<HTMLElement>('.nxs-rich-tooltip__panel');
    }

    afterEach(() => vi.restoreAllMocks());

    it('stays where it opens when it fits', async () => {
      layout({ viewport: 1280, left: 100, right: 140, panel: 320 });
      expect((await openPanel()).style.translate).toBe('');
    });

    it('moves back inside the viewport from its inline-end edge', async () => {
      layout({ viewport: 320, left: 280, right: 320, panel: 304 });
      expect((await openPanel()).style.translate).toBe('-272px');
    });

    it('keeps clear of the inline-start edge', async () => {
      layout({ viewport: 320, left: 0, right: 40, panel: 200 });
      expect((await openPanel()).style.translate).toBe('8px');
    });

    describe('right to left', () => {
      beforeEach(() => required<HTMLElement>('nxs-rich-tooltip').setAttribute('dir', 'rtl'));

      it('opens toward the left, and moves back inside from the left edge', async () => {
        layout({ viewport: 320, left: 0, right: 40, panel: 200 });
        expect((await openPanel()).style.translate).toBe('168px');
      });

      it('keeps clear of the right edge', async () => {
        layout({ viewport: 320, left: 280, right: 320, panel: 200 });
        expect((await openPanel()).style.translate).toBe('-8px');
      });
    });

    it('moves again when the window is resized while it is open', async () => {
      layout({ viewport: 1280, left: 280, right: 320, panel: 304 });
      const opened = await openPanel();
      expect(opened.style.translate).toBe('');
      layout({ viewport: 320, left: 280, right: 320, panel: 304 });
      window.dispatchEvent(new Event('resize'));
      await settle();
      expect(opened.style.translate).toBe('-272px');
    });
  });

  it('refuses to render without its text inputs', () => {
    const bare = TestBed.createComponent(NxsRichTooltipComponent);
    expect(() => bare.detectChanges()).toThrow(/NG0950/);
  });
});
