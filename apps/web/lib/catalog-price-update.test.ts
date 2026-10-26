import { describe, expect, it } from "vitest";
import { parseCatalogImport, planImport, type ExistingEntry } from "./catalog-import";

/**
 * Re-importing a supplier's updated price list: which existing entries move.
 *
 * The identity rule is the one the import always had — description, trimmed and
 * case-folded; there is no SKU column — and these cases pin what the preview
 * promises: N new, M price changes (old -> new, %), K unchanged.
 */

const entry = (over: Partial<ExistingEntry> & { id: string; description: string }): ExistingEntry => ({
  unit: "SF",
  unitPrice: null,
  budgetedUnitCost: null,
  ...over,
});

const rowsOf = (csv: string) => parseCatalogImport(csv).rows;

describe("planImport", () => {
  const existing = [
    entry({ id: "board", description: '5/8" Type X board', unitPrice: 2.5, budgetedUnitCost: 1.75 }),
    entry({ id: "stud", description: "3-5/8 25ga stud", unit: "LF", unitPrice: 1, budgetedUnitCost: 0.6 }),
    entry({ id: "tape", description: "Joint tape", unit: "EA", unitPrice: 4, budgetedUnitCost: 2 }),
  ];

  it("counts new, changed and unchanged, and reports old -> new with a percent", () => {
    const rows = rowsOf(
      [
        "Description,Unit,Unit Price,Cost",
        '5/8" TYPE X BOARD,SF,2.70,1.89', // +8% price, +8% cost, different case
        "3-5/8 25ga stud,LF,1.00,0.60", // identical
        "Brand new item,EA,9,5",
        "Joint tape,EA,4.00,2.10", // cost only
      ].join("\n"),
    );
    const plan = planImport(rows, existing);

    expect(plan.fresh.map((r) => r.description)).toEqual(["Brand new item"]);
    expect(plan.unchanged.map((r) => r.description)).toEqual(["3-5/8 25ga stud"]);
    expect(plan.changes).toHaveLength(2);

    const board = plan.changes.find((c) => c.entryId === "board")!;
    expect(board.price).toEqual({ old: 2.5, next: 2.7, percent: 8 });
    expect(board.cost).toEqual({ old: 1.75, next: 1.89, percent: 8 });

    const tape = plan.changes.find((c) => c.entryId === "tape")!;
    expect(tape.price).toBeNull(); // the file agrees on price
    expect(tape.cost).toEqual({ old: 2, next: 2.1, percent: 5 });
  });

  it("never lets a blank cell erase a price the catalog has", () => {
    const rows = rowsOf("Description,Unit,Unit Price,Cost\nJoint tape,EA,,2.10");
    const [change] = planImport(rows, existing).changes;
    expect(change.price).toBeNull();
    expect(change.cost?.next).toBe(2.1);

    const onlyBlank = rowsOf("Description,Unit,Unit Price,Cost\nJoint tape,EA,,");
    const plan = planImport(onlyBlank, existing);
    expect(plan.changes).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(1);
  });

  it("skips a row in a different unit rather than repricing the wrong item", () => {
    const rows = rowsOf("Description,Unit,Unit Price\n3-5/8 25ga stud,SF,9.99");
    const plan = planImport(rows, existing);
    expect(plan.changes).toHaveLength(0);
    expect(plan.unitMismatch).toHaveLength(1);
  });

  it("reports a price where the catalog had none, with no percent", () => {
    const plan = planImport(rowsOf("Description,Unit,Unit Price\nGhost,SF,3"), [
      entry({ id: "g", description: "ghost" }),
    ]);
    expect(plan.changes[0].price).toEqual({ old: null, next: 3, percent: null });
  });

  it("treats a repeat of the same item in the file as a repeat, and updates from the first", () => {
    const rows = rowsOf("Description,Unit,Unit Price\nJoint tape,EA,5\njoint tape,EA,6");
    const plan = planImport(rows, existing);
    expect(plan.duplicatesWithinFile).toHaveLength(1);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].price?.next).toBe(5);
  });

  it("does not call a one-cent float difference a change", () => {
    const plan = planImport(rowsOf("Description,Unit,Unit Price\nJoint tape,EA,4.004"), existing);
    expect(plan.changes).toHaveLength(0);
  });
});
