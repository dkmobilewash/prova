/**
 * Whether a string can be set in the PDF's standard fonts.
 *
 * The PDF uses the fourteen standard fonts (no embedded font file, so the
 * file stays small and opens anywhere), which encode WinAnsi -- Latin-1
 * plus 27 typographic characters. Every character in all four statutes is
 * in that set (the PDF test proves it by printing every form); a FILL might
 * not be, and pdf-lib throws on one it cannot encode. So fills are checked
 * here first and refused with a sentence a person can act on.
 */
const WINANSI_EXTRA = new Set(
  [
    0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019,
    0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
  ].map((code) => String.fromCodePoint(code)),
);

export function unsupportedCharacters(text: string): string[] {
  const bad = new Set<string>();
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const ok = (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WINANSI_EXTRA.has(char);
    if (!ok) bad.add(char);
  }
  return [...bad];
}
