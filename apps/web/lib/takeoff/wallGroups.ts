import { CLUSTER_INCHES, inchLabel, type WallCandidate, type WallCluster } from "./wallVectors";
import type { WallTypeFromNote } from "./wallNotes";
import { sameDesignation, type MatchableWallType } from "./wallTypeMatch";

/**
 * ── A THICKNESS GROUP IS NOT ONE WALL TYPE, AND ON A REAL SHEET IT RARELY IS ──
 *
 * The panel has grouped detected walls by thickness since the finder shipped,
 * and it reports the drawing's own tags beside each group. On School-01 the
 * biggest group read:
 *
 *     4-7/8"  ·  A1 / A2 / EXT-1 / C1  ·  41 runs · 1,117 ft
 *     "names more than one type in this group, so it cannot be priced as one"
 *
 * That is 58% of the sheet's footage stopping at plain measurements — the
 * single largest thing between "upload your plans" and "here is a priced bid".
 * And the refusal was right: pricing that group as A1 prices the A2, EXT-1 and
 * C1 runs inside it wrongly.
 *
 * The group is wrong, not the refusal. So this splits it.
 *
 * ── TAG FIRST, THEN THICKNESS, THEN ASK ──
 *
 * Two sources of truth, and they are not equal:
 *
 *   1. A TAG IS AN IDENTITY. The drafter printed `A1` beside that wall. Runs
 *      carrying a clear tag become their own group and are matched by name,
 *      which is what `wallTypeMatch.ts` already does and trusts enough to price
 *      from.
 *   2. A THICKNESS IS A SHORTLIST. It narrows the candidates and, where exactly
 *      one of the company's types is that thick, it identifies one. Where two
 *      are — A1 and A2 are BOTH 4-7/8" on this very sheet, differing by fire
 *      rating, which a floor plan cannot show — it identifies nothing and the
 *      person is asked.
 *
 * That ordering is the whole safety argument. Thickness never overrules a tag,
 * and it never guesses between two types; it only speaks where the drawing was
 * silent and the answer is unique.
 *
 * ── WHY THE REMAINDER IS MOST OF THE SHEET ──
 *
 * An architect tags REPRESENTATIVE walls, not every wall. Measured on two pages
 * of a real set, 25-43% of footage carries a tag at all. So splitting by tag
 * alone would leave the majority of every sheet unpriced — which is why the
 * partition schedule (#731) had to land first. It is what gives the untagged
 * remainder a thickness to be looked up by.
 *
 * Pure. No database, no React.
 */

/** Where a group's identity came from. The estimator is told which, because
 *  the two carry different weight and a reader should not have to guess. */
export type GroupSource =
  /** The drawing printed this name beside these runs. */
  | { kind: "TAG"; tag: string }
  /** Nothing named them; they are what is left of a thickness group. */
  | { kind: "REMAINDER" }
  /**
   * Nothing named them BESIDE the runs, but the sheet's general notes name a
   * default for everything untagged — "ALL PARTITIONS TYPE A1 U.N.O." — and
   * these measure like that type.
   *
   * A separate kind from TAG on purpose. A tag is printed beside the wall it
   * names; a note covers whatever is left, which is weaker evidence and has to
   * read as weaker on screen. It is still far better than the question the
   * panel used to ask: on School-01's A-101 this is 577 ft, 30% of the sheet,
   * that was being offered as A1, A2 or C1 with nothing to choose between them.
   */
  | { kind: "GENERAL_NOTE"; note: string };

export type WallGroup = {
  /** The thickness bucket these came from, unchanged — still what is drawn on
   *  the sheet and still what the colour key shows. */
  inches: number;
  runs: WallCandidate[];
  feet: number;
  source: GroupSource;
  /** The company's types this group could be. One is an answer; several is a
   *  question; none is a plain measurement. */
  candidates: MatchableWallType[];
  /**
   * The takeoff item this group proposes into, when detection matched one.
   *
   * Optional, and null on everything `wallGroups` builds fresh — a group being
   * found and a group being ASSIGNED are two different moments, and only the
   * stored row knows about the second. A null shows under "Unassigned walls".
   */
  itemId?: string | null;
};

