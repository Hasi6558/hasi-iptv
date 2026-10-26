import type { Channel } from '../../lib/types';
import { normalizeName, splitGroups } from '../../lib/m3u/normalize';

export function filterChannels(channels: Channel[], query: string, group: string): Channel[] {
  const tokens = normalizeName(query).split(' ').filter(Boolean);
  return channels.filter((c) => {
    // Placeholders restored from a personal backup are only shown in My Channels.
    if (!c.streamUrl) return false;
    if (group && !splitGroups(c.group).includes(group)) return false;
    for (const t of tokens) if (c.normalizedName.indexOf(t) < 0) return false;
    return true;
  });
}
