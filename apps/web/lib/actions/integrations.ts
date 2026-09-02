"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, assertOwner, type ActionResult } from "./shared";

/**
 * Connect and disconnect for the framework's own providers.
 *
 * Failures come back as `{ ok: false, error }` rather than being thrown,
 * per the rule established in ./submittals.ts: Next.js redacts the message
 * of an error thrown from a Server Action in a production build, so a
 * thrown guard reads perfectly in dev and becomes an opaque digest for a
 * real user.
 *
 * Only SANDBOX exists this phase, and it deliberately talks to nothing. Its
 * whole purpose is to exercise the connection row, the sync log and the
 * page against a provider that cannot be down, so that when a real OAuth
 * flow is built the framework underneath it is already known to work.
 */

/** SANDBOX is the only provider this framework connects today. */
const SANDBOX = "SANDBOX" as const;

export async function connectSandboxIntegration(): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  try {
    assertOwner(user, "Only the account owner can connect an integration");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Not permitted");
  }

  const now = new Date();

  // The connection row and the log row that explains it are written
  // together or not at all. lastSyncedAt/lastSyncStatus summarise the log,
  // and the only way they can ever disagree with it is if one write can
  // land without the other — so neither can.
  await prisma.$transaction(async (tx) => {
    const connection = await tx.integrationConnection.upsert({
      // Reconnecting reuses the row rather than leaving a trail of dead
      // ones, so "is this connected?" is a lookup and never a sort.
      where: { companyId_provider: { companyId: company.id, provider: SANDBOX } },
      create: {
        companyId: company.id,
        provider: SANDBOX,
        status: "CONNECTED",
        externalAccountLabel: "Sandbox Account",
        externalAccountId: "sandbox-000",
        scopes: ["sandbox.read", "sandbox.write"],
        connectedByUserId: user.id,
        connectedAt: now,
        disconnectedAt: null,
        lastSyncedAt: now,
        lastSyncStatus: "SUCCESS",
      },
      update: {
        status: "CONNECTED",
        externalAccountLabel: "Sandbox Account",
        externalAccountId: "sandbox-000",
        scopes: ["sandbox.read", "sandbox.write"],
        connectedByUserId: user.id,
        connectedAt: now,
        disconnectedAt: null,
        lastSyncedAt: now,
        lastSyncStatus: "SUCCESS",
      },
    });

    await tx.integrationSyncLog.create({
      data: {
        connectionId: connection.id,
        direction: "PULL",
        status: "SUCCESS",
        message: "Connected to Sandbox Account. No external service was contacted.",
        occurredAt: now,
      },
    });
  });

  revalidatePath("/settings/integrations");
  return ok;
}

export async function disconnectSandboxIntegration(): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  try {
    assertOwner(user, "Only the account owner can disconnect an integration");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Not permitted");
  }

  const existing = await prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId: company.id, provider: SANDBOX } },
    select: { id: true },
  });
  if (!existing) return fail("That integration is not connected.");

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.integrationConnection.update({
      where: { id: existing.id },
      data: {
        status: "NOT_CONNECTED",
        disconnectedAt: now,
        // A real provider's credential is destroyed here, not merely
        // ignored: a disconnected connection holding a live token is a
        // token nobody is watching. The sandbox has none to clear.
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        scopes: [],
      },
    });

    // The log is append-only, so disconnecting does not erase the history of
    // what this connection did. That is the point of keeping it separate
    // from the connection row.
    await tx.integrationSyncLog.create({
      data: {
        connectionId: existing.id,
        direction: "PUSH",
        status: "SUCCESS",
        message: "Disconnected from Sandbox Account.",
        occurredAt: now,
      },
    });
  });

  revalidatePath("/settings/integrations");
  return ok;
}
