export type Source = {
  id: string;
  name: string;
  kind: 'url' | 'file';
  url?: string;
  fileName?: string;
  lastSuccessfulRefreshAt?: string;
};

export type Availability = 'available' | 'missing' | 'needs-review';

export type Channel = {
  id: string; // Internal stable ID; not derived from the stream URL.
  sourceId: string;
  providerId?: string; // tvg-id; may be absent or duplicated.
  name: string;
  normalizedName: string;
  group?: string;
  logoUrl?: string;
  streamUrl: string; // Empty for placeholders restored from a personal backup.
  availability: Availability;
  /** Provider-specific directives (e.g. http-user-agent) a browser cannot honour. */
  directives?: string[];
  /** Position in the source catalogue, used for stable display order. */
  order: number;
};

export type PersonalPlaylist = {
  id: string;
  name: string;
  channelIds: string[]; // Unique, ordered references.
};

export const MY_CHANNELS_ID = 'my-channels';
