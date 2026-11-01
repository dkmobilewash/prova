import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readSentCopy, sentCopyResponse } from "@/lib/sent-document-store";

export const dynamic = "force-dynamic";

/** The kept copy of a sent document. Signed in, your own company, and the same
 * capability as the document's own page. Another company's id reads as missing,
 * so this cannot be used to learn which ids exist. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireApiContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const sent = await prisma.sentDocument.findUnique({ where: { id } });
  if (!sent || sent.companyId !== context.companyId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const capability = { PAY_APPLICATION: "MANAGE_BILLING", PURCHASE_ORDER: "VIEW_JOB_COSTS", SUBMITTAL_PACKAGE: "MANAGE_JOBS" } as const;
  if (!can(context, capability[sent.kind])) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await readSentCopy(sent);
  if (!body) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return sentCopyResponse(body, sent.fileName);
}
