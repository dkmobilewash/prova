import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TAG_MAJORITY, matchClusterToWallType, matchSentence, sameDesignation } from "./wallTypeMatch";
import type { MatchableWallType } from "./wallTypeMatch";

const TYPES: MatchableWallType[] = [
  { id: "wt_w1", code: "W1", name: "⅝″ Type X both sides, 3-5/8 stud", hasParts: true, thicknessIn: null },
  { id: "wt_w2", code: "W-2", name: "One hour, double layer", hasParts: true, thicknessIn: null },
  { id: "wt_ext", code: "EXT-1", name: "Exterior sheathing", hasParts: true, thicknessIn: null },
];

const tagged = (...parts: [string, number][]) => parts.map(([name, feet]) => ({ name, feet }));

describe("matching a detected group to the company's own wall type", () => {
  it("MATCHES on the drawing's own label", () => {
    const match = matchClusterToWallType(tagged(["W1", 283]), TYPES);
    expect(match.state).toBe("MATCH");
    if (match.state !== "MATCH") return;
    expect(match.type.id).toBe("wt_w1");
    expect(match.feet).toBe(283);
    expect(match.share).toBe(1);
  });

  it("treats W-1, W 1 and w1 as the same designation", () => {
    // Which they are on every drawing anybody has sent us.
    expect(matchClusterToWallType(tagged(["W-2", 100]), TYPES).state).toBe("MATCH");
    expect(matchClusterToWallType(tagged(["w 2", 100]), TYPES).state).toBe("MATCH");
    expect(matchClusterToWallType(tagged(["EXT1", 100]), TYPES).state).toBe("MATCH");
  });

  it("DOES NOT confuse W1 with W11, which is a different wall at a different price", () => {
    // The normalisation goes exactly as far as punctuation and no further.
    expect(sameDesignation("W1", "W11")).toBe(false);
    expect(sameDesignation("W1", "WA1")).toBe(false);
    expect(sameDesignation("W1", "1W")).toBe(false);
    expect(matchClusterToWallType(tagged(["W11", 100]), TYPES)).toEqual({ state: "NO_SUCH_TYPE", tag: "W11" });
  });

  it("refuses an empty designation rather than matching everything", () => {
    expect(sameDesignation("", "")).toBe(false);
    expect(sameDesignation("--", "W1")).toBe(false);
  });

  // ── THE THREE REFUSALS, each of which the estimator acts on differently ──

  it("NO_TAG when the drawing named nothing in the group", () => {
    expect(matchClusterToWallType([], TYPES)).toEqual({ state: "NO_TAG" });
    expect(matchClusterToWallType(tagged(["", 50]), TYPES)).toEqual({ state: "NO_TAG" });
    expect(matchClusterToWallType(tagged(["W1", 0]), TYPES), "a name with no length names nothing").toEqual({
      state: "NO_TAG",
    });
  });

  it("NO_SUCH_TYPE names the tag, because that is the actionable gap", () => {
    // The drawing says W9 and this company has no W9. The sheet's partition
    // schedule usually says what W9 is, and `SCHEDULE_ROWS` has already read it.
    expect(matchClusterToWallType(tagged(["W9", 120]), TYPES)).toEqual({ state: "NO_SUCH_TYPE", tag: "W9" });
  });

  it("MIXED rather than guessing when a group spans two types", () => {
    // Two types routinely share a thickness and differ in rating and layers, so
    // the finder can group them together. Pricing it as either prices part of
    // it wrong.
    const match = matchClusterToWallType(tagged(["W1", 100], ["W-2", 95]), TYPES);
    expect(match.state).toBe("MIXED");
    if (match.state !== "MIXED") return;
    expect(match.tags).toEqual(["W1", "W-2"]);
  });

  it("MIXED EVEN WHEN BOTH TYPES EXIST, which is the point", () => {
    // The refusal is not about whether the types are known. It is about which
    // one these feet are.
    const match = matchClusterToWallType(tagged(["W1", 60], ["W-2", 40]), TYPES);
    expect(match.state).toBe("MIXED");
  });

  // ── THE MAJORITY, which is a decision rather than a number ──

  it("MATCHES a group where one name clearly dominates, and says what the rest is", () => {
    // A corner run genuinely sits near two labels — `tagByRun` assigns by
    // proximity — so one stray tag must not cost the whole group.
    const match = matchClusterToWallType(tagged(["W1", 270], ["W-2", 13]), TYPES);
    expect(match.state).toBe("MATCH");
    if (match.state !== "MATCH") return;
    expect(match.type.code).toBe("W1");
    expect(match.share).toBeGreaterThan(TAG_MAJORITY);
    // AND IT SAYS SO. The minority is priced as the majority, which is a real
    // cost and must be on screen rather than discovered in the recap.
    expect(matchSentence(match)).toContain("% of the tagged length here is W1");
  });

  it("REFUSES a bare majority", () => {
    // 60/40 is not identification. A bid is not the place to round.
    const match = matchClusterToWallType(tagged(["W1", 60], ["W-2", 40]), TYPES);
    expect(match.state).toBe("MIXED");
    expect(TAG_MAJORITY).toBeGreaterThan(0.5);
    expect(TAG_MAJORITY).toBeLessThan(1);
  });

  it("does not depend on the input being sorted", () => {
    // `taggedFeetForClusters` sorts by feet, but a caller assembling the list
    // by hand must not get a silently different answer.
    const unsorted = matchClusterToWallType(tagged(["W-2", 13], ["W1", 270]), TYPES);
    expect(unsorted.state).toBe("MATCH");
    if (unsorted.state !== "MATCH") return;
    expect(unsorted.type.code).toBe("W1");
  });

  it("refuses everything when the company has no postable types at all", () => {
    expect(matchClusterToWallType(tagged(["W1", 283]), [])).toEqual({ state: "NO_SUCH_TYPE", tag: "W1" });
  });
});

