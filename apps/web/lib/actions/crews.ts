"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { workerFromValue } from "@/lib/crew-schedule";
import { actionFail, actionOk, isUniqueConstraintError, ownerRefusal, type ActionResult } from "./shared";

/**
 * Saved crews: a name for the people who usually go out together, so the
 * schedule form can tick them in one pick.
 *
 * A picking aid, never a record — see the Crew model. Nothing here touches
 * a planned day: the bulk schedule action still receives the ticked people
 * one by one. Gated on MANAGE_FIELD, the same capability as writing the
 * schedule (lib/actions/crewSchedule.ts), because the only place a crew is
 * used is that form. Archiving is owner-only, refused with `ownerRefusal`
 * so the sentence reaches the person rather than a redacted digest.
 */

const NO_PERMISSION = "Only someone with field access can change saved crews.";
const NAME_MAX = 60;

function crewName(formData: FormData): string {
  return String(formData.get("crewName") ?? "").trim();
}

/**
 * "Save these people as a crew". Saving under a name that already exists
 * REPLACES that crew's people — that is how a crew is updated, and it is
 * also how an archived crew comes back, so a name is never stuck behind
 * the unique key on a crew nobody can see.
 */
export async function saveCrew(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  if (!can(user, "MANAGE_FIELD")) return actionFail(NO_PERMISSION);

  const name = crewName(formData);
  if (!name) return actionFail("Give the crew a name.");
  if (name.length > NAME_MAX) return actionFail(`Keep the crew name under ${NAME_MAX} characters.`);

  const raw = [...new Set(formData.getAll("worker").map((v) => String(v).trim()).filter(Boolean))];
  const workers = raw.map(workerFromValue);
  if (workers.length === 0) return actionFail("Tick the people who are in this crew first.");
  if (workers.some((w) => w === null)) return actionFail("That person is not on your account.");

  // Re-read through THIS company rather than trusted from the form, the same
  // rule scheduleCrewDay follows. An archived crew member is refused: they
  // would never show as a checkbox to tick.
  const userIds = workers.flatMap((w) => (w && "scheduledUserId" in w ? [w.scheduledUserId] : []));
  const crewIds = workers.flatMap((w) => (w && "crewMemberId" in w ? [w.crewMemberId] : []));
  const [users, crew] = await Promise.all([
    prisma.user.count({ where: { id: { in: userIds }, companyId: company.id } }),
    prisma.crewMember.count({ where: { id: { in: crewIds }, companyId: company.id, archivedAt: null } }),
  ]);
  if (users !== userIds.length || crew !== crewIds.length) {
    return actionFail("Someone ticked is not on your account, or has been archived.");
  }

  await prisma.$transaction(async (tx) => {
    const saved = await tx.crew.upsert({
      where: { companyId_name: { companyId: company.id, name } },
      create: { companyId: company.id, name },
      update: { archivedAt: null },
      select: { id: true },
    });
    await tx.crewMembership.deleteMany({ where: { crewId: saved.id } });
    await tx.crewMembership.createMany({
      data: workers.map((w) => ({ crewId: saved.id, ...w! })),
    });
  });

  revalidatePath("/schedule");
  return actionOk;
}

export async function renameCrew(crewId: string, formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  if (!can(user, "MANAGE_FIELD")) return actionFail(NO_PERMISSION);

  const name = crewName(formData);
  if (!name) return actionFail("Give the crew a name.");
  if (name.length > NAME_MAX) return actionFail(`Keep the crew name under ${NAME_MAX} characters.`);

  try {
    // Scoped in the WHERE, so another company's crew simply does not match.
    const { count } = await prisma.crew.updateMany({ where: { id: crewId, companyId: company.id }, data: { name } });
    if (count === 0) return actionFail("That crew no longer exists.");
  } catch (err) {
    if (isUniqueConstraintError(err)) return actionFail(`There is already a crew called "${name}".`);
    throw err;
  }

  revalidatePath("/schedule");
  return actionOk;
}

/** Hides a crew from the picker. Nothing is deleted and no planned day
 * changes; saving the same name again brings it back. */
export async function archiveCrew(crewId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return actionFail(NO_PERMISSION);
  const refusal = ownerRefusal(context, "Only the account owner can archive a crew.");
  if (refusal) return refusal;

  const { count } = await prisma.crew.updateMany({
    where: { id: crewId, companyId: context.company.id, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (count === 0) return actionFail("That crew is already archived or no longer exists.");

  revalidatePath("/schedule");
  return actionOk;
}
