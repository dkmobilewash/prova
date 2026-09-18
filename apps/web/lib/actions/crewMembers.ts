"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { crewMemberName } from "@/lib/worker-name";
import { actionFail as fail, actionOk as ok, ownerRefusal, type ActionResult } from "./shared";

/**
 * Takes a crew member off the crew. There is no delete, on purpose: a person
 * named on a filed payroll cannot stop having existed (CrewMember in
 * crew.prisma). Archiving keeps every hour and every name exactly as it was;
 * it only stops the person being offered for NEW hours — the phone's crew
 * list and the time-entry API both leave archived people out.
 *
 * Owner-only and MANAGE_FIELD, the same pair that can import crew: whoever
 * can put a person on the crew can take them off it.
 */
export async function archiveCrewMember(crewMemberId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const refusal = ownerRefusal(context, "Only the account owner can archive crew members.");
  if (refusal) return refusal;
  if (!can(context, "MANAGE_FIELD")) {
    return fail("Managing the crew isn't part of your job function. Ask the account owner.");
  }

  const member = await prisma.crewMember.findUnique({
    where: { id: crewMemberId },
    select: { id: true, companyId: true, archivedAt: true, legalFirstName: true, legalMiddleName: true, legalLastName: true },
  });
  if (!member || member.companyId !== context.company.id) return fail("That crew member is gone. Reload the page.");
  if (member.archivedAt) return fail(`${crewMemberName(member).label} is already archived.`);

  await prisma.crewMember.update({ where: { id: member.id }, data: { archivedAt: new Date() } });

  revalidatePath("/team");
  revalidatePath("/union-compliance");
  return ok;
}
