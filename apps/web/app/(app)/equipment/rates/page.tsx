import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
import { EquipmentRateForm, EquipmentRateRowView } from "@/components/EquipmentRates";
import { NoAccess } from "@/components/NoAccess";
import { requireCapability } from "@/lib/authz";
import { equipmentRateRow } from "@/lib/equipment-rates-query";
import { viewerToday } from "@/lib/viewerToday";

export const metadata = { title: "Equipment rates" };

export const dynamic = "force-dynamic";

export default async function EquipmentRatesPage() {
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return <NoAccess capability="VIEW_JOB_COSTS" />;
  const { company, ...currentUser } = context;

  const [rows, today] = await Promise.all([
    prisma.equipmentRate.findMany({
      where: { companyId: company.id },
      orderBy: [{ name: "asc" }, { unit: "asc" }, { effectiveFrom: "desc" }],
    }),
    viewerToday(),
  ]);

  return (
    <PageShell width="working">
      <PageHeader route="/equipment" title="Equipment rates" subtitle="What each machine costs you per hour, day or week. A change order line can pick one, and the bid recap's markup goes on top." />
      <div className="mt-4">
        <EquipmentRateForm />
      </div>
      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">
          No rates yet. Add what a lift or a scaffold costs you, and change orders can fill it in instead of it being
          typed each time.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {rows.map((row) => (
            <EquipmentRateRowView key={row.id} rate={equipmentRateRow(row)} today={today} canDelete={currentUser.role === "OWNER"} />
          ))}
        </ul>
      )}
    </PageShell>
  );
}
