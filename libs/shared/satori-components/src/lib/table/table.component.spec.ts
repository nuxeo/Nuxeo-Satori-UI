import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import axe from 'axe-core';

import { NxsTableComponent, type NxsTableRow } from './table.component';

const COLUMNS = ['Time', 'Link', 'Item'];
const ROWS: readonly NxsTableRow[] = [
  ['25 Nov 2026, 16:30', 'ab12cd34', 'FullHD'],
  ['25 Nov 2026, 16:00', 'ab12cd34', 'Original file'],
];

describe('NxsTableComponent', () => {
  let fixture: ComponentFixture<NxsTableComponent>;

  async function render(inputs: Record<string, unknown> = {}): Promise<HTMLElement> {
    const all = { caption: 'Downloads', columns: COLUMNS, rows: ROWS, ...inputs };
    for (const [key, value] of Object.entries(all)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const table = (root: HTMLElement): HTMLTableElement => {
    const found = root.querySelector('table');
    if (!found) throw new Error('no table rendered');
    return found;
  };
  const bodyRows = (root: HTMLElement): string[][] =>
    [...table(root).tBodies[0].rows]
      .filter((row) => !row.hidden)
      .map((row) => [...row.cells].map((cell) => cell.textContent?.trim() ?? ''));

  async function wcag22(root: HTMLElement): Promise<axe.Result[]> {
    const results = await axe.run(root, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      // jsdom lays nothing out, so contrast cannot be measured here.
      rules: { 'color-contrast': { enabled: false } },
    });
    return results.violations;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsTableComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsTableComponent);
  });

  it('is one native table, named by its caption, drawn as Material’s table', async () => {
    const root = await render();
    expect(root.querySelectorAll('table')).toHaveLength(1);
    const caption = table(root).caption;
    expect(caption?.textContent?.trim()).toBe('Downloads');
    expect(caption?.classList).not.toContain('cdk-visually-hidden');
    expect(table(root).classList).toContain('mat-mdc-table');
  });

  it('heads each column with a th of scope col, in order', async () => {
    const root = await render();
    const headers = [...table(root).tHead!.querySelectorAll('th')];
    expect(headers.map((header) => header.textContent?.trim())).toEqual(COLUMNS);
    expect(headers.map((header) => header.getAttribute('scope'))).toEqual(['col', 'col', 'col']);
  });

  it('draws each row’s cells in the columns’ order, as td cells', async () => {
    const root = await render();
    expect(bodyRows(root)).toEqual(ROWS);
    expect(table(root).tBodies[0].querySelectorAll('th')).toHaveLength(0);
  });

  it('leaves the cells of a short row empty, rather than shifting them', async () => {
    const root = await render({ rows: [['10:00']] });
    expect(bodyRows(root)).toEqual([['10:00', '', '']]);
  });

  it('allows two columns to say the same, each its own column', async () => {
    const root = await render({ columns: ['Amount', 'Amount'], rows: [['10', '20']] });
    expect(bodyRows(root)).toEqual([['10', '20']]);
  });

  it('follows rows and columns that change', async () => {
    const root = await render();
    await render({ columns: ['Code'], rows: [['A1'], ['B2'], ['C3']] });
    expect(
      [...table(root).tHead!.querySelectorAll('th')].map((th) => th.textContent?.trim()),
    ).toEqual(['Code']);
    expect(bodyRows(root)).toEqual([['A1'], ['B2'], ['C3']]);
  });

  it('says the caption only to assistive technology with hideCaption', async () => {
    const root = await render({ hideCaption: true });
    const caption = table(root).caption;
    expect(caption?.classList).toContain('cdk-visually-hidden');
    expect(caption?.textContent?.trim()).toBe('Downloads');
  });

  describe('with no rows', () => {
    it('says its empty text in one row across every column', async () => {
      const root = await render({ rows: [], emptyText: 'Nothing downloaded yet.' });
      const rows = [...table(root).tBodies[0].rows];
      expect(rows).toHaveLength(1);
      expect(rows[0].hidden).toBe(false);
      expect(rows[0].cells).toHaveLength(1);
      expect(rows[0].cells[0].colSpan).toBe(3);
      expect(rows[0].cells[0].textContent?.trim()).toBe('Nothing downloaded yet.');
    });

    it('shows its headers alone when it has no empty text', async () => {
      const root = await render({ rows: [] });
      expect(table(root).tHead!.querySelectorAll('th')).toHaveLength(3);
      expect(bodyRows(root)).toEqual([]);
    });

    it('drops the empty row once there are rows', async () => {
      const root = await render({ rows: [], emptyText: 'Nothing downloaded yet.' });
      await render({ rows: ROWS, emptyText: 'Nothing downloaded yet.' });
      expect(bodyRows(root)).toEqual(ROWS);
      expect(root.textContent).not.toContain('Nothing downloaded yet.');
    });
  });

  it('draws compact rows when dense, and the theme’s height otherwise', async () => {
    let root = await render();
    expect(root.classList).not.toContain('nxs-table--dense');
    root = await render({ dense: true });
    expect(root.classList).toContain('nxs-table--dense');
  });

  it('takes no focus', async () => {
    const root = await render();
    expect(root.querySelectorAll('[tabindex], button, a, input')).toHaveLength(0);
  });

  it('passes axe at WCAG 2.2 AA, with rows, with none, and with its caption hidden', async () => {
    expect(await wcag22(await render())).toEqual([]);
    expect(await wcag22(await render({ rows: [], emptyText: 'Nothing yet.' }))).toEqual([]);
    expect(await wcag22(await render({ rows: [] }))).toEqual([]);
    expect(await wcag22(await render({ hideCaption: true, dense: true }))).toEqual([]);
  });
});
