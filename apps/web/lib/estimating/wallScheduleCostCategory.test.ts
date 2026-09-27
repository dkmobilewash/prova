import { describe, expect, it } from "vitest";
import { syncWallScheduleLines } from "./wall-schedule";

/**
 * What cost type a wall-schedule line arrives with — #513.
 *
 * WHY THIS WRITER GETS ITS OWN TEST. `bid-recap.ts` marks up BY cost type and
 * marks an uncategorised line up at NOTHING, on purpose. Not one of the four
 * automated line-creating paths set it, so every generated line landed uncoded —
 * and this is the writer that matters most, because a wall type's board, studs
 * and track are the largest block of a framing bid. A job taken off entirely
 * from wall types carried **zero markup** until somebody hand-coded every row.
 *
 * THE RULE, and it is new rather than inherited: the COMPONENT first, its
 * catalog entry second, null if neither. The component is the more specific
 * statement — a wall type is the one place "board is material, finishing is
 * labor" is knowable up front — and it is the same precedence
 * `craftClassificationId` uses one line below it in the same literal.
 *
 * The NULL case is asserted as hard as the set ones. A default of MATERIAL here
 * would be precisely the number `bid-recap.ts`'s own comment refuses, applied to
 * the biggest lines on the bid.
 *
 * The transaction client is a parameter of `syncWallScheduleLines`, so this
 * needs no database and no Prisma mock module — just an object with the four
 * methods it calls. That is the function's own design paying off.
 */

type Row = Record<string, unknown>;

/** The rows a `jobLineItem.create` was asked to write. */
function fakeTx(components: Row[]) {
  const created: Row[] = [];
  const updated: Row[] = [];
  const tx = {
    wallRun: {
      findMany: async () => [
        {
          id: "run-1",
          label: "Corridor",
          wallTypeId: "wt-1",
          lengthFt: 100,
          heightFt: 9,
          sortOrder: 0,
          createdAt: new Date(),
        },
      ],
    },
    wallType: {
      findMany: async () => [
        {
          id: "wt-1",
          code: "W2",
          companyId: "co-1",
          defaultHeightFt: 9,
          sortOrder: 0,
          components,
        },
      ],
    },
    jobLineItem: {
      findMany: async () => [],
      create: async ({ data }: { data: Row }) => {
        created.push(data);
        return { id: `li-${created.length}` };
      },
      update: async ({ data }: { data: Row }) => {
        updated.push(data);
        return {};
      },
    },
  };
  return { tx, created, updated };
}

/** One board component, with whatever category pair the case needs. */
function component(over: Row = {}): Row {
  return {
    id: "c-1",
    description: '5/8" Type X board',
    unit: "SF",
    basis: "WALL_AREA",
    factor: 1,
    wastePercent: 0,
    roundUp: false,
    productionRate: null,
    costCategory: null,
    craftClassificationId: null,
    catalogEntryId: null,
    catalogEntry: null,
    sortOrder: 0,
    createdAt: new Date(),
    ...over,
  };
}

const catalogEntry = (costCategory: string | null): Row => ({
  id: "cat-1",
  description: '5/8" Type X board',
  unit: "SF",
  defaultUnitPrice: 2.85,
  defaultBudgetedUnitCost: 1.9,
  defaultLaborHours: null,
  productionRate: null,
  tradeScope: null,
  costCategory,
  craftClassificationId: null,
});

async function categoryOfCreatedLine(components: Row[]) {
  const { tx, created } = fakeTx(components);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await syncWallScheduleLines(tx as any, "co-1", "job-1");
  expect(created.length, "the fake should have produced one line").toBe(1);
  return created[0].costCategory;
}

describe("a wall-schedule line's cost type", () => {
  it("comes from the COMPONENT when the component has one", async () => {
    expect(await categoryOfCreatedLine([component({ costCategory: "MATERIAL" })])).toBe("MATERIAL");
  });

  it("falls back to the linked catalog entry when the component has none", async () => {
    expect(
      await categoryOfCreatedLine([
        component({ catalogEntryId: "cat-1", catalogEntry: catalogEntry("MATERIAL") }),
      ]),
    ).toBe("MATERIAL");
  });

  it("prefers the COMPONENT over its catalog entry when the two disagree", async () => {
    // The specific beats the general. A wall type may use a catalog item in a
    // way the catalog entry does not describe — the finishing component priced
    // from a board entry, say — and the assembly is the better authority.
    expect(
      await categoryOfCreatedLine([
        component({ costCategory: "LABOR", catalogEntryId: "cat-1", catalogEntry: catalogEntry("MATERIAL") }),
      ]),
    ).toBe("LABOR");
  });

  it("is NULL when neither has one, rather than defaulting to MATERIAL", async () => {
    // The case with the money in it. These are the biggest lines on a framing
    // bid; a default here would mark them all up at the material rate without
    // anybody choosing it.
    const category = await categoryOfCreatedLine([component()]);
    expect(category).toBeNull();
    expect(category).not.toBe("MATERIAL");
  });

  it("is null when the catalog entry has none either", async () => {
    expect(
      await categoryOfCreatedLine([
        component({ catalogEntryId: "cat-1", catalogEntry: catalogEntry(null) }),
      ]),
    ).toBeNull();
  });
});
