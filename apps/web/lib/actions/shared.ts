// Form parsing, enum coercion and ownership guards shared by the action
// modules in this folder.
//
// Deliberately NOT a "use server" module: those may only export async
// functions, and this exports constants and synchronous helpers. It is
// imported directly by the domain files and never re-exported from index.ts.

import { prisma } from "@prova/db";
import { numericReaders, PERCENT_BOUNDS, type NumericInputOptions } from "@/lib/numeric-input";

const { number, optionalNumber } = numericReaders((message) => {
  throw new InputError(message);
});

/** The same two readers, for the action modules that already throw THIS
 * module's `InputError` (safety, phase codes) rather than a private copy.
 * `optionalNumberFromForm` returns null for a blank field and never for a
 * bad one — a bad one raises. */
export const numberFromForm = number;
export const optionalNumberFromForm = optionalNumber;

/**
 * A required number from a form, parsed the way a person types it.
 *
 * THROWS `InputError`, NOT `Error`, AND THAT IS THE WHOLE POINT OF THE
 * CHANGE. Production redacts a thrown Server Action message to a digest
 * (see `ActionResult` below), so the old plain `throw new Error` meant a
 * quantity of `2,800` produced the "specific message is omitted in
 * production builds" paragraph on the second screen of creating a first
 * job. `InputError` is what `runAction` converts into a returned
 * `{ ok: false, error }` the form can render.
 *
 * Tolerance and bounds both live in `lib/numeric-input.ts` — one parser,
 * one rule about what a number is, for the fourteen places that each had
 * their own.
 */
export function decimalFromForm(formData: FormData, key: string, options?: NumericInputOptions): string {
  return number(formData, key, options).value;
}

/** Like decimalFromForm, but an empty field is valid and means "not set"
 * (null) rather than an error — used for unitPrice (cost-only budget
 * lines have none) and the WIP cost fields (optional until entered). */
export function nullableDecimalFromForm(
  formData: FormData,
  key: string,
  options?: NumericInputOptions,
): string | null {
  return optionalNumber(formData, key, options)?.value ?? null;
}

/**
 * A percentage — 0 to 100, never a fraction of one.
 *
 * `Job.retainagePercent` went through `nullableDecimalFromForm` with no
 * bounds at all, so `0.10` typed by somebody meaning ten percent stored a
 * tenth of one percent and every invoice afterwards withheld a hundredth
 * of what the contract said, with nothing on any screen to contradict it.
 * The bound is half the fix; the other half is the `%` the input now wears,
 * because no bound can tell 0.10-meaning-a-tenth-of-a-percent apart from
 * 0.10-typed-by-somebody-thinking-in-fractions.
 */
export function nullablePercentFromForm(
  formData: FormData,
  key: string,
  options?: NumericInputOptions,
): string | null {
  return nullableDecimalFromForm(formData, key, { ...PERCENT_BOUNDS, maxDecimals: 2, ...options });
}

/*
 * WHAT ELSE IN THIS FILE THROWS, AND WHY IT IS STILL A BARE `Error`.
 *
 * Recorded because the next person to read the parsers above will
 * reasonably ask whether the sweep was finished, and the answer is that it
 * stopped on purpose rather than halfway.
 *
 * THE FORM PARSERS all raise `InputError`. Two do it directly —
 * `enumFromForm` and `optionalEnumFromForm` — and the numeric ones do it
 * through the callback handed to `numericReaders` at the top of this file,
 * so `decimalFromForm`, `nullableDecimalFromForm`, `nullablePercentFromForm`,
 * `numberFromForm` and `optionalNumberFromForm` all raise the same class
 * while none of them contains a `throw` of its own.
 *
 * THAT INDIRECTION IS LOAD-BEARING FOR ANYTHING THAT SCANS THIS FILE. A
 * census looking for a literal `throw new InputError` inside a parser body
 * finds two of seven, and then reports a smaller problem than it has with
 * every downstream assertion passing.
 * `actionErrorBoundaryCensus.test.ts` follows the callback for that reason,
 * and asserts the resulting roll-call so it cannot quietly shrink again.
 *
 * Every one of those turns a string a person typed into a value, and every
 * one of their messages is an instruction to that person.
 *
 * THE OWNERSHIP AND STATE GUARDS below still throw a bare `Error`:
 * `assertJobInCompany`, `assertLineItemOnJob`, `assertEditableDirectly`,
 * `assertEditableViaChangeOrder`, `craftClassificationIdFromForm`,
 * `phaseCodeIdFromForm`, `assertOwner`. They answer a question about a
 * record, not about a keystroke, and `assertOwner` in particular is half
 * of a documented pair — see `ownerRefusal` below and
 * `ownerRefusalCensus.test.ts`, which exists to stop exactly that one
 * being "tidied". Converting them is a separate decision with its own
 * call sites to check, and `changeOrders.ts` already wraps the three it
 * uses by hand where it needs them readable.
 */

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

/** Moved to `@/lib/trade-scopes` on 2026-09-21 and re-exported here so every
 * server caller is unchanged. It left because this file imports `prisma` as a
 * VALUE and is not a "use server" boundary, so a client component importing
 * this list shipped PrismaClient to the browser — see trade-scopes.ts. */
export { TRADE_SCOPES } from "@/lib/trade-scopes";
import { TRADE_SCOPES } from "@/lib/trade-scopes";

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

