import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { EmptyState } from "@/components/EmptyState";
import { NewWallTypeForm, StarterWallTypesButton, WallTypeCard, type WallTypeView } from "@/components/WallTypes";
import type { WallComponentBasis } from "@/lib/wall-assemblies";

/**
 * The company's partition schedule — every wall type it builds, and what each
 * one is made of. A job's wall runs are priced from these; editing one here
 * changes an existing estimate only when that job's schedule is refreshed.
 */
export default async function WallTypesPage() {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { company } = context;

  const [types, catalog, crafts] = await Promise.all([
    prisma.wallType.findMany({
      where: { companyId: company.id },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      include: {
        components: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        _count: { select: { runs: true } },
      },
    }),
    prisma.lineItemCatalogEntry.findMany({
      where: { companyId: company.id },
      orderBy: { description: "asc" },
      select: { id: true, description: true, unit: true },
    }),
    prisma.craftClassification.findMany({
      where: { companyId: company.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, unionLocal: { select: { parentInternational: true, localNumber: true } } },
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
      catalogEntryId: c.catalogEntryId,
      craftClassificationId: c.craftClassificationId,
    })),
  }));
  const catalogOptions = catalog.map((entry) => ({ id: entry.id, label: entry.unit ? `${entry.description} (${entry.unit})` : entry.description }));
  const craftOptions = crafts.map((craft) => ({
    id: craft.id,
    label: `${craft.unionLocal.parentInternational} ${craft.unionLocal.localNumber} — ${craft.name}`,
  }));

  return (
    <PageShell width="working">
      <h1 className="mb-2 text-xl font-semibold text-ink">Wall types</h1>
      <p className="mb-6 max-w-3xl text-sm text-ink-body">
        Your partition schedule: each wall type by the tag the drawings give it, and what goes into a foot of it —
        studs, track, board, insulation. On a job you enter each run of wall by its type, length and height, and the
        estimate&rsquo;s lines are worked out from these. Link a part to your price book to price it, and give it your
        crew&rsquo;s rate to get the hours.
      </p>

      {views.length === 0 ? (
        <div className="mb-6 flex flex-col gap-3">
          <EmptyState
            data-tour="wall-types-empty"
            title="No wall types yet"
            purpose={
              <p>
                A floor plan tells you how many feet of wall there are. It does not tell you what the wall is or how
                tall — the partition schedule and the sections do. Put your wall types here once and every job&rsquo;s
                runs turn into studs, track and board by themselves.
              </p>
            }
            actions={[{ label: "Open your price book", href: "/catalog" }]}
          />
          <StarterWallTypesButton />
        </div>
      ) : (
        <ul data-tour="wall-types-list" className="mb-6 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {views.map((type) => (
            <WallTypeCard key={type.id} type={type} catalog={catalogOptions} crafts={craftOptions} />
          ))}
        </ul>
      )}

      <div data-tour="wall-types-add">
        <NewWallTypeForm />
      </div>
    </PageShell>
  );
}
