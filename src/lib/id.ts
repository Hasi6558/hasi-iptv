let counter = 0;

/** Random-enough local ID. Uses only characters that are safe in attribute selectors. */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1679616;
  const rand = Math.floor(Math.random() * 2176782336).toString(36);
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
