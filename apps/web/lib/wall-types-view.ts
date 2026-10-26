import { prisma } from "@prova/db";
import type { WallTypeView } from "@/components/WallTypes";
import type { WallComponentBasis } from "@/lib/wall-assemblies";

/**
 * Everything the wall-types screen renders, read once for a company.
 *
 * ONE LOADER FOR TWO PRODUCTS. The CRM's `/wall-types` and C Stream Bid's
 * `/bid/wall-types` render the same partition schedule with the same
 * components, and the screen's shape — which relations are included, how the
 * Decimals become strings, how a price-book entry and a craft are labelled —
 * lives here so the two pages cannot drift into two different schedules.
 * Moved verbatim out of `app/(app)/wall-types/page.tsx`; nothing about it
 * changed.
 */
export async function loadWallTypesScreen(companyId: string) {
  const [types, catalog, crafts, bidDefaults] = await Promise.all([
    prisma.wallType.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      include: {
        components: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        _count: { select: { runs: true } },
      },
    }),
    prisma.lineItemCatalogEntry.findMany({
      where: { companyId },
      orderBy: { description: "asc" },
      select: { id: true, description: true, unit: true },
    }),
    prisma.craftClassification.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, unionLocal: { select: { parentInternational: true, localNumber: true } } },
    }),
    // Only the waste figure. The recap rates on this row have no business on
    // this page, and selecting the whole thing would invite one of them being
    // rendered here later by accident.
    prisma.companyBidDefaults.findUnique({
      where: { companyId },
      select: { defaultWastePercent: true },
    }),
  ]);

  const views: WallTypeView[] = types.map((type) => ({
    id: type.id,
    code: type.code,
    name: type.name,
    sides: type.sides,
    studSpacingIn: type.studSpacingIn.toString(),
    defaultHeightFt: type.defaultHeightFt?.toString() ?? null,
    notes: type.notes,
    runCount: type._count.runs,
    components: type.components.map((c) => ({
      id: c.id,
      description: c.description,
      unit: c.unit,
      basis: c.basis as WallComponentBasis,
      factor: c.factor.toString(),
      wastePercent: c.wastePercent.toString(),
      roundUp: c.roundUp,
      productionRate: c.productionRate?.toString() ?? null,
      costCategory: c.costCategory,
      catalogEntryId: c.catalogEntryId,
      craftClassificationId: c.craftClassificationId,
    })),
  }));
  const catalogOptions = catalog.map((entry) => ({
    id: entry.id,
    label: entry.unit ? `${entry.description} (${entry.unit})` : entry.description,
  }));
  const craftOptions = crafts.map((craft) => ({
    id: craft.id,
    label: `${craft.unionLocal.parentInternational} ${craft.unionLocal.localNumber} — ${craft.name}`,
  }));

  return {
    views,
    catalogOptions,
    craftOptions,
    defaultWastePercent: bidDefaults?.defaultWastePercent?.toString() ?? null,
  };
}
