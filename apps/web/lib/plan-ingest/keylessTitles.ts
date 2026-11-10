import { prisma } from "@prova/db";
import { CAPTION_WORDS } from "@/lib/takeoff/scannedCaptions";
import { KEYLESS_MODEL } from "./pageInventory";

/**
 * ── A WORD ON EVERY SHEET'S TITLE IS THE TITLE BLOCK, NOT THE DRAWING ──
 *
 * The keyless reader names a sheet by its title block's largest lettering, one page
 * at a time, so it cannot know what the whole set prints on every page. Green Bay
 * (walk, 2026-11-08, plan reading off) read "ROGUE NO.: DRAWN: ARCHITECTURAL
 * INFORMATION SCL ROGUE" for A1.0 and "… MECHANICAL FLOOR PLAN JCAA ERK" for M1.1:
 * the firm's name and the drafters' initials sit at the title's size on every
 * sheet. Across the set they are obvious, so once every page has been read they
 * come off: a word on 10% or more of the titles (and on at least three) that is
 * not a drawing's word (`CAPTION_WORDS` — PLAN, FLOOR, DEMOLITION… recur because
 * they are the titles). Half was tried first and removed nothing on Green Bay: the
 * firm's name is on 8 of 27 titles, because the rest are missing or misread. A title
 * left with nothing is no title, which says less and claims nothing wrong.
 */
const MIN_TITLES = 4;
const SHARE = 0.1;
const MIN_SHEETS = 3;

export function withoutSetBoilerplate(titles: readonly (string | null)[]): (string | null)[] {
  const words = (t: string) => t.split(/\s+/).filter((w) => w !== "");
  const named = titles.filter((t): t is string => t !== null && t.trim() !== "");
  if (named.length < MIN_TITLES) return [...titles];
  const seen = new Map<string, number>();
  for (const t of named) for (const w of new Set(words(t).map((x) => x.toUpperCase()))) seen.set(w, (seen.get(w) ?? 0) + 1);
  const common = new Set(
    // A token with no letter (" - ", "&", "24") is punctuation or a number, not a name.
    [...seen].filter(([w, n]) => /[A-Z]/.test(w) && n >= Math.max(MIN_SHEETS, named.length * SHARE) && !CAPTION_WORDS.has(w.replace(/[^A-Z0-9]/g, ""))).map(([w]) => w),
  );
  return titles.map((t) => {
    if (t === null) return null;
    const kept = words(t).filter((w) => !common.has(w.toUpperCase())).join(" ").trim();
    return kept === "" ? null : kept;
  });
}

/** The set-level pass over a plan's keyless titles, once every page has been read. Returns how many changed. */
export async function cleanKeylessTitles(planId: string): Promise<number> {
  const rows = await prisma.planSheetProposal.findMany({
    where: { planId, model: KEYLESS_MODEL, acceptedTitle: null },
    select: { id: true, proposedTitle: true },
    orderBy: { pageNumber: "asc" },
  });
  const cleaned = withoutSetBoilerplate(rows.map((r) => r.proposedTitle));
  let changed = 0;
  for (const [i, row] of rows.entries()) {
    if (cleaned[i] === row.proposedTitle) continue;
    await prisma.planSheetProposal.update({ where: { id: row.id }, data: { proposedTitle: cleaned[i] } });
    changed += 1;
  }
  return changed;
}
