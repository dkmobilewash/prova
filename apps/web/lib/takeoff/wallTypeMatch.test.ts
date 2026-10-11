import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TAG_MAJORITY, matchClusterToWallType, matchSentence, sameDesignation } from "./wallTypeMatch";
import type { PostableWallType } from "./wallTypeMatch";

const TYPES: PostableWallType[] = [
  { id: "wt_w1", code: "W1", name: "⅝″ Type X both sides, 3-5/8 stud" },
  { id: "wt_w2", code: "W-2", name: "One hour, double layer" },
  { id: "wt_ext", code: "EXT-1", name: "Exterior sheathing" },
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

  it("SENDS THE MATCHED TYPE, which is what makes the group arrive priced", () => {
    const text = viewer();
    expect(text, "the matched type is never sent, so nothing is ever priced").toContain(
      'body.set("wallTypeId", match.type.id)',
    );
    // ONLY ON A MATCH. Every other state is a refusal this component must not
    // overrule, and an unguarded `set` would post a group the drawing never
    // named against whatever type happened to be first.
    expect(text).toContain('if (match?.state === "MATCH") body.set("wallTypeId", match.type.id)');
  });

  it("COMPUTES the match from the same pass as the names on screen", () => {
    // Two walks of the same runs would be the second list CLAUDE.md warns
    // about, and the one that drifted would be the one on screen.
    const text = viewer();
    expect(text).toContain("taggedFeetForClusters(clusters, walls, tags, feetPerUnit)");
    expect(text).toContain("matchClusterToWallType(one, wallTypes)");
    expect(text, "the names shown are derived from the same pass").toContain(
      "taggedFeet.map((one) => one.map((part) => part.name))",
    );
  });

  it("SAYS on the button what it is about to do", () => {
    // A button reading "Add these" that silently prices a group is worse than
    // one that does not: the estimator cannot tell which groups went onto the
    // estimate as money and which went on as quantities.
    const text = viewer();
    expect(text).toContain("priced");
    expect(text).toContain("Add these");
  });

  it("CARRIES THE DRAWING'S OWN WORD into the measurement label", () => {
    // `4⅞" wall` is what the app measured; `W1 wall` is what the drawing calls
    // it, and it is what an estimator looks for in the list and on the recap.
    const text = viewer();
    expect(text).toContain("${match.tag} wall");
  });

  it("RENDERS THE REASON when there is one", () => {
    const text = viewer();
    expect(text).toContain("matchSentence(typeMatches[index]");
  });
});
