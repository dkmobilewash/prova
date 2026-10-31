import { prisma } from "@prova/db";
import { sendRow, type SendRow } from "@/lib/document-email";
import { formatCalendarDate } from "@/lib/render-date";

/** Every send of these documents, newest first, by document id. Never reads the
 * file. Tenant scoping is by company here, because the ids come from the page. */
export async function loadSends(
  companyId: string,
  kind: "PURCHASE_ORDER" | "PAY_APPLICATION",
  documentIds: readonly string[],
): Promise<Map<string, SendRow[]>> {
  const rows = await prisma.sentDocument.findMany({
    where: { companyId, kind, documentId: { in: [...documentIds] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      documentId: true,
      sentOn: true,
      message: {
        select: {
          toAddress: true,
          events: { select: { id: true, type: true, occurredAt: true, detail: true } },
        },
      },
    },
  });
  const out = new Map<string, SendRow[]>();
  for (const row of rows) {
    const line = sendRow({
      id: row.id,
      sentOn: formatCalendarDate(row.sentOn),
      toAddress: row.message.toAddress,
      events: row.message.events.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() })),
    });
    out.set(row.documentId, [...(out.get(row.documentId) ?? []), line]);
  }
  return out;
}
