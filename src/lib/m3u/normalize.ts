const COMBINING = /[̀-ͯ]/g;
// ASCII punctuation (except '+'), Latin-1 punctuation and general punctuation.
// Avoids Unicode property escapes so the parser also runs on older TV engines.
const SEPARATORS = /[\s!-*,-/:-@[-`{-~ -¿×÷ -⁯　-〿]+/g;

function stripDiacritics(s: string): string {
  // String.prototype.normalize can be missing on very old engines.
  return typeof s.normalize === 'function' ? s.normalize('NFD').replace(COMBINING, '') : s;
}

/** Lowercase, accent-free, punctuation-collapsed text used for search. Computed once on import. */
export function normalizeName(name: string): string {
  return stripDiacritics(name.toLowerCase()).replace(SEPARATORS, ' ').trim();
}

/**
 * Identity key used for reconciliation: like normalizeName but ignores volatile
 * suffixes such as "(720p)", "[Geo-blocked]" or "[Not 24/7]".
 */
export function identityName(name: string): string {
  return normalizeName(name.replace(/\(\s*\d{3,4}[pi]\s*\)/gi, ' ').replace(/\[[^\]]*\]/g, ' '));
}

export function splitGroups(group: string | undefined): string[] {
  if (!group) return [];
  return group
    .split(';')
    .map((g) => g.trim())
    .filter(Boolean);
}
