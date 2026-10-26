import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';

import { NXS_PRIMITIVE_IDS } from '../primitives';
import { provideNxsComponents } from '../provide-nxs-components';
import { NxsCardComponent } from './card.component';

/**
 * The media every story passes: the document-type icon a document card shows until its thumbnail
 * arrives. An application passes `nxs-thumbnail` with this icon inside; these stories make no request,
 * so they show the icon.
 */
const MEDIA = `<ng-template #media>
  <mat-icon aria-hidden="true" style="font-size: 40px; width: 40px; height: 40px">description</mat-icon>
</ng-template>`;

/** The actions search's card view passes: Favorite and Download. */
const ACTIONS = `<ng-template #actions>
  <button mat-icon-button type="button" aria-label="Add to Favorites"><mat-icon>star_border</mat-icon></button>
  <button mat-icon-button type="button" aria-label="Download"><mat-icon>download</mat-icon></button>
</ng-template>`;

/** The header action browse's card view passes for a collection: its menu button. */
const HEADER_ACTION = `<ng-template #headerAction>
  <button mat-icon-button type="button" aria-label="Collection actions"><mat-icon>more_vert</mat-icon></button>
</ng-template>`;

/** The card as one cell of a grid, the width browse's card view gives it. */
const card = (extra = '') => `<div style="inline-size: 200px">
  <nxs-card
    [heading]="heading"
    [subheading]="subheading"
    [selected]="selected"
    [selectionLabel]="selectionLabel"
    [selectionHandler]="selectionHandler"
    [openHandler]="openHandler"
    [media]="media"${extra}
  />
</div>`;

/**
 * One document in a grid of cards: its thumbnail, title and type, a checkbox to select it, and
 * whatever actions the page offers. The text below stands in for what a page binds through its
 * translate pipe.
 */
const meta: Meta<NxsCardComponent> = {
  title: 'Primitives/Card',
  component: NxsCardComponent,
  tags: ['autodocs'],
  decorators: [moduleMetadata({ imports: [MatButtonModule, MatIconModule] })],
  args: {
    heading: 'Claim 42 — water damage.pdf',
    subheading: 'File',
    selected: false,
    selectionLabel: 'Select Claim 42 — water damage.pdf',
    selectionHandler: fn(),
    openHandler: fn(),
  },
  argTypes: {
    heading: { control: 'text', description: 'The card’s title, already translated.' },
    subheading: { control: 'text', description: 'One line under the title. Blank shows none.' },
    selected: { control: 'boolean' },
    selectionLabel: {
      control: 'text',
      description: 'The checkbox’s accessible name. Blank renders no checkbox.',
    },
    selectionHandler: {
      control: false,
      description: 'Called with the checkbox’s new state when the user toggles it.',
    },
    openHandler: {
      control: false,
      description: 'Called when the user opens the card. Without it the title is text.',
    },
    media: { control: false },
    headerAction: { control: false },
    actions: { control: false },
  },
  render: (args) => ({ props: args, template: `${MEDIA}\n${card()}` }),
};

export default meta;

type Story = StoryObj<NxsCardComponent>;

/** A file in browse's card view. Press the title, or anywhere on the card: `openHandler` is called. */
export const Document: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Claim 42 — water damage.pdf' }));
    await expect(args.openHandler).toHaveBeenCalledTimes(1);
    await userEvent.click(
      canvas.getByRole('checkbox', { name: 'Select Claim 42 — water damage.pdf' }),
    );
    await expect(args.selectionHandler).toHaveBeenCalledWith(true);
    await expect(args.openHandler).toHaveBeenCalledTimes(1);
  },
};

/** Selected: the checkbox stays shown and the card takes the theme's selection colours. */
export const Selected: Story = {
  args: { selected: true },
};

/** Search's card view adds Favorite and Download at the foot. They show on hover or focus. */
export const WithActions: Story = {
  render: (args) => ({
    props: args,
    template: `${MEDIA}\n${ACTIONS}\n${card('\n    [actions]="actions"')}`,
  }),
};

/** A collection in browse's card view has a menu in the corner. It shows on hover or focus. */
export const WithHeaderAction: Story = {
  args: { heading: 'Q3 claims', subheading: 'Collection', selectionLabel: 'Select Q3 claims' },
  render: (args) => ({
    props: args,
    template: `${MEDIA}\n${HEADER_ACTION}\n${card('\n    [headerAction]="headerAction"')}`,
  }),
};

/** With no `openHandler` and no `selectionLabel`, a card is a summary: no button and no checkbox. */
export const NotInteractive: Story = {
  args: { selectionLabel: '', openHandler: null },
};

/** A title longer than the card is cut short with an ellipsis; hovering it shows it whole. */
export const LongTitle: Story = {
  args: {
    heading: 'Supplier contract renewal — signed counterpart, scanned 2026-10-01.pdf',
    selectionLabel: 'Select Supplier contract renewal',
  },
};

/**
 * Rendered by ID, the way browse and search render each card: whatever is registered under
 * `nxs.primitives.card` renders here. The outlet sets inputs and binds no outputs, so the handlers
 * and templates are inputs; `display: contents` on the outlet makes the card itself the grid item.
 */
export const ByRegisteredId: Story = {
  name: 'By Registered ID',
  decorators: [
    applicationConfig({ providers: [provideNxsComponents()] }),
    moduleMetadata({ imports: [ExtensionOutletComponent] }),
  ],
  parameters: { layout: 'padded' },
  render: (args) => ({
    props: {
      ...args,
      id: NXS_PRIMITIVE_IDS.card,
      titles: ['Claim 42 — water damage.pdf', 'Adjuster notes.docx', 'Site photos'],
    },
    template: `${MEDIA}
<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px">
  @for (title of titles; track title; let first = $first) {
    <lib-extension-outlet
      style="display: contents"
      [componentId]="id"
      [componentInputs]="{
        heading: title,
        subheading: subheading,
        selected: first,
        selectionLabel: 'Select ' + title,
        selectionHandler: selectionHandler,
        openHandler: openHandler,
        media: media
      }"
    />
  }
</div>`,
  }),
};
