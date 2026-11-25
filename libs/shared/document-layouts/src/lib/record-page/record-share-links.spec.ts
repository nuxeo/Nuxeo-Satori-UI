import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import {
  ShareLinkService,
  type CreatedShareLink,
  type NuxeoDocument,
  type ShareLink,
  type ShareLinkDownloads,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, type Observable } from 'rxjs';

import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from './record-clock';
import { RecordShareLinksComponent } from './record-share-links';

const ID = 'ab12cd34'.padEnd(64, '0');
const OTHER = 'ffee0011'.padEnd(64, '9');
/** A token of the server's form, made here for the test only: no server ever issued it. */
const TOKEN = 'k'.repeat(43);

function asset(uid = 'a1', views: unknown[] = VIEWS, original = true): NuxeoDocument {
  return {
    uid,
    title: 'Trail jacket, front',
    type: 'AcmeAsset',
    path: `/assets/${uid}`,
    lastModified: '2026-11-25T00:00:00.000Z',
    properties: {
      ...(original ? { 'file:content': { name: 'jacket.tif', 'mime-type': 'image/tiff' } } : {}),
      'picture:views': views,
    },
  };
}

const view = (title: unknown) => ({
  title,
  width: 800,
  height: 1000,
  content: { 'mime-type': 'image/jpeg', digest: String(title), data: 'http://x/nxfile/m' },
});
const VIEWS = [view('Medium'), view('FullHD'), view(''), view('Medium'), { title: 'NoFile' }];

function link(overrides: Partial<ShareLink> = {}): ShareLink {
  return {
    id: ID,
    document: 'a1',
    renditions: ['view:FullHD', 'original'],
    end: '2026-12-14',
    created: '2026-11-25T10:00:00Z',
    createdBy: 'jdoe',
    revoked: null,
    revokedBy: null,
    state: 'active',
    ...overrides,
  };
}

interface Call<T> {
  readonly uid: string;
  readonly answer: Subject<T>;
}