describe("what it says on screen", () => {
  it("names the TYPE, not just the tag, so the match is checkable", () => {
    const match = matchClusterToWallType(tagged(["W1", 283]), TYPES);
    const sentence = matchSentence(match);
    expect(sentence).toContain("W1");
    expect(sentence, "an estimator has to be able to see WHAT it matched to").toContain("⅝″ Type X both sides");
  });

  it("tells somebody what to DO when the type is missing", () => {
    const sentence = matchSentence({ state: "NO_SUCH_TYPE", tag: "W9" });
    expect(sentence).toContain("no wall type W9");
    expect(sentence, "the actionable half").toContain("partition schedule");
  });

  it("says why a mixed group cannot be priced, and names both", () => {
    const sentence = matchSentence({ state: "MIXED", tags: ["W1", "W-2"] });
    expect(sentence).toContain("W1, W-2");
    expect(sentence).toContain("cannot be priced");
  });

  it("says NOTHING when the drawing named nothing — no sentence is better than a hedge", () => {
    // The group already carries its thickness and footage. A line saying "no
    // tag found" on every untagged group is the permanent notice this app's own
    // rule calls noise that teaches people to stop reading notices.
    expect(matchSentence({ state: "NO_TAG" })).toBeNull();
  });
});

describe("the call site, because no test here can open a PDF", () => {
  // A CENSUS, with its limit stated first. The matcher above is pure and fully
  // exercised; what it cannot prove is that the VIEWER sends the matched type
  // to the action — and mutation showed exactly that hole: deleting the one
  // line that sets `wallTypeId` left all fifteen database cases green, because
  // they call the action directly.
  //
  // This is the shape CLAUDE.md's expo-router entry records: three fixes
  // shipped green while a framework threw the option away, and no census can
  // see delivery. It can see the code is there, which is the half worth having
  // when the other half needs pdf.js, a real document and a canvas.

  const viewer = () => readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
  /**
   * The pipeline, which is where the grouping went.
   *
   * TWO READERS, because this block asks two different questions. Whether the
   * SUBMIT sends the type it promised is a fact about the component; how the
   * groups are built is a fact about the pipeline, and that moved out of the
   * component when `findWallsOnSheet` was lifted so the bench and the server
   * could run it too. Pointing both at one file would make half these cases
   * assert against a file that cannot contain the answer.
   */
  const pipeline = () => readFileSync(resolve(process.cwd(), "lib/takeoff/findWallsOnSheet.ts"), "utf8");

  it("SENDS THE TYPE IT PROMISED, which is what makes the group arrive priced", () => {
    const text = viewer();
    expect(text, "the resolved type is never sent, so nothing is ever priced").toContain(
      'body.set("wallTypeId", priced.id)',
    );
    // ONLY WHERE ONE WAS RESOLVED. Every other state is a refusal this
    // component must not overrule, and an unguarded `set` would post a group
    // the drawing never named against whatever type happened to be first.
    expect(text).toContain("if (priced) body.set(\"wallTypeId\", priced.id)");
  });

  it("READS THE BUTTON AND THE SUBMIT FROM ONE FUNCTION", () => {
    // ── THE FAILURE THIS REPLACES A WEAKER ASSERTION WITH ──
    //
    // The button's words and the form's `wallTypeId` are two readings of the
    // same question. The way that goes wrong is a button promising "priced"
    // over a submit that sends nothing — a bid short by a whole group, with
    // the screen saying otherwise. One function, read by both, makes the two
    // unable to disagree rather than merely expected to agree.
    const text = viewer();
    expect(text).toContain("function pricedTypeFor(");
    // BOTH CALL SITES, COUNTED. `toContain` cannot tell them apart — they are
    // the same string — so replacing the PANEL's copy with a literal left this
    // green while the button promised a price the submit never sent. Found by
    // mutation. Two is the whole population: the panel and the submit.
    expect(
      text.split("pricedTypeFor(group, chosen[index])").length - 1,
      "the button and the submit no longer read the same value",
    ).toBe(2);
    // And the button's words come from that value rather than from anything
    // computed beside it.
    expect(text).toContain("`Add as ${priced.code} — priced`");
  });

  /** The same source with every run of whitespace collapsed to one space. */
  const flat = (text: string) => text.replace(/\s+/g, " ");

  it("SPLITS THE GROUPS BY TAG BEFORE SHOWING ANY OF THEM", () => {
    // A thickness bucket is not one wall type — School-01's 4-7/8in bucket
    // held A1, A2, EXT-1 and C1, and 1,117 ft that could be priced as nothing.
    //
    // MATCHED WITH THE WHITESPACE COLLAPSED, because this call now lives in a
    // named closure the viewer rebuilds the panel with — once when the walls
    // are found and again when some of them are labelled casework, so the two
    // lists cannot be grouped differently. Pinning the formatting rather than
    // the call made this census fail on a change that kept every argument.
    const text = flat(pipeline());
    expect(text).toContain(
      "wallGroups( clusterByThickness(runs), tagByRun(runs, tags, feetPerUnit, wallTypes), wallTypes, fromNote, )",
    );
  });

  it("READS THE SHEET'S GENERAL NOTES AND HANDS THEM TO THE GROUPER", () => {
    // `fromNote` is an OPTIONAL fourth argument to `wallGroups`. Leaving it off
    // compiles, passes every unit test of the note reader, and silently returns
    // the panel to asking which of A1, A2 or C1 the biggest group on the sheet
    // is — 556 ft of School-01's A-101. Mutation-tested; blind without this.
    const text = pipeline();
    expect(text).toMatch(/defaultWallTypeFromNotes\(textItems, wallTypes\)/);
    expect(flat(text)).toMatch(/wallGroups\(\s*clusterByThickness\(runs\), tagByRun\(runs, tags, feetPerUnit, wallTypes\), wallTypes, fromNote,?\s*\)/);
  });

  it("PRICES A GROUP THE NOTE NAMED, so the answer reaches the button", () => {
    // Reading the note and then refusing to act on it would be the same group
    // with a longer sentence.
    expect(viewer()).toMatch(/verdict\.state === "BY_GENERAL_NOTE"/);
  });

  it("HANDS THE TAGGER THE WALL TYPES, which is the half of the evidence it used to drop", () => {
    // `tagByRun` takes the types as an OPTIONAL fourth argument, so leaving it
    // off compiles, passes every unit test of the tagger, and silently restores
    // nearest-wins on the real sheet — mutation-tested, and blind until this
    // case existed. Measured on A-101: without it an EXT-1 tag takes a 4-7/8"
    // run 0.47 ft away over the 8-7/8" wall at 2.32 ft.
    const text = pipeline();
    expect(text, "the pipeline calls tagByRun without its wall types").not.toMatch(
      /tagByRun\(runs, tags, feetPerUnit\)/,
    );
    expect(flat(text)).toMatch(/tagByRun\(runs, tags, feetPerUnit, wallTypes\)/);
  });

  it("NEVER DEFAULTS THE ANSWER TO A QUESTION IT ASKED", () => {
    // An `ASK` group has two types that a floor plan cannot choose between.
    // Picking the first would be a coin flip printed as an answer, and the
    // footage would look right.
    const text = viewer();
    expect(text).toContain("verdict.types.find((type) => type.id === pick) ?? null");
    expect(text, "the chooser offers no pre-selected type").toContain('value={chosen[index] ?? ""}');
  });

  it("SAYS on the button what it is about to do", () => {
    // A button reading "Add these" that silently prices a group is worse than
    // one that does not: the estimator cannot tell which groups went onto the
    // estimate as money and which went on as quantities.
    const text = viewer();
    expect(text).toContain("priced");
    expect(text).toContain("Add these");
  });

  it("CARRIES THE RESOLVED TYPE'S OWN CODE into the measurement label", () => {
    // `4⅞" wall` is what the app measured; `A1 wall` is what the drawing calls
    // it, and it is what an estimator looks for in the list and on the recap.
    //
    // THE LABEL FOLLOWS `named`, NOT `priced`, and that is the change this case
    // was rewritten for rather than relaxed to admit. A type imported from a
    // partition schedule has a thickness and no layers, so it can name a group
    // and not price one; reading the label off the priced type would throw the
    // drawing's own word away in exactly the case where reading the schedule
    // just supplied it.
    const text = viewer();
    expect(text).toContain("${named.code} wall");
    expect(text, "the label is read off the priced type again").not.toContain("${priced.code} wall");
  });

  it("PRICES ONLY A TYPE WITH PARTS, and the button and the form read one function", () => {
    // The invariant the old comment protected: the words on the button and the
    // `wallTypeId` on the form are two readings of the same question. Both go
    // through `pricedTypeFor`, which is now `namedTypeFor` plus `hasParts`.
    const text = viewer();
    expect(text).toMatch(/return named !== null && named\.hasParts \? named : null;/);
    expect(text).toContain('body.set("wallTypeId", priced.id)');
  });

  it("RENDERS THE REASON, and every reason says where it came from", () => {
    const text = viewer();
    expect(text).toContain("groupSentence(group, verdict)");
  });
});

