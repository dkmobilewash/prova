import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /wall-types (declutter, 2026-10-13): the add form waits behind its button,
 * and each wall type is a closed row (tag · name · part count) that opens
 * into its edit form, its parts and the add-part form. Every card used to
 * be all of those, open, at once. Rendered from the real page.
 */

const dec = (n: number) => ({ toString: () => String(n) });

/** The library the page reads. Each case may replace it; it resets to A1 alone. */
let extraTypes: { code: string }[] = [];

vi.mock("@prova/db", () => ({
  prisma: {
    wallType: {
      findMany: vi.fn(async () => [
        ...extraTypes.map((extra, index) => ({
          id: `wt-extra-${index}`,
          code: extra.code,
          name: `Company type ${extra.code}`,
          sides: 2,
          studSpacingIn: dec(16),
          defaultHeightFt: null,
          notes: null,
          _count: { runs: 0 },
          components: [],
        })),
        {
          id: "wt-1",
          code: "A1",
          name: "3-5/8 in. 20ga @ 16 o.c., one layer each side",
          sides: 2,
          studSpacingIn: dec(16),
          defaultHeightFt: null,
          notes: null,
          _count: { runs: 0 },
          components: [
            {
              id: "p-1",
              name: "Studs",
              unit: "EA",
              basis: "STUD",
              factor: dec(1),
              wastePercent: dec(5),
              roundUp: true,
              productionRate: null,
              costCategory: "MATERIAL",
              catalogEntryId: null,
              craftClassificationId: null,
            },
          ],
        },
      ]),
    },
    lineItemCatalogEntry: { findMany: vi.fn(async () => []) },
    craftClassification: { findMany: vi.fn(async () => []) },
    companyBidDefaults: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/authz", () => ({
  requireCapability: vi.fn(async () => ({ allowed: true, context: { company: { id: "co-1" }, role: "OWNER" } })),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/wall-types", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions", () => ({
  addStarterWallTypes: vi.fn(),
  addWallTypeComponent: vi.fn(),
  createWallType: vi.fn(),
  deleteWallType: vi.fn(),
  removeWallTypeComponent: vi.fn(),
  updateWallType: vi.fn(),
  updateWallTypeComponent: vi.fn(),
}));

const { default: WallTypesPage } = await import("@/app/(app)/wall-types/page");

describe("/wall-types", () => {
  it("keeps the add form behind its button", async () => {
    const html = renderToStaticMarkup(await WallTypesPage({}));
    expect(html).toMatch(/data-tour="wall-types-add"[^>]*>(?:<div>)?<button[^>]*>Add wall type</);
  });

  it("shows each wall type as one closed row with its tag and part count", async () => {
    const html = renderToStaticMarkup(await WallTypesPage({}));
    const row = html.match(/<details name="wall-type"[\s\S]*?<\/details>/)?.[0] ?? "";
    expect(row, "the wall type rendered as a row").toContain("A1");
    expect(row).not.toMatch(/<details[^>]* open/);
    const summary = row.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "";
    expect(summary).toContain("1 part");
    expect(summary, "no form controls in the closed line").not.toContain("<input");
    // Its edit forms are inside the row, one click away.
    expect(row).toContain("<form");
  });
});

/**
 * ISSUE #818: THE STARTERS STAYED HIDDEN ONCE ANY WALL TYPE EXISTED.
 *
 * The button lived only in the empty state, so a company whose first type was
 * read off a partition schedule (A1 here) could never get W1, ACT1 or FTG1
 * without typing them. It is offered now while ANY starter is missing, and it
 * says how many it will add — the count from `missingStarterTypes`, the same
 * function `addStarterWallTypes` uses to decide what to write.
 */
describe("/wall-types starter assemblies (#818)", () => {
  beforeEach(() => {
    extraTypes = [];
  });

  const starterButton = (html: string) =>
    html.match(/<button[^>]*data-wall-types="add-starters"[^>]*>([^<]*)<\/button>/)?.[1] ?? null;

  it("is still offered beside a library that has types of its own, and says it adds all twelve", async () => {
    const html = renderToStaticMarkup(await WallTypesPage({}));
    expect(html, "the library rendered as a list").toContain('data-tour="wall-types-list"');
    expect(starterButton(html), "no starter button beside a non-empty library").toBe(
      "Start from the common trade assemblies (adds 12)",
    );
  });

  it("counts only the missing ones, case-insensitively, and names them", async () => {
    extraTypes = [{ code: "W1" }, { code: "w2" }, { code: "ACT1" }];
    const html = renderToStaticMarkup(await WallTypesPage({}));
    expect(starterButton(html)).toBe("Start from the common trade assemblies (adds 9)");
    expect(html).toContain("W3, EW1, FIN5, ACT2, GYPC1, FLR1, PT1, SLB1, FTG1");
    expect(html).toContain("left as they are");
  });

  it("says one, not ones, for the last missing starter", async () => {
    extraTypes = ["W1", "W2", "W3", "EW1", "FIN5", "ACT1", "ACT2", "GYPC1", "FLR1", "PT1", "SLB1"].map((code) => ({ code }));
    const html = renderToStaticMarkup(await WallTypesPage({}));
    expect(starterButton(html)).toBe("Start from the common trade assemblies (adds 1)");
  });

  it("is gone once every starter is in the library", async () => {
    extraTypes = ["W1", "W2", "W3", "EW1", "FIN5", "ACT1", "ACT2", "GYPC1", "FLR1", "PT1", "SLB1", "FTG1"].map((code) => ({ code }));
    const html = renderToStaticMarkup(await WallTypesPage({}));
    expect(html).toContain("FTG1");
    expect(starterButton(html)).toBeNull();
    expect(html).not.toContain("common trade assemblies");
    // Not even an empty box where it was.
    expect(html).not.toContain('data-wall-types="starters"');
  });
});

/**
 * C STREAM BID'S /bid/wall-types — the same button, Bid's trades only. Bid is
 * for framing/drywall, plaster, EIFS, ceilings and fireproofing; its press used
 * to add flooring, paint, slab and footing too (browser test, 2026-10-30).
 */
describe("/bid/wall-types starter assemblies", () => {
  beforeEach(() => {
    extraTypes = [];
  });

  const starterButton = (html: string) =>
    html.match(/<button[^>]*data-wall-types="add-starters"[^>]*>([^<]*)<\/button>/)?.[1] ?? null;
  const bidPage = async () => (await import("@/app/bid/(signed-in)/wall-types/page")).default;

  it("offers eight, and names none of the other trades'", async () => {
    extraTypes = [{ code: "W1" }];
    const html = renderToStaticMarkup(await (await bidPage())({}));
    expect(starterButton(html)).toBe("Start from the common trade assemblies (adds 7)");
    expect(html).toContain("W2, W3, EW1, FIN5, ACT1, ACT2, GYPC1.");
    for (const code of ["FLR1", "PT1", "SLB1", "FTG1"]) expect(html).not.toContain(code);
  });

  it("is gone once Bid's eight are there, though the CRM's other four are not", async () => {
    extraTypes = ["W1", "W2", "W3", "EW1", "FIN5", "ACT1", "ACT2", "GYPC1"].map((code) => ({ code }));
    const html = renderToStaticMarkup(await (await bidPage())({}));
    expect(starterButton(html)).toBeNull();
  });
});
