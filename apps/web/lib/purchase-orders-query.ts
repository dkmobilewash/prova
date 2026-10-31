import { prisma } from "@prova/db";
import { commitmentsByLine, type LineCommitment, type PurchaseOrderStatus } from "@/lib/purchase-orders";

/** Every PO line on a job, per scope line. Tenant scoping is the caller's: it
 * has already proved the job belongs to the company. */
export async function loadLineCommitments(jobId: string): Promise<Map<string, LineCommitment>> {
  const lines = await prisma.purchaseOrderLine.findMany({
    where: { purchaseOrder: { jobId } },
    select: { lineItemId: true, quantity: true, unitPrice: true, purchaseOrder: { select: { status: true } } },
  });
  return commitmentsByLine(
    lines.map((line) => ({
      lineItemId: line.lineItemId,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      status: line.purchaseOrder.status as PurchaseOrderStatus,
    })),
  );
}
