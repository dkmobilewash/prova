"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { linkToken } from "@/lib/tokens";
import { isUniqueConstraintError, type ActionResultWith } from "./shared";

/**
 * The "Subscribe in your calendar" section on /schedule.
 *
 * NO CAPABILITY GATE, deliberately: /schedule itself is open to every
 * signed-in member (it is absent from ROUTE_CAPABILITY on purpose), the
 * feed serves exactly what that page shows, and the token being minted
 * is the CALLER'S OWN — each person gets their own row, keyed
 * (companyId, userId), so nobody here can create, read or rotate anyone
 * else's link. That per-person key is also why there is no ownerRefusal:
 * rotating your own credential is not a destructive action on shared
 * data.
 */

/** The caller's feed token, creating one on first use. Returns the token
 * string; the component builds the URL from its own origin. */
export async function ensureCalendarFeedToken(): Promise<ActionResultWith<string>> {
  const context = await requireCompanyContext();
  const companyId = context.company.id;

  const existing = await prisma.calendarFeedToken.findUnique({
    where: { companyId_userId: { companyId, userId: context.id } },
    select: { token: true },
  });
  if (existing) return { ok: true, value: existing.token };

  const token = linkToken();
  try {
    await prisma.calendarFeedToken.create({ data: { companyId, userId: context.id, token } });
  } catch (error) {
    // Two tabs pressing Create together: the other tab's row is the one
    // that exists now, and ITS token is the answer — minting a second
    // would 404 the link the other tab is already showing.
    if (isUniqueConstraintError(error)) {
      const raced = await prisma.calendarFeedToken.findUnique({
        where: { companyId_userId: { companyId, userId: context.id } },
        select: { token: true },
      });
      if (raced) return { ok: true, value: raced.token };
    }
    throw error;
  }
  revalidatePath("/schedule");
  return { ok: true, value: token };
}

/**
 * Replace the caller's token with a fresh one. The old URL dies the
 * moment this commits — it matches no row, so the feed 404s it exactly
 * like a token that never existed. That IS the revocation: subscribed
 * calendars holding the old link stop updating and the person re-adds
 * the new one.
 */
export async function regenerateCalendarFeedToken(): Promise<ActionResultWith<string>> {
  const context = await requireCompanyContext();
  const companyId = context.company.id;

  const token = linkToken();
  await prisma.calendarFeedToken.upsert({
    where: { companyId_userId: { companyId, userId: context.id } },
    create: { companyId, userId: context.id, token },
    update: { token },
  });
  revalidatePath("/schedule");
  return { ok: true, value: token };
}
