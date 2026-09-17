import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prova/db";
import { changeOrderValueDelta, type LineItemForChangeOrder } from "./change-order";
import {
  SCOPE_NOTE_KINDS,
  foremanOutOfStep,
  hasDefensiveScope,
  laborBreakout,
  scopeSections,
  type ProposalForBreakout,
  type ScopeNote,
} from "./change-order-scope";

/**
 * The two claims this feature is worth anything for.
 *
 *  1. An exclusion is stored and rendered as an EXCLUSION — never folded in
 *     with the scope of work. `scopeSections` is the only thing that decides
 *     which sentence goes under which heading, so it is the place to hold
 *     that. (`changeOrderScope.test.tsx` then mounts the component and
 *     checks the DOM actually keeps them apart; this file checks the split.)
 *  2. The labour breakout SUMS. The foreman allowance is inside the labour
 *     subtotal, and every bucket together equals the change order's own
 *     contract-value delta — the same number the card already shows. A
 *     breakout that reconciles to nothing is a second set of books.
 *
 * Both were mutation-tested: the mutations and their results are in
 * changelog.d/cyrus-change-order-scope.md.
 */

const d = (value: string) => new Prisma.Decimal(value);

/** The scope section of the real PCO this feature came from, as notes. */
const CATWALK_NOTES: ScopeNote[] = [
  { id: "n1", kind: "INCLUSION", text: "Includes layout and fire-caulk at all penetrations", sortOrder: 0 },
  { id: "n2", kind: "EXCLUSION", text: "Temporary dance floor to be provided BY OTHERS", sortOrder: 0 },
  {
    id: "n3",
    kind: "EXCLUSION",
    text: "Hecklift provided BY OTHERS, to be used for stocking materials",
    sortOrder: 1,
  },
  {
    id: "n4",
    kind: "ASSUMPTION",
    text: "Top of dance floor to be no more than three feet below catwalk",
    sortOrder: 0,
  },
  { id: "n5", kind: "PRICING_BASIS", text: "Steel angle figured at continuous perimeter", sortOrder: 0 },
];

