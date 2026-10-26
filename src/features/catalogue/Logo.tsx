import { memo, useState } from 'react';

/** Logos that failed once are not retried during this session. */
const failed = new Set<string>();

function initials(name: string): string {
  const words = name.replace(/\(.*?\)|\[.*?\]/g, '').trim().split(/\s+/);
  return (words[0]?.[0] ?? '?').toUpperCase() + (words[1]?.[0] ?? '').toUpperCase();
}

export const Logo = memo(function Logo({ url, name }: { url?: string; name: string }) {
  const [broken, setBroken] = useState(() => !url || failed.has(url));
  if (broken || !url) {
    return (
      <span className="logo logo-fallback" aria-hidden="true">
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      className="logo"
      src={url}
      alt=""
      width={56}
      height={42}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        failed.add(url);
        setBroken(true);
      }}
    />
  );
});