/**
 * ── WHICH LIST THE PAGE HANDS THE MATCHER, WHICH IS WHERE THE DEFECT LIVED ──
 *
 * Every other case in this file reasons about the matcher and the viewer. The
 * bug was in neither: the takeoff page queried `components: { some: {} }` and
 * handed the result to the wall finder, so ten wall types read off School-01's
 * partition schedule were not in the list the matcher was given. The matcher
 * was correct about the list it had. The viewer was correct about the list it
 * had. The list was wrong.
 *
 * FOUND BY MUTATION, NOT BY REVIEW. With the fix in place, reverting that one
 * prop back to `postableWallTypes` restores the defect exactly — and every
 * test in this repo stayed green, because nothing here could see the page.
 * CLAUDE.md's sentence for it: nothing is ever missing from a list nobody
 * imports.
 *
 * A census is the right instrument here rather than a fallback. The question is
 * not what a function computes, it is which of two values is wired to a prop,
 * and that is a fact about the source. It cannot tell you the page RUNS — the
 * pilot journey does that — only that it is still wired this way.
 */
describe("the takeoff page's two wall-type lists", () => {
    // ── THE QUERY MOVED, THE JSX DID NOT, 2026-10-16 ──
    //
    // `loadTakeoffWorkspace` holds everything `TakeoffPlanViewer` needs, so
    // the full-screen workspace at `/takeoff/[id]` and this tab load it once
    // and only render differently. A census of the COMPUTATION therefore reads
    // the loader; a census of a PROP still reads the page that passes it.
    //
    // Both halves are kept deliberately. Reading only the loader would stop
    // noticing a page that computes the value and forgets to hand it over,
    // which is the defect the prop assertions were written for.
  /**
   * ── THE QUERY MOVED, THE JSX DID NOT, 2026-10-16 ──
   *
   * `loadTakeoffWorkspace` holds everything `TakeoffPlanViewer` needs, so the
   * full-screen workspace at `/takeoff/[id]` and this tab load once and differ
   * only in what they render. A census of the COMPUTATION reads the loader; a
   * census of a PROP reads the page that passes it.
   *
   * Both, deliberately. Reading only the loader would stop noticing a page
   * that computes a value and forgets to hand it over, which is the defect
   * these prop assertions exist for — and there are two such pages now.
   */
  const loader = readFileSync(resolve(process.cwd(), "lib/takeoff/workspaceLoad.ts"), "utf8");
  const page = () =>
    readFileSync(resolve(process.cwd(), "app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx"), "utf8");
  const code = () =>
    page().replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  /** The QUERY lives in the loader both takeoff pages share — see the note
   *  above `loader`. Comments stripped for the same reason `code()` strips
   *  them: this file's own prose quotes the patterns it forbids. */
  const loaderCode = () =>
    loader.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("QUERIES EVERY TYPE, so a schedule-imported one is not invisible", () => {
    const text = loaderCode();
    expect(text, "the wall-type query filters by components again").not.toMatch(
      /findMany\(\{\s*where: \{ companyId: company\.id, components:/,
    );
    expect(text).toMatch(/const allWallTypes = await prisma\.wallType\.findMany/);
    expect(text).toMatch(/_count: \{ select: \{ components: true \} \}/);
  });

  it("GIVES THE WALL FINDER THE WHOLE LIST — the defect, as shipped", () => {
    // The single line that was wrong. Reverting it to `postableWallTypes` is
    // the mutation that used to pass every test in the repo.
    expect(code()).toMatch(/wallTypes=\{allWallTypes\.map/);
    expect(code(), "the finder is back on the filtered list").not.toMatch(
      /wallTypes=\{postableWallTypes\.map\(\(type\) => \(\{\s*id: type\.id,\s*code: type\.code,\s*name: type\.name,\s*hasParts/,
    );
  });

  it("STILL GATES POSTING ON LAYERS, which is the guard that was moved not dropped", () => {
    // If this stops filtering, a measurement can be posted against a type that
    // produces no line items — the thing the original query was right about.
    expect(loaderCode()).toMatch(
      /const postableWallTypes = allWallTypes\.filter\(\(type\) => type\._count\.components > 0\);/,
    );
  });

  it("hands the MEASUREMENT LIST the postable list, not every type", () => {
    // The other consumer, which posts wall runs and must keep the old rule.
    expect(code()).toMatch(/wallTypes=\{postableWallTypes\.map/);
  });

  it("READ A REAL FILE, so a path that stopped resolving fails loudly", () => {
    // The size assertion this family needs: a census over an empty string
    // passes every `not.toMatch` above it.
    expect(page().length).toBeGreaterThan(2000);
    expect(page()).toContain("TakeoffPlanViewer");
  });
});
