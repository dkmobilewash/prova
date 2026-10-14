import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /wall-types (declutter, 2026-10-13): the add form waits behind its button,
 * and each wall type is a closed row (tag · name · part count) that opens
 * into its edit form, its parts and the add-part form. Every card used to
 * be all of those, open, at once. Rendered from the real page.
 */

const dec = (n: number) => ({ toString: () => String(n) });

vi.mock("@prova/db", () => ({
  prisma: {
    wallType: {
      findMany: vi.fn(async () => [
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
    const html = renderToStaticMarkup(await WallTypesPage());
    expect(html).toMatch(/data-tour="wall-types-add"[^>]*>(?:<div>)?<button[^>]*>Add wall type</);
  });

  it("shows each wall type as one closed row with its tag and part count", async () => {
    const html = renderToStaticMarkup(await WallTypesPage());
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