/**
 * How far a company's stated thickness may sit from a measured one.
 *
 * HALF THE CLUSTER WIDTH, derived rather than chosen — a group IS a bucket
 * `CLUSTER_INCHES` wide, so a type belongs to it exactly when its thickness
 * falls inside it. Two consequences worth stating: a type cannot belong to two
 * adjacent buckets, and if clustering is ever retuned this follows it instead
 * of silently disagreeing.
 *
 * It also clears the measurement noise it has to. `A1` measured 4.75, 4.75,
 * 4.75 and 5.00 inches across four pages of one set against a schedule value of
 * 4.875 — the worst of those is 0.125 out, half of this.
 */
export const THICKNESS_SLACK_IN = CLUSTER_INCHES / 2;

/** A U.N.O. sentence about the filled walls — "ALL INTERIOR MASONRY PARTITIONS ARE TYPE 'B'". */
export const MASONRY_NOTE = /\b(MASONRY|CMU|CONCRETE|BLOCK|BRICK)\b/i;

/** The company's postable types that could be a wall of this thickness. */
export function typesAtThickness(
  inches: number,
  wallTypes: readonly MatchableWallType[],
): MatchableWallType[] {
  return wallTypes.filter(
    (type) =>
      type.thicknessIn !== null && Math.abs(type.thicknessIn - inches) <= THICKNESS_SLACK_IN,
  );
}

/**
 * Split each thickness cluster by the drawing's own tags, and give every piece
 * the types it could be.
 *
 * A cluster becomes one group per tag found in it, plus one for whatever
 * carries no tag.
 *
 * ── LARGEST FIRST, ACROSS THE WHOLE SHEET ──
 *
 * This used to order per cluster — tagged groups first, remainder last — and
 * the first real sheet to run through it showed why that is wrong. Splitting
 * multiplies the rows: School-01's eight groups became seventeen, the panel
 * shows a fixed number of them, and the cut landed by cluster order rather than
 * by size. **488 ft, 26% of the sheet, fell below the fold** — and some of what
 * was hidden was LARGER than what was shown.
 *
 * So the list is a work queue rather than a summary, and a work queue is
 * ordered by what matters most. A tagged group wins a tie with the remainder it
 * came from, because a name is a better answer than a thickness.
 *
 * A cluster nobody tagged comes back as a single REMAINDER group, which is the
 * common case and is why this cannot simply refuse an untagged run.
 */
