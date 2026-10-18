import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localToday } from "./fills";
import {
  checkChangeOrder,
  EMPTY_DRAFT,
  formatCents,
  freshDraft,
  lineCents,
  liveTotals,
  markupCents,
  parseHundredths,
  restoreDraft,
  startDraft,
  STEPS,
  stepErrors,
  type ChangeOrderDraft,
} from "./change-order";

/** A request a drywall sub would actually send. Every figure below is
 * worked by hand, not by the code under test. */
const SAMPLE: ChangeOrderDraft = {
  ...EMPTY_DRAFT,
  companyName: "Desert Drywall LLC",
  project: "Mesa Medical Office Building",
  projectAddress: "1234 E Main St, Mesa, AZ",
  gc: "Acme Builders Inc.",
  pcoNumber: "PCO-07",
  date: "2026-10-17",
  title: "Add rated head-of-wall at corridor",
  description: "Per RFI 14, add 2-hr rated deflection track at the level 2 corridor.\nGC super asked for it on site Oct 12.",
  labor: [
    { description: "Framers", quantity: "8", unit: "", unitPrice: "85" },
    { description: "Tapers", quantity: "2.5", unit: "hr", unitPrice: "85.00" },
  ],
  material: [{ description: "Deflection track", quantity: "12", unit: "EA", unitPrice: "14.37" }],
  equipment: [{ description: "Scissor lift", quantity: "1", unit: "day", unitPrice: "$325" }],
  markupPercent: "15",
  scheduleDays: "2",
  backup: "RFI 14 response\n\nSite photos, Oct 12\n",
};

describe("money is integer cents", () => {
  it("reads typed amounts into hundredths without a float", () => {
    expect(parseHundredths("8")).toBe(800n);
    expect(parseHundredths("12.5")).toBe(1250n);
    expect(parseHundredths("$1,234.56")).toBe(123456n);
    expect(parseHundredths("0.1")).toBe(10n);
    for (const bad of ["", "-5", "1.234", "1e3", "12k", "1,2,3.4.5", " . "]) expect(parseHundredths(bad)).toBeNull();
  });

  it("rounds a line half-up to the cent", () => {
    expect(lineCents(150n, 8500n)).toBe(12750n); // 1.5 x $85.00
    expect(lineCents(50n, 1n)).toBe(1n); // 0.5 x $0.01 = 0.5c -> 1c
    expect(lineCents(49n, 1n)).toBe(0n); // 0.49c -> 0c
    expect(lineCents(33n, 333n)).toBe(110n); // 0.33 x $3.33 = 1.0989 -> $1.10
  });

  it("rounds the markup half-up once, on the subtotal", () => {
    expect(markupCents(10_000n, 1500n)).toBe(1500n); // 15% of $100.00
    expect(markupCents(10_010n, 1500n)).toBe(1502n); // 1501.5c -> 1502c
    expect(markupCents(10_003n, 1500n)).toBe(1500n); // 1500.45c -> 1500c
    expect(markupCents(12_345n, 0n)).toBe(0n);
  });

  it("does not drift the way floats do", () => {
    const { order } = checkChangeOrder({
      ...SAMPLE,
      labor: [
        { description: "a", quantity: "1", unit: "", unitPrice: "0.10" },
        { description: "b", quantity: "1", unit: "", unitPrice: "0.20" },
      ],
      material: [],
      equipment: [],
      markupPercent: "",
    });
    expect(order?.totalCents).toBe(30n);
    expect(formatCents(order!.totalCents)).toBe("0.30");
  });

  it("works the sample request to the cent", () => {
    const { order, errors } = checkChangeOrder(SAMPLE);
    expect(errors).toEqual({});
    expect(order!.subtotals).toEqual({ labor: 89_250n, material: 17_244n, equipment: 32_500n }); // 680 + 212.50; 12 x 14.37; 325
    expect(order!.subtotalCents).toBe(138_994n);
    expect(order!.markupCents).toBe(20_849n); // 15% of 1,389.94 = 208.491
    expect(order!.totalCents).toBe(159_843n);
    expect(formatCents(order!.totalCents)).toBe("1,598.43");
  });

  it("the subtotal is the sum of the PRINTED (rounded) lines", () => {
    // Three lines of 1/3 hour at $1.00: each prints $0.33, so the subtotal
    // must print $0.99, not the $1.00 an unrounded sum would give.
    const third = { description: "x", quantity: "0.33", unit: "", unitPrice: "1" };
    const { order } = checkChangeOrder({ ...SAMPLE, labor: [third, third, third], material: [], equipment: [], markupPercent: "" });
    expect(order!.lines.labor.map((line) => formatCents(line.amountCents))).toEqual(["0.33", "0.33", "0.33"]);
    expect(order!.subtotalCents).toBe(99n);
  });

  it("stays exact past the float's 2^53", () => {
    const { order } = checkChangeOrder({
      ...SAMPLE,
      labor: [{ description: "huge", quantity: "999999999.99", unit: "", unitPrice: "999999999.99" }],
      material: [],
      equipment: [],
      markupPercent: "",
    });
    expect(formatCents(order!.totalCents)).toBe("999,999,999,980,000,000.00");
  });

  it("the screens' running totals agree with the checked order", () => {
    const live = liveTotals(SAMPLE);
    const { order } = checkChangeOrder(SAMPLE);
    expect(live.total).toBe(order!.totalCents);
    expect(live.markup).toBe(order!.markupCents);
  });
});

