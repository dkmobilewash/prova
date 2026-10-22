/**
 * ── THE COLOURS AN ITEM CAN BE ──
 *
 * These are RAW HEX and not design tokens, which is a deliberate exception to
 * `DESIGN.md` recorded in `docs/TAKEOFF-WORKSPACE-DESIGN.md` §2.6: they mark
 * USER DATA over a drawing that is not our palette, the user chooses them, and
 * they have to stay the same colour whatever the app's theme does. What the
 * picker OFFERS is this list; what gets stored is whatever was chosen.
 *
 * ── CHOSEN TO BE TELLABLE APART ON A WHITE SHEET ──
 *
 * Twelve, spread around the wheel, all dark enough to read as a line over
 * printed linework and none of them the near-black an architect has already
 * used for the walls. They are not checked by `theme-contrast.test.ts`,
 * because that census is about the APP's ink-on-ground pairs and these are
 * never a background for text.
 */
export const ITEM_COLORS = [
  "#e11d48", // rose
  "#2563eb", // blue
  "#16a34a", // green
  "#d97706", // amber
  "#9333ea", // violet
  "#0891b2", // cyan
  "#be123c", // deep rose
  "#4f46e5", // indigo
  "#15803d", // deep green
  "#b45309", // bronze
  "#7c3aed", // purple
  "#0e7490", // teal
] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Why this colour cannot be stored, or null.
 *
 * SIX DIGITS, ALWAYS. The three-digit form (`#f00`) is valid CSS and would
 * render perfectly, which is exactly the problem: the column would then hold
 * two spellings of the same colour and nothing comparing them as strings — a
 * "which items share a colour" check, say — would agree with what the screen
 * shows.
 */
export function colorProblem(value: string): string | null {
  if (!HEX.test(value)) return "Pick a colour from the list, or give one as #RRGGBB.";
  return null;
}

/**
 * The next colour to offer, given what is already used.
 *
 * THE FIRST UNUSED ONE, falling back to the least-used. Two items the same
 * colour on one drawing cannot be told apart, which is most of what a colour
 * is for — so a thirteenth item repeats the colour that is currently hardest
 * to confuse rather than always repeating the first.
 *
 * Case-insensitive, because a hand-typed `#E11D48` is the same colour as the
 * list's `#e11d48` and treating it as free would hand out a duplicate.
 */
export function nextItemColor(used: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const color of ITEM_COLORS) counts.set(color, 0);
  for (const raw of used) {
    const color = raw.toLowerCase();
    if (counts.has(color)) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  let best: string = ITEM_COLORS[0];
  let fewest = Number.POSITIVE_INFINITY;
  for (const color of ITEM_COLORS) {
    const n = counts.get(color) ?? 0;
    if (n === 0) return color;
    if (n < fewest) {
      fewest = n;
      best = color;
    }
  }
  return best;
}
