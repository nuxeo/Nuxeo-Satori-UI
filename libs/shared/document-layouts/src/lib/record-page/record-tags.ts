import type { NxsTagStatus } from '@nuxeo/satori-platform/components';

import type { Tone } from './record-field-view';

/**
 * The design system's status for each of version 2's tones, for a `status-badge`: on the record
 * page's fields and in a card from another system.
 */
export const TAG_STATUS: Readonly<Record<Tone, NxsTagStatus>> = {
  positive: 'success',
  warning: 'warning',
  negative: 'important',
  info: 'info',
  neutral: 'neutral',
};
