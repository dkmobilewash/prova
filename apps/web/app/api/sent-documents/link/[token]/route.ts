import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { readSentCopy, sentCopyResponse } from "@/lib/sent-document-store";

export const dynamic = "force-dynamic";

/** The link in a package email. A GC has no login, so the token is the whole of
 * the access control, as with the portal and e-sign links. It opens the one file
 * and nothing else, and stops working on its date. Anything wrong reads as gone,
 * so this cannot be used to learn what exists. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const gone = () => NextResponse.json({ error: "This link has expired. Ask the sender for a new one." }, { status: 404 });
  const sent = await prisma.sentDocument.findUnique({ where: { linkToken: token } });
  if (!sent?.linkExpiresAt || sent.linkExpiresAt.getTime() < Date.now()) return gone();
  const body = await readSentCopy(sent);
  return body ? sentCopyResponse(body, sent.fileName) : gone();
}
