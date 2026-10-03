import { describe, expect, it } from "vitest";

import {
  BAND_RANK,
  FIT_BANDS,
  qualify,
  SALES_SIGNAL_KINDS,
  type QualifyingSignal,
} from "./sales-qualification";

const sig = (over: Partial<QualifyingSignal> = {}): QualifyingSignal => ({
  kind: "TRADE",
  state: "CONFIRMED",
  claim: "Metal framing and drywall subcontractor",
  ...over,
});

const trade = (over: Partial<QualifyingSignal> = {}) =>
  sig({ kind: "TRADE", ...over });
const geo = (over: Partial<QualifyingSignal> = {}) =>
  sig({
    kind: "GEOGRAPHY",
    claim: "Works across the Sacramento valley",
    ...over,
  });
const project = (over: Partial<QualifyingSignal> = {}) =>
  sig({
    kind: "PROJECT",
    claim: "Framing the Mission Valley medical office",
    ...over,
  });
const gc = (over: Partial<QualifyingSignal> = {}) =>
  sig({ kind: "GC_RELATIONSHIP", claim: "Works under Swinerton", ...over });

describe("a prospect with nothing confirmed", () => {
  it("is THIN, and says which of the two baselines is missing", () => {
    const q = qualify([]);
    expect(q.band).toBe("THIN");
    expect(q.reason).toContain("what they do");
    expect(q.reason).toContain("where they work");
    expect(q.missing).toEqual(["TRADE", "GEOGRAPHY"]);
  });

  it("names only the half that is missing once the other arrives", () => {
    const q = qualify([trade()]);
    expect(q.band).toBe("THIN");
    expect(q.missing).toEqual(["GEOGRAPHY"]);
    expect(q.reason).toContain("where they work");
    expect(q.reason).not.toContain("what they do");
  });
});

describe("trade and area confirmed", () => {
  it("is WORTH_A_CALL, and says what is still missing to make it STRONG", () => {
    const q = qualify([trade(), geo()]);
    expect(q.band).toBe("WORTH_A_CALL");
    expect(q.reason).toMatch(/nothing specific to open with/i);
    expect(q.missing).toEqual([]);
  });

  it("is STRONG once a project gives you an opening sentence", () => {
    const q = qualify([trade(), geo(), project()]);
    expect(q.band).toBe("STRONG");
    expect(
      q.reason,
      "STRONG's reason should BE the opening line, not a description of one",
    ).toBe("Framing the Mission Valley medical office");
  });

  it("is STRONG on a GC relationship too", () => {
    expect(qualify([trade(), geo(), gc()]).band).toBe("STRONG");
  });

  it("does not reach STRONG on volume of other kinds alone", () => {
    /* SIZE, LICENCE, UNION and TECH are all worth knowing and none of them is
       something to open a call with. Four more confirmed signals must not
       substitute for one specific thing. */
    const q = qualify([
      trade(),
      geo(),
      sig({ kind: "SIZE", claim: "About 60 in the field" }),
      sig({ kind: "LICENCE", claim: "C-9 active, DIR registered" }),
      sig({ kind: "UNION", claim: "Signatory, Local 46" }),
      sig({ kind: "TECH", claim: "Runs Procore for the GC's sake" }),
    ]);
    expect(q.band).toBe("WORTH_A_CALL");
    expect(q.confirmedKinds).toHaveLength(6);
  });
});

describe("a PROPOSED signal can never raise the band", () => {
  /* THE MOST IMPORTANT RULE IN THE MODULE. Research nobody has read must not
     make a prospect look better than a prospect nobody researched — otherwise
     the band measures how much searching happened rather than what is known. */

  it("leaves an all-PROPOSED prospect exactly where an empty one sits", () => {
    const proposed = [
      trade({ state: "PROPOSED" }),
      geo({ state: "PROPOSED" }),
      project({ state: "PROPOSED" }),
    ];
    const researched = qualify(proposed);
    const untouched = qualify([]);

    expect(researched.band).toBe("THIN");
    expect(researched.band).toBe(untouched.band);
    expect(researched.missing).toEqual(untouched.missing);
    expect(researched.confirmedKinds).toEqual([]);
  });

  it("reports them as awaiting review rather than silently ignoring them", () => {
    const q = qualify([
      trade({ state: "PROPOSED" }),
      geo({ state: "PROPOSED" }),
    ]);
    expect(q.awaitingReview).toBe(2);
    expect(
      q.reason,
      "the reason should say work is waiting, or nobody will ever review it",
    ).toContain("waiting for review");
  });

  it("will not let a PROPOSED project turn a WORTH_A_CALL into a STRONG", () => {
    const q = qualify([trade(), geo(), project({ state: "PROPOSED" })]);
    expect(q.band).toBe("WORTH_A_CALL");
    expect(q.awaitingReview).toBe(1);
  });

  it("ignores DISMISSED signals entirely, and does not count them as waiting", () => {
    const q = qualify([trade(), geo(), project({ state: "DISMISSED" })]);
    expect(q.band).toBe("WORTH_A_CALL");
    expect(q.awaitingReview).toBe(0);
  });
});

