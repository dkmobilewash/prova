"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { JOB_FUNCTIONS, type JobFunctionValue } from "@/lib/permissions";
import { actionFail as fail, actionOk as ok, type ActionResult } from "./shared";

/**
 * Setting what someone's job is.
 *
 * The only write this feature has. Owner-only, for the obvious reason —
 * a permission anyone can widen is not a permission.
 *
 * Failures are RETURNED: production redacts a thrown Server Action
 * message to a digest, and "you can't do that" arriving as an opaque
 * error id is how a person concludes the app is broken rather than that
 * they lack access.
 */
export async function setJobFunction(userId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();

  if (context.role !== "OWNER") {
    return fail("Only the account owner can change what someone's access covers");
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.companyId !== context.company.id) {
    return fail("That person isn't on your team");
  }

  // An owner's capabilities never depend on their job function (see
  // capabilitiesFor), so setting one here would have no effect and read
  // as though it had. Refusing says which of those two is true.
  if (target.role === "OWNER") {
    return fail("An owner always has full access — a job function wouldn't change anything.");
  }

  const raw = String(formData.get("jobFunction") ?? "").trim();

  // Empty is a real, meaningful value and the default: nobody has said,
  // and the person keeps the full office access every member has always
  // had. It is not the same as picking a function that happens to be
  // broad, because it is what an untouched row already means.
  if (raw === "") {
    await prisma.user.update({ where: { id: target.id }, data: { jobFunction: null } });
    revalidatePath("/team");
    return ok;
  }

  if (!JOB_FUNCTIONS.includes(raw as JobFunctionValue)) {
    return fail("That isn't one of the job functions");
  }

  await prisma.user.update({
    where: { id: target.id },
    data: { jobFunction: raw as JobFunctionValue },
  });

  revalidatePath("/team");
  return ok;
}
