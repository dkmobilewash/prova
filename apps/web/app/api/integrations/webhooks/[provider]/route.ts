import { NextResponse } from "next/server";
import { prisma } from "@prova/db";
import type { IntegrationProvider } from "@prova/db";

/**
 * Generic inbound webhook receiver.
 *
 * One route for every provider, because the part that is the same for all of
 * them — accept it, write down that it arrived, answer 200 — is the part
 * worth building once. The part that differs is signature verification, and
 * that is deferred to whichever phase brings a provider that has one.
 *
 * TODO(phase 2+): verify provider-specific signature before trusting payload.
 *
 * UNTIL THEN, THIS ROUTE TRUSTS NOTHING IT RECEIVES. That is not a slogan;
 * it is why the handler below does so little. It is public and
 * unauthenticated by necessity — a provider's servers have no session — so
 * anything it did with the body would be something an anonymous caller could
 * make it do. So it does not parse the payload into any record, does not
 * change a connection's status, and does not store the body. It writes one
 * row saying a webhook arrived.
 *
 * Two consequences worth stating rather than discovering:
 *
 * Writing a row at all is an unauthenticated write, which is a
 * storage-amplification vector. It is bounded here by a body-size cap and
 * by requiring the payload to name an account that an existing connection
 * already claims — an attacker needs a real externalAccountId, not just the
 * URL. Signature verification is the real fix and arrives with the first
 * real provider.
 *
 * And an unattributable webhook is NOT written down. IntegrationSyncLog
 * hangs off a connection; a row belonging to none is orphan data nobody
 * will ever read. It goes to the server log instead, which is where an
 * operator looks when a provider says it delivered and the page disagrees.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mirrors the IntegrationProvider enum. A path outside it is a bad URL. */
const PROVIDERS = ["SANDBOX", "QUICKBOOKS", "DOCUSIGN", "PROCORE", "MYCOI"] as const;

function asProvider(value: string): IntegrationProvider | null {
  const upper = value.toUpperCase();
  return (PROVIDERS as readonly string[]).includes(upper) ? (upper as IntegrationProvider) : null;
}

/** 64 KB. Larger than any provider's notification, small enough that this
 * route cannot be used to push arbitrary volume at the process. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * The account a payload claims to be about.
 *
 * Providers disagree on the field name, so this checks the handful in
 * common use rather than pretending there is a standard. It reads ONLY this
 * one value out of the body — nothing else in the payload is looked at,
 * which is the point.
 */
function claimedAccountId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const body = payload as Record<string, unknown>;
  for (const field of ["externalAccountId", "realmId", "accountId", "companyId"]) {
    const value = body[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: raw } = await params;
  const provider = asProvider(raw);
  if (!provider) {
    // A 404 rather than a 200: this is not a delivery that failed, it is a
    // URL that does not exist, and answering 200 would tell a provider its
    // misconfigured endpoint was fine.
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let payload: unknown = null;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    // Not JSON. Still a delivery, still answered 200 — a provider that gets
    // a 4xx here will retry the same unparseable body on a schedule.
    payload = null;
  }

  const externalAccountId = claimedAccountId(payload);

  const connection = externalAccountId
    ? await prisma.integrationConnection.findFirst({
        where: { provider, externalAccountId },
        // The id is all this route needs. An unauthenticated handler has no
        // business holding a credential in memory.
        select: { id: true },
      })
    : null;

  if (!connection) {
    // Deliberately identical to the success response. Telling an anonymous
    // caller whether an account is connected here would answer a question
    // they have no business asking.
    console.warn(
      `[integrations] ${provider} webhook could not be attributed to a connection` +
        `${externalAccountId ? " for the account it named" : " (no account id in payload)"}.`,
    );
    return NextResponse.json({ received: true });
  }

  const occurredAt = new Date();

  // ONLY the log row. This handler is unauthenticated, and it used to also
  // stamp `lastSyncedAt` / `lastSyncStatus: "SUCCESS"` on the connection —
  // which made an anonymous caller the author of the one field an operator
  // reads to decide whether an integration is healthy, on a connection they
  // did not choose and may have disconnected.
  //
  // The bound that was supposed to make that safe did not exist. The header
  // above says an attacker "needs a real externalAccountId, not just the
  // URL"; `connectSandboxIntegration` sets that id to the literal
  // "sandbox-000" for every company, so it is a constant in this repo. The
  // lookup is also a `findFirst` with no company scope, so with more than
  // one company connected it resolves to an arbitrary tenant.
  //
  // A log row is what this route is for and is honest about its own
  // provenance — `direction: WEBHOOK_RECEIVED` says where it came from.
  // Connection HEALTH is a claim about a real exchange, and only the
  // authenticated sync path gets to make it.
  await prisma.integrationSyncLog.create({
    data: {
      connectionId: connection.id,
      direction: "WEBHOOK_RECEIVED",
      status: "SUCCESS",
      // A summary, never the payload: it carries customer names and
      // amounts that do not need a second copy, and sometimes secrets.
      message: `Webhook received from ${provider}.`,
      occurredAt,
    },
  });

  return NextResponse.json({ received: true });
}