/** The same ownership check as `craftClassificationIdFromForm` above, for
 * the phase code beside it on the same forms, and deliberately the same
 * shape rather than a cleverer one.
 *
 * The id arrives from a `<select>` in a browser, so it is a claim rather
 * than a fact: without this lookup a caller could post any company's phase
 * code id and have it stored on their own line item, which would then read
 * back as a code they do not have and land in somebody's budget report.
 * Scoped by `companyId` in the same `where`, so the scope cannot be dropped
 * in a later edit without deleting the predicate that finds the row.
 *
 * Throws rather than returning an ActionResult because both call sites do —
 * `createLineItem` and `updateLineItem` are throw-style and already end on
 * `throw new Error("Description is required")`. Converting one argument of
 * one of them would leave a function that reports two ways. A stale form
 * posting a retired-and-deleted id is the only way to reach it, and a phase
 * code cannot be deleted at all.
 *
 * A RETIRED code is accepted on purpose. It is not offered in the picker,
 * but a line already coded to one must survive being edited for any other
 * reason — a retired code is evidence of how work on an invoiced job was
 * coded, and silently dropping it on save would rewrite that. */
export async function phaseCodeIdFromForm(formData: FormData, companyId: string): Promise<string | null> {
  const raw = String(formData.get("phaseCodeId") ?? "").trim();
  if (!raw) return null;
  const phase = await prisma.phaseCode.findFirst({
    where: { id: raw, companyId },
  });
  if (!phase) {
    throw new Error("Phase code not found");
  }
  return phase.id;
}

export function assertOwner(user: { role: string }, message?: string) {
  if (user.role !== "OWNER") {
    throw new Error(message ?? "Only the account owner can do that");
  }
}

export const INSURANCE_POLICY_TYPES = ["GENERAL_LIABILITY", "WORKERS_COMP", "AUTO", "UMBRELLA_EXCESS"] as const;

export const BOND_TYPES = ["LICENSE_BOND", "PERFORMANCE_PAYMENT_CAPACITY"] as const;

/**
 * Every member of the Prisma `LocationType` enum, and it has to STAY every
 * member — see `lib/company-location-types.test.ts`, which reads the enum
 * out of the schema and fails when this list disagrees with it.
 *
 * TRAILER was missing here for a fortnight while the settings dropdown
 * offered it and the database accepted it (migration
 * `20260826043651_add_trailer_location_type` was written for exactly that
 * value). Choosing it threw out of `enumFromForm`, and because that throw
 * happens before the insert, the whole typed address went with it — a
 * jobsite trailer is the one location a contractor is most likely to add
 * and the form silently refused it.
 *
 * This file's own comments elsewhere cite `LOCATION_TYPES` as the example
 * of a second copy of an enum drifting from its Prisma original. It was
 * still drifting.
 */
export const LOCATION_TYPES = ["HQ", "BRANCH_YARD", "WAREHOUSE", "TRAILER"] as const;

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

/**
 * A `<select>` or radio group's value, checked against the list the form
 * offered.
 *
 * Throws `InputError` (declared further down this file), NOT a bare
 * `Error`, and the difference reached a user. This threw `Error` until
 * 2026-09-21, so an action wrapped in `runAction` — which converts only
 * `InputError` — rethrew it, and production redacted it to a digest. The
 * first screen a new owner sees (`/welcome` → `saveBusinessScope`) did
 * exactly that on a Save with no radio chosen: "Application error", a
 * digest, and no way forward. Pinned by lib/businessScope-save.test.ts.
 *
 * The message is still the parser's — a field name and a constant list —
 * so an action that can say something better checks for the empty case
 * itself first, as `saveBusinessScope` now does. This is the floor, not
 * the sentence.
 */
export function enumFromForm<T extends readonly string[]>(formData: FormData, key: string, allowed: T): T[number] {
  const raw = String(formData.get(key) ?? "");
  if (!allowed.includes(raw as T[number])) {
    throw new InputError(`"${key}" must be one of: ${allowed.join(", ")}`);
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
    // InputError for the same reason enumFromForm's is — see its comment.
    throw new InputError(`"${key}" must be one of: ${allowed.join(", ")}`);
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
 * identical copies free to drift.
 *
 * THEY DID NOT STAY AT FIVE, AND THEY DID DRIFT. This paragraph used to
 * end "the original in submittals.ts is deliberately left where it is — it
 * is the documented reference implementation and rewriting it is not this
 * change." That was a reasonable call and it cost #407: by 2026-09-21 there
 * were SIXTEEN declarations of this class name, fifteen of them local, and
 * `company.ts`'s caught only its own while the parsers in this file threw
 * this one. Same name, different class, `instanceof` false — so the first
 * screen a new owner sees answered an empty Save with a digest.
 *
 * There is one class now. Every local copy is gone, `submittals.ts`
 * included, and `actionErrorBoundaryCensus.test.ts` fails the build if a
 * seventeenth appears. A "reference implementation" that is a second copy
 * of the thing it references is just a second copy.
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

/**
 * "a" / "a and b" / "a, b, and c" — the Oxford-comma natural-language list
 * join for a delete-refusal message that names several non-zero counts.
 *
 * Extracted for #218: deleteContact joined with `.join(", ")` ("has 1 bid
 * invitation, 4 logged interactions, 1 person on file" — no "and" at all)
 * while deleteSalesLead joined with `.join(" and ")` ("has 2 opportunities
 * and 2 logged activities" — right for exactly two items, since it has no
 * third field to ever test, but "a and b and c" for three). Neither was
 * actually correct at every length; this is, and now there is one place to
 * get it from instead of a future third caller guessing which style is
 * "the" style.
 */
export function joinWithConjunction(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
