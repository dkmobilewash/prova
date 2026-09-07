import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { EquipmentForm } from "@/components/EquipmentForm";
import { EquipmentRow } from "@/components/EquipmentRow";
import { EquipmentDeploymentControls } from "@/components/EquipmentDeploymentControls";
import {
  type AssignmentData,
  deploymentToday,
  stayLength,
  utilisation,
} from "@/components/equipmentDeployment";

export const dynamic = "force-dynamic";

/** How far back utilisation is measured. A quarter is long enough that one
 * quiet fortnight doesn't read as an idle machine, and short enough to
 * describe the season you're actually in. */
const WINDOW_DAYS = 90;

export default async function EquipmentPage() {
  const { context, allowed } = await requireCapability("MANAGE_FIELD");
  if (!allowed) return <NoAccess capability="MANAGE_FIELD" />;
  const { company, ...currentUser } = context;

  const [equipment, jobs] = await Promise.all([
    prisma.equipment.findMany({
      where: { companyId: company.id },
      orderBy: { name: "asc" },
      include: {
        assignments: {
          include: { job: { select: { id: true, name: true } } },
          orderBy: { sentOutOn: "desc" },
        },
      },
    }),
    prisma.job.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "desc" } }),
  ]);

  const jobOptions = jobs.map((job) => ({ id: job.id, name: job.name }));

  // Dates are stored and rendered at UTC midnight, so "today" is the UTC
  // date. The user's own calendar date is only ever a form default.
  const today = new Date().toISOString().slice(0, 10);
  const windowStart = new Date(Date.parse(`${today}T00:00:00.000Z`) - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const items = equipment.map((item) => {
    const history: AssignmentData[] = item.assignments.map((a) => ({
      id: a.id,
      equipmentId: item.id,
      equipmentName: item.name,
      jobId: a.job.id,
      jobName: a.job.name,
      sentOutOn: a.sentOutOn.toISOString().slice(0, 10),
      returnedOn: a.returnedOn ? a.returnedOn.toISOString().slice(0, 10) : null,
      notes: a.notes,
    }));

    return {
      item,
      history,
      // Where it is NOW — derived from the history, never read from
      // Equipment.assignedJobId. That column still exists, nothing writes
      // it, and it is frozen at the day the writes stopped; a stored copy
      // of a derived fact eventually disagrees with what it was derived
      // from. This comment used to assert that nothing in the app consulted
      // the column, which was false — Ask's equipment_location handler did,
      // and answered from the frozen value. Both now come through
      // currentAssignment(). See components/equipmentDeployment.ts.
      //
      // deploymentToday, not currentAssignment: a stay dated ahead is a plan
      // and the machine is still in the yard until it starts.
      where: deploymentToday(history, today),
      use: utilisation(history, windowStart, today, item.createdAt.toISOString().slice(0, 10)),
    };
  });

  // A piece spoken for next Tuesday is in the yard today, and this count has
  // to agree with the line each row prints or the page argues with itself.
  const inYard = items.filter((i) => i.where.kind !== "out").length;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Equipment</h1>
      <p className="mb-6 text-sm text-slate-400">
        Company-owned equipment, where each piece is, and how hard it has been working. Where
        something is now is worked out from its assignment history rather than stored, so a lift
        can never be recorded in two places at once.
      </p>

      <div className="mb-8">
        <EquipmentForm />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-300">
          Inventory
          {items.length > 0 && (
            <span className="ml-2 font-normal text-slate-500">
              {items.length} item{items.length === 1 ? "" : "s"}, {inYard} in the yard
            </span>
          )}
        </h2>
        {items.length === 0 ? (
          <p className="text-slate-400">
            No equipment yet. Add the gear that moves between jobs — lifts, scaffolding, mixers —
            so you can tell where something is without calling the foreman.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {items.map(({ item, history, where, use }) => (
              <li key={item.id} className="p-4">
                <EquipmentRow
                  canDelete={currentUser.role === "OWNER"}
                  item={{
                    id: item.id,
                    name: item.name,
                    type: item.type,
                    assetTag: item.assetTag,
                    notes: item.notes,
                  }}
                />

                {/* The ONE place this row says where the piece is. EquipmentRow
                    printed it too, from the same value, so the card read as if
                    it were stating two separate facts. */}
                <p className="mt-1 text-xs text-slate-500">
                  {where.kind === "out"
                    ? `${stayLength(where.stay, today)} on ${where.stay.jobName}`
                    : where.kind === "planned"
                      ? `In the yard · ${stayLength(where.stay, today)} to ${where.stay.jobName}`
                      : "In the yard"}
                  {use.percent === null ? (
                    <> · too new to say how used it is</>
                  ) : (
                    <>
                      {" "}
                      · out {use.daysOut} of the last {use.daysTracked} days ({use.percent}%)
                    </>
                  )}
                </p>

                <EquipmentDeploymentControls
                  equipmentId={item.id}
                  jobs={jobOptions}
                  history={history}
                  today={today}
                  canDelete={currentUser.role === "OWNER"}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