describe("scope sections", () => {
  it("never puts a note of one kind into another kind's section", () => {
    const sections = scopeSections(CATWALK_NOTES);

    // The load-bearing assertion of the whole feature, stated as an
    // invariant rather than as a spot check on one sentence: whatever the
    // input, every note in a section is of that section's kind. Merge the
    // filter and this goes red on every section at once.
    for (const section of sections) {
      for (const note of section.notes) {
        expect(note.kind, `"${note.text}" is rendering under ${section.kind}`).toBe(section.kind);
      }
    }
  });

  it("keeps the two BY OTHERS sentences out of the scope of work entirely", () => {
    const sections = scopeSections(CATWALK_NOTES);
    const inclusion = sections.find((s) => s.kind === "INCLUSION");
    const exclusion = sections.find((s) => s.kind === "EXCLUSION");

    expect(exclusion?.notes.map((n) => n.text)).toEqual([
      "Temporary dance floor to be provided BY OTHERS",
      "Hecklift provided BY OTHERS, to be used for stocking materials",
    ]);
    // Named the other way round too, because "the exclusions are in the
    // exclusion section" is true of a function that puts them in BOTH.
    expect(inclusion?.notes.map((n) => n.text)).not.toContain(
      "Temporary dance floor to be provided BY OTHERS",
    );
    expect(inclusion?.notes).toHaveLength(1);
  });

  it("orders the sections the way the document is written, and drops empty ones", () => {
    expect(scopeSections(CATWALK_NOTES).map((s) => s.kind)).toEqual([...SCOPE_NOTE_KINDS]);
    expect(scopeSections([CATWALK_NOTES[1]]).map((s) => s.kind)).toEqual(["EXCLUSION"]);
    expect(scopeSections([])).toEqual([]);
  });

  it("gives every kind its own heading, and no two the same", () => {
    const headings = scopeSections(CATWALK_NOTES).map((s) => s.heading);
    expect(new Set(headings).size).toBe(headings.length);
    expect(headings.some((h) => /not included/i.test(h))).toBe(true);
  });

  it("sorts within a kind by the order the estimator authored, not by id", () => {
    const reversed = scopeSections([
      { id: "zzz", kind: "EXCLUSION", text: "first", sortOrder: 0 },
      { id: "aaa", kind: "EXCLUSION", text: "second", sortOrder: 1 },
    ]);
    expect(reversed[0].notes.map((n) => n.text)).toEqual(["first", "second"]);
  });

  it("knows when a change order has nothing defending it", () => {
    expect(hasDefensiveScope([])).toBe(false);
    expect(hasDefensiveScope([CATWALK_NOTES[0]])).toBe(false); // an inclusion defends nothing
    expect(hasDefensiveScope([CATWALK_NOTES[1]])).toBe(true);
    expect(hasDefensiveScope([CATWALK_NOTES[3]])).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

function add(
  id: string,
  description: string,
  quantity: string,
  unitPrice: string,
  costCategory: ProposalForBreakout["costCategory"],
  foremanPercent: string | null = null,
): ProposalForBreakout {
  return {
    id,
    description,
    changeType: "ADD",
    lineItemId: null,
    quantity: d(quantity),
    unitPrice: d(unitPrice),
    costCategory,
    foremanPercent: foremanPercent === null ? null : d(foremanPercent),
  };
}

const NO_TARGETS = new Map<string, LineItemForChangeOrder>();

/**
 * His breakdown, priced: cut and install as one line, foreman at 10% of it,
 * stocking and cleanup on its own line, materials broken out separately.
 *
 *   cut and install   40 hr @ $85   = $3,400
 *   stocking/cleanup   8 hr @ $75   =   $600
 *   base labour                       $4,000
 *   foreman @ 10%      1  @ $400    =   $400
 *   labour subtotal                   $4,400
 *   FRT plywood       32 sh @ $96   = $3,072
 */
const CATWALK_LINES = [
  add("p1", "Cut and install 3/4 FRT APA plywood at catwalk", "40", "85", "LABOR"),
  add("p2", "Stocking and cleanup", "8", "75", "LABOR"),
  add("p3", "Foreman", "1", "400", "LABOR", "10"),
  add("p4", "3/4 FRT APA plywood", "32", "96", "MATERIAL"),
];

describe("the labour breakout", () => {
  it("sums to the labour subtotal", () => {
    const breakout = laborBreakout(CATWALK_LINES, NO_TARGETS);

    expect(breakout.laborBase.toString()).toBe("4000");
    expect(breakout.foreman.toString()).toBe("400");
    // THE assertion of the second half of this feature. Drop the foreman
    // out of `labor`, or fold it into `laborBase` and double-count it, and
    // this goes red.
    expect(breakout.labor.equals(breakout.laborBase.add(breakout.foreman))).toBe(true);
    expect(breakout.labor.toString()).toBe("4400");
  });

  it("keeps materials out of the labour subtotal", () => {
    const breakout = laborBreakout(CATWALK_LINES, NO_TARGETS);
    expect(breakout.material.toString()).toBe("3072");
    expect(breakout.labor.toString()).toBe("4400");
    // Stated as its own claim: "broken out separately from labour" is the
    // requirement, and a breakout that put materials in both would still
    // satisfy the total.
    expect(breakout.labor.add(breakout.material).toString()).toBe("7472");
  });

  it("never makes the foreman a percentage of itself", () => {
    const breakout = laborBreakout(CATWALK_LINES, NO_TARGETS);
    // $4,000 of crew labour, not $4,400. The foreman line is excluded from
    // its own base or 10% would be figured on money that includes it.
    expect(breakout.laborBase.toString()).toBe("4000");
    expect(breakout.foremanLines[0].figuredAt.toString()).toBe("400");
  });

  it("reconciles to the change order's own contract-value delta", () => {
    const breakout = laborBreakout(CATWALK_LINES, NO_TARGETS);
    const delta = changeOrderValueDelta(CATWALK_LINES, NO_TARGETS);

    // Every bucket, added up, is the same number the card already shows.
    // Forget to add one of them and this is the test that says so.
    expect(breakout.total.toString()).toBe(delta.toString());
    expect(
      breakout.labor
        .add(breakout.material)
        .add(breakout.subcontractor)
        .add(breakout.other)
        .add(breakout.uncategorized)
        .add(breakout.adjustments)
        .toString(),
    ).toBe(breakout.total.toString());
  });

  it("puts an uncategorised line in its own bucket, not in Other", () => {
    const lines = [...CATWALK_LINES, add("p5", "Lump sum allowance", "1", "500", null)];
    const breakout = laborBreakout(lines, NO_TARGETS);

    expect(breakout.uncategorized.toString()).toBe("500");
    expect(breakout.other.toString()).toBe("0");
    expect(breakout.total.toString()).toBe(changeOrderValueDelta(lines, NO_TARGETS).toString());
  });

  it("counts a change to existing scope as an adjustment, and still reconciles", () => {
    const target: LineItemForChangeOrder = {
      id: "li1",
      quantity: d("10"),
      unitPrice: d("100"),
      isDeleted: false,
    };
    const targets = new Map([["li1", target]]);
    const lines: ProposalForBreakout[] = [
      ...CATWALK_LINES,
      {
        id: "p6",
        description: null,
        changeType: "EDIT",
        lineItemId: "li1",
        quantity: d("12"),
        unitPrice: null,
        costCategory: null,
        foremanPercent: null,
      },
    ];
    const breakout = laborBreakout(lines, targets);

    expect(breakout.adjustments.toString()).toBe("200");
    // An EDIT carries no cost category -- the line it targets is existing
    // scope on the job, which has none -- so it must NOT leak into the
    // uncategorised ADD bucket.
    expect(breakout.uncategorized.toString()).toBe("0");
    expect(breakout.total.toString()).toBe(changeOrderValueDelta(lines, targets).toString());
  });

  it("is all zeroes and reconciles on a change order with nothing in it", () => {
    const breakout = laborBreakout([], NO_TARGETS);
    expect(breakout.labor.toString()).toBe("0");
    expect(breakout.total.toString()).toBe("0");
    expect(breakout.foremanLines).toEqual([]);
  });
});

describe("a foreman line that no longer matches its own basis", () => {
  it("says nothing while the priced amount and the percentage agree", () => {
    expect(foremanOutOfStep(laborBreakout(CATWALK_LINES, NO_TARGETS))).toEqual([]);
  });

  it("names the gap once more labour is added after the foreman was priced", () => {
    // The estimator adds another $1,000 of crew time and forgets to move
    // the foreman line. 10% is now $500, the line still says $400.
    const lines = [...CATWALK_LINES, add("p7", "Extra crew day", "10", "100", "LABOR")];
    const messages = foremanOutOfStep(laborBreakout(lines, NO_TARGETS));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("$400.00");
    expect(messages[0]).toContain("$500.00");
    expect(messages[0]).toContain("10%");
  });

  it("does not report a rounding cent as a mismatch", () => {
    // 10% of $3,333.33 is $333.333, and the priced line can only hold two
    // decimals. An exact comparison would call every honest line wrong.
    const lines = [
      add("q1", "Crew", "1", "3333.33", "LABOR"),
      add("q2", "Foreman", "1", "333.33", "LABOR", "10"),
    ];
    expect(foremanOutOfStep(laborBreakout(lines, NO_TARGETS))).toEqual([]);
  });

  it("says nothing when there is no labour to take a percentage of", () => {
    const lines = [add("q3", "Foreman", "1", "400", "LABOR", "10")];
    expect(foremanOutOfStep(laborBreakout(lines, NO_TARGETS))).toEqual([]);
  });
});

/**
 * The GC's copy is the one that has to carry the exclusions.
 *
 * An exclusion that lives only on the sub's own screen is a note to self.
 * Its whole value is that the document the GC holds says, under its own
 * heading, that the item is not in the price — so the portal rendering the
 * notes, and rendering them SPLIT, is part of the feature rather than a
 * nicety.
 *
 * Source text rather than a mount: the portal page is an async server
 * component that opens with a Prisma query, so there is nothing to render
 * without a database. Both assertions are fixed literals, which cannot
 * silently match nothing the way a derived pattern can.
 */
describe("the GC's copy", () => {
  const portalSource = readFileSync(
    fileURLToPath(new URL("../app/portal/[token]/jobs/[jobId]/page.tsx", import.meta.url)),
    "utf8",
  );

  it("loads the scope notes with the change orders it shows the GC", () => {
    expect(portalSource).toContain("scopeNotes: true");
  });

  it("splits them with scopeSections rather than rendering them flat", () => {
    // If someone later maps co.scopeNotes directly, this fails — and that is
    // exactly how an exclusion ends up in one undifferentiated list with the
    // scope of work, on the surface where the distinction is the defence.
    expect(portalSource).toContain("scopeSections(co.scopeNotes)");
    expect(portalSource).not.toMatch(/co\.scopeNotes\.map/);
  });
});