export function wallGroups(
  clusters: readonly WallCluster[],
  tagByRun: ReadonlyMap<WallCandidate, string>,
  wallTypes: readonly MatchableWallType[],
  fromNote: WallTypeFromNote | null = null,
  /**
   * Runs drawn with hatch strokes across their band — a filled wall. A
   * hatched run never takes a default whose sentence is about drywall, and
   * an unhatched one never takes a masonry default (`stageGroups.ts`).
   */
  hatched: ReadonlySet<WallCandidate> = new Set(),
): WallGroup[] {
  const out: WallGroup[] = [];
  for (const cluster of clusters) {
    const byTag = new Map<string, WallCandidate[]>();
    const untaggedPlain: WallCandidate[] = [];
    const untaggedHatched: WallCandidate[] = [];
    for (const run of cluster.runs) {
      const tag = tagByRun.get(run);
      if (tag === undefined) {
        (hatched.has(run) ? untaggedHatched : untaggedPlain).push(run);
        continue;
      }
      const group = byTag.get(tag);
      if (group) group.push(run);
      else byTag.set(tag, [run]);
    }

    const tagged = [...byTag.entries()].map(([tag, runs]) => ({
        inches: cluster.inches,
        runs,
        feet: feetOf(runs),
        source: { kind: "TAG", tag } as const,
        // A TAG IS AN IDENTITY, so the candidate list is whatever carries that
        // code — never narrowed by thickness as well. If the drawing says A1
        // and the company's A1 is recorded at a different thickness, that is
        // worth a person's attention and is not something to silently drop:
        // the thickness on file may be the thing that is wrong.
      candidates: wallTypes.filter((type) => sameDesignation(type.code, tag)),
    }));

    out.push(...tagged);
    for (const [untagged, isHatched] of [[untaggedPlain, false], [untaggedHatched, true]] as const) {
      if (untagged.length === 0) continue;
      // ── THE GENERAL NOTE'S TYPE IS OFFERED FIRST — NEVER APPLIED ──
      //
      // "ALL PARTITIONS TYPE A1 U.N.O." covers whatever the architect did not
      // tag, and this used to price the group as A1 with nothing to click.
      // Now A1 LEADS the picker (`verdictFor` returns ASK with it as
      // `suggested`) and the group is priced only once a person picks it.
      //
      // It still does NOT reach a wall of a different thickness: the 6-5/8"
      // exterior runs and the 10-1/4" chase on School-01's A-101 are untagged
      // too, and a different thickness IS a notation — the note's own
      // "unless noted otherwise". A type with NO recorded thickness is offered,
      // because offering is not applying.
      // Whichever of the legend's defaults (drywall A, masonry B) is this thick,
      // where the sheet's own note is not the one.
      // Each default covers its OWN thickness only — a different thickness IS
      // a notation, the note's own "unless noted otherwise". Joplin names a
      // default per family (drywall A at 4-7/8 in, masonry B at 7-5/8 in), and
      // the nearer family was tried for the buckets between: wrong, because
      // its 6 in stud partition (A3, 7-1/4 in) is a CMU wall's thickness. So
      // those buckets stay a question, which `verdictFor` asks.
      const defaults = fromNote === null ? [] : [fromNote, ...(fromNote.others ?? [])];
      const covers = (n: WallTypeFromNote) => n.type.thicknessIn === null || Math.abs(n.type.thicknessIn - cluster.inches) <= THICKNESS_SLACK_IN;
      // A hatched band is a filled wall: only a masonry sentence names it,
      // and a masonry sentence names nothing drawn hollow.
      const forThisFill = (n: WallTypeFromNote) => MASONRY_NOTE.test(n.note) === isHatched;
      const note = defaults.find((n) => covers(n) && forThisFill(n)) ?? null;
      const atThickness = typesAtThickness(cluster.inches, wallTypes);
      out.push({
        inches: cluster.inches,
        runs: untagged,
        feet: feetOf(untagged),
        source: note !== null ? { kind: "GENERAL_NOTE", note: note.note } : { kind: "REMAINDER" },
        candidates: note !== null ? [note.type, ...atThickness.filter((t) => t.id !== note.type.id)] : atThickness,
      });
    }
  }
  // Largest first, across every cluster. A tie goes to the named group, then to
  // the tag's own spelling so the order cannot wander between runs.
  return out.sort(
    (a, b) =>
      b.feet - a.feet ||
      Number(b.source.kind === "TAG") - Number(a.source.kind === "TAG") ||
      (a.source.kind === "TAG" ? a.source.tag : "").localeCompare(
        b.source.kind === "TAG" ? b.source.tag : "",
      ),
  );
}

function feetOf(runs: readonly WallCandidate[]): number {
  return runs.reduce((sum, run) => sum + run.lengthFeet, 0);
}

/** What a group is, once its candidates are counted. */
export type GroupVerdict =
  /** One type, and the drawing named it. Price it. */
  | { state: "NAMED"; type: MatchableWallType; tag: string }
  /**
   * The drawing names a type this company HAS, and the wall is not the
   * thickness that type is recorded as. Two sources disagree; neither is
   * overruled here.
   */
  | { state: "TAG_DISAGREES"; type: MatchableWallType; tag: string }
  /** One type, from the thickness alone, because nothing named these. */
  | { state: "ONLY_ONE_THAT_THICK"; type: MatchableWallType }
  /** Several types are this thick, or the sheet's general notes name a
   *  default for everything untagged (`suggested`, listed first, with the
   *  `note` quoted). Only a person can say which. */
  | { state: "ASK"; types: MatchableWallType[]; suggested?: MatchableWallType; note?: string }
  /** The drawing names a type this company does not have. */
  | { state: "NO_SUCH_TYPE"; tag: string }
  /** Nothing named them and nothing in the library is that thick. */
  | { state: "UNKNOWN" };

/**
 * ── THE TYPE A GROUP IS SETTLED AS, WITH NOBODY ASKED ──
 *
 * NAMED and ONLY_ONE_THAT_THICK always were. TAG_DISAGREES joins them: the
 * drawing printed the name, and a legend's thickness (stud plus board) is
 * routinely not what is drawn — ICF, furring, finishes — so the tag wins and
 * the disagreement is SAID beside it rather than used to withhold a price.
 * The sentence carries both numbers and the row offers to move the library's
 * figure to what is drawn (`setWallTypeThickness`). Only an UNTAGGED group is
 * ever matched by thickness. One function for the button and the submit, so
 * the words and the form cannot disagree.
 */
