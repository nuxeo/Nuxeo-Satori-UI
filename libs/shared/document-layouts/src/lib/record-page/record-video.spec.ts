import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NXS_STORYBOARD_ID, NxsStoryboardComponent } from '@nuxeo/satori-platform/components';
import { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';
import {
  DocumentDetailService,
  type AssetRightsExplanation,
  type NuxeoDocument,
  type WatermarkedVideoAnswer,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, throwError, type Observable } from 'rxjs';

import {
  RecordVideoComponent,
  WATERMARK_POLL_LIMIT,
  WATERMARK_POLL_WAIT,
  formatDuration,
  pickRendition,
  readStoryboard,
  readVideoFacts,
  readVideoRenditions,
  watermarkPollDelay,
  type VideoRenditionEntry,
} from './record-video';

describe('watermarkPollDelay', () => {
  it("waits the server's retryAfter, doubled at each answer up to a minute", () => {
    const waits = Array.from({ length: WATERMARK_POLL_LIMIT - 1 }, (_, attempt) =>
      watermarkPollDelay(attempt, 5),
    );
    expect(waits).toEqual([5, 10, 20, 40, 60, 60, 60, 60, 60, 60, 60].map((s) => s * 1000));
  });

  it('stops after its last answer: a bound on the asks, never an endless poll', () => {
    expect(watermarkPollDelay(WATERMARK_POLL_LIMIT - 1, 5)).toBeNull();
    expect(watermarkPollDelay(WATERMARK_POLL_LIMIT + 5, 5)).toBeNull();
    expect(watermarkPollDelay(-1, 5)).toBeNull();
    expect(watermarkPollDelay(1.5, 5)).toBeNull();
  });

  it("holds the server's retryAfter to 2 to 30 seconds", () => {
    expect(watermarkPollDelay(0, 0)).toBe(2000);
    expect(watermarkPollDelay(0, 600)).toBe(30_000);
    expect(watermarkPollDelay(0, Number.NaN)).toBe(5000);
  });
});

/** A transcoded video as Nuxeo 2025 writes one in `vid:transcodedVideos`. */
function transcoded(name: string, mime: string, digest = `${name}-1`) {
  return {
    name,
    content: {
      name: `film.${mime.slice('video/'.length)}`,
      'mime-type': mime,
      digest,
      length: '48211',
      data: `http://localhost:8080/nuxeo/nxfile/default/v1/vid:transcodedVideos/0/content/film.mp4`,
    },
    info: { width: 854, height: 480, duration: 12, format: 'mov,mp4,m4a,3gp,3g2,mj2' },
  };
}

/** A storyboard frame as Nuxeo writes one in `vid:storyboard`. */
function frame(timecode: number, digest = `frame-${timecode}`) {
  return {
    timecode,
    comment: '',
    content: {
      name: `frame-${timecode}.jpeg`,
      'mime-type': 'image/jpeg',
      digest,
      data: `http://localhost:8080/nuxeo/nxfile/default/v1/vid:storyboard/0/content`,
    },
  };
}

const ORIGINAL = {
  name: 'ast-511.webm',
  'mime-type': 'video/webm',
  digest: 'original-1',
  length: '4762',
  data: 'http://localhost:8080/nuxeo/nxfile/default/v1/file:content/ast-511.webm',
};

const INFO = { duration: 12, width: 160, height: 90, format: 'matroska,webm', frameRate: 5 };

const MP4 = transcoded('MP4 480p', 'video/mp4');
const WEBM = transcoded('WebM 480p', 'video/webm');

function video(properties: Record<string, unknown> = {}, uid = 'v1'): NuxeoDocument {
  return {
    uid,
    title: 'Into the Hills, campaign film',
    type: 'AcmeVideo',
    path: `/assets/${uid}`,
    lastModified: '2026-11-26T00:00:00.000Z',
    properties: {
      'file:content': ORIGINAL,
      'vid:info': INFO,
      'vid:transcodedVideos': [MP4, WEBM],
      'vid:storyboard': [frame(0), frame(4), frame(8)],
      ...properties,
    },
  };
}

describe('readVideoRenditions', () => {
  it('reads each transcoded video by its name, with its size and format, in the order Nuxeo lists them', () => {
    expect(readVideoRenditions(video())).toEqual([
      {
        kind: 'rendition',
        name: 'MP4 480p',
        width: 854,
        height: 480,
        mimeType: 'video/mp4',
        format: 'MP4',
        key: 'v1/rendition/MP4 480p/MP4 480p-1',
      },
      {
        kind: 'rendition',
        name: 'WebM 480p',
        width: 854,
        height: 480,
        mimeType: 'video/webm',
        format: 'WEBM',
        key: 'v1/rendition/WebM 480p/WebM 480p-1',
      },
    ]);
  });

  it('leaves out one with no file or no usable name, and keeps the first of a name', () => {
    const renditions = readVideoRenditions(
      video({
        'vid:transcodedVideos': [
          { name: 'Ogg 480p', content: null },
          { ...MP4, name: '  ' },
          { ...MP4, name: '..' },
          MP4,
          { ...MP4, info: { width: 1 } },
        ],
      }),
    );
    expect(renditions.map((each) => [each.name, each.width])).toEqual([['MP4 480p', 854]]);
  });

  it('takes the original, sized by what Nuxeo read of it, while there is no transcoded video', () => {
    expect(readVideoRenditions(video({ 'vid:transcodedVideos': [] }))).toEqual([
      {
        kind: 'original',
        name: null,
        width: 160,
        height: 90,
        mimeType: 'video/webm',
        format: 'WEBM',
        key: 'v1/original/original-1',
      },
    ]);
  });

  it('takes nothing for a format it is not given as a video, and nothing from a record with no file', () => {
    const [odd] = readVideoRenditions(
      video({
        'vid:transcodedVideos': [],
        'file:content': { ...ORIGINAL, 'mime-type': 'text/html' },
      }),
    );
    expect([odd.mimeType, odd.format]).toEqual([null, null]);
    expect(
      readVideoRenditions(video({ 'vid:transcodedVideos': undefined, 'file:content': null })),
    ).toEqual([]);
  });
});

describe('readVideoFacts', () => {
  it("reads the duration, the frame size and the format from Nuxeo's vid:info", () => {
    expect(readVideoFacts(video())).toEqual({
      duration: 12,
      width: 160,
      height: 90,
      format: 'matroska,webm',
    });
  });

  it('reads none when Nuxeo has read none, as on a server without ffprobe', () => {
    const unread = { duration: null, width: null, height: null, format: null, streams: [] };
    expect(readVideoFacts(video({ 'vid:info': unread }))).toBeNull();
    expect(readVideoFacts(video({ 'vid:info': undefined }))).toBeNull();
    expect(
      readVideoFacts(video({ 'vid:info': { duration: -1, width: '0', format: ' ' } })),
    ).toBeNull();
  });
});

describe('readStoryboard', () => {
  it('reads each frame with its place and timecode, the first of each timecode', () => {
    const frames = readStoryboard(
      video({
        'vid:storyboard': [frame(0), { timecode: 2, content: null }, frame(4), frame(4, 'again')],
      }),
    );
    expect(frames.map(({ index, timecode }) => [index, timecode])).toEqual([
      [0, 0],
      [2, 4],
    ]);
    expect(frames[1].key).toBe('v1/storyboard/2/frame-4');
  });

  it('reads none from a video the server made no storyboard for', () => {
    expect(readStoryboard(video({ 'vid:storyboard': [] }))).toEqual([]);
    expect(
      readStoryboard(video({ 'vid:storyboard': [{ ...frame(1), timecode: 'soon' }] })),
    ).toEqual([]);
  });
});

describe('pickRendition', () => {
  const renditions = readVideoRenditions(video());
  const keys = (picked: VideoRenditionEntry | null) => picked?.name ?? null;

  it('plays what the browser can probably play, then what it may, then the first', () => {
    expect(
      keys(
        pickRendition(renditions, new Set(), (mime) =>
          mime === 'video/webm' ? 'probably' : 'maybe',
        ),
      ),
    ).toBe('WebM 480p');
    expect(
      keys(pickRendition(renditions, new Set(), (mime) => (mime === 'video/webm' ? 'maybe' : ''))),
    ).toBe('WebM 480p');
    expect(keys(pickRendition(renditions, new Set(), () => ''))).toBe('MP4 480p');
  });

  it('passes over a file the browser could not decode, and gives none when every one failed', () => {
    const mp4 = new Set([renditions[0].key]);
    expect(keys(pickRendition(renditions, mp4, () => 'probably'))).toBe('WebM 480p');
    expect(
      pickRendition(renditions, new Set(renditions.map((each) => each.key)), () => ''),
    ).toBeNull();
  });
});

describe('formatDuration', () => {
  it('writes a duration as a player does', () => {
    expect(formatDuration(12)).toBe('0:12');
    expect(formatDuration(245.9)).toBe('4:05');
    expect(formatDuration(3723)).toBe('1:02:03');
  });
});

/** What the server's `assetRights` enricher says of a video asset with no Print channel. */
function noPrintRights(): AssetRightsExplanation {
  const refused = {
    allowed: false,
    reason: 'channel-not-covered',
    channel: 'Print',
    rightsEnd: null,
  } as const;
  const web = { allowed: true, reason: 'cleared', channel: 'E-commerce', rightsEnd: null } as const;
  return {
    type: 'AcmeVideo',
    today: '2026-11-26',
    rightsEnd: '2026-12-11',
    channels: ['E-commerce', 'Social'],
    uses: [
      { kind: 'original', name: null, ...refused },
      { kind: 'rendition', name: 'MP4 480p', ...web },
      { kind: 'rendition', name: 'WebM 480p', ...web },
    ],
    otherwise: { allowed: false, reason: 'not-cleared', channel: null, rightsEnd: null },
  };
}

describe('RecordVideoComponent', () => {
  let fixture: ComponentFixture<RecordVideoComponent> | null;
  let fetchRendition: ReturnType<typeof vi.fn>;
  let fetchBlobByXpath: ReturnType<typeof vi.fn>;
  let fetchAssetRights: ReturnType<typeof vi.fn>;
  let fetchWatermarkedVideo: ReturnType<typeof vi.fn>;
  /** Each marked video asked, in order, with its answer. */
  let markedRequests: { key: string; answer: Subject<WatermarkedVideoAnswer> }[];
  /** Each wait the page asked for before asking again, in order, and its end. */
  let waits: { ms: number; over: Subject<void> }[];
  let rightsAnswer: Observable<AssetRightsExplanation | null>;
  /** Each request's answer, by `<uid> <what>`, in the order asked. */
  let requests: { key: string; answer: Subject<Blob> }[];
  let created: string[];
  let revoked: string[];
  let canPlayType: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fixture = null;
    requests = [];
    created = [];
    revoked = [];
    let counter = 0;
    // jsdom implements neither, so they are installed rather than spied on, and removed after.
    Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        const url = `blob:video-${++counter}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
    });
    const asked = (key: string): Observable<Blob> => {
      const answer = new Subject<Blob>();
      requests.push({ key, answer });
      return answer;
    };
    fetchRendition = vi.fn((uid: string, name: string) => asked(`${uid} rendition ${name}`));
    fetchBlobByXpath = vi.fn((uid: string, xpath: string) => asked(`${uid} ${xpath}`));
    rightsAnswer = of(noPrintRights());
    fetchAssetRights = vi.fn(() => rightsAnswer);
    markedRequests = [];
    waits = [];
    fetchWatermarkedVideo = vi.fn((uid: string, use: string) => {
      const answer = new Subject<WatermarkedVideoAnswer>();
      markedRequests.push({ key: `${uid} ${use}`, answer });
      return answer;
    });
    // jsdom says it can play nothing; the browser under test plays MP4.
    canPlayType = vi
      .spyOn(HTMLMediaElement.prototype, 'canPlayType')
      .mockImplementation((mime: string) => (mime === 'video/mp4' ? 'probably' : 'maybe'));
    TestBed.configureTestingModule({
      imports: [RecordVideoComponent, MatIconTestingModule],
      providers: [
        {
          provide: DocumentDetailService,
          useValue: { fetchRendition, fetchBlobByXpath, fetchAssetRights, fetchWatermarkedVideo },
        },
        {
          provide: WATERMARK_POLL_WAIT,
          useValue: (ms: number) => {
            const over = new Subject<void>();
            waits.push({ ms, over });
            return over;
          },
        },
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    canPlayType.mockRestore();
    Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
  });

  async function render(document: NuxeoDocument): Promise<HTMLElement> {
    fixture ??= TestBed.createComponent(RecordVideoComponent);
    fixture.componentRef.setInput('document', document);
    return settle();
  }

  async function settle(): Promise<HTMLElement> {
    const shown = fixture as ComponentFixture<RecordVideoComponent>;
    shown.detectChanges();
    await shown.whenStable();
    shown.detectChanges();
    return shown.nativeElement as HTMLElement;
  }

  /** Answer the request `<uid> <what>` asked last with a file. */
  async function answer(key: string, type = 'video/mp4'): Promise<void> {
    const request = [...requests].reverse().find((each) => each.key === key);
    if (!request) throw new Error(`nothing asked ${key}: ${requests.map((each) => each.key)}`);
    request.answer.next(new Blob(['bytes'], { type }));
    request.answer.complete();
    await settle();
  }

  async function refuse(key: string, error: unknown): Promise<HTMLElement> {
    const request = [...requests].reverse().find((each) => each.key === key);
    request?.answer.error(error);
    return settle();
  }

  /** Answer every storyboard frame asked so far. */
  async function answerFrames(uid = 'v1'): Promise<void> {
    for (const request of requests.filter((each) =>
      each.key.startsWith(`${uid} vid:storyboard/`),
    )) {
      request.answer.next(new Blob(['jpeg'], { type: 'image/jpeg' }));
      request.answer.complete();
    }
    await settle();
  }

  const player = (root: HTMLElement) => root.querySelector<HTMLVideoElement>('video');
  const refusalOf = (root: HTMLElement) => root.querySelector('nxs-banner[data-refusal]');
  const frameButtons = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('.nxs-storyboard__frame'));

  it('asks for the transcoded video the browser can play by its name, and plays it from a blob URL', async () => {
    const root = await render(video());
    expect(fetchRendition).toHaveBeenCalledTimes(1);
    expect(fetchRendition).toHaveBeenCalledWith('v1', 'MP4 480p');
    expect(fetchBlobByXpath).not.toHaveBeenCalledWith('v1', 'file:content');
    expect(player(root)).toBeNull();
    expect(root.querySelector('nxs-spinner')).not.toBeNull();

    await answer('v1 rendition MP4 480p');
    expect(player(root)?.getAttribute('src')).toBe('blob:video-1');
    expect(player(root)?.hasAttribute('controls')).toBe(true);
    expect(root.querySelector('figcaption')?.textContent?.trim()).toBe(
      'MP4 480p · 854 × 480 · MP4',
    );
  });

  it('plays the original, through @blob/file:content, while the server has transcoded nothing', async () => {
    const root = await render(video({ 'vid:transcodedVideos': [] }));
    expect(fetchRendition).not.toHaveBeenCalled();
    expect(fetchBlobByXpath).toHaveBeenCalledWith('v1', 'file:content');
    await answer('v1 file:content', 'video/webm');
    expect(player(root)?.getAttribute('src')).toMatch(/^blob:video-/);
    expect(root.querySelector('figcaption')?.textContent?.trim()).toBe(
      'Original · 160 × 90 · WEBM',
    );
  });

  it('never binds a Nuxeo address to the player or the frames', async () => {
    const root = await render(video());
    await answer('v1 rendition MP4 480p');
    await answerFrames();
    for (const element of Array.from(root.querySelectorAll('video, img')))
      expect(element.getAttribute('src')).toMatch(/^blob:/);
    expect(root.innerHTML).not.toContain('nxfile');
    expect(root.innerHTML).not.toContain('/nuxeo/');
  });

  describe('its blob URLs', () => {
    it('revokes every URL it created, the video and its frames, when it is destroyed', async () => {
      await render(video());
      await answer('v1 rendition MP4 480p');
      await answerFrames();
      expect(created).toHaveLength(4);
      fixture?.destroy();
      fixture = null;
      expect([...revoked].sort()).toEqual([...created].sort());
    });

    it("revokes another record's video and frames as soon as the record changes", async () => {
      await render(video());
      await answer('v1 rendition MP4 480p');
      await answerFrames();
      const first = [...created];
      await render(video({}, 'v2'));
      expect([...revoked].sort()).toEqual(first.sort());
      expect(fetchRendition).toHaveBeenLastCalledWith('v2', 'MP4 480p');
    });

    it("revokes a replaced video's URL, and asks for the new file", async () => {
      await render(video());
      await answer('v1 rendition MP4 480p');
      await render(video({ 'vid:transcodedVideos': [transcoded('MP4 480p', 'video/mp4', 'new')] }));
      expect(revoked).toEqual(['blob:video-1']);
      expect(fetchRendition).toHaveBeenCalledTimes(2);
    });

    it('asks nothing again, and revokes nothing, when the record is reloaded with the same files', async () => {
      const root = await render(video());
      await answer('v1 rendition MP4 480p');
      await answerFrames();
      await render({ ...video(), lastModified: '2026-11-26T10:00:00.000Z' });
      expect(fetchRendition).toHaveBeenCalledTimes(1);
      expect(fetchBlobByXpath).toHaveBeenCalledTimes(3);
      expect(revoked).toEqual([]);
      expect(player(root)?.getAttribute('src')).toBe('blob:video-1');
    });

    it('creates no URL for an answer that comes after the record changed', async () => {
      await render(video());
      const late = requests.find((each) => each.key === 'v1 rendition MP4 480p');
      await render(video({}, 'v2'));
      expect(late?.answer.observed).toBe(false);
      expect(created).toEqual([]);
    });

    it('revokes the URL of a file the browser cannot decode at once, and plays the next', async () => {
      const root = await render(video());
      await answer('v1 rendition MP4 480p');
      player(root)?.dispatchEvent(new Event('error'));
      await settle();
      expect(revoked).toEqual(['blob:video-1']);
      expect(fetchRendition).toHaveBeenLastCalledWith('v1', 'WebM 480p');
      await answer('v1 rendition WebM 480p', 'video/webm');
      expect(player(root)?.getAttribute('src')).toBe('blob:video-2');

      player(root)?.dispatchEvent(new Event('error'));
      await settle();
      expect(revoked).toEqual(['blob:video-1', 'blob:video-2']);
      expect(player(root)).toBeNull();
      expect(root.querySelector('.record-video__unplayable')?.textContent).toContain(
        "This browser cannot play this video's files",
      );
    });
  });

  describe('a file the server refuses', () => {
    it("says the server's own reason, asked after its 403, where the player would be", async () => {
      const root = await render(video({ 'vid:transcodedVideos': [] }));
      await refuse('v1 file:content', { status: 403 });

      expect(fetchAssetRights).toHaveBeenCalledWith('v1');
      expect(refusalOf(root)?.getAttribute('data-refusal')).toBe('channel-not-covered');
      expect(refusalOf(root)?.textContent).toContain(
        "The server refused this video: it is covered by the Print channel, and this asset's rights cover E-commerce and Social only.",
      );
      expect(player(root)).toBeNull();
      expect(root.querySelector('nxs-error-state')).toBeNull();
      // Nothing is tried instead: the server decided.
      expect(fetchRendition).not.toHaveBeenCalled();
      expect(requests.filter((each) => each.key === 'v1 file:content')).toHaveLength(1);
    });

    it('says the day the rights ended, for a transcoded video refused by name', async () => {
      const ended = noPrintRights();
      rightsAnswer = of({
        ...ended,
        uses: ended.uses.map((use) =>
          use.name === 'MP4 480p'
            ? { ...use, allowed: false, reason: 'rights-ended' as const, rightsEnd: '2026-11-14' }
            : use,
        ),
      });
      const root = await render(video());
      await refuse('v1 rendition MP4 480p', { status: 403 });

      expect(refusalOf(root)?.getAttribute('data-refusal')).toBe('rights-ended');
      expect(refusalOf(root)?.textContent).toContain(
        'The server refused this video: the rights to this asset ended on November 14, 2026.',
      );
    });

    it('says the reason for a rendition the rights do not list', async () => {
      const unlisted = noPrintRights();
      rightsAnswer = of({
        ...unlisted,
        uses: unlisted.uses.filter((use) => use.name !== 'MP4 480p'),
      });
      const root = await render(video());
      await refuse('v1 rendition MP4 480p', { status: 403 });
      expect(refusalOf(root)?.getAttribute('data-refusal')).toBe('not-cleared');
    });

    it('shows a 403 the rights do not explain as any 403', async () => {
      rightsAnswer = of(null);
      const root = await render(video());
      await refuse('v1 rendition MP4 480p', { status: 403 });
      expect(refusalOf(root)).toBeNull();
      expect(root.querySelector('nxs-error-state')?.getAttribute('data-status')).toBe('403');
    });

    it('asks why only after a 403, and asks again on Retry after a server error', async () => {
      const root = await render(video());
      await refuse('v1 rendition MP4 480p', { status: 503 });
      expect(fetchAssetRights).not.toHaveBeenCalled();
      expect(root.querySelector('nxs-error-state')?.getAttribute('data-status')).toBe('500');

      root.querySelector<HTMLButtonElement>('nxs-error-state button')?.click();
      await settle();
      expect(fetchRendition).toHaveBeenCalledTimes(2);
      await answer('v1 rendition MP4 480p');
      expect(player(root)?.getAttribute('src')).toMatch(/^blob:/);
    });

    it('shows no storyboard with no player to seek', async () => {
      const root = await render(video());
      await answerFrames();
      await refuse('v1 rendition MP4 480p', { status: 403 });
      expect(root.querySelector('nxs-storyboard')).toBeNull();
    });
  });

  it('says clearly that a record with no video file has none to play, and asks nothing', async () => {
    const root = await render(video({ 'vid:transcodedVideos': [], 'file:content': null }));
    const empty = root.querySelector('nxs-empty-state');
    expect(empty?.textContent).toContain('This video has no file to play');
    expect(player(root)).toBeNull();
    expect(fetchRendition).not.toHaveBeenCalled();
    expect(fetchBlobByXpath).not.toHaveBeenCalledWith('v1', 'file:content');
  });

  describe('its facts and its storyboard', () => {
    it("lists the video's duration, frame size and format as terms and their values", async () => {
      const root = await render(video());
      const facts = Array.from(root.querySelectorAll('dl.record-video__facts > div')).map(
        (each) => [
          each.querySelector('dt')?.textContent?.trim(),
          each.querySelector('dd')?.textContent?.trim(),
        ],
      );
      expect(facts).toEqual([
        ['Duration', '0:12'],
        ['Frame size', '160 × 90'],
        ['Format', 'matroska,webm'],
      ]);
      expect(root.querySelector('[data-note]')).toBeNull();
    });

    it('says when the server has read no facts and made no storyboard, as without ffmpeg', async () => {
      const root = await render(
        video({ 'vid:info': { duration: null }, 'vid:storyboard': [], 'vid:transcodedVideos': [] }),
      );
      expect(root.querySelector('dl')).toBeNull();
      expect(root.querySelector('[data-note="facts"]')?.textContent).toContain(
        "The server has not read this video's duration, frame size or format.",
      );
      expect(root.querySelector('[data-note="storyboard"]')?.textContent).toContain(
        'The server has made no storyboard for this video.',
      );
    });

    it('fetches each frame by its place, and shows one it could not fetch without its picture', async () => {
      const root = await render(video());
      expect(fetchBlobByXpath.mock.calls.map(([, xpath]) => xpath)).toEqual([
        'vid:storyboard/0/content',
        'vid:storyboard/1/content',
        'vid:storyboard/2/content',
      ]);
      await answer('v1 rendition MP4 480p');
      requests
        .find((each) => each.key === 'v1 vid:storyboard/1/content')
        ?.answer.error({ status: 404 });
      for (const key of ['v1 vid:storyboard/0/content', 'v1 vid:storyboard/2/content'])
        await answer(key, 'image/jpeg');
      const frames = frameButtons(root);
      expect(frames).toHaveLength(3);
      expect(frames.map((each) => each.querySelector('img')?.getAttribute('src') ?? null)).toEqual([
        'blob:video-2',
        null,
        'blob:video-3',
      ]);
    });
  });

  describe('keyboard and accessible names', () => {
    it("names the player by the record's title and the file it plays, and keeps its own controls", async () => {
      const root = await render(video());
      expect(root.querySelector('nxs-spinner [aria-label]')?.getAttribute('aria-label')).toBe(
        'Loading the video',
      );
      expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
      await answer('v1 rendition MP4 480p');
      expect(player(root)?.getAttribute('aria-label')).toBe(
        'Into the Hills, campaign film, MP4 480p',
      );
      expect(player(root)?.hasAttribute('controls')).toBe(true);
      expect(player(root)?.getAttribute('tabindex')).toBeNull();
      expect(root.querySelector('[aria-busy="true"]')).toBeNull();
    });

    it('names the original in its words', async () => {
      const root = await render(video({ 'vid:transcodedVideos': [] }));
      await answer('v1 file:content', 'video/webm');
      expect(player(root)?.getAttribute('aria-label')).toBe(
        'Into the Hills, campaign film, Original',
      );
    });

    it('offers each storyboard frame as a named button, in a named list, that seeks the player', async () => {
      const root = await render(video());
      await answer('v1 rendition MP4 480p');
      await answerFrames();
      const strip = root.querySelector('nxs-storyboard ul');
      expect(strip?.getAttribute('aria-label')).toBe('Storyboard of the video');
      const frames = frameButtons(root);
      expect(frames.map((each) => each.getAttribute('aria-label'))).toEqual([
        'Seek to 0:00',
        'Seek to 0:04',
        'Seek to 0:08',
      ]);
      // Native buttons in the tab order: Enter and Space press them, as the browser does.
      for (const each of frames) {
        expect(each.tagName).toBe('BUTTON');
        expect(each.getAttribute('type')).toBe('button');
        expect(each.tabIndex).toBe(0);
        expect(each.disabled).toBe(false);
      }

      frames[2].click();
      await settle();
      expect(player(root)?.currentTime).toBe(8);
      expect(frames[2].getAttribute('aria-current')).toBe('true');
      expect(frames[0].getAttribute('aria-current')).toBeNull();
    });

    it('gives the storyboard registered by its ID, as the app registers it, its name and its seek', async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        [NXS_STORYBOARD_ID]: NxsStoryboardComponent,
      });
      const root = await render(video());
      await answer('v1 rendition MP4 480p');
      await answerFrames();
      // Drawn by the outlet, not the page's own fallback: one strip.
      expect(root.querySelectorAll('nxs-storyboard')).toHaveLength(1);
      expect(root.querySelector('lib-extension-outlet nxs-storyboard')).not.toBeNull();
      expect(root.querySelector('nxs-storyboard ul')?.getAttribute('aria-label')).toBe(
        'Storyboard of the video',
      );
      frameButtons(root)[1].click();
      await settle();
      expect(player(root)?.currentTime).toBe(4);
      expect(frameButtons(root)[1].getAttribute('aria-current')).toBe('true');
    });

    it('marks the frame the player has reached as it plays', async () => {
      const root = await render(video());
      await answer('v1 rendition MP4 480p');
      await answerFrames();
      const element = player(root) as HTMLVideoElement;
      element.currentTime = 5;
      element.dispatchEvent(new Event('timeupdate'));
      await settle();
      expect(frameButtons(root).map((each) => each.getAttribute('aria-current'))).toEqual([
        null,
        'true',
        null,
      ]);
    });

    it('announces a refusal as it appears', async () => {
      const root = await render(video({ 'vid:transcodedVideos': [] }));
      await refuse('v1 file:content', { status: 403 });
      expect(refusalOf(root)?.getAttribute('role')).toBe('alert');
    });
  });

  describe('a video the rights serve only watermarked', () => {
    /** The original served only marked for the reader, as nuxeo-agentic-assets 0.5.0 says. */
    function markedRights(): AssetRightsExplanation {
      const rights = noPrintRights();
      return {
        ...rights,
        uses: rights.uses.map((use) =>
          use.kind === 'original'
            ? { ...use, allowed: false, reason: 'watermark-required' as const, channel: 'Print' }
            : use,
        ),
      };
    }

    const originalOnly = () => video({ 'vid:transcodedVideos': [] });
    const preparing = (retryAfter = 5): WatermarkedVideoAnswer => ({
      status: 'preparing',
      retryAfter,
    });

    async function answerMarked(answer: WatermarkedVideoAnswer): Promise<HTMLElement> {
      const request = markedRequests.at(-1);
      if (!request) throw new Error('no marked video was asked for');
      request.answer.next(answer);
      request.answer.complete();
      return settle();
    }

    /** The last wait asked for, over. */
    async function waited(): Promise<HTMLElement> {
      const wait = waits.at(-1);
      if (!wait) throw new Error('no wait was asked for');
      wait.over.next();
      wait.over.complete();
      return settle();
    }

    beforeEach(() => {
      rightsAnswer = of(markedRights());
    });

    it('asks for it marked once the 403 and the rights say so, plays it, and says it is marked', async () => {
      const root = await render(originalOnly());
      await refuse('v1 file:content', { status: 403 });
      expect(fetchAssetRights).toHaveBeenCalledWith('v1');
      expect(fetchWatermarkedVideo).toHaveBeenCalledWith('v1', 'original');

      await answerMarked({ status: 'ready', file: new Blob(['marked'], { type: 'video/webm' }) });
      expect(player(root)?.getAttribute('src')).toBe('blob:video-1');
      expect(root.querySelector('.record-video__watermarked')?.textContent).toContain(
        "Watermarked for you: this asset's rights require it.",
      );
      expect(refusalOf(root)).toBeNull();
      expect(waits).toHaveLength(0);
    });

    it('asks for a transcoded video marked by its name', async () => {
      const rights = noPrintRights();
      rightsAnswer = of({
        ...rights,
        uses: rights.uses.map((use) =>
          use.name === 'MP4 480p'
            ? { ...use, allowed: false, reason: 'watermark-required' as const }
            : use,
        ),
      });
      await render(video());
      await refuse('v1 rendition MP4 480p', { status: 403 });
      expect(fetchWatermarkedVideo).toHaveBeenCalledWith('v1', 'rendition:MP4 480p');
    });

    it('says it is being prepared, and asks again after a backoff, until it is ready', async () => {
      const root = await render(originalOnly());
      await refuse('v1 file:content', { status: 403 });
      await answerMarked(preparing());
      expect(root.querySelector('[data-preparing="asking"]')?.textContent).toContain(
        'The server is preparing a copy of this video watermarked for you.',
      );
      expect(root.querySelector('[data-preparing="asking"]')?.getAttribute('role')).toBe('status');
      expect(player(root)).toBeNull();
      expect(waits.map((wait) => wait.ms)).toEqual([5000]);
      expect(fetchWatermarkedVideo).toHaveBeenCalledTimes(1);

      await waited();
      expect(fetchWatermarkedVideo).toHaveBeenCalledTimes(2);
      await answerMarked(preparing());
      expect(waits.map((wait) => wait.ms)).toEqual([5000, 10000]);

      await waited();
      await answerMarked({ status: 'ready', file: new Blob(['marked'], { type: 'video/webm' }) });
      expect(player(root)?.getAttribute('src')).toMatch(/^blob:/);
      expect(root.querySelector('[data-preparing]')).toBeNull();
      // The unmarked file was asked once, refused, and never again.
      expect(requests.filter((each) => each.key === 'v1 file:content')).toHaveLength(1);
    });

    it('stops asking after its bound, and asks again only on Check again', async () => {
      const root = await render(originalOnly());
      await refuse('v1 file:content', { status: 403 });
      for (let answered = 1; answered <= WATERMARK_POLL_LIMIT; answered++) {
        await answerMarked(preparing());
        if (answered < WATERMARK_POLL_LIMIT) await waited();
      }
      expect(fetchWatermarkedVideo).toHaveBeenCalledTimes(WATERMARK_POLL_LIMIT);
      expect(waits).toHaveLength(WATERMARK_POLL_LIMIT - 1);
      expect(Math.max(...waits.map((wait) => wait.ms))).toBe(60_000);
      const stopped = root.querySelector('[data-preparing="stopped"]');
      expect(stopped?.textContent).toContain(
        'The watermarked copy of this video is still being prepared.',
      );
      expect(root.querySelector('[data-preparing="asking"]')).toBeNull();

      root.querySelector<HTMLButtonElement>('.record-video__check-again')?.click();
      await settle();
      expect(fetchWatermarkedVideo).toHaveBeenCalledTimes(WATERMARK_POLL_LIMIT + 1);
      expect(requests.filter((each) => each.key === 'v1 file:content')).toHaveLength(1);
      await answerMarked({ status: 'ready', file: new Blob(['marked'], { type: 'video/webm' }) });
      expect(player(root)?.getAttribute('src')).toMatch(/^blob:/);
    });

    it("says the rights' reason when the server cannot mark it", async () => {
      const root = await render(originalOnly());
      await refuse('v1 file:content', { status: 403 });
      const request = markedRequests.at(-1);
      request?.answer.error({ status: 409 });
      await settle();
      expect(refusalOf(root)?.getAttribute('data-refusal')).toBe('watermark-unavailable');
      expect(player(root)).toBeNull();
    });

    it('says any other failure as its status, and plays nothing', async () => {
      const root = await render(originalOnly());
      await refuse('v1 file:content', { status: 403 });
      markedRequests.at(-1)?.answer.error({ status: 500 });
      await settle();
      expect(refusalOf(root)).toBeNull();
      expect(root.querySelector('nxs-error-state')?.getAttribute('data-status')).toBe('500');
      expect(player(root)).toBeNull();
    });

    it('asks nothing more once the record changes', async () => {
      await render(originalOnly());
      await refuse('v1 file:content', { status: 403 });
      await answerMarked(preparing());
      expect(waits).toHaveLength(1);
      await render(video({ 'vid:transcodedVideos': [] }, 'v2'));
      await waited();
      expect(fetchWatermarkedVideo.mock.calls.filter(([uid]) => uid === 'v1')).toHaveLength(1);
    });
  });
});