describe('RecordShareLinksComponent', () => {
  let fixture: ComponentFixture<RecordShareLinksComponent> | null;
  let lists: Call<ShareLink[]>[];
  let downloads: Call<ShareLinkDownloads>[];
  let creates: (Call<CreatedShareLink> & { items: readonly string[]; end: string })[];
  let revokes: (Call<ShareLink> & { link: string })[];
  let announced: string[];
  let copied: string[];
  let confirm: boolean | undefined;
  let dialogs: unknown[];

  beforeEach(() => {
    fixture = null;
    lists = [];
    downloads = [];
    creates = [];
    revokes = [];
    announced = [];
    copied = [];
    confirm = true;
    dialogs = [];
    const call = <T>(into: Call<T>[], uid: string, extra: object = {}): Observable<T> => {
      const answer = new Subject<T>();
      into.push({ uid, answer, ...extra } as Call<T>);
      return answer;
    };
    TestBed.configureTestingModule({
      imports: [RecordShareLinksComponent, MatIconTestingModule],
      providers: [
        {
          provide: ShareLinkService,
          useValue: {
            list: (uid: string) => call(lists, uid),
            downloads: (uid: string) => call(downloads, uid),
            create: (uid: string, items: readonly string[], end: string) =>
              call(creates as Call<CreatedShareLink>[], uid, { items, end }),
            revoke: (uid: string, id: string) =>
              call(revokes as Call<ShareLink>[], uid, { link: id }),
          },
        },
        {
          provide: LiveAnnouncer,
          useValue: { announce: (message: string) => announced.push(message) },
        },
        {
          provide: Clipboard,
          useValue: { copy: (text: string) => (copied.push(text), true) },
        },
        {
          provide: MatDialog,
          useValue: {
            open: (_component: unknown, config: { data: unknown }) => {
              dialogs.push(config.data);
              return { afterClosed: () => of(confirm) };
            },
          },
        },
        // 25 November 2026, 22:00 UTC: already the 26th east of UTC, as +0530 reads it.
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date(Date.UTC(2026, 10, 25, 22)) },
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+0530' },
      ],
    });
  });

  afterEach(() => fixture?.destroy());

  async function settle(): Promise<HTMLElement> {
    const shown = fixture as ComponentFixture<RecordShareLinksComponent>;
    shown.detectChanges();
    await shown.whenStable();
    shown.detectChanges();
    return shown.nativeElement as HTMLElement;
  }

  async function render(document = asset(), readOnly = false): Promise<HTMLElement> {
    fixture ??= TestBed.createComponent(RecordShareLinksComponent);
    fixture.componentRef.setInput('document', document);
    fixture.componentRef.setInput('readOnly', readOnly);
    return settle();
  }

  async function answer<T>(calls: Call<T>[], value: T, index = calls.length - 1) {
    calls[index].answer.next(value);
    calls[index].answer.complete();
    return settle();
  }

  async function fail<T>(calls: Call<T>[], status: number, index = calls.length - 1) {
    calls[index].answer.error(new HttpErrorResponse({ status }));
    return settle();
  }

  /** The links answered, then an empty log. */
  async function loaded(links: ShareLink[], document = asset(), readOnly = false) {
    await render(document, readOnly);
    await answer(lists, links);
    return answer(downloads, { downloads: [], truncated: false });
  }

  const button = (root: HTMLElement, text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (each) => each.textContent?.trim() === text,
    ) ?? null;
  /** A Material button with `disabledInteractive` stays focusable, and says it is disabled. */
  const disabled = (element: HTMLButtonElement) =>
    element.disabled || element.getAttribute('aria-disabled') === 'true';
  const items = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLElement>('mat-checkbox')).map((each) =>
      each.getAttribute('data-item'),
    );
  async function choose(root: HTMLElement, item: string) {
    const box = root.querySelector<HTMLInputElement>(
      `mat-checkbox[data-item="${item}"] input[type="checkbox"]`,
    );
    if (!box) throw new Error(`no checkbox for ${item}`);
    box.click();
    return settle();
  }

  it("lists the asset's links, each with its label, state, items, last day in UTC and creator", async () => {
    const root = await render();
    expect(lists.map((each) => each.uid)).toEqual(['a1']);
    expect(root.querySelector('nxs-spinner')).not.toBeNull();
    // The downloads are asked only once the links are: a 403 hides all before any is read.
    expect(downloads).toEqual([]);

    await answer(lists, [
      link(),
      link({
        id: OTHER,
        renditions: ['view:Medium'],
        state: 'revoked',
        revoked: '2026-11-26T09:00:00Z',
        revokedBy: 'asmith',
      }),
    ]);
    const shown = Array.from(root.querySelectorAll<HTMLElement>('.record-share-links__link'));
    expect(shown.map((each) => [each.dataset['link'], each.dataset['state']])).toEqual([
      ['ab12cd34', 'active'],
      ['ffee0011', 'revoked'],
    ]);
    expect(shown[0].textContent).toContain('Link ab12cd34');
    expect(shown[0].textContent).toContain('FullHD, Original file');
    // The last day as written, in UTC, whatever the reader's zone.
    expect(shown[0].textContent).toContain('Until December 14, 2026 (UTC)');
    expect(shown[0].textContent).toContain('Created by jdoe');
    expect(shown[1].textContent).toContain('Revoked by asmith');
    expect(downloads.map((each) => each.uid)).toEqual(['a1']);
  });

  it('draws nothing at all when the server answers 403: the user may not manage the links', async () => {
    const root = await render();
    await fail(lists, 403);
    expect(root.querySelector('section')).toBeNull();
    expect(root.textContent?.trim()).toBe('');
    expect(downloads).toEqual([]);
  });

  it('says any other failure, with Retry for a server error, and reads again on Retry', async () => {
    const root = await render();
    await fail(lists, 500);
    expect(root.querySelector('nxs-error-state')).not.toBeNull();
    expect(root.textContent).toContain('The share links could not be loaded');
    fixture?.componentInstance.retry();
    await settle();
    expect(lists).toHaveLength(2);
    await answer(lists, []);
    expect(root.querySelector('[data-share-links-empty]')).not.toBeNull();
  });

  it('shows the downloads log, each with its time, link and item, and says when it is cut', async () => {
    const root = await render();
    await answer(lists, [link()]);
    await answer(downloads, {
      downloads: [
        { time: '2026-11-25T11:00:00Z', link: ID, rendition: 'view:FullHD' },
        { time: '2026-11-25T10:30:00Z', link: ID, rendition: 'original' },
      ],
      truncated: true,
    });
    const rows = Array.from(root.querySelectorAll('.record-share-links__table tbody tr')).map(
      (row) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim()),
    );
    expect(rows.map((row) => row.slice(1))).toEqual([
      ['ab12cd34', 'FullHD'],
      ['ab12cd34', 'Original file'],
    ]);
    // In the page's zone: 11:00 UTC is 16:30 at +0530.
    expect(rows[0][0]).toContain('4:30');
    expect(root.textContent).toContain('The latest 200 downloads are shown.');
  });

  it('offers the original, then each view with a file and a title of its own, each once', async () => {
    const root = await loaded([]);
    expect(items(root)).toEqual(['original', 'view:Medium', 'view:FullHD']);
    fixture?.componentRef.setInput('document', asset('a2', VIEWS, false));
    await settle();
    await answer(lists, []);
    expect(items(root)).toEqual(['view:Medium', 'view:FullHD']);
  });

  it('creates a link for the items chosen, in the asset’s order, to the last day chosen in UTC', async () => {
    const root = await loaded([]);
    const create = button(root, 'Create link') as HTMLButtonElement;
    // Nothing chosen yet.
    expect(disabled(create)).toBe(true);
    await choose(root, 'view:FullHD');
    await choose(root, 'original');
    expect(disabled(create)).toBe(false);
    create.click();
    await settle();
    expect(creates.map((each) => [each.uid, each.items, each.end])).toEqual([
      // The default: 7 days after today in UTC, the 25th, not the reader's 26th.
      ['a1', ['original', 'view:FullHD'], '2026-12-02'],
    ]);
  });

  it('refuses a last day the server would, before it is asked', async () => {
    const root = await loaded([]);
    await choose(root, 'view:FullHD');
    const component = fixture?.componentInstance as unknown as {
      setEnd(value: Date | null): void;
    };
    const create = () => button(root, 'Create link') as HTMLButtonElement;
    for (const [day, allowed] of [
      [new Date(2026, 10, 24), false],
      [new Date(2026, 10, 25), true],
      [new Date(2027, 1, 23), true],
      [new Date(2027, 1, 24), false],
      [null, false],
    ] as const) {
      component.setEnd(day);
      await settle();
      expect([day, disabled(create())]).toEqual([day, !allowed]);
    }
  });

  it("shows the created link's address once, from this page's origin, and copies it", async () => {
    const root = await loaded([]);
    await choose(root, 'view:FullHD');
    (button(root, 'Create link') as HTMLButtonElement).click();
    await settle();
    await answer(creates as Call<CreatedShareLink>[], {
      kind: 'created',
      link: link({ renditions: ['view:FullHD'] }),
      token: TOKEN,
      path: `/nuxeo/agentic-share/${TOKEN}/`,
    });
    const url = `${window.location.origin}/nuxeo/agentic-share/${TOKEN}/`;
    const created = root.querySelector('[data-share-link-created]') as HTMLElement;
    expect(created.textContent).toContain(url);
    expect(created.textContent).toContain('Link ab12cd34 created');
    // Inside the page's live region, and announced, without the token.
    expect(created.closest('[role="status"]')).not.toBeNull();
    expect(announced).toEqual([
      'Link ab12cd34 created. Copy its address now: it is shown this once.',
    ]);
    expect(announced.join(' ')).not.toContain(TOKEN);
    // The new link heads the list, by its hash: the list holds no token.
    expect(root.querySelector('.record-share-links__list')?.textContent).not.toContain(TOKEN);
    // The selection is cleared for the next link.
    expect(items(root).length).toBe(3);
    expect(disabled(button(root, 'Create link') as HTMLButtonElement)).toBe(true);

    (button(root, 'Copy the address') as HTMLButtonElement).click();
    expect(copied).toEqual([url]);

    (button(root, 'Done') as HTMLButtonElement).click();
    await settle();
    expect(root.querySelector('[data-share-link-created]')).toBeNull();
    // Once gone, the address is nowhere on the page.
    expect(root.innerHTML).not.toContain(TOKEN);
  });

  it('never shows an address on another origin, even from the service', async () => {
    const root = await loaded([]);
    await choose(root, 'view:FullHD');
    (button(root, 'Create link') as HTMLButtonElement).click();
    await settle();
    await answer(creates as Call<CreatedShareLink>[], {
      kind: 'created',
      link: link(),
      token: TOKEN,
      path: `//evil.example/${TOKEN}/`,
    });
    expect(root.querySelector('[data-share-link-created]')).toBeNull();
    expect(root.innerHTML).not.toContain(TOKEN);
    expect(root.querySelector('[data-share-links-error]')?.textContent).toContain(
      'on another site',
    );
  });

  it('forgets a created link when the page moves to another record', async () => {
    const root = await loaded([]);
    await choose(root, 'view:FullHD');
    (button(root, 'Create link') as HTMLButtonElement).click();
    await settle();
    await answer(creates as Call<CreatedShareLink>[], {
      kind: 'created',
      link: link(),
      token: TOKEN,
      path: `/nuxeo/agentic-share/${TOKEN}/`,
    });
    expect(root.innerHTML).toContain(TOKEN);
    fixture?.componentRef.setInput('document', asset('a2'));
    await settle();
    await answer(lists, []);
    expect(root.innerHTML).not.toContain(TOKEN);
  });

  it('says each item the server refused, and why, in the reader’s words, and creates nothing', async () => {
    const root = await loaded([]);
    await choose(root, 'original');
    await choose(root, 'view:FullHD');
    (button(root, 'Create link') as HTMLButtonElement).click();
    await settle();
    await answer(creates as Call<CreatedShareLink>[], {
      kind: 'refused',
      refused: [
        { rendition: 'original', reason: 'channel-not-covered' },
        { rendition: 'view:FullHD', reason: 'something-new' },
      ],
    });
    const refused = Array.from(
      root.querySelectorAll<HTMLElement>('[data-share-links-refused] li'),
    ).map((each) => each.textContent?.replace(/\s+/g, ' ').trim());
    expect(refused).toEqual([
      "Original file: the asset's channels do not cover it",
      'FullHD: refused by the server',
    ]);
    expect(root.querySelector('[data-share-link-created]')).toBeNull();
    expect(root.querySelector('[data-share-links-empty]')).not.toBeNull();
  });

  it('says a refused or failed create where it was asked', async () => {
    const root = await loaded([]);
    await choose(root, 'original');
    (button(root, 'Create link') as HTMLButtonElement).click();
    await settle();
    await fail(creates as Call<CreatedShareLink>[], 403);
    expect(root.querySelector('[data-share-links-error]')?.textContent).toContain(
      'Only an administrator, or a member of a group the server lets share, creates share links.',
    );
    (button(root, 'Create link') as HTMLButtonElement).click();
    await settle();
    await fail(creates as Call<CreatedShareLink>[], 400);
    expect(root.querySelector('[data-share-links-error]')?.textContent).toContain(
      'check what it shares and its last day',
    );
  });

  it('revokes an active link once confirmed, and shows it revoked', async () => {
    const root = await loaded([link()]);
    (button(root, 'Revoke') as HTMLButtonElement).click();
    await settle();
    expect(dialogs).toEqual([
      {
        title: 'Revoke share link',
        message: 'Revoke link ab12cd34? It stops working at once, and cannot be turned on again.',
        confirmLabel: 'Revoke',
      },
    ]);
    expect(revokes.map((each) => [each.uid, each.link])).toEqual([['a1', ID]]);
    await answer(
      revokes as Call<ShareLink>[],
      link({ state: 'revoked', revoked: '2026-11-26T09:00:00Z', revokedBy: 'jdoe' }),
    );
    const shown = root.querySelector<HTMLElement>('.record-share-links__link') as HTMLElement;
    expect(shown.dataset['state']).toBe('revoked');
    expect(button(root, 'Revoke')).toBeNull();
    expect(announced).toEqual(['Link ab12cd34 revoked']);
  });

  it('revokes nothing when the dialog is cancelled', async () => {
    confirm = undefined;
    const root = await loaded([link()]);
    (button(root, 'Revoke') as HTMLButtonElement).click();
    await settle();
    expect(dialogs).toHaveLength(1);
    expect(revokes).toEqual([]);
  });

  it('offers Revoke only on an active link', async () => {
    const root = await loaded([
      link({ id: OTHER, state: 'expired' }),
      link({ state: 'revoked', revoked: '2026-11-26T09:00:00Z', revokedBy: 'jdoe' }),
    ]);
    expect(root.querySelector('.record-share-links__revoke')).toBeNull();
  });

  it('in the designer’s preview, lists the links with no Create and no Revoke', async () => {
    const root = await loaded([link()], asset(), true);
    expect(root.querySelector('.record-share-links__link')).not.toBeNull();
    expect(root.querySelector('.record-share-links__form')).toBeNull();
    expect(button(root, 'Revoke')).toBeNull();
    expect(button(root, 'Create link')).toBeNull();
  });

  it('names its parts as headings below its own level', async () => {
    fixture = TestBed.createComponent(RecordShareLinksComponent);
    fixture.componentRef.setInput('headingLevel', 2);
    const root = await loaded([]);
    const levels = Array.from(root.querySelectorAll('[role="heading"]')).map((each) => [
      each.textContent?.trim(),
      each.getAttribute('aria-level'),
    ]);
    expect(levels).toEqual([
      ['Share links', '2'],
      ['New share link', '3'],
      ['Downloads', '3'],
    ]);
  });
});