export function settledType(verdict: GroupVerdict): MatchableWallType | null {
  return verdict.state === "NAMED" || verdict.state === "ONLY_ONE_THAT_THICK" || verdict.state === "TAG_DISAGREES"
    ? verdict.type
    : null;
}

export function verdictFor(group: WallGroup): GroupVerdict {
  if (group.source.kind === "TAG") {
    const [type] = group.candidates;
    // More than one type sharing a CODE cannot happen — `WallType` is unique
    // on (companyId, code) — so the first is the only one.
    if (!type) return { state: "NO_SUCH_TYPE", tag: group.source.tag };
    // ── WHEN THE NAME AND THE MEASUREMENT DISAGREE ──
    //
    // A click-through on School-01 found `B1` reported at three thicknesses at
    // once and `EXT-1` at two. One assembly is not three thicknesses, so one of
    // two things is true of each of those groups, and they need opposite
    // responses:
    //
    //   - the tag is on the WRONG RUN. `tagByRun` assigns by proximity, and on
    //     a dense sheet the nearest detected run to a label is not always the
    //     wall it names. Pricing that run as B1 prices the wrong assembly.
    //   - the LIBRARY's thickness is wrong, or the wall is drawn with extra
    //     line work where this one was measured.
    //
    // Until #731 there was no thickness on a `WallType` and this contradiction
    // could not be seen at all. Now both numbers exist, so it can be stated —
    // and it is stated rather than resolved, because the app has no evidence
    // for which source is wrong and guessing would price a wall by coin flip.
    //
    // A type with NO recorded thickness is exempt: null means "cannot be
    // matched by thickness", and reading it as a disagreement would refuse
    // every library typed in before that column existed.
    const disagrees =
      type.thicknessIn !== null && Math.abs(type.thicknessIn - group.inches) > THICKNESS_SLACK_IN;
    return disagrees
      ? { state: "TAG_DISAGREES", type, tag: group.source.tag }
      : { state: "NAMED", type, tag: group.source.tag };
  }
  // THE SHEET'S OWN DEFAULT, which is a named answer rather than an inference
  // from thickness — and a weaker one than a tag, which is why it is its own
  // state and gets its own sentence.
  if (group.source.kind === "GENERAL_NOTE" && group.candidates.length >= 1) {
    return { state: "ASK", types: group.candidates, suggested: group.candidates[0], note: group.source.note };
  }
  if (group.candidates.length === 1) return { state: "ONLY_ONE_THAT_THICK", type: group.candidates[0] };
  if (group.candidates.length > 1) return { state: "ASK", types: group.candidates };
  return { state: "UNKNOWN" };
}

/**
 * The sentence beside a group.
 *
 * Every one of them says WHERE the answer came from, because a name read off
 * the drawing and a name inferred from a thickness are different kinds of claim
 * and an estimator pricing a bid is entitled to know which they are looking at.
 */
/**
 * A type's code, carrying its own recorded thickness where that differs from
 * what the walls measured.
 *
 * ── THE SENTENCES USED TO SAY THE TYPE WAS THE GROUP'S THICKNESS ──
 *
 * Both read `… wall types at ${inchLabel(group.inches)} (A1, A2, C1)`, which
 * states the group's MEASURED number and attributes it to the TYPES. They are
 * only ever matched within `THICKNESS_SLACK_IN`, so that claim can be wrong by
 * up to a quarter inch — and on School-01's A-101 it was wrong twice on one
 * screen, caught by somebody reading the panel against the schedule:
 *
 *   "B1 is the only wall type you have at 7-3/8""   — B1 is recorded at 7-1/4"
 *   "3 wall types at 4-7/8" (A1, A2, C1)"           — C1 is recorded at 4-3/4"
 *
 * Neither number was wrong on its own; the sentence joining them was. An
 * estimator checking the panel against the partition schedule finds a
 * contradiction the app invented, which is the fastest way to lose their trust
 * in every other number on the screen.
 *
 * THE NULL BRANCH IS UNREACHABLE TODAY and is written down as such rather than
 * trusted. Both sentences that call this take their candidates from
 * `typesAtThickness`, which drops a type with no thickness — so nothing can
 * arrive here with one, and a mutation deleting that branch stays GREEN.
 * It is kept because `MatchableWallType.thicknessIn` IS nullable and removing
 * the branch means asserting non-null, which is a worse lie than a line that
 * never runs. If a name-filtered candidate list ever reaches these sentences,
 * this is what stops "A1 at NaN" reaching a bid.
 *
 * THE CONDITION IS WHAT THE READER WOULD SEE, not a tolerance of its own: the
 * thickness is spelled out exactly when `inchLabel` would render it
 * differently. So the sentence never says "B1, recorded at 7-3/8"" beside
 * "they measure 7-3/8"", and never hides a difference the reader could check.
 */
