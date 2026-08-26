// Form parsing, enum coercion and ownership guards shared by the action
// modules in this folder.
//
// Deliberately NOT a "use server" module: those may only export async
// functions, and this exports constants and synchronous helpers. It is
// imported directly by the domain files and never re-exported from index.ts.

import { prisma } from "@prova/db";

export function decimalFromForm(formData: FormData, key: string): string {
  const raw = formData.get(key);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || Number.isNaN(Number(value))) {
    throw new Error(`"${key}" must be a number`);
  }
  return value;
}

/** Like decimalFromForm, but an empty field is valid and means "not set"
 * (null) rather than an error — used for unitPrice (cost-only budget
 * lines have none) and the WIP cost fields (optional until entered). */
export function nullableDecimalFromForm(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return null;
  }
  if (Number.isNaN(Number(value))) {
    throw new Error(`"${key}" must be a number`);
  }
  return value;
}

export async function assertJobInCompany(jobId: string, companyId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.companyId !== companyId) {
    throw new Error("Job not found");
  }
  return job;
}

/**
 * Only an ESTIMATE-stage job allows direct line-item edits. Once a job is
 * CONTRACTED, scope/pricing changes must go through a change order so
 * there's an audit trail of what changed after the client agreed to it.
 */
export function assertEditableDirectly(job: { status: string }) {
  if (job.status !== "ESTIMATE") {
    throw new Error(
      "This job is contracted — edit line items via a change order instead of directly.",
    );
  }
}

/**
 * Change orders only make sense once there's a contracted baseline to
 * change. Before that, direct edits (see assertEditableDirectly) are the
 * right tool.
 */
export function assertEditableViaChangeOrder(job: { status: string }) {
  if (job.status === "ESTIMATE") {
    throw new Error("This job isn't contracted yet — edit line items directly instead.");
  }
}

export async function nextChangeOrderNumber(jobId: string) {
  const last = await prisma.changeOrder.findFirst({
    where: { jobId },
    orderBy: { number: "desc" },
  });
  return (last?.number ?? 0) + 1;
}

export async function assertLineItemOnJob(lineItemId: string, jobId: string) {
  const lineItem = await prisma.jobLineItem.findUnique({ where: { id: lineItemId } });
  if (!lineItem || lineItem.jobId !== jobId) {
    throw new Error("Line item not found on this job");
  }
  return lineItem;
}

export const COST_CATEGORIES = ["LABOR", "MATERIAL", "SUBCONTRACTOR", "OTHER"] as const;

export const TRADE_SCOPES = [
  "METAL_FRAMING_DRYWALL",
  "LATH_PLASTER",
  "EIFS",
  "ACOUSTICAL_CEILINGS",
  "FIREPROOFING",
] as const;

/** Empty selection means "untagged" — a valid, common state, not an error. */
export function tradeScopeFromForm(formData: FormData): (typeof TRADE_SCOPES)[number] | null {
  const raw = String(formData.get("tradeScope") ?? "");
  return TRADE_SCOPES.includes(raw as (typeof TRADE_SCOPES)[number])
    ? (raw as (typeof TRADE_SCOPES)[number])
    : null;
}

/** Empty selection means "no craft tag" — valid, since not every line item
 * is labor a specific craft performs. When set, verified against this
 * company's own union affiliations (CraftClassification is a global
 * reference table, not company-scoped, so this is the access check). */
export async function craftClassificationIdFromForm(formData: FormData, companyId: string): Promise<string | null> {
  const raw = String(formData.get("craftClassificationId") ?? "").trim();
  if (!raw) return null;
  const craft = await prisma.craftClassification.findFirst({
    where: { id: raw, unionLocal: { companyAgreements: { some: { companyId } } } },
  });
  if (!craft) {
    throw new Error("Craft classification not found");
  }
  return craft.id;
}

export function assertOwner(user: { role: string }) {
  if (user.role !== "OWNER") {
    throw new Error("Only the account owner can manage team members");
  }
}

export const INSURANCE_POLICY_TYPES = ["GENERAL_LIABILITY", "WORKERS_COMP", "AUTO", "UMBRELLA_EXCESS"] as const;

export const BOND_TYPES = ["LICENSE_BOND", "PERFORMANCE_PAYMENT_CAPACITY"] as const;

export const LOCATION_TYPES = ["HQ", "BRANCH_YARD", "WAREHOUSE"] as const;

export const COMPLIANCE_DOCUMENT_TYPES = [
  "LIEN_WAIVER",
  "CERTIFICATE_OF_INSURANCE",
  "CERTIFIED_PAYROLL",
  "UNION_FRINGE_BENEFIT_FILING",
  "UNION_AGREEMENT",
] as const;

export function enumFromForm<T extends readonly string[]>(formData: FormData, key: string, allowed: T): T[number] {
  const raw = String(formData.get(key) ?? "");
  if (!allowed.includes(raw as T[number])) {
    throw new Error(`"${key}" must be one of: ${allowed.join(", ")}`);
  }
  return raw as T[number];
}

export const BID_INVITATION_STATUSES = ["INVITED", "SUBMITTED", "WON", "LOST", "DECLINED"] as const;

export const INVOICE_STATUSES = ["SUBMITTED", "APPROVED", "PARTIALLY_PAID", "PAID", "DISPUTED"] as const;
