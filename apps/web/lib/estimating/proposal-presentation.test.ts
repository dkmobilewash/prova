import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bidTotalOf } from "@/lib/estimating/recap-state";
import {
  bidFormSections,
  DEFAULT_PROPOSAL_MODE,
  parseProposalMode,
  PROPOSAL_MODES,
  proposalPresentation,
  scopeSubtotals,
  type ProposalLineInput,
} from "./proposal-presentation";

const usd = (n: number) => `$${n.toFixed(2)}`;

const line = (over: Partial<ProposalLineInput> & { id: string }): ProposalLineInput => ({
  description: "line",
  unit: "SF",
  quantity: 1,
  unitPrice: 1,
  wallType: null,
  tradeScope: null,
  ...over,
});

const W2 = { code: "W2", name: "Rated partition" };
const W5 = { code: "W5", name: "Furring" };

// Sub-cent extensions on purpose: they cannot be rounded per scope and still
// add up, which is the case the reconciliation exists for.
const LINES: ProposalLineInput[] = [
  line({ id: "a", description: "W2 — 3-5/8 25ga stud", quantity: 1240, unitPrice: 2.37, wallType: W2 }),
  line({ id: "b", description: "W2 — hang & finish", quantity: 3333.33, unitPrice: 1.15, wallType: W2 }),
  line({ id: "c", description: "W5 — hat channel", quantity: 7.5, unitPrice: 0.33, wallType: W5 }),
  line({ id: "d", description: "W5 — board", quantity: 2.5, unitPrice: 1.15, wallType: W5 }),
  line({ id: "e", description: "Mobilization", quantity: 1, unitPrice: 1234.56, tradeScope: "METAL_FRAMING_DRYWALL" }),
  line({ id: "f", description: "Hand line", quantity: 3, unitPrice: 0.335 }),
  line({ id: "g", description: "General conditions (cost only)", quantity: 1, unitPrice: null }),
];

const cents = (n: number) => Math.round(Number((n * 100).toFixed(6)));

describe("proposal presentation — one total, three views", () => {
  it("defaults to a lump sum and falls back on anything unrecognised", () => {
    expect(DEFAULT_PROPOSAL_MODE).toBe("lump");
    expect(parseProposalMode(undefined)).toBe("lump");
    expect(parseProposalMode("nonsense")).toBe("lump");
    expect(parseProposalMode(["scope", "x"])).toBe("scope");
    expect(parseProposalMode("itemized")).toBe("itemized");
  });

  for (const mode of PROPOSAL_MODES) {
    it(`${mode}: the printed total is bidTotalOf, to the cent`, () => {
      const p = proposalPresentation(LINES, mode);
      expect(cents(p.total)).toBe(cents(bidTotalOf(LINES)));
    });
  }

  it("lump: exactly one row, carrying the whole bid", () => {
    const p = proposalPresentation(LINES, "lump");
    expect(p.rows).toHaveLength(1);
    expect((p.rows[0] as { amountCents: number }).amountCents).toBe(cents(bidTotalOf(LINES)));
  });

  it("scope: subtotals per wall type, and they sum to the bid exactly", () => {
    const p = proposalPresentation(LINES, "scope");
    if (p.mode !== "scope") throw new Error("mode");
    expect(p.rows.map((r) => r.label)).toEqual([
      "W2 — Rated partition",
      "W5 — Furring",
      "Metal framing & drywall",
      "Other work",
    ]);
    expect(p.rows.reduce((s, r) => s + r.amountCents, 0)).toBe(cents(bidTotalOf(LINES)));
  });

  it("scope: reconciles when per-scope rounding alone would NOT add up", () => {
    // Three scopes of $0.335: each rounds to 0.34 (1.02 together) but the bid is 1.005 → 1.01.
    const three = ["x", "y", "z"].map((c) =>
      line({ id: c, quantity: 1, unitPrice: 0.335, wallType: { code: c, name: c } }),
    );
    const naive = three.reduce((s, l) => s + Math.round(l.unitPrice! * l.quantity * 100), 0);
    const { rows, totalCents } = scopeSubtotals(three);
    expect(naive).not.toBe(totalCents);
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(totalCents);
  });

  it("scope: sums to the bid across many shapes of lines", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let run = 0; run < 200; run++) {
      const n = 1 + Math.floor(rnd() * 12);
      const lines = Array.from({ length: n }, (_, i) =>
        line({
          id: String(i),
          quantity: Math.round(rnd() * 500000) / 100,
          unitPrice: rnd() < 0.1 ? null : Math.round(rnd() * 5000) / 100,
          wallType: rnd() < 0.7 ? { code: `W${Math.floor(rnd() * 5)}`, name: "t" } : null,
        }),
      );
      const { rows, totalCents } = scopeSubtotals(lines);
      expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(totalCents);
      expect(totalCents).toBe(cents(bidTotalOf(lines)));
    }
  });

  it("a deduct line (negative price) still reconciles", () => {
    const lines = [
      line({ id: "1", quantity: 10, unitPrice: 3.337, wallType: W2 }),
      line({ id: "2", quantity: 1, unitPrice: -50.115, wallType: W5 }),
    ];
    const { rows, totalCents } = scopeSubtotals(lines);
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(totalCents);
  });

  it("lump and scope rows carry NO unit price, quantity, unit, cost, hours or markup", () => {
    for (const mode of ["lump", "scope"] as const) {
      const p = proposalPresentation(LINES, mode);
      for (const row of p.rows) {
        expect(Object.keys(row).sort()).toEqual(["amountCents", "key", "label"]);
      }
      const json = JSON.stringify(p);
      expect(json).not.toContain("2.37");
      expect(json).not.toContain("1240");
      expect(json).not.toMatch(/stud|hang|hat channel/i);
    }
  });

  it("itemized keeps today's rows, unit prices included; a null price stays a cost-only line", () => {
    const p = proposalPresentation(LINES, "itemized");
    if (p.mode !== "itemized") throw new Error("mode");
    expect(p.rows).toHaveLength(LINES.length);
    expect(p.rows[0]).toMatchObject({ quantity: 1240, unitPrice: 2.37 });
    expect(p.rows.at(-1)).toMatchObject({ unitPrice: null, total: null });
  });
});

