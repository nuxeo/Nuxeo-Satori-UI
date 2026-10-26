export interface NuxeoAce {
  id: string;
  username: string;
  /** The principal's display name, when the read asked for `fetch-acls: extended`. */
  usernameLabel?: string;
  externalUser: boolean;
  permission: string;
  granted: boolean;
  creator: string | null;
  begin: string | null;
  end: string | null;
  status: 'effective' | 'pending' | 'archived';
}

export interface NuxeoAcl {
  name: string;
  aces: NuxeoAce[];
}
