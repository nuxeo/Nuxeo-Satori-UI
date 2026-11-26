import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';
import { Subject, of, type Observable } from 'rxjs';

import {
  DeploymentLayerService,
  type LayerChange,
  type LayerReading,
} from './deployment-layer.service';
import { controlContract } from '../control-contract.testing';
import { LayerPanelComponent } from './layer-panel';
import type { LayerLive, LayerState } from './layer-state';

const PACKAGED = { version: 2, cards: [{ id: 'claim', fields: ['claim:number'] }] };
const LIVE = { version: 2, cards: [{ id: 'claim', label: 'Live', fields: ['claim:number'] }] };
const DRAFT = {
  version: 2,
  cards: [{ id: 'claim', label: 'Draft', fields: ['claim:number', 'dc:title'] }],
};

function state(change: Partial<LayerState> = {}): LayerState {
  return {
    app: 'payers-claims',
    path: 'layouts/Claim/view.layout.json',
    revision: 3,
    package: { content: PACKAGED },
    live: {
      version: 1,
      kind: 'approved',
      at: '2026-11-25T22:00:00Z',
      authors: ['ada'],
      submittedBy: 'ada',
      approvedBy: 'ben',
      from: null,
      restoredBy: null,
      content: LIVE,
    },
    draft: null,
    versions: [],
    trail: [],
    previous: 0,
    packageChanged: false,
    served: true,
    permissions: { write: true, approve: false, approveRefused: null, selfApproval: false },
    ...change,
  };
}

const submittedDraft = (by = 'ada') => ({
  content: DRAFT,
  authors: [by],
  savedBy: by,
  savedAt: '2026-11-25T22:10:00Z',
  basedOn: 1,
  submittedBy: by,
  submittedAt: '2026-11-25T22:11:00Z',
});

