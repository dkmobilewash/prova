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
 * company's own craft classifications: CraftClassification carries its own
 * companyId (added for #136 finding 1 — it used to be a global reference
 * table gated only by a self-asserted CompanyUnionAgreement, which was the
 * vulnerability), so this is a direct ownership check now, not a join
 * through the agreement table. */
export async function craftClassificationIdFromForm(formData: FormData, companyId: string): Promise<string | null> {
  const raw = String(formData.get("craftClassificationId") ?? "").trim();
  if (!raw) return null;
  const craft = await prisma.craftClassification.findFirst({
    where: { id: raw, companyId },
  });
  if (!craft) {
    throw new Error("Craft classification not found");
  }
  return craft.id;
}

export function assertOwner(user: { role: string }, message?: string) {
  if (user.role !== "OWNER") {
    throw new Error(message ?? "Only the account owner can do that");
  }
}

export const INSURANCE_POLICY_TYPES = ["GENERAL_LIABILITY", "WORKERS_COMP", "AUTO", "UMBRELLA_EXCESS"] as const;

export const BOND_TYPES = ["LICENSE_BOND", "PERFORMANCE_PAYMENT_CAPACITY"] as const;

export const LOCATION_TYPES = ["HQ", "BRANCH_YARD", "WAREHOUSE"] as const;

export const JURISDICTION_TYPES = ["STATE", "COUNTY", "CITY"] as const;

/**
 * The statuses a licence can be SET to.
 *
 * Deliberately not the whole `LicenseStatus` enum: EXPIRED is missing on
 * purpose. Whether a licence has expired is decided by its expiration
 * date, and storing that as a status too creates a second copy of a
 * derived fact — which is exactly the contradiction the renewals panel
 * has to detect and report ("marked active, but its date has passed").
 * Rows that already store EXPIRED still render; nothing new can create
 * one. The four here all describe a board's action on the licence, which
 * no date can tell you.
 */
export const SETTABLE_LICENSE_STATUSES = ["ACTIVE", "SUSPENDED", "PENDING", "INACTIVE"] as const;

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

export const CONTACT_STATUSES = ["PROSPECT", "ACTIVE", "INACTIVE"] as const;

export const CONTACT_TYPES = ["GENERAL_CONTRACTOR", "DEVELOPER", "VENDOR", "SUBCONTRACTOR"] as const;

export const INTERACTION_TYPES = ["CALL", "EMAIL", "SITE_VISIT", "NOTE"] as const;

export const SALES_LEAD_SOURCES = ["REFERRAL", "OUTBOUND", "INBOUND", "EVENT", "OTHER"] as const;

/** Deliberately not INTERACTION_TYPES: SITE_VISIT means nothing when the
 * prospect is a software buyer, and DEMO is the meeting that moves a Prova
 * deal. See the SalesActivity model comment. */
export const SALES_ACTIVITY_TYPES = ["CALL", "EMAIL", "DEMO", "MEETING", "NOTE"] as const;

export const OPPORTUNITY_STAGES = [
  "NEW",
  "CONTACTED",
  "DEMO_SCHEDULED",
  "TRIAL",
  "WON",
  "LOST",
] as const;

/** Like enumFromForm, but an empty selection is valid and means "not set"
 * (null) rather than an error — used for fields like Contact.accountType
 * that are deliberately unclassified with no backfill. */
export function optionalEnumFromForm<T extends readonly string[]>(
  formData: FormData,
  key: string,
  allowed: T,
): T[number] | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  if (!allowed.includes(raw as T[number])) {
    throw new Error(`"${key}" must be one of: ${allowed.join(", ")}`);
  }
  return raw as T[number];
}

export const INVOICE_STATUSES = ["SUBMITTED", "APPROVED", "PARTIALLY_PAID", "PAID", "DISPUTED"] as const;

