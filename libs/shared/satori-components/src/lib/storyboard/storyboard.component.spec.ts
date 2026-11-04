import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';

import {
  NxsStoryboardComponent,
  nxsFormatTimecode,
  type NxsStoryboardItem,
} from './storyboard.component';

@Component({
  standalone: true,
  imports: [NxsStoryboardComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-storyboard
      [items]="items()"
      [label]="label()"
      [activeTimecode]="activeTimecode()"
      (seek)="sought.push($event)"
    />
  `,
})
class HostComponent {
  readonly items = signal<readonly NxsStoryboardItem[]>([]);
  readonly label = signal('');
  readonly activeTimecode = signal<number | null>(null);
  readonly sought: number[] = [];
}

const frame = (
  timecode: number,
  label = '',
  thumbnailUrl: string | null = 'blob:x',
): NxsStoryboardItem => ({
  timecode,
  label,
  thumbnailUrl,
});

describe('NxsStoryboardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const strip = (): HTMLElement | null => el().querySelector('.nxs-storyboard__strip');
  const frames = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll('.nxs-storyboard__frame'));
  const times = (): string[] =>
    Array.from(el().querySelectorAll('.nxs-storyboard__time'), (n) => n.textContent?.trim() ?? '');

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

  it('renders nothing when there are no frames', () => {
    expect(strip()).toBeNull();
  });

  it('draws one button per frame, with its timecode', async () => {
    host.items.set([frame(0), frame(5), frame(65)]);
    await render();
    expect(frames()).toHaveLength(3);
    expect(times()).toEqual(['0:00', '0:05', '1:05']);
  });

  // Native `<ul>`/`<li>`, not a `div` with `role="group"`: the list also announces how many frames
  // there are, and it does it without an ARIA attribute.
  it('is a list of frames, so a screen reader can count them', async () => {
    host.items.set([frame(0), frame(5)]);
    await render();
    expect(strip()?.tagName).toBe('UL');
    expect(strip()?.hasAttribute('role')).toBe(false);
    expect(Array.from(el().querySelectorAll('.nxs-storyboard__item'), (n) => n.tagName)).toEqual([
      'LI',
      'LI',
    ]);
  });

  it('names the list "Video storyboard" until a label is given', async () => {
    host.items.set([frame(0)]);
    await render();
    expect(strip()?.getAttribute('aria-label')).toBe('Video storyboard');

    host.label.set('Frames of the interview');
    await render();
    expect(strip()?.getAttribute('aria-label')).toBe('Frames of the interview');
  });

  it('treats a label of only zero-width characters as no label', async () => {
    host.items.set([frame(0)]);
    host.label.set('\u200b ');
    await render();
    expect(strip()?.getAttribute('aria-label')).toBe('Video storyboard');
  });

  it('names a frame after its label and its timecode, and after the timecode alone when it has no label', async () => {
    host.items.set([frame(30, 'Opening titles'), frame(90)]);
    await render();
    expect(frames()[0].getAttribute('aria-label')).toBe('Seek to Opening titles 0:30');
    expect(frames()[1].getAttribute('aria-label')).toBe('Seek to 1:30');
  });

  // WCAG 2.5.3: the timecode is the only text drawn on the button, so a name that omits it leaves a
  // speech-input user saying "0:30" at a control that does not answer to it.
  it('keeps every frame\u2019s visible timecode inside its accessible name', async () => {
    host.items.set([frame(30, 'Opening titles'), frame(90, 'Interview'), frame(0)]);
    await render();
    const pairs = frames().map((button) => ({
      name: button.getAttribute('aria-label') ?? '',
      visible: button.querySelector('.nxs-storyboard__time')?.textContent?.trim() ?? '',
    }));
    expect(pairs.map((p) => p.visible)).toEqual(['0:30', '1:30', '0:00']);
    for (const { name, visible } of pairs) {
      expect(name).toContain(visible);
    }
  });

  // The tooltip stays the caption alone, not the accessible name: the timecode is already drawn
  // under the frame, and putting it in the tooltip too would show it twice to a mouse user.
  it('puts the caption alone in the tooltip', async () => {
    host.items.set([frame(30, 'Opening titles'), frame(90)]);
    await render();
    const messages = fixture.debugElement
      .queryAll(By.directive(MatTooltip))
      .map((node) => node.injector.get(MatTooltip).message);
    expect(messages).toEqual(['Opening titles', '1:30']);
  });

  it('hides the image from assistive technology, because the button is already named', async () => {
    host.items.set([frame(0, 'Opening titles')]);
    await render();
    const img = el().querySelector('img');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('src')).toBe('blob:x');
  });

  it('shows a placeholder, not a broken image, for a frame with no thumbnail', async () => {
    host.items.set([frame(0, '', null)]);
    await render();
    expect(el().querySelector('img')).toBeNull();
    expect(el().querySelector('.nxs-storyboard__thumb--empty')).not.toBeNull();
  });

  it('asks the host to seek to the frame that was pressed', async () => {
    host.items.set([frame(0), frame(5), frame(65)]);
    await render();
    frames()[2].click();
    frames()[0].click();
    expect(host.sought).toEqual([65, 0]);
  });

  it('marks only the frame at the active timecode', async () => {
    host.items.set([frame(0), frame(5)]);
    host.activeTimecode.set(5);
    await render();
    expect(frames().map((b) => b.getAttribute('aria-current'))).toEqual([null, 'true']);
    expect(frames()[1].classList).toContain('nxs-storyboard__frame--active');

    host.activeTimecode.set(null);
    await render();
    expect(frames().map((b) => b.getAttribute('aria-current'))).toEqual([null, null]);
  });

  describe('nxsFormatTimecode', () => {
    it('writes seconds as m:ss', () => {
      expect(nxsFormatTimecode(0)).toBe('0:00');
      expect(nxsFormatTimecode(9)).toBe('0:09');
      expect(nxsFormatTimecode(61)).toBe('1:01');
      expect(nxsFormatTimecode(3661)).toBe('61:01');
    });

    it('reads a negative or non-finite timecode as the start', () => {
      expect(nxsFormatTimecode(-5)).toBe('0:00');
      expect(nxsFormatTimecode(Number.NaN)).toBe('0:00');
      expect(nxsFormatTimecode(Number.POSITIVE_INFINITY)).toBe('0:00');
    });
  });
});