describe("checking a request", () => {
  it("names every missing required field", () => {
    const { order, errors } = checkChangeOrder(EMPTY_DRAFT);
    expect(order).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(["companyName", "date", "description", "gc", "project", "scheduleDays", "title"]);
  });

  it("skips a line left completely empty, and refuses a half-filled one", () => {
    const blank = { description: " ", quantity: "", unit: "", unitPrice: "" };
    expect(checkChangeOrder({ ...SAMPLE, labor: [...SAMPLE.labor, blank] }).order!.lines.labor).toHaveLength(2);
    const { errors } = checkChangeOrder({ ...SAMPLE, labor: [{ description: "Framers", quantity: "eight", unit: "", unitPrice: "" }] });
    expect(Object.keys(errors).sort()).toEqual(["labor.0.quantity", "labor.0.unitPrice"]);
  });

  it("refuses a zero quantity, a markup past 100% and fractional days", () => {
    const { errors } = checkChangeOrder({
      ...SAMPLE,
      material: [{ description: "x", quantity: "0", unit: "", unitPrice: "5" }],
      markupPercent: "150",
      scheduleDays: "1.5",
    });
    expect(Object.keys(errors).sort()).toEqual(["markupPercent", "material.0.quantity", "scheduleDays"]);
  });

  it("refuses what the PDF's font cannot print", () => {
    expect(checkChangeOrder({ ...SAMPLE, title: "Wall \u{1F9F1}" }).errors.title).toMatch(/cannot print/);
  });

  it("reads hostile input without throwing", () => {
    const hostile = { companyName: 7, labor: "nope", material: [null, 3, { quantity: {} }], date: ["x"], backup: 12 } as never;
    expect(() => checkChangeOrder(hostile)).not.toThrow();
    expect(checkChangeOrder(hostile).order).toBeNull();
  });

  it("lists backup by name, dropping blank lines", () => {
    expect(checkChangeOrder(SAMPLE).order!.backup).toEqual(["RFI 14 response", "Site photos, Oct 12"]);
  });

  it("restores only known fields from this browser's memory", () => {
    const restored = restoreDraft({ title: "T", labor: [{ description: "d", quantity: 3 }], evil: "x", gc: 5 });
    expect(restored.title).toBe("T");
    expect(restored.gc).toBe("");
    expect(restored.labor).toEqual([{ description: "d", quantity: "", unit: "", unitPrice: "" }]);
    expect("evil" in restored).toBe(false);
  });
});

