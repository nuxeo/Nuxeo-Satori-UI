import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

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

  it('names the group "Video storyboard" until a label is given', async () => {
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

  it('names a frame after its label, and after its timecode when it has none', async () => {
    host.items.set([frame(30, 'Opening titles'), frame(90)]);
    await render();
    expect(frames()[0].getAttribute('aria-label')).toBe('Seek to Opening titles');
    expect(frames()[1].getAttribute('aria-label')).toBe('Seek to 1:30');
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