function named(type: MatchableWallType, groupInches: number): string {
  const tail = type.summary ? ` (${type.summary})` : "";
  if (type.thicknessIn === null) return `${type.code}${tail}`;
  const mine = inchLabel(type.thicknessIn);
  return (mine === inchLabel(groupInches) ? type.code : `${type.code} at ${mine}`) + tail;
}

/** One line for a picker option: code, name, and what tells it from its neighbours. */
export function typeOptionLabel(type: MatchableWallType): string {
  return `${type.code} — ${type.name}${type.summary ? ` · ${type.summary}` : ""}`;
}

/**
 * ── WHAT AN UNPRICED GROUP MAY BECOME, and the order it is offered in ──
 *
 * "Add these" used to write plain measurements with nothing said; 36 of them
 * on Baker's A101, in Unassigned, and nothing on the estimate. Now a group
 * with no priced type ASKS, and the first answer is a type: the verdict's own
 * candidates lead (the sheet's note first when there is one), then every
 * other type with parts, then "create a type from this group", then plain
 * measurements — last, because they are the step that prices nothing.
 */
export type GroupChoice =
  | { kind: "type"; type: MatchableWallType; why: "candidate" | "note" | "tag" | "other" }
  | { kind: "create" }
  | { kind: "plain" };

export function groupChoices(verdict: GroupVerdict, wallTypes: readonly MatchableWallType[]): GroupChoice[] {
  const lead: GroupChoice[] = [];
  const seen = new Set<string>();
  const push = (type: MatchableWallType, why: "candidate" | "note" | "tag" | "other") => {
    if (seen.has(type.id)) return;
    seen.add(type.id);
    lead.push({ kind: "type", type, why });
  };
  if (verdict.state === "ASK") {
    if (verdict.suggested) push(verdict.suggested, "note");
    for (const t of verdict.types) push(t, "candidate");
  }
  if (verdict.state === "TAG_DISAGREES") push(verdict.type, "tag");
  for (const t of wallTypes) if (t.hasParts) push(t, "other");
  return [...lead, { kind: "create" }, { kind: "plain" }];
}


export function groupSentence(group: WallGroup, verdict: GroupVerdict): string | null {
  switch (verdict.state) {
    case "NAMED":
      // ── AND WHETHER IT CAN BE PRICED, WHICH IS A SECOND FACT ──
      //
      // A type imported from a partition schedule arrives with its thickness
      // and no layers, so it can name a group and not price one. Saying only
      // the first half leaves an estimator with a button that writes plain
      // measurements for a reason nothing on the screen states — which is what
      // happened on School-01, where the app had just read A1 off A-501 and
      // then declined to use it without ever saying why.
      return verdict.type.hasParts
        ? `The drawing tags these ${verdict.tag}, which is your ${verdict.type.code} — ${verdict.type.name}.`
        : `The drawing tags these ${verdict.tag}, which is your ${verdict.type.code} — ${verdict.type.name}. ` +
          `It has no parts on it yet, so these can be added as measurements but not priced — put the studs, ` +
          `track and board on ${verdict.type.code} under Wall types and they will price themselves.`;
    case "ONLY_ONE_THAT_THICK":
      return (
        `Nothing on the drawing names these. They measure ${inchLabel(group.inches)}, and the only ` +
        `wall type you have near that is ${named(verdict.type, group.inches)} — so that is what they ` +
        `would be priced as — check one against the drawing first.`
      );
    case "ASK":
      // THE NOTE IS QUOTED, not summarised. It is the whole of the evidence and
      // it covers more footage than any tag on the sheet — 577 ft of A-101 —
      // so an estimator reads the sentence the architect wrote and judges it,
      // and the app offers rather than concludes.
      if (verdict.suggested && verdict.note) {
        return (
          `Nothing is tagged beside these, but this sheet's general notes say ` +
          `“${verdict.note}” — so ${verdict.suggested.code} is offered first. ` +
          `Pick it to price them that way, or another type; nothing is priced until you do.`
        );
      }
      return (
        `Nothing on the drawing names these. They measure ${inchLabel(group.inches)}, and you have ` +
        `${verdict.types.length} wall types near that: ` +
        `${verdict.types.map((type) => named(type, group.inches)).join(", ")}. ` +
        `They differ in ways a floor plan cannot show, so pick one.`
      );
    case "TAG_DISAGREES":
      return (
        `The drawing tags these ${verdict.tag}, which is your ${verdict.type.code} — ${verdict.type.name}. ` +
        `They are drawn ${inchLabel(group.inches)} and your ${verdict.type.code} is on file at ` +
        `${inchLabel(verdict.type.thicknessIn ?? 0)}; the tag wins, so they price as ${verdict.type.code}. ` +
        `A legend's thickness is the studs and board, and the drawn wall may carry furring or finishes — ` +
        `or the tag may belong to the wall beside these. Check one on the drawing.`
      );
    case "NO_SUCH_TYPE":
      return (
        `The drawing tags these ${verdict.tag}, and you have no wall type ${verdict.tag} with layers on it. ` +
        `This sheet's partition schedule usually says what ${verdict.tag} is — read it on the Takeoff tab and ` +
        `add these types, or add these as plain measurements.`
      );
    case "UNKNOWN":
      return (
        `Nothing on the drawing names these and no wall type you have is ${inchLabel(group.inches)} thick. ` +
        `They can be added as plain measurements and priced by hand.`
      );
  }
}