describe("the step-by-step screens", () => {
  it("walks the screens in order", () => {
    expect(STEPS.map((step) => step.title)).toEqual([
      "Your Company",
      "Project",
      "This Request",
      "The Change",
      "Labor",
      "Material",
      "Equipment",
      "Markup",
      "Schedule Impact",
      "Backup",
      "Read Your Change Order",
      "Get Your PDF",
    ]);
  });

  // Every error the checker can produce must stop exactly one screen's
  // Next. An error no screen owns would let a person walk past it to a send
  // the server then refuses, with nothing on screen to fix.
  const bad: ChangeOrderDraft[] = [
    EMPTY_DRAFT,
    {
      ...SAMPLE,
      date: "nope",
      companyName: "x".repeat(300),
      projectAddress: "\u{1F9F1}",
      pcoNumber: "y".repeat(50),
      labor: [{ description: "", quantity: "a", unit: "z".repeat(20), unitPrice: "b" }],
      material: Array.from({ length: 25 }, () => ({ description: "m", quantity: "1", unit: "", unitPrice: "1" })),
      equipment: [{ description: "e", quantity: "0", unit: "", unitPrice: "-1" }],
      markupPercent: "abc",
      scheduleDays: "x",
      backup: Array.from({ length: 30 }, (_, i) => `doc ${i}`).join("\n"),
    },
  ];
  const keys = [...new Set(bad.flatMap((draft) => Object.keys(checkChangeOrder(draft).errors)))];

  it("produces errors to check (the set is not empty)", () => expect(keys.length).toBeGreaterThanOrEqual(15));

  it.each(keys)("error %s belongs to exactly one screen", (key) => {
    const owners = STEPS.filter((step) => stepErrors(step.id, { [key]: "x" }).length > 0).map((step) => step.id);
    expect(owners).toHaveLength(1);
  });

  it("an empty request stops on the first screen, and the line screens are optional", () => {
    const { errors } = checkChangeOrder(EMPTY_DRAFT);
    expect(stepErrors("company", errors)).toEqual(["companyName"]);
    for (const step of ["labor", "material", "equipment", "markup", "backup", "review", "send"] as const) {
      expect(stepErrors(step, errors)).toEqual([]);
    }
  });
});

/**
 * FOUND BY CLICKING (2026-10-18): after a send, coming back started with the
 * WHOLE last request filled in -- job, every line, markup, days and
 * yesterday's date -- and typing appended to it. A sent request is not a
 * draft; only the sub's own company survives it.
 */
describe("a new request starts clean", () => {
  const TODAY = "2026-10-18";

  it("after a send (and on Make another) only the company and today are kept", () => {
    expect(freshDraft(SAMPLE.companyName, TODAY)).toEqual({ ...EMPTY_DRAFT, companyName: "Desert Drywall LLC", date: TODAY });
  });

  it("a sent request, stored as its fresh draft, comes back empty but for the company", () => {
    const stored = JSON.parse(JSON.stringify(freshDraft(SAMPLE.companyName, "2026-10-17"))) as Record<string, unknown>;
    expect(startDraft(stored, TODAY, "")).toEqual({ ...EMPTY_DRAFT, companyName: "Desert Drywall LLC", date: TODAY });
  });

  it("an UNFINISHED draft is restored, but a past date moves up to today", () => {
    const draft = startDraft({ ...SAMPLE, date: "2026-10-17" }, TODAY, "Other Co");
    expect(draft.date).toBe(TODAY);
    expect(draft.title).toBe(SAMPLE.title);
    expect(draft.labor).toEqual(SAMPLE.labor);
    expect(draft.companyName).toBe("Desert Drywall LLC");
  });

  it("keeps a date picked for later, and dates an empty one today", () => {
    expect(startDraft({ ...SAMPLE, date: "2026-10-20" }, TODAY, "").date).toBe("2026-10-20");
    expect(startDraft(null, TODAY, "Known Co")).toEqual({ ...EMPTY_DRAFT, companyName: "Known Co", date: TODAY });
  });

  it("today is the USER'S calendar date, not UTC's", () => {
    // 23:30 local on the 18th; in UTC west of Greenwich it is already the 19th.
    expect(localToday(new Date(2026, 9, 18, 23, 30))).toBe(TODAY);
    expect(localToday(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });

  // "Written and never called" is this repo's recurring shape: the send,
  // Make another and Forget must all go through freshDraft, and nothing may
  // build a new request by hand out of the old one.
  it("the tool uses them on every path that starts a new request", () => {
    const source = readFileSync(join(__dirname, "..", "components", "ChangeOrderTool.tsx"), "utf8");
    expect(source.match(/freshDraft\(/g)).toHaveLength(3);
    expect(source).toContain("startDraft(loadChangeOrder(), localToday()");
    expect(source).not.toMatch(/\.\.\.EMPTY_DRAFT/);
  });
});
