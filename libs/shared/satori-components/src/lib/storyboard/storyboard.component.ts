import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

import { nxsVisibleText } from '../visible-text';

/** The ID the host renders the storyboard under, through `lib-extension-outlet`. */
export const NXS_STORYBOARD_ID = 'nxs.components.storyboard';

/** One frame of a video's storyboard: where it is, what it shows, and what to call it. */
export interface NxsStoryboardItem {
  /** Seconds from the start of the video. */
  readonly timecode: number;
  /**
   * An object URL for the frame's image, or `null` when there is none.
   *
   * **The host owns this URL.** The storyboard only reads it, and never creates or revokes one, so
   * a host that made it with `createObjectURL()` revokes it itself. A Nuxeo URL does not work here:
   * the image is loaded by the browser, which sends no credentials, so fetch the blob through the
   * authenticated client and pass the object URL.
   */
  readonly thumbnailUrl: string | null;
  /** What the frame shows, already translated. Blank falls back to the timecode. */
  readonly label: string;
}

/** `m:ss`, the form Nuxeo's own video storyboards are labelled in. */
export function nxsFormatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * The strip of frames under a video that seeks it: one button per frame, showing the frame and its
 * timecode.
 *
 * It reads nothing and fetches nothing. The host passes the frames it already has and moves the
 * video when `seek` tells it where — which is what lets the document viewer and an asset screen
 * show the same strip over two different players.
 *
 * It renders nothing when there are no frames, so a host can place it unconditionally over a
 * document that turns out not to be a video, or whose storyboard has not arrived yet.
 */
@Component({
  selector: 'nxs-storyboard',
  standalone: true,
  templateUrl: './storyboard.component.html',
  styleUrl: './storyboard.component.scss',
  imports: [MatIconModule, MatTooltipModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-storyboard' },
})
export class NxsStoryboardComponent {
  /** The frames, in the order they are shown. Usually ordered by timecode. */
  readonly items = input<readonly NxsStoryboardItem[]>([]);
  /**
   * The list's accessible name, already translated. Blank, or only whitespace or zero-width
   * characters, names it "Video storyboard".
   */
  readonly label = input('');
  /** The frame to mark as the one playing, by timecode. `null` marks none. */
  readonly activeTimecode = input<number | null>(null);
  /**
   * Where the host should move the video to, in seconds from the start — the same fact as `seek`,
   * as a callback.
   *
   * Both exist because `lib-extension-outlet` sets **inputs only**: a host that renders this
   * component through `NXS_STORYBOARD_ID` cannot bind an output, so it passes a handler, exactly as
   * the trash list takes `openHandler`. A host with the element in its own template binds `seek`
   * instead. Pressing a frame does both, so neither path is the special case.
   */
  readonly seekHandler = input<((timecode: number) => void) | null>(null);

  /** Where the host should move the video to, in seconds from the start. */
  readonly seek = output<number>();

  protected readonly visible = computed(() => this.items().length > 0);
  protected readonly ownLabel = computed(() => nxsVisibleText(this.label()));

  /**
   * The frames with the text each one needs worked out once: the button's accessible name, the
   * timecode under it and its tooltip. Done here rather than in the template so the name is one
   * string a test can read, instead of whatever the browser concatenates out of the image and the
   * caption.
   *
   * `name` keeps the timecode even when the frame has a caption, because the timecode is the only
   * text drawn on the button — the image is decorative. A name of the caption alone leaves a
   * speech-input user with nothing to say that matches what they can see (WCAG 2.5.3), which is the
   * `label-content-name-mismatch` this library already tracks elsewhere.
   */
  protected readonly frames = computed(() =>
    this.items().map((item) => {
      const timecode = nxsFormatTimecode(item.timecode);
      const label = nxsVisibleText(item.label);
      return {
        item,
        timecode,
        caption: label || timecode,
        name: label ? `${label} ${timecode}` : timecode,
        active: this.activeTimecode() === item.timecode,
      };
    }),
  );

  protected select(item: NxsStoryboardItem): void {
    this.seek.emit(item.timecode);
    this.seekHandler()?.(item.timecode);
  }
}
