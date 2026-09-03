import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { EquipmentForm } from "@/components/EquipmentForm";
import { EquipmentRow } from "@/components/EquipmentRow";

export default async function EquipmentPage() {
  const { company, ...currentUser } = await requireCompanyContext();

  const [equipment, jobs] = await Promise.all([
    prisma.equipment.findMany({
      where: { companyId: company.id },
      orderBy: { name: "asc" },
      include: { assignedJob: true },
    }),
    prisma.job.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "desc" } }),
  ]);

  const jobOptions = jobs.map((job) => ({ id: job.id, name: job.name }));
  const inYard = equipment.filter((item) => !item.assignedJobId).length;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Equipment</h1>
      <p className="mb-6 text-sm text-slate-400">
        Company-owned equipment — scaffolding, lifts, mixers — and which job each item is on right now.
        Costing equipment into jobs comes later; step one is knowing what you own and where it is.
      </p>

      <div className="mb-8">
        <EquipmentForm jobs={jobOptions} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-300">
          Inventory
          {equipment.length > 0 && (
            <span className="ml-2 font-normal text-slate-400">
              {equipment.length} item{equipment.length === 1 ? "" : "s"}, {inYard} in the yard
            </span>
          )}
        </h2>
        {equipment.length === 0 ? (
          <p className="text-slate-400">
            No equipment yet. Add the gear that moves between jobs — lifts, scaffolding, mixers — so you
            can tell where something is without calling the foreman.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {equipment.map((item) => (
              <EquipmentRow
                key={item.id}
                canDelete={currentUser.role === "OWNER"}
                jobs={jobOptions}
                item={{
                  id: item.id,
                  name: item.name,
                  type: item.type,
                  assetTag: item.assetTag,
                  assignedJobId: item.assignedJobId,
                  assignedJobName: item.assignedJob?.name ?? null,
                  notes: item.notes,
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
