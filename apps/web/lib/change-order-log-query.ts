import { prisma } from "@prova/db";
import type { ChangeOrderStatus } from "@/components/changeOrderStates";
import { changeOrderValueDelta } from "@/lib/change-order";
import type { ChangeOrderForLog } from "@/lib/change-order-log";

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

/** Every change order on a job with the value its card shows: the same helper over
 * the same line items, deleted ones included, as the Estimate tab. Null when the
 * job is not this company's. */
export async function loadChangeOrdersForLog(jobId: string, companyId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    select: {
      id: true,
      name: true,
      changeOrders: {
        orderBy: { number: "asc" },
        select: {
          number: true,
          title: true,
          status: true,
          submittedOn: true,
          decidedOn: true,
          proposals: true,
          supersedes: { select: { number: true } },
        },
      },
    },
  });
  if (!job) return null;
  const targets = await prisma.jobLineItem.findMany({
    where: { jobId },
    select: { id: true, description: true, quantity: true, unitPrice: true, isDeleted: true },
  });
  const targetsById = new Map(targets.map((item) => [item.id, item]));
  const changeOrders: ChangeOrderForLog[] = job.changeOrders.map((co) => ({
    number: co.number,
    title: co.title,
    status: co.status as ChangeOrderStatus,
    submittedOn: day(co.submittedOn),
    decidedOn: day(co.decidedOn),
    amount: Number(changeOrderValueDelta(co.proposals, targetsById)),
    revises: co.supersedes?.number ?? null,
  }));
  return { jobName: job.name, changeOrders };
}
