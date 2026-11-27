import { picturePng } from './png.mjs';

/**
 * The media kit's fictional film, its localised versions and its release windows, for its seed,
 * its stand-in server and the demo's steps file. No real studio, distributor, person or film: the
 * names are made up, as the brand assets kit's Acme Outdoor is.
 *
 * Release windows are days from the day the seed runs, in UTC, so that the demo reads the same
 * whenever it is seeded: run it within 30 days of the seed, and re-seed after (the kit's README).
 */

/** The workspace the seed writes into, under /default-domain/workspaces, and its three folders. */
export const WORKSPACE = { name: 'media-demo', title: 'Media rights (demo)' };
export const FILMS = { name: 'films', title: 'Films' };
export const VERSIONS = { name: 'versions', title: 'Localised versions' };
export const DELIVERIES = { name: 'deliveries', title: 'Deliveries' };

/**
 * The kit's groups, which the server's directory holds: rights managers write the films and their
 * versions; the distribution team reads them, and files deliveries; and, from 0.2.0, outside
 * partners, such as a festival's programmers, read the versions, and are served the still marked.
 * The kit's watermark exempts the first two, its staff (`bundle/OSGI-INF/media-demo-rights.xml`).
 */
export const GROUPS = {
  rights: 'media-rights',
  distribution: 'media-distribution',
  partners: 'media-partners',
};

/** Who may do what, folder by folder: the seed grants these on the workspace's three folders. */
export const GRANTS = [
  { folder: FILMS.name, group: GROUPS.rights, permission: 'ReadWrite' },
  { folder: VERSIONS.name, group: GROUPS.rights, permission: 'ReadWrite' },
  { folder: FILMS.name, group: GROUPS.distribution, permission: 'Read' },
  { folder: VERSIONS.name, group: GROUPS.distribution, permission: 'Read' },
  { folder: DELIVERIES.name, group: GROUPS.distribution, permission: 'ReadWrite' },
  { folder: DELIVERIES.name, group: GROUPS.rights, permission: 'Read' },
  { folder: VERSIONS.name, group: GROUPS.partners, permission: 'Read' },
];

/**
 * The film's release windows, each a territory and a channel, open from `from` days after the seed's
 * day to `until` days after it, both included. SVOD clears a version's master and subtitles,
 * Marketing its key art (the kit's rights policy, `bundle/OSGI-INF/media-demo-rights.xml`).
 */
export const WINDOWS = [
  { territory: 'GB', channel: 'SVOD', from: -30, until: 150 },
  { territory: 'GB', channel: 'Marketing', from: -60, until: 150 },
  { territory: 'FR', channel: 'SVOD', from: -30, until: 150 },
  { territory: 'FR', channel: 'Marketing', from: -60, until: 150 },
  // Marketing in Belgium closed the day before the seed's: a package to BE is refused whole.
  { territory: 'BE', channel: 'SVOD', from: -30, until: 150 },
  { territory: 'BE', channel: 'Marketing', from: -90, until: -1 },
  // SVOD in Germany opens 35 days after the seed's day.
  { territory: 'DE', channel: 'SVOD', from: 35, until: 215 },
  { territory: 'DE', channel: 'Marketing', from: -10, until: 215 },
  { territory: 'CH', channel: 'SVOD', from: -30, until: 150 },
  { territory: 'CH', channel: 'Marketing', from: -30, until: 150 },
];

export const FILM = {
  name: 'lighthouse-at-saltmere',
  title: 'The Lighthouse at Saltmere',
  year: 2026,
  director: 'Ines Varga',
  genre: 'Drama',
  originalLanguage: 'English',
  description:
    'A fictional feature of Acme Pictures: a keeper, a storm and a letter that arrives forty years late. No real film.',
};

/**
 * Its localised versions, each with its own rights: where it may be delivered, the channels it is
 * cleared for, and the day those rights end, `rightsForDays` after the seed's day.
 */
