import type { Meta, StoryObj } from '@storybook/angular';
import { fn } from 'storybook/test';

import { NxsDropzoneComponent } from './dropzone.component';

/** Where files are dropped from the computer, or chosen with the button — the keyboard's way in. */
const meta: Meta<NxsDropzoneComponent> = {
  title: 'Upload/Dropzone',
  component: NxsDropzoneComponent,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    label: 'Drag and drop files here',
    buttonLabel: '',
    multiple: true,
    accept: '',
    disabled: false,
    files: fn(),
  },
  argTypes: {
    label: { control: 'text', description: 'What the zone says, already translated. Required.' },
    buttonLabel: { control: 'text', description: 'The button’s text; blank says “Choose files”.' },
    multiple: { control: 'boolean', description: 'Takes several files at once.' },
    accept: { control: 'text', description: 'The file types the chooser offers, such as `.csv`.' },
    disabled: { control: 'boolean', description: 'Takes nothing.' },
    files: { control: false, description: 'The files chosen or dropped.' },
  },
  render: (args) => ({
    props: args,
    template: `<div style="width: 420px"><nxs-dropzone [label]="label" [buttonLabel]="buttonLabel" [multiple]="multiple" [accept]="accept" [disabled]="disabled" (files)="files($event)" /></div>`,
  }),
};

export default meta;

type Story = StoryObj<NxsDropzoneComponent>;

/** Several files, from a drop or the chooser. */
export const SeveralFiles: Story = {};

/** One CSV file, as the CSV import takes it. */
export const OneCsvFile: Story = {
  args: {
    label: 'Drop a CSV file here',
    multiple: false,
    accept: '.csv',
    buttonLabel: 'Choose a CSV file',
  },
};

/** While an upload runs: neither the drop nor the button takes anything. */
export const Disabled: Story = { args: { disabled: true } };
