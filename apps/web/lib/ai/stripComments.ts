/**
 * A COMMENT STRIPPER THE THREE CENSUSES SHARE.
 *
 * MOVED OUT OF `aiFeatureGateCensus.test.ts` on 2026-09-29, where it was defined and
 * exported. That worked until two more censuses needed it: importing from a test FILE
 * pulls that file's own tests into the importer's module graph, so the gate census ran
 * three times over and a failure in it would have been reported against whichever file
 * happened to be running. A shared helper is not a test.
 *
 * Its tests stay in the gate census, under "the comment stripper this census rests
 * on" — they still import it, and that file is still the one that proves it against a
 * fixture.
 */

/**
 * Comments out, string contents kept.
 *
 * A regex would do this wrong in a way that matters: `"https://..."` contains
 * `//`, and cutting from there to end of line would delete the rest of a real
 * line of code — which fails OPEN, since less text means fewer matches means a
 * smaller set means nothing missing. So this walks characters and tracks which
 * of the five states it is in. Proved against a fixture at the bottom of this
 * file rather than assumed.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== "*/") i += 1;
      i += 2;
      continue;
    }
    const quote = source[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      out += quote;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}
