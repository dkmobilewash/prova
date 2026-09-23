import { NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { DocuSignApiError } from "@prova/integrations";
import { verifyDocuSignSignature } from "./hmac";
import { DOCUSIGN_WEBHOOK_ENV } from "./setup";
import {
  DocuSignNotConfiguredError,
  DocuSignNotConnectedError,
  DocuSignReconnectError,
} from "./connection";
import { syncDocuSignEnvelope, type SyncDeps } from "./sync";

/**
 * DocuSign Connect (webhook) receiver — the dedicated route the generic
 * /api/integrations/webhooks/[provider] TODO asked for. That route no longer
 * accepts DOCUSIGN at all, so there is one way in and it is this one.
 *
 * ORDER, and every step refuses before the next is reached:
 *
 *   1. No HMAC key on this install -> 503, nothing read. A receiver that
 *      cannot verify must not process.
 *   2. Body over the cap -> 413. Read as raw BYTES, because the signature is
 *      over the exact bytes sent (lib/docusign/hmac.ts).
 *   3. No X-DocuSign-Signature-N matches -> 401, nothing parsed, nothing
 *      looked up. An anonymous caller learns only that it is unsigned.
 *   4. Signed but not about an envelope this install sent -> 200 and a log
 *      line (DocuSign retries a non-200, and retrying will not change the
 *      answer).
 *   5. Found -> `syncDocuSignEnvelope` for THAT envelope's company, which
 *      reads the envelope back from DocuSign with that company's token. The
 *      body's own status is never applied: a message only says "look again".
 *
 * The envelope is matched on DocuSign's envelope id (unique here) AND the
 * account the message names — an envelope id from one DocuSign account
 * delivered under another is ignored.
 *
 * Answers 500 only for a transient failure worth DocuSign retrying (the
 * DocuSign read failed, the database failed); a dead connection answers 200
 * with the connection marked for reconnect, since no retry can fix that.
 */


/** JSON SIM without documents is a few KB; this leaves ample room and still
 * bounds what an unsigned caller can make the process read. */
export const DOCUSIGN_CONNECT_MAX_BYTES = 512 * 1024;

type Payload = { event?: unknown; data?: { accountId?: unknown; envelopeId?: unknown } };

export async function handleDocuSignConnect(request: Request, deps: SyncDeps = {}): Promise<Response> {
  const key = process.env[DOCUSIGN_WEBHOOK_ENV]?.trim();
  if (!key) {
    console.warn("[docusign] Connect message refused: DOCUSIGN_CONNECT_HMAC_KEY is not set on this install.");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > DOCUSIGN_CONNECT_MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > DOCUSIGN_CONNECT_MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  if (!verifyDocuSignSignature(body, request.headers, key)) {
    console.warn("[docusign] Connect message refused: no signature header matched.");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Payload | null = null;
  try {
    payload = JSON.parse(Buffer.from(body).toString("utf8")) as Payload;
  } catch {
    payload = null;
  }
  const envelopeId = typeof payload?.data?.envelopeId === "string" ? payload.data.envelopeId : null;
  const accountId = typeof payload?.data?.accountId === "string" ? payload.data.accountId : null;
  const event = typeof payload?.event === "string" ? payload.event : "unknown";
  if (!envelopeId || !accountId) {
    console.warn(`[docusign] Signed Connect message (${event}) named no envelope and account; ignored.`);
    return NextResponse.json({ received: true });
  }

  const envelope = await prisma.docuSignEnvelope.findFirst({
    where: { envelopeId, docusignAccountId: accountId },
    select: { id: true, companyId: true },
  });
  if (!envelope) {
    console.warn(`[docusign] Signed Connect message (${event}) for an envelope this install did not send; ignored.`);
    return NextResponse.json({ received: true });
  }

  try {
    await syncDocuSignEnvelope(envelope.companyId, envelope.id, deps);
  } catch (error) {
    if (
      error instanceof DocuSignReconnectError ||
      error instanceof DocuSignNotConnectedError ||
      error instanceof DocuSignNotConfiguredError
    ) {
      console.warn(`[docusign] Connect message (${event}) could not be read back: ${(error as Error).name}.`);
      return NextResponse.json({ received: true });
    }
    console.error("[docusign] Connect message processing failed", {
      event,
      name: (error as Error)?.name,
      message: error instanceof DocuSignApiError ? error.message : undefined,
    });
    return NextResponse.json({ error: "Try again" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