export const LOCALISED = [
  {
    key: 'english',
    language: 'English',
    territories: ['GB', 'IE'],
    channels: ['SVOD', 'Marketing'],
    rightsForDays: 730,
  },
  {
    key: 'french',
    language: 'French',
    territories: ['FR', 'BE', 'CH'],
    channels: ['SVOD', 'Marketing'],
    rightsForDays: 730,
  },
  {
    key: 'german',
    language: 'German',
    territories: ['DE', 'AT', 'CH'],
    channels: ['SVOD', 'Marketing'],
    rightsForDays: 730,
  },
];

/** A version's name in the versions folder, and its title. */
export const versionName = (version) => `${FILM.name}-${version.key}`;
export const versionTitle = (version) => `${FILM.title} (${version.language})`;

/** Where each of a version's files is, as the kit's rights policy names them. */
export const FILES = {
  master: 'files:files/0/file',
  subtitles: 'files:files/1/file',
  keyArt: 'files:files/2/file',
  still: 'files:files/3/file',
};

/**
 * The text the kit's watermark draws, as its rights policy writes it, `ACME PICTURES · FOR
 * {recipient} · {day}`: for a delivery's key art, its distributor; for the still, the outside
 * partner reading it. The selftest holds it to the policy file.
 */
export const watermarkText = (recipient, today) => `ACME PICTURES · FOR ${recipient} · ${today}`;

/**
 * A version's four files, in the order its rights policy names them: `files:files/0` the master,
 * `1` the subtitles, `2` the key art and, from 0.2.0, `3` a still from the film. The master and the
 * subtitles are small placeholders, not a film: a stand-in model's files. The key art and the
 * still are pictures, drawn by `png.mjs`, so that the server can mark them.
 */
export function filesOf(version) {
  const title = versionTitle(version);
  return [
    {
      fileName: `${versionName(version)}-master.txt`,
      mimeType: 'text/plain',
      bytes: Buffer.from(
        `Placeholder for the master of ${title}. A fictional film: no picture, no sound.\n`,
      ),
    },
    {
      fileName: `${versionName(version)}-subtitles.vtt`,
      mimeType: 'text/vtt',
      bytes: Buffer.from(
        `WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n${title}, fictional subtitles of Acme Pictures.\n`,
      ),
    },
    {
      fileName: `${versionName(version)}-key-art.png`,
      mimeType: 'image/png',
      bytes: picturePng({
        shape: 'key-art',
        size: [480, 270],
        background: [28, 52, 84],
        ink: [236, 214, 160],
      }),
    },
    {
      fileName: `${versionName(version)}-still.png`,
      mimeType: 'image/png',
      bytes: picturePng({
        shape: 'still',
        size: [480, 270],
        background: [44, 48, 58],
        ink: [250, 236, 190],
      }),
    },
  ];
}

/** The demo's deliveries: phase 9's demo step 1, and two more refusals the README shows. */
export const DEMO = {
  /** Inside its windows: delivered, whole. */
  inside: { version: 'french', distributor: 'Acme Distribution France', territory: 'FR' },
  /** Outside: SVOD in Germany opens 35 days after the seed's day. */
  outside: {
    version: 'german',
    distributor: 'Acme Verleih Deutschland',
    territory: 'DE',
    reason: 'outside-window',
  },
  /** Refused whole: SVOD is open in Belgium, Marketing closed, so the key art is outside. */
  whole: {
    version: 'french',
    distributor: 'Acme Distribution Belgique',
    territory: 'BE',
    reason: 'outside-window',
  },
  /** The French version's own territories do not hold DE, whatever the film's windows there. */
  territory: {
    version: 'french',
    distributor: 'Acme Verleih Deutschland',
    territory: 'DE',
    reason: 'territory-not-covered',
  },
};

/** `yyyy-MM-dd`, `days` after `today`, in UTC. */
export function day(today, days) {
  const at = new Date(`${today}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Today, in UTC, as the server's rights read it. */
export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** The film's windows as its `film:windows` holds them, for a seed run on `today`. */
export function windowsFrom(today) {
  return WINDOWS.map(({ territory, channel, from, until }) => ({
    territory,
    channel,
    from: day(today, from),
    until: day(today, until),
  }));
}