describe("a confirmed disqualifier stops the chase", () => {
  it("beats every other signal, however well researched the lead is", () => {
    const q = qualify([
      trade(),
      geo(),
      project(),
      gc(),
      sig({
        kind: "TRADE",
        claim: "They are the general contractor, not a sub",
        disqualifies: true,
      }),
    ]);
    expect(q.band).toBe("NOT_A_FIT");
    expect(q.reason).toBe("They are the general contractor, not a sub");
  });

  it("does nothing while it is still only PROPOSED", () => {
    const q = qualify([
      trade(),
      geo(),
      project(),
      sig({ claim: "Looks like a GC", disqualifies: true, state: "PROPOSED" }),
    ]);
    expect(
      q.band,
      "an unreviewed disqualifier must not kill a lead either — PROPOSED means nobody has checked, in both directions",
    ).toBe("STRONG");
  });
});

describe("the reason is always something a person can read", () => {
  it("is never empty, for any band", () => {
    const cases = [
      qualify([]),
      qualify([trade(), geo()]),
      qualify([trade(), geo(), project()]),
      qualify([
        sig({ claim: "Out of business since 2024", disqualifies: true }),
      ]),
    ];
    for (const q of cases) {
      expect(
        q.reason.trim().length,
        `${q.band} produced an empty reason`,
      ).toBeGreaterThan(10);
    }
    expect(
      new Set(cases.map((c) => c.band)).size,
      "expected four distinct bands",
    ).toBe(4);
  });

  it("bounds a long claim rather than pasting a paragraph into a row", () => {
    const q = qualify([trade(), geo(), project({ claim: "x".repeat(400) })]);
    expect(q.reason.length).toBeLessThanOrEqual(120);
    expect(q.reason.endsWith("…")).toBe(true);
  });

  it("never renders an empty reason, even when a caller drops the claim", () => {
    /* THIS REPRODUCES A REAL TEN-MINUTE BUG. The /sales list query first
       selected only the fields the band reads — kind, state, disqualifies —
       and passed `claim: ""` to keep the query small. Typecheck was clean,
       every other test passed, and a STRONG lead's reason rendered as an empty
       line on the one screen where the reason is the whole value. */
    const stripped = qualify([
      trade({ claim: "" }),
      geo({ claim: "" }),
      project({ claim: "" }),
    ]);
    expect(stripped.band).toBe("STRONG");
    expect(stripped.reason.trim().length).toBeGreaterThan(10);
    expect(
      stripped.reason,
      "with no claim to quote, the reason should say where to go and look rather than inventing one",
    ).toMatch(/open the lead/i);

    const ruledOut = qualify([sig({ claim: "", disqualifies: true })]);
    expect(ruledOut.band).toBe("NOT_A_FIT");
    expect(ruledOut.reason.trim().length).toBeGreaterThan(10);
  });

  it("flattens newlines, so a scraped claim cannot break the row", () => {
    const q = qualify([
      trade(),
      geo(),
      project({ claim: "Mission Valley\n\n  medical office" }),
    ]);
    expect(q.reason).toBe("Mission Valley medical office");
  });
});

describe("the shapes the screens depend on", () => {
  it("ranks every band, so a list can sort by it", () => {
    for (const band of FIT_BANDS) {
      expect(BAND_RANK[band], `${band} has no rank`).toBeTypeOf("number");
    }
    expect(new Set(Object.values(BAND_RANK)).size).toBe(FIT_BANDS.length);
  });

  it("returns confirmed kinds deduped and in the canonical order", () => {
    const q = qualify([
      project(),
      trade(),
      geo(),
      trade({ claim: "Also does lath and plaster" }),
    ]);
    expect(q.confirmedKinds).toEqual(["TRADE", "GEOGRAPHY", "PROJECT"]);
    expect(q.confirmedKinds.every((k) => SALES_SIGNAL_KINDS.includes(k))).toBe(
      true,
    );
  });
});