describe("the bid form's alternates and unit prices", () => {
  const rows = bidFormSections(
    [
      { kind: "ALTERNATE", label: "Alt 1", description: "Level 5 lobby", amount: 12000, unit: null, unitPrice: null },
      { kind: "ALTERNATE", label: "Alt 2", description: null, amount: -4500.5, unit: null, unitPrice: null },
      { kind: "ALTERNATE", label: "Alt 3", description: "left blank", amount: null, unit: null, unitPrice: null },
      { kind: "UNIT_PRICE", label: "UP A", description: null, amount: null, unit: "SF of 5/8 board", unitPrice: 3.1 },
      { kind: "UNIT_PRICE", label: "UP B", description: null, amount: null, unit: "LF", unitPrice: null },
      { kind: "ALLOWANCE", label: "Soffits", description: null, amount: 15000, unit: null, unitPrice: null },
    ],
    usd,
  );

  it("prints add / deduct with the sub's own figure, a blank as No bid", () => {
    expect(rows.alternates.map((r) => r.price)).toEqual(["Add $12000.00", "Deduct $4500.50", "No bid"]);
  });

  it("prints unit prices per the GC's unit, a blank as No bid", () => {
    expect(rows.unitPrices.map((r) => r.price)).toEqual(["$3.10 per SF of 5/8 board", "No bid"]);
  });

  it("counts the blanks so the sender is warned, invents nothing, omits allowances", () => {
    expect(rows.blankCount).toBe(2);
    expect(JSON.stringify(rows)).not.toContain("Soffits");
    expect(JSON.stringify(rows)).not.toContain("15000");
  });
});

describe("the page uses the presentation", () => {
  const page = readFileSync(new URL("../../app/(app)/jobs/[id]/proposal/page.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("reads the mode, builds the presentation and the bid-form sections", () => {
    expect(page).toMatch(/parseProposalMode\(/);
    expect(page).toMatch(/proposalPresentation\(/);
    expect(page).toMatch(/bidFormSections\(/);
  });

  it("prints a unit price only on the itemized branch", () => {
    // Every render of a price column goes through an itemized row.
    expect(page).not.toMatch(/line\.unitPrice/);
    const branch = page.indexOf('presentation.mode === "itemized" ? (');
    expect(branch).toBeGreaterThan(-1);
    const elseBranch = page.indexOf(") : (", branch);
    const reads = [...page.matchAll(/row\.unitPrice/g)].map((m) => m.index ?? -1);
    expect(reads.length).toBeGreaterThan(0);
    for (const at of reads) expect(at > branch && at < elseBranch).toBe(true);
  });
});
