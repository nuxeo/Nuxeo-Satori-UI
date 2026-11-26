/**
 * The round trip through the pages: each kit's file, opened in the designer as the server serves
 * it, its JSON value, and downloaded with no edit, is the file's bytes, but for those listed in
 * `NOT_BYTE_FOR_BYTE`, which are the bytes Prettier writes for the same value afresh. The writer
 * alone, and the edits, are `round-trip.spec.ts`.
 *
 * Each page is given the kit's own content model and `actions.json`, which the package pipeline
 * holds the kit to, so that the validator finds nothing and the download is offered.
 */
import { ChangeDetectionStrategy, Component, input, output, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { join } from 'node:path';
import * as prettier from 'prettier';
import {
  PACKAGED_REGISTRIES,
  readContentModel,
  type ContentModel,
} from '@agentic-ui/shared/app-definition';
import {
  DocumentLayoutFormComponent,
  RecordPageComponent,
} from '@agentic-ui/shared/document-layouts';
import { QueuePageComponent } from '@agentic-ui/shared/queues';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';
import { NEVER, of } from 'rxjs';

import {
  kitFiles,
  kitText,
  NOT_BYTE_FOR_BYTE,
  REPOSITORY,
  type KitFile,
} from './kit-files.testing';
import { LayerPanelComponent } from './layer/layer-panel';
import { LayoutDesignerPageComponent } from './layout-designer-page/layout-designer-page';
import { LayoutDesignerService, type Reading } from './layout-designer.service';
import { QueueDesignerPageComponent } from './queue-designer-page/queue-designer-page';

/** Stands in for the engines and the layer's panel, which draw what the page hands them. */
@Component({
  selector: 'lib-record-page',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubRecordPageComponent {
  readonly document = input<unknown>();
  readonly layout = input<unknown>();
  readonly readOnly = input(false);
}

@Component({
  selector: 'lib-document-layout-form',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubFormComponent {
  readonly mode = input<unknown>();
  readonly document = input<unknown>(null);
  readonly type = input<unknown>(null);
  readonly parentPath = input<unknown>(null);
  readonly preview = input<unknown>(null);
  readonly disabled = input(false);
  readonly headingLevel = input<number>(3);
}

@Component({
  selector: 'lib-queue-page',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubQueuePageComponent {
  readonly id = input('');
  readonly content = input<unknown>(undefined);
  readonly readOnly = input(false);
}

@Component({
  selector: 'lib-layer-panel',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubLayerPanelComponent {
  readonly path = input<string | null>(null);
  readonly file = input<unknown>(null);
  readonly saveable = input(false);
  readonly openVersion = output<unknown>();
}

/** The kit's content model, as the designer reads the server's, or why it cannot be read. */
function modelOf(kit: string): Reading<ContentModel> {
  const text = kitText(kit, 'content-model.json');
  if (text === null) return { state: 'failed', problem: 'the kit has no content-model.json' };
  const read = readContentModel(JSON.parse(text));
  return read.model
    ? { state: 'read', value: read.model }
    : { state: 'failed', problem: read.problems.join('; ') };
}

/** Opens `file` on the page that edits it, as served, and downloads it unedited: the bytes saved. */
async function downloaded(file: KitFile): Promise<string> {
  const content: unknown = JSON.parse(file.text);
  const saved: Blob[] = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    saved.push(blob);
    return 'blob:round-trip';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const actions = kitText(file.kit, 'bundle/agentic-ui-config/actions.json');
  const service: Partial<Record<keyof LayoutDesignerService, unknown>> = {
    files: () =>
      of({
        state: 'read',
        value:
          file.opens.kind === 'layout' ? [{ type: file.opens.type, mode: file.opens.mode }] : [],
      }),
    model: () => of(modelOf(file.kit)),
    source: () => of({ state: 'read', value: { url: `/${file.path}`, content } }),
    records: () => of({ state: 'read', value: [] }),
    record: () => NEVER,
    registries: () => PACKAGED_REGISTRIES,
    preview: () => NEVER,
    previewForm: () => NEVER,
    queueIds: () => of({ state: 'read', value: [] }),
    queueSource: () => of({ state: 'read', value: content }),
    queueRegistered: () => ({ rules: [], rowActions: [], bulkActions: [] }),
    packageActions: () =>
      of({ state: 'read', value: actions === null ? null : (JSON.parse(actions) as unknown) }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideNxsComponents(),
      { provide: LayoutDesignerService, useValue: service },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(true) }) } },
    ],
  });
  const page: Type<LayoutDesignerPageComponent | QueueDesignerPageComponent> =
    file.opens.kind === 'layout' ? LayoutDesignerPageComponent : QueueDesignerPageComponent;
  if (file.opens.kind === 'layout')
    TestBed.overrideComponent(LayoutDesignerPageComponent, {
      remove: { imports: [RecordPageComponent, DocumentLayoutFormComponent, LayerPanelComponent] },
      add: { imports: [StubRecordPageComponent, StubFormComponent, StubLayerPanelComponent] },
    });
  else
    TestBed.overrideComponent(QueueDesignerPageComponent, {
      remove: { imports: [QueuePageComponent, LayerPanelComponent] },
      add: { imports: [StubQueuePageComponent, StubLayerPanelComponent] },
    });
  const fixture = TestBed.createComponent(page);
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await settle();
  const instance = fixture.componentInstance;
  if (instance instanceof LayoutDesignerPageComponent && file.opens.kind === 'layout') {
    instance.open(`${file.opens.type}/${file.opens.mode}`);
  } else if (instance instanceof QueueDesignerPageComponent && file.opens.kind === 'queue') {
    instance.idChosen.set(file.opens.id);
    instance.open(file.opens.id);
  }
  await settle();
  // What the validator finds is shown, so that a kit's file the designer will not save says why.
  expect(instance.findings()).toEqual([]);
  expect(instance.saveState()).toBe('saveable');
  const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
    '[data-action="download"] button',
  );
  button?.click();
  expect(saved).toHaveLength(1);
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(saved[0]);
  });
  fixture.destroy();
  return text;
}

describe('the round trip through the designer pages', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(kitFiles().map((file) => [file.path, file] as const))(
    'downloads %s, opened and unedited, byte for byte',
    async (_, file) => {
      const text = await downloaded(file);
      if (NOT_BYTE_FOR_BYTE[file.path]) {
        const filepath = join(REPOSITORY, file.path);
        const config = await prettier.resolveConfig(filepath);
        const afresh = await prettier.format(JSON.stringify(JSON.parse(file.text)), {
          ...config,
          filepath,
        });
        expect(text).not.toBe(file.text);
        expect(text).toBe(afresh);
      } else expect(text).toBe(file.text);
    },
  );
});
