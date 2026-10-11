import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TAG_MAJORITY, matchClusterToWallType, matchSentence, sameDesignation } from "./wallTypeMatch";
import type { PostableWallType } from "./wallTypeMatch";

const TYPES: PostableWallType[] = [
  { id: "wt_w1", code: "W1", name: "⅝″ Type X both sides, 3-5/8 stud", thicknessIn: null },
  { id: "wt_w2", code: "W-2", name: "One hour, double layer", thicknessIn: null },
  { id: "wt_ext", code: "EXT-1", name: "Exterior sheathing", thicknessIn: null },
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

  it("SPLITS THE GROUPS BY TAG BEFORE SHOWING ANY OF THEM", () => {
    // A thickness bucket is not one wall type — School-01's 4-7/8in bucket
    // held A1, A2, EXT-1 and C1, and 1,117 ft that could be priced as nothing.
    const text = viewer();
    expect(text).toContain("wallGroups(clusters, tagByRun(walls, tags, feetPerUnit), wallTypes)");
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
    // `4⅞" wall` is what the app measured; `A1 wall` is what it will be priced
    // as, and it is what an estimator looks for in the list and on the recap.
    const text = viewer();
    expect(text).toContain("${priced.code} wall");
  });

  it("RENDERS THE REASON, and every reason says where it came from", () => {
    const text = viewer();
    expect(text).toContain("groupSentence(group, verdict)");
  });
});
