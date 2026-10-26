export const DOC_TYPE_ICONS: Record<string, string> = {
  File: 'page',
  Note: 'notepad',
  Picture: 'image',
  Video: 'videocam',
  Audio: 'audio',
  Folder: 'folder',
  OrderedFolder: 'folder',
  Workspace: 'apps',
  WorkspaceRoot: 'processes',
  Domain: 'users',
  Collection: 'bookmark_filled',
  SectionRoot: 'book',
  Section: 'book',
  TemplateRoot: 'ui',
};

export function docTypeIcon(type: string): string {
  return DOC_TYPE_ICONS[type] ?? 'page';
}
