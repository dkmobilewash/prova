"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  actionFail as fail,
  actionOk as ok,
  InputError,
  optionalNumberFromForm as optionalNumber,
  isUniqueConstraintError,
  ownerRefusal,
  runAction,
  type ActionResult,
} from "./shared";

/**
 * A company's own cost-coding vocabulary — what a contractor calls a phase
 * code or a cost code. `04112` / "Plywood - SF".
 *
 * Every action here RETURNS its failures instead of throwing them.
 * Production redacts the message of anything thrown from a Server Action,
 * so "You already have a phase code 04112" would reach the person who
 * typed it as an unexplained dead button. `lib/actions/submittals.ts` is
 * the reference; `ActionResult`, `runAction` and `InputError` come from
 * ./shared rather than being re-declared here, because two feature modules
 * exporting the same type name is a TS2308 build break through the barrel.
 *
 * THERE IS NO DELETE IN THIS FILE AND THERE MUST NOT BE ONE. A phase code
 * with priced work against it is the evidence of how that work was coded,
 * on jobs that may already be invoiced; deleting it would rewrite the
 * history of a document a GC has been sent. Retiring is `isActive = false`
 * — see the model comment in packages/db/prisma/schema/jobs.prisma. The
 * foreign key is `ON DELETE SET NULL`, so a delete would not even fail
 * loudly: it would silently uncode every line the phase was on.
 */

/** `/settings` is guarded by MANAGE_COMPLIANCE, so every write here
 * answers to the same capability. A guarded page in front of an open
 * action is not a guard — a Server Action is its own endpoint with a
 * stable id and it answers whoever posts to it, page or no page.
 *
 * Checked FIRST in every action below: before the owner check, and before
 * any query. Somebody who cannot reach this feature at all should be told
 * that rather than told they are not the owner, and a refusal that arrives
 * after a read has already read. */
const COMPLIANCE_ONLY =
  "Company settings aren't part of your job function. The account owner sets who sees what, on the Team page.";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/**
 * The code and the name, both required and both trimmed.
 *
 * Free text on purpose, and the refusals below say what a good answer
 * looks like rather than what the rules are. A contractor renames these so
 * the report matches the budget they already read — "we can rename our
 * phase codes just so the way they appear in our budget, they look the
 * same" — so nothing here is validated against MasterFormat or any other
 * standard list. A product that refuses `04112-A` because a standard does
 * not have it is a product nobody can enter their own budget into.
 */
function fieldsFromForm(formData: FormData) {
  const code = text(formData, "code");
  if (!code) {
    throw new InputError("A code is required — the one you write on your own budget, like 04112.");
  }
  const name = text(formData, "name");
  if (!name) {
    throw new InputError("What is this phase called? Something like “Plywood - SF”.");
  }

  const sortOrder =
    optionalNumber(formData, "sortOrder", {
      label: "Sort order",
      integer: true,
    })?.n ?? 0;

  return {
    code,
    name,
    unit: text(formData, "unit") || null,
    // An unchecked checkbox sends nothing at all, so absence is false.
    // Deliberately not defaulted to the schema's `true`: the edit form
    // always renders the box, so a missing value there means the person
    // cleared it.
    tracksLabor: formData.get("tracksLabor") !== null,
    sortOrder,
  };
}

/** The message for a code this company already uses.
 *
 * `@@unique([companyId, code])` is the real guarantee and it is enforced
 * by the database, but P2002 arrives as a Prisma message that production
 * redacts — so the collision is caught twice: read-then-write for the
 * sentence a person can act on, and the constraint error for the case two
 * submits race, which is the one that actually reached a user in #224. */
function duplicateMessage(code: string) {
  return `You already have a phase code ${code}. Edit that one, or give this a different code.`;
}

/** Adds a phase code. */
export async function createPhaseCode(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);
    const refusal = ownerRefusal(context, "Only the account owner can add a phase code");
    if (refusal) return refusal;

    const fields = fieldsFromForm(formData);
    const existing = await prisma.phaseCode.findFirst({
      where: { companyId: context.company.id, code: fields.code },
      select: { id: true },
    });
    if (existing) return fail(duplicateMessage(fields.code));

    try {
      await prisma.phaseCode.create({ data: { companyId: context.company.id, ...fields } });
    } catch (err) {
      if (isUniqueConstraintError(err)) return fail(duplicateMessage(fields.code));
      throw err;
    }

    revalidatePath("/settings");
    revalidatePath("/phase-codes");
    return ok;
  });
}

/** Edits a phase code's code, name, unit, labour flag or reading order.
 *
 * All of it stays editable, including the code itself: these are the
 * company's own words and a typo in one is not evidence of anything. The
 * lines coded to it follow the row rather than the string, so renaming
 * `04112` to `04112-A` re-labels the history instead of orphaning it. */
export async function updatePhaseCode(
  phaseCodeId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);
    const refusal = ownerRefusal(context, "Only the account owner can edit a phase code");
    if (refusal) return refusal;

    const phaseCode = await prisma.phaseCode.findUnique({ where: { id: phaseCodeId } });
    if (!phaseCode || phaseCode.companyId !== context.company.id) {
      return fail("That phase code no longer exists.");
    }

    const fields = fieldsFromForm(formData);
    // The row that already holds this code, if any. Written as a plain
    // lookup plus an id comparison rather than `id: { not: phaseCodeId }`
    // because `code` is unique within a company, so at most one row can
    // come back and the extra clause buys nothing — and the plain form is
    // one a fake client can answer, which is what lets the "renaming a row
    // must not collide with itself" case be pinned by a test at all.
    const holder = await prisma.phaseCode.findFirst({
      where: { companyId: context.company.id, code: fields.code },
      select: { id: true },
    });
    if (holder && holder.id !== phaseCodeId) return fail(duplicateMessage(fields.code));

    try {
      await prisma.phaseCode.update({ where: { id: phaseCodeId }, data: fields });
    } catch (err) {
      if (isUniqueConstraintError(err)) return fail(duplicateMessage(fields.code));
      throw err;
    }

    revalidatePath("/settings");
    revalidatePath("/phase-codes");
    return ok;
  });
}

/**
 * Retires a phase code, or brings a retired one back.
 *
 * This is what this feature has instead of a delete, and the asymmetry is
 * the point: a retired code stops being offered on new work and keeps
 * reporting every dollar already coded to it. Reversible on purpose —
 * somebody retires the wrong row on a Friday and the fix is one click, not
 * a support call, because nothing was destroyed.
 */
export async function setPhaseCodeActive(
  phaseCodeId: string,
  isActive: boolean,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);
    const refusal = ownerRefusal(
      context,
      isActive
        ? "Only the account owner can bring a phase code back"
        : "Only the account owner can retire a phase code",
    );
    if (refusal) return refusal;

    const phaseCode = await prisma.phaseCode.findUnique({ where: { id: phaseCodeId } });
    if (!phaseCode || phaseCode.companyId !== context.company.id) {
      return fail("That phase code no longer exists.");
    }

    await prisma.phaseCode.update({ where: { id: phaseCodeId }, data: { isActive } });

    revalidatePath("/settings");
    revalidatePath("/phase-codes");
    return ok;
  });
}
