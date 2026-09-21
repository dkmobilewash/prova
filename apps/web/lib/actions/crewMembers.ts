"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { crewMemberName } from "@/lib/worker-name";
import {
  actionFail as fail,
  actionOk as ok,
  InputError,
  isUniqueConstraintError,
  ownerRefusal,
  runAction,
  type ActionResult,
} from "./shared";

/**
 * WHO MAY TOUCH THE CREW, AND WHY IT IS NOT THE OWNER ALONE.
 *
 * Adding a person to the crew is `MANAGE_FIELD` and nothing more. That is a
 * deliberate change from how crew arrived in this app (CSV import, owner
 * only) and the argument is already written down one file over: the payroll
 * REGISTER import is not owner-only because "certified payroll is the office
 * manager's weekly chore, and gating it to OWNER would mean the person who
 * runs that chore every week cannot reach the button"
 * (`app/(app)/settings/import/page.tsx`). Crew members are the rows that
 * import matches against. A PAYROLL_COMPLIANCE office manager who may import
 * the register but may not create the people it names cannot do the job at
 * all — she can only wait for an owner.
 *
 * `MANAGE_FIELD` is held by FIELD, PROJECT_MANAGER, PAYROLL_COMPLIANCE and
 * EXECUTIVE (lib/permissions.ts), which is the set of people who know who
 * turned up on site. It is not "administering the account" in the sense
 * `UserRole.OWNER` means — nobody gains a login, nobody gains access to
 * anything, and no money moves.
 *
 * ARCHIVING KEEPS THE OWNER GATE, and the asymmetry is the point rather
 * than an oversight. Adding is additive and undone by archiving. Archiving
 * is the one-way door: there is no un-archive anywhere in this app, so a
 * mistake there is not recoverable from the UI. CLAUDE.md's list-page
 * convention asks for owner-only destructive actions and this is the
 * destructive half.
 *
 * The cost of that split, stated plainly because somebody will meet it: the
 * legal name is LOCKED by a database trigger after creation, so correcting
 * a misspelling means archiving the row and creating a new one — and only
 * an owner can do the archiving half. An office manager who fat-fingers a
 * name can add the corrected person but needs the owner to retire the typo.
 */
const FIELD_ONLY = "Managing the crew isn't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * Takes a crew member off the crew. There is no delete, on purpose: a person
 * named on a filed payroll cannot stop having existed (CrewMember in
 * crew.prisma). Archiving keeps every hour and every name exactly as it was;
 * it only stops the person being offered for NEW hours — the phone's crew
 * list, the web time-entry form and the time-entry API all leave archived
 * people out.
 *
 * Owner-only AND MANAGE_FIELD. It used to say "the same pair that can import
 * crew"; that stopped being true when creating crew became MANAGE_FIELD
 * alone — see the block above for why the two halves differ now.
 */
