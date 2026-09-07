import { describe, expect, it, vi } from "vitest";

/**
 * Ask must answer "where is the skid steer" from the same assignment
 * history the equipment page reads — not from `Equipment.assignedJobId`.
 *
 * Nothing has written that column since the assignment history landed, so a
 * reader of it is pinned to whatever was true the day the writes stopped
 * and never moves again. That is not a stale cache that eventually catches
 * up; it is a permanently wrong answer, and it was wrong quietly — the
 * equipment page and Ask would have named two different jobs for the same
 * machine with nothing anywhere reporting a disagreement.
 *
 * The fake below is the whole point of the test, so it is worth being
 * precise about what it does: it HONOURS the `select`, returning only the
 * fields the query asked for. A handler that asks for `assignedJob` gets
 * the frozen column and fails these assertions; a handler that asks for
 * `assignments` gets the history and passes. A fake that handed back every
 * field regardless would let the buggy version pass, which would make this
 * file worse than no file.
 */

type Select = Record<string, unknown>;

/** Returns only what `select` asked for, recursing into nested selects the
 * way Prisma does. */
function project(row: Record<string, unknown>, select: Select | undefined): unknown {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(select)) {
    if (!spec) continue;
    const value = row[key];
    const nested =
      typeof spec === "object" && spec !== null && "select" in spec
        ? ((spec as { select: Select }).select)
        : null;
    if (!nested) {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.map((entry) => project(entry as Record<string, unknown>, nested));
    } else {
      out[key] = value == null ? value : project(value as Record<string, unknown>, nested);
    }
  }
  return out;
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Two pieces, and for both of them the frozen column disagrees with the
 * history. That disagreement is exactly the production situation: the
 * column stopped being written while the stays kept being recorded. */
const EQUIPMENT = [
  {
    id: "eq-mixer",
    name: "Mortar mixer",
    assetTag: null,
    // Frozen: last written before the assignment history existed.
    assignedJobId: "job-warehouse",
    assignedJob: { name: "Warehouse Fitout" },
    assignments: [
      {
        id: "stay-1",
        jobId: "job-warehouse",
        sentOutOn: day("2026-02-01"),
        returnedOn: day("2026-02-10"),
        job: { name: "Warehouse Fitout" },
      },
    ],
  },
  {
    id: "eq-skid",
    name: "Skid steer",
    assetTag: "SS-114",
    assignedJobId: "job-warehouse",
    assignedJob: { name: "Warehouse Fitout" },
    assignments: [
      {
        id: "stay-2",
        jobId: "job-warehouse",
        sentOutOn: day("2026-03-01"),
        returnedOn: day("2026-03-09"),
        job: { name: "Warehouse Fitout" },
      },
      // Where it actually is: sent to Maple Street and never brought back.
      {
        id: "stay-3",
        jobId: "job-maple",
        sentOutOn: day("2026-08-20"),
        returnedOn: null,
        job: { name: "Maple Street" },
      },
    ],
  },
];

vi.mock("@prova/db", () => ({
  prisma: {
    equipment: {
      findMany: async (args: { select?: Select }) =>
        EQUIPMENT.map((row) => project(row, args.select)),
    },
  },
}));

type Row = {
  equipment: string;
  assetTag: string | null;
  assignedToJob: string | null;
  sentOutOn: string | null;
  available: boolean;
};

async function ask(): Promise<Row[]> {
  const { runTool } = await import("./handlers");
  const result = await runTool("company-1", "equipment_location", {});
  return result.data as Row[];
}

describe("equipment_location", () => {
  it("names the job from the open stay, not the frozen assignedJobId column", async () => {
    const rows = await ask();
    const skid = rows.find((r) => r.equipment === "Skid steer");

    expect(skid?.assignedToJob).toBe("Maple Street");
    expect(skid?.available).toBe(false);
  });

  it("says a piece with no open stay is in the yard, whatever the column says", async () => {
    const rows = await ask();
    const mixer = rows.find((r) => r.equipment === "Mortar mixer");

    // The frozen column claims Warehouse Fitout. The history says it came
    // back on the 10th of February and has not gone out since.
    expect(mixer?.assignedToJob).toBeNull();
    expect(mixer?.available).toBe(true);
  });

  it("reports the day it went out, so 'since when' needs no second question", async () => {
    const rows = await ask();
    expect(rows.find((r) => r.equipment === "Skid steer")?.sentOutOn).toBe("2026-08-20");
    expect(rows.find((r) => r.equipment === "Mortar mixer")?.sentOutOn).toBeNull();
  });

  it("never reads the deprecated column, so a reissued value cannot leak in", async () => {
    const rows = await ask();
    for (const row of rows) {
      expect(row.assignedToJob).not.toBe("Warehouse Fitout");
    }
  });
});
