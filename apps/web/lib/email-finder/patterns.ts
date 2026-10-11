/**
 * THE ADDRESSES A SMALL FIRM USUALLY HAS, guessed from the owner's name.
 *
 * Ordered by how often a one-owner trade shop uses each shape, the owner's own
 * first: `first@` is the commonest by a distance. The role addresses come last
 * because they reach somebody but rarely the person who signs. A guess is only
 * ever a candidate — `find.ts` verifies it or labels it a guess, never neither.
 *
 * No owner name, no guesses: `info@` on its own is not worth a verifier credit
 * on a domain whose site printed nothing.
 */

const SUFFIX = /^(jr|sr|ii|iii|iv)$/;

function fold(word: string): string {
  return word
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function patternCandidates(ownerName: string | null | undefined, domain: string): string[] {
  if (!ownerName) return [];
  const words = ownerName
    .split(/\s+/)
    .map(fold)
    .filter((w) => w.length > 1 && !SUFFIX.test(w)); // drops "Q." middle initials
  if (words.length < 2) return [];
  const first = words[0];
  const last = words[words.length - 1];
  const locals = [first, `${first}.${last}`, `${first}${last}`, `${first[0]}${last}`, `${first}_${last}`, last, "info", "office", "estimating"];
  return [...new Set(locals)].map((local) => `${local}@${domain}`);
}