@Component({
  standalone: true,
  imports: [LayerPanelComponent],
  template: `<lib-layer-panel
    [path]="path()"
    [file]="file()"
    [saveable]="saveable()"
    (openVersion)="opened.push($event)"
  />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostComponent {
  readonly path = signal<string | null>('layouts/Claim/view.layout.json');
  readonly file = signal<unknown>(DRAFT);
  readonly saveable = signal(true);
  readonly opened: unknown[] = [];
}

describe('LayerPanelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let readings: Subject<LayerReading>;
  let sent: [string, LayerChange][];
  let answer: LayerReading;
  let agreed: boolean;
  let asked: unknown[];

  beforeEach(() => {
    readings = new Subject();
    sent = [];
    asked = [];
    agreed = true;
    answer = { kind: 'state', state: state({ revision: 4 }) };
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideNxsComponents(),
        {
          provide: DeploymentLayerService,
          useValue: {
            state: (): Observable<LayerReading> => readings,
            act: (path: string, change: LayerChange): Observable<LayerReading> => {
              sent.push([path, change]);
              return of(answer);
            },
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: (_component: unknown, config: { data: unknown }) => {
              asked.push(config.data);
              return { afterClosed: () => of(agreed) };
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
  });

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  /** The native button of the `nxs-` button for `action`. */
  const button = (action: string): HTMLButtonElement =>
    root().querySelector<HTMLButtonElement>(
      `[data-layer-action="${action}"] button`,
    ) as HTMLButtonElement;

  async function show(reading: LayerReading): Promise<void> {
    fixture.detectChanges();
    readings.next(reading);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the package, live and draft versions side by side, as text, with their differences', async () => {
    await show({ kind: 'state', state: state({ draft: submittedDraft() }) });
    const versions = [...root().querySelectorAll('[data-version]')].map((each) =>
      each.getAttribute('data-version'),
    );
    expect(versions).toEqual(['package', 'live', 'draft']);
    const live = root().querySelector('[data-version="live"] pre')?.textContent ?? '';
    expect(JSON.parse(live)).toEqual(LIVE);
    expect(root().querySelector('[data-version="live"]')?.textContent).toContain('approved by ben');
    const comparisons = [...root().querySelectorAll('[data-comparison]')].map((each) =>
      each.getAttribute('data-comparison'),
    );
    expect(comparisons).toEqual([
      'layout-designer.layer.diff-live',
      'layout-designer.layer.diff-draft',
      'layout-designer.layer.diff-edited',
    ]);
    expect(root().textContent).toContain('cards[0].label');
  });

  it('draws a label that is markup as its text, and runs nothing', async () => {
    const markup = {
      version: 2,
      cards: [{ id: 'x', label: '<img src=x onerror="window.pwned=1">' }],
    };
    await show({
      kind: 'state',
      state: state({ live: { ...(state().live as LayerLive), content: markup } }),
    });
    expect(root().querySelector('img')).toBeNull();
    expect(root().querySelector('[data-version="live"] pre')?.textContent).toContain('<img src=x');
    expect((window as { pwned?: unknown }).pwned).toBeUndefined();
  });

  it('saves the file as edited on the revision it read, once the designer finds nothing in it', async () => {
    await show({ kind: 'state', state: state() });
    button('save').click();
    expect(sent).toEqual([
      ['layouts/Claim/view.layout.json', { action: 'save', revision: 3, content: DRAFT }],
    ]);
    fixture.detectChanges();
    expect(root().querySelector('[data-layer="done"]')?.textContent).toContain('draft is saved');
  });

  it('turns Save draft off, and says why, while the designer finds something in the file', async () => {
    fixture.componentInstance.saveable.set(false);
    await show({ kind: 'state', state: state() });
    expect(button('save').disabled).toBe(true);
    expect(root().querySelector('[data-layer-why="save"]')).not.toBeNull();
    // Whatever calls it, nothing is sent.
    const panel = fixture.debugElement.children[0].componentInstance as LayerPanelComponent;
    panel.save();
    expect(sent).toEqual([]);
  });

  it("follows the server's permissions, turning a button off rather than hiding it", async () => {
    await show({
      kind: 'state',
      state: state({
        draft: submittedDraft(),
        permissions: {
          write: true,
          approve: false,
          approveRefused: 'You wrote this draft, so a second administrator approves it.',
          selfApproval: false,
        },
      }),
    });
    expect(button('approve').disabled).toBe(true);
    expect(root().querySelector('[data-layer-why="approve"]')?.textContent).toContain(
      'You wrote this draft',
    );
    expect(button('submit').disabled).toBe(true);
    expect(button('rollback').disabled).toBe(false);
    expect(button('discard').disabled).toBe(false);
    const panel = fixture.debugElement.children[0].componentInstance as LayerPanelComponent;
    panel.approve();
    expect(sent).toEqual([]);

    await show({
      kind: 'state',
      state: state({ permissions: { ...state().permissions, write: false } }),
    });
    for (const action of ['save', 'submit', 'approve', 'rollback', 'discard'])
      expect(button(action).disabled, action).toBe(true);
  });

  it('asks before approving, and approves only when the answer is yes', async () => {
    await show({
      kind: 'state',
      state: state({
        draft: submittedDraft(),
        permissions: { write: true, approve: true, approveRefused: null, selfApproval: false },
      }),
    });
    agreed = false;
    button('approve').click();
    expect(asked).toHaveLength(1);
    expect(sent).toEqual([]);
    agreed = true;
    button('approve').click();
    expect(sent).toEqual([['layouts/Claim/view.layout.json', { action: 'approve', revision: 3 }]]);
  });

  it('offers a rollback while something is live, and names what it puts back', async () => {
    await show({ kind: 'state', state: state({ live: null, previous: 0 }) });
    expect(button('rollback').disabled).toBe(true);
    await show({ kind: 'state', state: state({ previous: 2 }) });
    button('rollback').click();
    expect((asked[0] as { message: string }).message).toContain(
      'to version 2, the one live before',
    );
    await show({ kind: 'state', state: state({ previous: 0 }) });
    button('rollback').click();
    expect((asked[1] as { message: string }).message).toContain("to the package's version");
    await show({
      kind: 'state',
      state: state({
        live: { ...(state().live as LayerLive), kind: 'rollback', from: 1, restoredBy: 'ada' },
      }),
    });
    expect(root().querySelector('[data-version="live"]')?.textContent).toContain('put back by ada');
  });

  it('says when the live version is not what people get', async () => {
    await show({ kind: 'state', state: state({ served: false }) });
    expect(root().querySelector('[data-layer="not-served"]')).not.toBeNull();
    await show({ kind: 'state', state: state() });
    expect(root().querySelector('[data-layer="not-served"]')).toBeNull();
  });

  it("puts the package's version back, after asking, while something overrides it", async () => {
    await show({ kind: 'state', state: state({ live: null, previous: 1 }) });
    expect(button('rollback-package').disabled).toBe(true);
    await show({ kind: 'state', state: state() });
    button('rollback-package').click();
    expect(asked).toHaveLength(1);
    expect(sent).toEqual([
      ['layouts/Claim/view.layout.json', { action: 'rollback', revision: 3, to: 0 }],
    ]);
    fixture.detectChanges();
    expect(root().querySelector('[data-layer="done"]')?.textContent).toContain(
      "package's version is in force again",
    );
  });

  it('asks before a rollback and before a draft is discarded', async () => {
    await show({ kind: 'state', state: state({ draft: submittedDraft() }) });
    // The rollback leaves the draft, which may then be discarded.
    answer = { kind: 'state', state: state({ revision: 4, draft: submittedDraft() }) };
    button('rollback').click();
    fixture.detectChanges();
    button('discard').click();
    expect(asked).toHaveLength(2);
    expect(sent.map(([, change]) => change.action)).toEqual(['rollback', 'discard']);
  });

  it("shows the server's refusal and its findings, and the file as the server says it is now", async () => {
    await show({ kind: 'state', state: state() });
    answer = {
      kind: 'refused',
      refusal: {
        status: 409,
        error: 'stale',
        message: 'The file has changed since revision 3',
        findings: [
          { path: 'bogus', kind: 'unknown', message: '"bogus" is not a key version 2 has' },
        ],
        state: state({ revision: 7 }),
      },
    };
    button('save').click();
    fixture.detectChanges();
    expect(root().querySelector('[data-layer="refused"]')?.textContent).toContain(
      'changed since revision 3',
    );
    expect(root().querySelector('[data-kind="unknown"]')?.textContent).toContain('bogus');
    button('save').click();
    expect(sent[1][1].revision).toBe(7);
  });

  it('says why there is no layer: no app open, switched off, or not an administrator', async () => {
    for (const reason of ['no-app', 'off', 'forbidden'] as const) {
      await show({ kind: 'unavailable', reason });
      expect(root().querySelector(`[data-layer="${reason}"]`)).not.toBeNull();
      expect(root().querySelector('[data-layer-action]')).toBeNull();
    }
  });

  it('warns when the package has changed under the override, as after an upgrade', async () => {
    await show({ kind: 'state', state: state({ packageChanged: true }) });
    expect(root().querySelector('[data-layer="package-changed"]')).not.toBeNull();
  });

  it('opens the draft, or else the live version, in the designer, as a copy', async () => {
    await show({ kind: 'state', state: state({ draft: submittedDraft() }) });
    button('open').click();
    expect(fixture.componentInstance.opened).toEqual([DRAFT]);
    expect(fixture.componentInstance.opened[0]).not.toBe(DRAFT);
  });

  it("keeps the panel's keyboard contract: each control's element, name, state and order", async () => {
    await show({ kind: 'state', state: state({ draft: submittedDraft() }) });
    expect(controlContract(root())).toEqual([
      'button "Save draft"',
      'button "Submit for approval" disabled',
      'button "Approve and publish" disabled',
      'button "Roll back"',
      'button "Put the package\'s version back"',
      'button "Discard draft"',
      'button "Open the newest version here"',
    ]);
  });
});
