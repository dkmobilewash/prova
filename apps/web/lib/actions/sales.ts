"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import {
  OPPORTUNITY_STAGES,
  SALES_LEAD_SOURCES,
  actionFail as fail,
  actionOk as ok,
  type ActionResult,
} from "./shared";

/** Thrown by the form parsers below, caught at each action's boundary and
 * converted to a returned failure — same shape as submittals.ts, the
 * reference implementation for this pattern. */
class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

function optionalEnum<T extends readonly string[]>(formData: FormData, key: string, allowed: T): T[number] | null {
  const raw = text(formData, key);
  if (!raw) return null;
  if (!allowed.includes(raw as T[number])) throw new InputError(`"${key}" must be one of: ${allowed.join(", ")}`);
  return raw as T[number];
}

function requiredEnum<T extends readonly string[]>(formData: FormData, key: string, allowed: T, label: string): T[number] {
  const raw = text(formData, key);
  if (!allowed.includes(raw as T[number])) throw new InputError(`Pick ${label}`);
  return raw as T[number];
}

/** Stored at UTC midnight, same rule as every other date in this app. */
function optionalDate(formData: FormData, key: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new InputError("Date is not valid");
  return date;
}

function optionalDecimal(formData: FormData, key: string): string | null {
  const raw = text(formData, key);
  if (!raw) return null;
  if (Number.isNaN(Number(raw))) throw new InputError(`"${key}" must be a number`);
  return raw;
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

/**
 * The only gate this whole file uses. Two independent checks, deliberately
 * NOT expressed as a lib/permissions.ts Capability: that map is about what
 * a job function can do WITHIN a company, and its own rule is "an OWNER
 * holds every capability regardless of job function" -- there is no way to
 * express "owner only, no job function grants this" in it, and forcing one
 * in would corrupt a map that is otherwise purely about roles. Tenant
 * identity (isProvaOperator) and person identity (role) are checked
 * directly instead, same as assertOwner everywhere else in this codebase.
 *
 * A non-operator company gets "not found," not an authorization message --
 * this feature does not exist for them, and saying so would be a stranger
 * kind of lie than just not showing it. A member at the operator company
 * gets the real reason, matching assertOwner's own convention.
 */
function assertSalesAccess(context: { company: { isProvaOperator: boolean }; role: string }) {
  if (!context.company.isProvaOperator) {
    throw new InputError("Not found");
  }
  if (context.role !== "OWNER") {
    throw new InputError("Only the account owner can use the sales CRM");
  }
}

async function findLead(leadId: string, companyId: string) {
  const lead = await prisma.salesLead.findUnique({ where: { id: leadId } });
  if (!lead || lead.companyId !== companyId) return null;
  return lead;
}

async function findOpportunity(opportunityId: string, companyId: string) {
  const opportunity = await prisma.salesOpportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.companyId !== companyId) return null;
  return opportunity;
}

export async function createSalesLead(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);
    const { company } = context;

    const companyName = required(formData, "companyName", "Company name");
    const contactName = text(formData, "contactName");
    const email = text(formData, "email");
    const phone = text(formData, "phone");
    const source = optionalEnum(formData, "source", SALES_LEAD_SOURCES);

    await prisma.salesLead.create({
      data: {
        companyId: company.id,
        companyName,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        source,
      },
    });

    revalidatePath("/sales");
    return ok;
  });
}

export async function updateSalesLead(leadId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);
    const lead = await findLead(leadId, context.company.id);
    if (!lead) return fail("Lead not found");

    const companyName = required(formData, "companyName", "Company name");
    const contactName = text(formData, "contactName");
    const email = text(formData, "email");
    const phone = text(formData, "phone");
    const source = optionalEnum(formData, "source", SALES_LEAD_SOURCES);

    await prisma.salesLead.update({
      where: { id: leadId },
      data: {
        companyName,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        source,
      },
    });

    revalidatePath(`/sales/${leadId}`);
    revalidatePath("/sales");
    return ok;
  });
}

/** Blocks once there's a real opportunity on record, same reasoning as
 * deleteContact -- a lead with pipeline history stays even if none of it
 * ever closed. */
export async function deleteSalesLead(leadId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);

    const lead = await prisma.salesLead.findUnique({
      where: { id: leadId },
      include: { _count: { select: { opportunities: true } } },
    });
    if (!lead || lead.companyId !== context.company.id) return fail("Lead not found");

    if (lead._count.opportunities > 0) {
      return fail(
        `${lead.companyName} has ${lead._count.opportunities} opportunit${lead._count.opportunities === 1 ? "y" : "ies"} on file, so its record stays. Only a lead with no opportunities can be deleted.`,
      );
    }

    await prisma.salesLead.delete({ where: { id: leadId } });
    revalidatePath("/sales");
    return ok;
  });
}

export async function createSalesOpportunity(leadId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);
    const lead = await findLead(leadId, context.company.id);
    if (!lead) return fail("Lead not found");

    const stage = requiredEnum(formData, "stage", OPPORTUNITY_STAGES, "a stage");
    const estimatedMrr = optionalDecimal(formData, "estimatedMrr");
    const expectedCloseDate = optionalDate(formData, "expectedCloseDate");
    const notes = text(formData, "notes");

    await prisma.salesOpportunity.create({
      data: {
        companyId: context.company.id,
        leadId,
        stage,
        estimatedMrr,
        expectedCloseDate,
        notes: notes || null,
      },
    });

    revalidatePath(`/sales/${leadId}`);
    return ok;
  });
}

export async function updateSalesOpportunity(opportunityId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);
    const opportunity = await findOpportunity(opportunityId, context.company.id);
    if (!opportunity) return fail("Opportunity not found");

    const stage = requiredEnum(formData, "stage", OPPORTUNITY_STAGES, "a stage");
    const estimatedMrr = optionalDecimal(formData, "estimatedMrr");
    const expectedCloseDate = optionalDate(formData, "expectedCloseDate");
    const notes = text(formData, "notes");

    await prisma.salesOpportunity.update({
      where: { id: opportunityId },
      data: { stage, estimatedMrr, expectedCloseDate, notes: notes || null },
    });

    revalidatePath(`/sales/${opportunity.leadId}`);
    return ok;
  });
}

export async function deleteSalesOpportunity(opportunityId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    assertSalesAccess(context);
    const opportunity = await findOpportunity(opportunityId, context.company.id);
    if (!opportunity) return fail("Opportunity not found");

    await prisma.salesOpportunity.delete({ where: { id: opportunityId } });
    revalidatePath(`/sales/${opportunity.leadId}`);
    return ok;
  });
}