/**
 * THE FOUND WALLS A GIVEN SHEET IS ALLOWED TO SHOW.
 *
 * A proposal belongs to the sheet it was read off. This is the one place that
 * says so, and both the results panel and the ghost overlay go through it —
 * which is the point: the bug it closes was two render sites reading a single
 * page-less variable, so neither of them was wrong on its own.
 *
 * Reported 2026-10-11 with three screenshots: Find the walls was pressed on a
 * floor plan, and the identical dashed overlay then appeared on sheet 30, on
 * sheet 52 and on S-101 — every run in the same place, on drawings it had
 * nothing to do with. Two of those are the partition-types sheet, whose own
 * scale is 3" = 1'-0", so the footage those lines implied was nonsense.
 *
 * HERE RATHER THAN IN THE VIEWER because `lib/client-boundary.test.ts` refuses
 * a non-component value imported out of a "use client" module: across the RSC
 * boundary that arrives as a client-reference proxy and not the function. It
 * was written in the viewer first and that guard caught it.
 */
export function wallsOnThisSheet(
  found: WallGroup[] | null,
  foundOnPage: number | null,
  pageNumber: number,
): WallGroup[] | null {
  if (found === null || foundOnPage !== pageNumber) return null;
  return found;
}

/**
 * THE STORED WALLS A SHEET MAY BE SEEDED WITH, or null when there are none.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A LOOKUP INSIDE THE EFFECT ──
 *
 * It was a lookup inside the effect, and a mutation showed nothing could see
 * it: keying the read to page 1 instead of to the page being viewed left every
 * test green. It had to, for a reason worth writing down rather than working
 * around — `TakeoffPlanViewer` opens on page 1 and its pager only renders once
 * a real PDF has reported `numPages`, which never happens in a DOM test. So no
 * rendered test can put the viewer on page 2, and the page-keying was
 * unobservable from outside.
 *
 * That is the same shape as `wallsOnThisSheet` above, which exists because two
 * render sites read one page-less variable. Pulling the decision out gives it a
 * caller a test can be, which is this file's answer both times.
 *
 * It lives HERE and not in the viewer for the reason `wallsOnThisSheet` does:
 * `lib/client-boundary.test.ts` refuses a non-component value imported out of a
 * "use client" module, because across the RSC boundary that arrives as a
 * client-reference proxy rather than the function.
 */
export function storedWallsFor(
  byPage: Record<number, WallGroup[]> | undefined,
  pageNumber: number,
): WallGroup[] | null {
  const stored = byPage?.[pageNumber];
  // AN EMPTY LIST IS NOTHING TO SHOW, not an empty result to display. A sheet
  // with no stored walls and a sheet whose stored list is empty are the same
  // fact, and seeding `[]` would replace "press to look" with "none found".
  if (stored === undefined || stored.length === 0) return null;
  return stored;
}