export async function archiveCrewMember(crewMemberId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const refusal = ownerRefusal(context, "Only the account owner can archive crew members.");
  if (refusal) return refusal;
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

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

/** Every path into these records reads the form the same way, so the create
 * form and the inline edit form cannot validate the same field names
 * differently — the reason `<CrewMemberFields>` is one component. */
function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/**
 * The name, and only the name, is required.
 *
 * A first-run contractor with a crew sheet in his hand should be able to
 * type two words and be done. Everything else on `CrewMember` — the badge
 * number, the address Davis-Bacon's basic-records rule wants, the last four
 * of the SSN, the hire date — is genuinely optional at this moment and is
 * filled in later by the payroll register import or by the owner. A form
 * that demanded them would simply not get used.
 */
function readIdentity(formData: FormData) {
  const legalFirstName = text(formData, "legalFirstName");
  const legalLastName = text(formData, "legalLastName");
  if (!legalFirstName) throw new InputError("First name is required.");
  if (!legalLastName) throw new InputError("Last name is required.");
  return {
    legalFirstName,
    legalMiddleName: text(formData, "legalMiddleName") || null,
    legalLastName,
  };
}

/**
 * The craft this person works under, when one was picked.
 *
 * Returns `undefined` when the form did not offer the field at all (the
 * viewer cannot set crafts, or the company has none yet) and `null` when it
 * offered it and the answer was "not set". The two are different: undefined
 * leaves an existing craft alone, null clears it.
 *
 * WHY ITS OWN CAPABILITY. `setWorkerCraft` on /union-compliance is
 * MANAGE_COMPLIANCE, because a craft classification is what fringe rates
 * and the apprentice-ratio check are computed from. Writing the same row
 * from this form under a weaker capability would be a hole opened by a
 * second door, so the field is rendered only for somebody who already holds
 * that capability, and refused here as well — a page guard stops a page
 * rendering and does nothing about the action behind it.
 */
async function readCraft(
  formData: FormData,
  context: { role: string; jobFunction: string | null },
  companyId: string,
): Promise<string | null | undefined> {
  if (!formData.has("craftClassificationId")) return undefined;
  const raw = text(formData, "craftClassificationId");
  if (!raw) return null;
  if (!can(context, "MANAGE_COMPLIANCE")) {
    throw new InputError("Setting who works under each craft isn't part of your job function.");
  }
  const craft = await prisma.craftClassification.findFirst({
    where: { id: raw, companyId },
    select: { id: true },
  });
  if (!craft) throw new InputError("That craft classification no longer exists. Reload the page.");
  return craft.id;
}

const TAKEN_NUMBER =
  "Someone on your crew already has that employee number. Employee numbers have to be unique, because a payroll form identifies a person by one.";

/**
 * Puts one person on the crew — by name, with no email and no login.
 *
 * THIS IS THE AFFORDANCE THE PRODUCT WAS MISSING. Until now the only way to
 * create a `CrewMember` from the UI was the owner-only CSV import buried in
 * Settings, and the crew section on /team did not render at all until a crew
 * member existed — the empty-state failure where the only thing that would
 * create the first row is hidden until there is one. A union drywall sub
 * with thirty hands could not get his crew into the product.
 *
 * The person and their craft are written in ONE transaction. A crew member
 * who exists with no craft is a fine state and happens constantly; a craft
 * row pointing at a person whose creation then failed is not a state
 * anything here knows how to read.
 */
export async function createCrewMember(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const companyId = context.company.id;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

    const identity = readIdentity(formData);
    const employeeNumber = text(formData, "employeeNumber") || null;
    const craftClassificationId = await readCraft(formData, context, companyId);

    try {
      await prisma.$transaction(async (tx) => {
        const member = await tx.crewMember.create({
          data: { companyId, ...identity, employeeNumber },
          select: { id: true },
        });
        if (craftClassificationId) {
          await tx.workerCraft.create({
            data: { companyId, craftClassificationId, crewMemberId: member.id },
          });
        }
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) return fail(TAKEN_NUMBER);
      throw err;
    }

    revalidateCrew();
    return ok;
  });
}

/**
 * Corrects what CAN be corrected about a crew member, which is deliberately
 * not their name.
 *
 * `prova_crew_member_identity_lock` — a BEFORE UPDATE trigger installed by
 * 20260905183000_add_crew_members — refuses any change to the legal name at
 * the database, because a WH-347 that has been signed and filed names this
 * person and the row it was built from has to keep saying the same thing. So
 * this form does not offer the name at all: offering a field the database
 * will refuse is a control that reads as working and is a dead button in
 * production, where the thrown message is redacted to a digest. A misspelling
 * is fixed by archiving the row and creating a corrected one, which leaves
 * both the old filing and the correction on the record.
 *
 * What is left is the employee number and the craft — and the number is
 * exactly why `CrewMember.employeeNumber` is nullable: a person is worth
 * recording before payroll has sent their badge number over.
 */
export async function updateCrewMember(crewMemberId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const companyId = context.company.id;
  return runAction(async () => {
    if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

    const member = await prisma.crewMember.findUnique({
      where: { id: crewMemberId },
      select: { id: true, companyId: true, archivedAt: true },
    });
    if (!member || member.companyId !== companyId) return fail("That crew member is gone. Reload the page.");
    if (member.archivedAt) return fail("That crew member is archived, so their record is closed.");

    const employeeNumber = text(formData, "employeeNumber") || null;
    const craftClassificationId = await readCraft(formData, context, companyId);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.crewMember.update({ where: { id: member.id }, data: { employeeNumber } });
        if (craftClassificationId !== undefined) {
          // Replaced rather than added to: this form shows ONE craft, so
          // leaving an older row behind would make the screen disagree with
          // the database about what it just saved.
          await tx.workerCraft.deleteMany({ where: { companyId, crewMemberId: member.id } });
          if (craftClassificationId) {
            await tx.workerCraft.create({
              data: { companyId, craftClassificationId, crewMemberId: member.id },
            });
          }
        }
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) return fail(TAKEN_NUMBER);
      throw err;
    }

    revalidateCrew();
    return ok;
  });
}

/** Every page that reads the crew. The job pages are in the list because the
 * web time-entry form's worker dropdown is built from it — a crew member
 * added on /team has to be selectable on a job without a hard reload. */
function revalidateCrew() {
  revalidatePath("/team");
  revalidatePath("/union-compliance");
  revalidatePath("/schedule");
  revalidatePath("/certifications");
  revalidatePath("/settings/import");
  revalidatePath("/jobs", "layout");
}