/** The return shape for expected, user-readable action failures.
 *
 * Next.js redacts the message of any error thrown from a Server Action in
 * a production build — verified 2026-08-27 against a real production
 * build, not inferred. A thrown guard message reads perfectly in dev and
 * degrades to an opaque digest for a real user, which is the worst
 * possible way to fail. So: expected failures come back as
 * `{ ok: false, error }` and the form renders `error`; `throw` is
 * reserved for genuine bugs, which SHOULD be redacted in production.
 *
 * Lives here rather than in one feature module so two features can't hold
 * two structurally identical copies of it and drift. It is a type and a
 * pure helper, so it stays out of the "use server" modules and out of the
 * barrel — see the note at the top of this file.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

export const actionOk: ActionResult = { ok: true };

export function actionFail(error: string): ActionResult {
  return { ok: false, error };
}

/**
 * The owner check for an action that promises `ActionResult` — returns the
 * refusal to hand back, or null when the caller is the owner.
 *
 *     const refusal = ownerRefusal(context, "Only the account owner can …");
 *     if (refusal) return refusal;
 *
 * WHY THIS EXISTS ALONGSIDE `assertOwner` RATHER THAN REPLACING IT.
 * Production REDACTS a thrown Server Action message to a digest. An action
 * whose declared type is `Promise<ActionResult>` has promised the opposite —
 * that its refusals are legible — so it must not refuse by throwing. Nine
 * actions did exactly that (#166), including both QuickBooks push paths,
 * where a non-owner got a digest instead of a sentence naming the reason.
 *
 * `assertOwner` is still correct in the twenty actions that make no such
 * promise and throw anyway; changing it would have altered their behaviour
 * for no reason, so it is untouched.
 *
 * THE SHAPE IS "RETURN THE REFUSAL", not a boolean, and that is deliberate.
 * A boolean leaves every caller to write the message, which is how fifteen
 * of them ended up hand-wrapping `assertOwner` in a local try/catch to get
 * the same effect — the same five lines, fifteen times, which is the signal
 * that the helper was the wrong shape rather than that fifteen authors were
 * being thorough.
 *
 * THE RETURN IS NARROWED TO THE FAILURE BRANCH, and that is load-bearing
 * rather than pedantic. Two of the eleven exposed actions declare the same
 * contract INLINE with a payload —
 * `Promise<{ ok: true; accounts: … } | { ok: false; error: string }>` — so a
 * helper returning the full `ActionResult` could not be returned from them
 * at all: `{ ok: true }` is not assignable to `{ ok: true; accounts }`. The
 * failure branch alone fits every union that has one.
 *
 * `ownerRefusalCensus.test.ts` fails the build if an action promising a
 * readable refusal goes back to throwing one. It matches on the CONTRACT
 * rather than the type NAME, because matching the name is exactly how the
 * two inline ones were missed when #166 was counted.
 */
export function ownerRefusal(
  user: { role: string },
  message?: string,
): Extract<ActionResult, { ok: false }> | null {
  if (user.role === "OWNER") return null;
  return { ok: false, error: message ?? "Only the account owner can do that" };
}

/** ActionResult for an action that returns something on success — the same
 * contract, with a payload. Here for the same reason ActionResult is: two
 * feature modules exporting the same type name is a TS2308 build break,
 * because the barrel `export *`s all of them. */
export type ActionResultWith<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Thrown by a form parser, caught at the action's boundary by `runAction`
 * and converted to a returned failure — parsing stays terse, the wire stays
 * honest. Anything that is NOT an InputError is a genuine bug and is
 * rethrown, so it keeps being redacted in production, which is what should
 * happen to a bug.
 *
 * Lives here rather than in a feature module for the reason `ActionResult`
 * does: `submittals.ts` wrote it locally first, and four more modules
 * converting to the same contract (#251) would have been five structurally
 * identical copies free to drift. The original in `submittals.ts` is
 * deliberately left where it is — it is the documented reference
 * implementation and rewriting it is not this change.
 *
 * WHY A CLASS AND NOT A FLAG. The throw has to survive being raised deep
 * inside a `prisma.$transaction` callback, where returning is not an option
 * because a returned value COMMITS the transaction. A guard that reads the
 * latest row inside the transaction — the only place it can be read without
 * a race — must abort by throwing, and this is the type that says "abort,
 * but this one is the user's to read".
 */
export class InputError extends Error {}

/**
 * The boundary that turns an `InputError` into a returned failure.
 *
 *     export async function createThing(formData: FormData): Promise<ActionResult> {
 *       const context = await requireCompanyContext();
 *       return runAction(async () => { … return ok; });
 *     }
 *
 * `requireCompanyContext()` is deliberately OUTSIDE the callback: it
 * redirects an unauthenticated caller, and a redirect is a thrown control
 * signal, not a failure to render in a form.
 */
export async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return actionFail(err.message);
    throw err;
  }
}

/** True when a write failed a unique constraint (Prisma P2002).
 *
 * Checks the `code` property rather than `instanceof
 * Prisma.PrismaClientKnownRequestError`, because that instanceof is FALSE
 * at runtime in this app. Measured 2026-08-28: a duplicate insert produced
 * an error whose constructor name was `PrismaClientKnownRequestError` and
 * whose `code` was `P2002`, while `err instanceof
 * Prisma.PrismaClientKnownRequestError` evaluated to false — the client's
 * internal error class and the re-exported namespace are different copies
 * under this bundling. `prisma` and `Prisma` come from the same import, so
 * this affects every call site equally, not just one.
 *
 * The cost of getting it wrong is not cosmetic: the guard silently never
 * fires, the error escapes, and the user gets a 500 instead of the
 * sentence you wrote for them.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/** "1 job" / "3 bid invitations" — for messages that name a count.
 * Originally local to unionCompliance.ts; moved here (#76) so a second
 * caller doesn't grow its own copy. */
export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}
