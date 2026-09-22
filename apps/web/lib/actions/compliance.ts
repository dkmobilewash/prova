"use server";

import { revalidatePath } from "next/cache";
import {
  DOCUMENT_UPLOAD_MAX_BYTES,
  DOCUMENT_UPLOAD_TARGETS,
  documentDisplayFileName,
  documentUrlProblem,
  isAllowedDocumentType,
  type DocumentUploadContentType,
} from "@/lib/document-uploads";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";
import { extractComplianceDocument } from "@prova/integrations";
import { ASK_DEFAULT_MODEL } from "@prova/integrations";
import { recordAskUsage } from "@/lib/ask/usage";
import { markAskAllowanceFailure } from "@/lib/ask/allowance";
import { claimDocumentPages } from "@/lib/ask/documentSpend";
import {
  actionFail,
  actionOk,
  assertOwner,
  BOND_TYPES,
  COMPLIANCE_DOCUMENT_TYPES,
  enumFromForm,
  INSURANCE_POLICY_TYPES,
  JURISDICTION_TYPES,
  InputError,
  nullableDecimalFromForm,
  ownerRefusal,
  runAction,
  SETTABLE_LICENSE_STATUSES,
  type ActionResult,
  type ActionResultWith,
} from "./shared";

/** Adds a company insurance policy record (GL, workers' comp, auto, umbrella). */
export async function createInsurancePolicy(formData: FormData) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const policyType = enumFromForm(formData, "policyType", INSURANCE_POLICY_TYPES);
  const carrier = String(formData.get("carrier") ?? "").trim();
  const policyNumber = String(formData.get("policyNumber") ?? "").trim();
  const coverageLimits = String(formData.get("coverageLimits") ?? "").trim();
  const effectiveRaw = String(formData.get("effectiveDate") ?? "").trim();
  const expirationRaw = String(formData.get("expirationDate") ?? "").trim();

  if (!carrier || !policyNumber) {
    throw new Error("Carrier and policy number are required");
  }

  await prisma.companyInsurancePolicy.create({
    data: {
      companyId: company.id,
      policyType,
      carrier,
      policyNumber,
      coverageLimits: coverageLimits || null,
      effectiveDate: effectiveRaw ? new Date(effectiveRaw) : null,
      expirationDate: expirationRaw ? new Date(expirationRaw) : null,
    },
  });

  revalidatePath("/settings");
}

export async function deleteInsurancePolicy(policyId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const policy = await prisma.companyInsurancePolicy.findUnique({ where: { id: policyId } });
  if (!policy || policy.companyId !== company.id) {
    throw new Error("Insurance policy not found");
  }

  await prisma.companyInsurancePolicy.delete({ where: { id: policyId } });

  revalidatePath("/settings");
}

/** Adds a company bonding record (license bond or performance/payment capacity). */
export async function createBond(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const refusal = ownerRefusal(context);
  if (refusal) return refusal;
  const { company } = context;

  return runAction(async () => {
    const bondType = enumFromForm(formData, "bondType", BOND_TYPES);
    const suretyName = String(formData.get("suretyName") ?? "").trim();
    const aggregateBondingCapacity = nullableDecimalFromForm(formData, "aggregateBondingCapacity");
    const singleJobLimit = nullableDecimalFromForm(formData, "singleJobLimit");
    const agentContactName = String(formData.get("agentContactName") ?? "").trim();
    const agentContactPhone = String(formData.get("agentContactPhone") ?? "").trim();
    const agentContactEmail = String(formData.get("agentContactEmail") ?? "").trim();
    const renewalRaw = String(formData.get("renewalDate") ?? "").trim();

    if (!suretyName) {
      throw new InputError("Surety name is required");
    }

    await prisma.companyBond.create({
      data: {
        companyId: company.id,
        suretyName,
        bondType,
        aggregateBondingCapacity,
        singleJobLimit,
        agentContactName: agentContactName || null,
        agentContactPhone: agentContactPhone || null,
        agentContactEmail: agentContactEmail || null,
        renewalDate: renewalRaw ? new Date(renewalRaw) : null,
      },
    });

    revalidatePath("/settings");
    return actionOk;
  });
}

export async function deleteBond(bondId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const bond = await prisma.companyBond.findUnique({ where: { id: bondId } });
  if (!bond || bond.companyId !== company.id) {
    throw new Error("Bond not found");
  }

  await prisma.companyBond.delete({ where: { id: bondId } });

  revalidatePath("/settings");
}

/** Uploads a compliance document (lien waiver, COI, certified payroll,
 * union fringe filing) and has Claude read it into structured fields —
 * see extractComplianceDocument in @prova/integrations. The extracted
 * fields are saved as a normal, editable row (aiExtracted just flags it
 * for review, not a lock) — a bad extraction is fixed the same way a typo
 * would be.
 *
 * IT IS GATED ON MANAGE_COMPLIANCE, AND THAT PARAGRAPH REPLACES ONE THAT
 * SAID THE OPPOSITE. This comment read "not owner-gated: any team member
 * can log paperwork they receive from a sub or vendor, same reasoning as
 * addCostEntry" from the day it was written, and
 * lib/action-capability-guards.test.ts carried the same action in
 * OPEN_BEHIND_AN_ALREADY_GUARDED_PAGE — a counted debt, `/compliance`
 * refusing at the page and this endpoint answering whoever posts to it.
 *
 * What changed is not the reasoning about paperwork, it is what a click
 * costs. This is the most expensive single call in the app — a whole
 * document into one request, $2.25-$4.50 by this repo's own audit — and it
 * now spends the company's PAID monthly allowance. "Any team member" is a
 * defensible answer for logging a row and is not a defensible answer for
 * spending somebody's month, so the action asserts the capability its own
 * page already withholds. Nobody loses a screen they use today: an OWNER
 * holds every capability by construction, and PAYROLL_COMPLIANCE and
 * EXECUTIVE hold MANAGE_COMPLIANCE, which is who /compliance was already
 * for. `DOCUMENT_UPLOAD_TARGETS["compliance-document"].capability` follows
 * it, so the upload TOKEN is refused too and a person who cannot use this
 * never moves the bytes in the first place.
 *
 * THE PAGES ARE COUNTED AND CLAIMED BEFORE THE MODEL IS CALLED — see
 * lib/ask/documentSpend.ts, which composes lib/ask/pageCount.ts's counter
 * and lib/ask/allowance.ts's ledger. There is no second ledger and no
 * second counter: the row this claims against is the row the Ask box
 * claims against, so a document read here reduces what the assistant has
 * left. A refused claim takes nothing and no model call happens; a claim
 * whose call then FAILS is marked rather than released, for the reasons
 * allowance.ts's header sets out at length.
 *
 * THE FILE NO LONGER PASSES THROUGH HERE — issue #27, and this is the one
 * of the five that needed more than deleting a `File`. It used to refuse
 * anything over `COMPLIANCE_UPLOAD_MAX_BYTES`, 15MB, a check that could
 * never run behind Next's 1MB Server Action body cap; a scanned COI is
 * several megabytes, so this feature was broken for its own normal case.
 * The browser uploads to the blob store under a one-shot token now
 * (`app/api/documents/upload/route.ts`) and this records the URL.
 *
 * BUT THE EXTRACTOR NEEDS THE BYTES, so they are READ BACK from the store
 * here rather than carried through the action. That is a deliberate
 * difference from the other four, which never look at the file at all:
 *
 *   - the read is server-to-server and the URL has already been proved to
 *     be OUR store's and under THIS company's folder, so it is not a
 *     fetch of anything a caller chose;
 *   - the content type comes from the STORE'S OWN response header rather
 *     than from the client, because the store serves the type the signed
 *     token allowed. The old code trusted `file.type`, which was whatever
 *     the browser said;
 *   - the length is checked against the same 15MB ceiling before the body
 *     is turned into base64. The token already bound the transfer to it;
 *     this is the second look, on bytes this function is about to hold in
 *     memory.
 *
 * RETURNS A RESULT NOW, and does not throw. It used to throw for every
 * refusal, and production redacts a thrown Server Action message to a
 * digest — so the sentence never arrived. That was survivable while the
 * only failures were ones the file input prevented; it is not survivable
 * now that "storage would not give the file back" is a real outcome a
 * person needs told. `ComplianceUploadForm` renders `result.error`.
 *
 * ON SUCCESS IT NOW RETURNS WHAT THE DOCUMENT COST, and that is a promise
 * being kept rather than a nicety. pageCount.ts charges an unreadable PDF a
 * flat ten pages and its own header says the person "is TOLD, on screen,
 * that it was charged that and why" — nothing told them until this. The
 * form renders `result.value.note` beside the pages left in the month. */
export async function uploadComplianceDocument(
  formData: FormData,
): Promise<ComplianceUploadResult> {
  const context = await requireCompanyContext();
  // Before the URL is looked at, before the job is read, before a byte
  // moves: this endpoint spends money and is reachable by anyone with a
  // session who knows its id.
  if (!can(context, "MANAGE_COMPLIANCE")) {
    return uploadFail(DOCUMENT_UPLOAD_TARGETS["compliance-document"].refusal);
  }
  const { company, ...user } = context;

  const fileUrl = String(formData.get("fileUrl") ?? "").trim();
  if (!fileUrl) {
    return uploadFail("A file is required.");
  }
  // The owner of a compliance document is the COMPANY, and the company is
  // the caller's own session — there is no id here that came from the
  // request to be verified. A URL under another company's compliance
  // folder therefore fails this check outright.
  const problem = documentUrlProblem(fileUrl, "compliance-document", company.id, process.env);
  if (problem) {
    return uploadFail(problem);
  }
  const fileName = documentDisplayFileName(String(formData.get("fileName") ?? ""));

  const jobIdRaw = String(formData.get("jobId") ?? "").trim();
  let jobId: string | null = null;
  if (jobIdRaw) {
    const job = await prisma.job.findUnique({ where: { id: jobIdRaw } });
    if (!job || job.companyId !== company.id) {
      return uploadFail("Job not found.");
    }
    jobId = job.id;
  }

  const read = await readStoredDocument(fileUrl);
  if (!read.ok) {
    return uploadFail(read.error);
  }

  // THE PAGES, COUNTED FROM THE BYTES AND CLAIMED BEFORE THE CALL.
  //
  // It sits here and not one line earlier on purpose: the count comes out
  // of the fetched bytes, never out of anything the browser said, so how
  // much this upload costs is not known until `read` has it. Reading our
  // own blob spends no model money, so nothing is at risk in doing it
  // first — and a file refused above never touches the allowance at all.
  //
  // Anything other than `ok` here is the hard stop: the sentence says what
  // ran out or why the document is too big, nothing is charged, and
  // `extractComplianceDocument` is never reached.
  const spend = await claimDocumentPages(company.id, read.mediaType, read.buffer);
  if (!spend.ok) {
    return uploadFail(spend.error);
  }

  // #277 moved the upload to the browser, so there is no putDocument here
  // any more — the blob already exists and `read` is it, fetched back by
  // readStoredDocument above. The metering below is the half of this call
  // that has to survive that restructure.
  let extraction: Awaited<ReturnType<typeof extractComplianceDocument>>;
  try {
    extraction = await extractComplianceDocument({
      fileBase64: read.buffer.toString("base64"),
      mediaType: read.mediaType,
      fileName: fileName ?? "document",
      // Metered since 2026-09-14. The most expensive single call in this
      // app — a 15MB file base64'd into one request, put at $2.25-$4.50 an
      // upload by audit, against a warm Ask question at $0.05 — and until
      // now it reported nothing at all.
      onUsage: (usage) =>
        recordAskUsage({
          companyId: company.id,
          userId: user.id,
          model: ASK_DEFAULT_MODEL,
          usage,
          outcome: "answered",
          feature: "compliance-extract",
        }),
    });
  } catch (err) {
    // MARKED, NOT RELEASED — the same rule `streamAnswer` follows. A unit
    // you can get back by making calls fail is not a cap, the provider
    // bills a request that died halfway anyway, and the mark is what lets
    // an owner see failed reads on /settings/assistant and ask a human for
    // a credit. Nothing here adjusts an allowance by itself.
    await markAskAllowanceFailure(spend.claim);
    console.error("[compliance] the extractor failed after its allowance was claimed", err);
    return uploadFail(
      "The assistant couldn't read that document. Its pages are recorded as a failed read on this " +
        "month's allowance — the account owner can see them on Settings → Assistant and ask C Stream " +
        "about a credit. Nothing else was saved.",
    );
  }

  await prisma.complianceDocument.create({
    data: {
      companyId: company.id,
      jobId,
      type: extraction.type,
      partyName: extraction.partyName,
      amount: extraction.amount != null ? extraction.amount.toString() : null,
      periodStart: extraction.periodStart ? new Date(extraction.periodStart) : null,
      periodEnd: extraction.periodEnd ? new Date(extraction.periodEnd) : null,
      effectiveDate: extraction.effectiveDate ? new Date(extraction.effectiveDate) : null,
      expiresAt: extraction.expiresAt ? new Date(extraction.expiresAt) : null,
      notes: extraction.notes,
      fileUrl,
      fileName,
      aiExtracted: true,
      uploadedByUserId: user.id,
    },
  });

  revalidatePath("/compliance");
  // The allowance figures on the owner's own page moved, so the page that
  // prints them is stale the moment this returns.
  revalidatePath("/settings/assistant");
  return { ok: true, value: { note: spend.note, pagesLeft: spend.pagesLeft } };
}

/** What an upload gives back: the refusal to render, or what the document
 * cost and what is left. Not exported — a "use server" module may only
 * export async functions, and nothing outside needs to name it. */
type ComplianceUploadResult = ActionResultWith<{ note: string; pagesLeft: number }>;

/** `actionFail` declares the plain `ActionResult`, whose success branch has
 * no `value`, so it does not narrow to this contract. Same local helper
 * `payrollRegister.ts` writes for the same reason. */
function uploadFail(error: string): Extract<ComplianceUploadResult, { ok: false }> {
  return { ok: false, error };
}

/**
 * Reads a document back out of the blob store so Claude can be shown it.
 *
 * ONLY EVER CALLED WITH A URL `documentUrlProblem` HAS ALREADY ACCEPTED,
 * which is what makes it safe to fetch: the host is our own store and the
 * path is under the caller's own company folder. Called with anything else
 * it would be a server-side request to an address a caller chose, so the
 * order of the two calls at the single call site above is load-bearing
 * rather than stylistic.
 *
 * The type is taken from the STORE's response, not from the caller. A
 * `content-type` may carry parameters (`application/pdf; charset=binary`),
 * so only the media type itself is compared — and it is compared against
 * the same allowlist the token was minted from, so a blob the store serves
 * as something else is refused rather than handed to the extractor.
 */
async function readStoredDocument(
  fileUrl: string,
): Promise<
  { ok: true; buffer: Buffer; mediaType: DocumentUploadContentType } | { ok: false; error: string }
> {
  let response: Response;
  try {
    response = await fetch(fileUrl);
  } catch {
    return { ok: false, error: "That file could not be read back from storage — try again." };
  }
  if (!response.ok) {
    return { ok: false, error: "That file could not be read back from storage — try again." };
  }

  const served = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!isAllowedDocumentType(served)) {
    return { ok: false, error: "Upload a PDF, PNG, JPEG, or WEBP file." };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  // The signed token already bound the TRANSFER to this ceiling. This is
  // the second look, taken before the bytes are base64'd and sent on.
  if (buffer.byteLength === 0 || buffer.byteLength > DOCUMENT_UPLOAD_MAX_BYTES) {
    return { ok: false, error: "That file is over the 15MB limit." };
  }

  return { ok: true, buffer, mediaType: served };
}

/** Edits a compliance document's fields — how a bad AI extraction gets
 * fixed (same as fixing a typo, not a separate "correction" flow) but
 * also just how anyone edits a manually-entered record. Not owner-gated,
 * same reasoning as uploadComplianceDocument. */
export async function updateComplianceDocument(documentId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();

  return runAction(async () => {
    const document = await prisma.complianceDocument.findUnique({ where: { id: documentId } });
    if (!document || document.companyId !== company.id) {
      throw new Error("Compliance document not found");
    }

    const type = enumFromForm(formData, "type", COMPLIANCE_DOCUMENT_TYPES);
    const partyName = String(formData.get("partyName") ?? "").trim();
    if (!partyName) {
      throw new Error("Party name is required");
    }
    const amount = nullableDecimalFromForm(formData, "amount");
    const periodStartRaw = String(formData.get("periodStart") ?? "").trim();
    const periodEndRaw = String(formData.get("periodEnd") ?? "").trim();
    const effectiveRaw = String(formData.get("effectiveDate") ?? "").trim();
    const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();

    await prisma.complianceDocument.update({
      where: { id: documentId },
      data: {
        type,
        partyName,
        amount,
        periodStart: periodStartRaw ? new Date(periodStartRaw) : null,
        periodEnd: periodEndRaw ? new Date(periodEndRaw) : null,
        effectiveDate: effectiveRaw ? new Date(effectiveRaw) : null,
        expiresAt: expiresRaw ? new Date(expiresRaw) : null,
        notes: notes || null,
      },
    });

    revalidatePath("/compliance");
    return actionOk;
  });
}

/** Marks a compliance document RECEIVED (e.g. the lien waiver came back
 * signed, or the sub's updated COI arrived). */
export async function markComplianceDocumentReceived(documentId: string) {
  const { company } = await requireCompanyContext();

  const document = await prisma.complianceDocument.findUnique({ where: { id: documentId } });
  if (!document || document.companyId !== company.id) {
    throw new Error("Compliance document not found");
  }

  await prisma.complianceDocument.update({ where: { id: documentId }, data: { status: "RECEIVED" } });

  revalidatePath("/compliance");
}

export async function deleteComplianceDocument(documentId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const document = await prisma.complianceDocument.findUnique({ where: { id: documentId } });
  if (!document || document.companyId !== company.id) {
    throw new Error("Compliance document not found");
  }

  await prisma.complianceDocument.delete({ where: { id: documentId } });

  revalidatePath("/compliance");
}

// ---------------------------------------------------------------------------
// Vendors (Cyrus's lane — WORK-SPLIT.md task 2). Appended at the end of the
// file per WORK-SPLIT.md's shared-file rule.
// ---------------------------------------------------------------------------

/* ------------------------------------------------------------------ */
/* Contractor licences                                                 */
/* ------------------------------------------------------------------ */

/**
 * A licence a company holds, per jurisdiction.
 *
 * One row per licence HELD, not per state — the schema is explicit about
 * why: Colorado has no state licence at all, only municipal ones, so a
 * company working in two Colorado cities holds two rows here and no
 * "Colorado" row exists.
 *
 * These actions return ActionResult rather than throwing. Production
 * redacts thrown Server Action messages, so "That licence number is
 * already recorded" would reach a user as an unexplained failure.
 *
 * AND THEY DID NOT KEEP THAT PROMISE UNTIL 2026-09-21, on the one path
 * they do not write themselves. `licenceFieldsFromForm` below checks the
 * free-text fields and the dates by hand and RETURNS a refusal for each —
 * which is why this read as finished — but the two `<select>` values go
 * through `enumFromForm`, and that THROWS. With no boundary anywhere in
 * the function, the throw left the action as a rejected promise and
 * production redacted it: a licence saved with a value the picker did not
 * offer (a stale tab, a restored form, a dispatched submit) produced a
 * digest on /settings rather than a sentence.
 *
 * It was invisible for the usual reason — it reads perfectly in `next dev`,
 * where the message is not redacted. And a `grep` for the local-class
 * defect #407 found could never see it, because there is no local class
 * here: the boundary is not WRONG, it is ABSENT. Wrapping both actions in
 * ./shared's `runAction` is the whole fix. Pinned by
 * lib/actionInputError.test.ts.
 */

/** A yyyy-mm-dd from a date input, at UTC midnight — or null when blank.
 * Returns undefined when the text is present but not a date, so the caller
 * can say so rather than storing an Invalid Date. */
function dateFromForm(formData: FormData, key: string): Date | null | undefined {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function licenceFieldsFromForm(formData: FormData) {
  const jurisdictionName = String(formData.get("jurisdictionName") ?? "").trim();
  const licenseNumber = String(formData.get("licenseNumber") ?? "").trim();
  const classificationCode = String(formData.get("classificationCode") ?? "").trim();
  const classificationLabel = String(formData.get("classificationLabel") ?? "").trim();
  const bondNumber = String(formData.get("bondNumber") ?? "").trim();

  if (!jurisdictionName) return actionFail("Which jurisdiction issued it?");
  if (!licenseNumber) return actionFail("A licence number is required.");

  const issueDate = dateFromForm(formData, "issueDate");
  if (issueDate === undefined) return actionFail("That issue date isn't a date.");
  const expirationDate = dateFromForm(formData, "expirationDate");
  if (expirationDate === undefined) return actionFail("That expiration date isn't a date.");

  // An expiry before the issue date is always a typo, and it would show up
  // in the renewals panel as an already-expired licence you just added.
  if (issueDate && expirationDate && expirationDate < issueDate) {
    return actionFail("The expiration date is before the issue date.");
  }

  return {
    jurisdictionType: enumFromForm(formData, "jurisdictionType", JURISDICTION_TYPES),
    jurisdictionName,
    licenseNumber,
    classificationCode: classificationCode || null,
    classificationLabel: classificationLabel || null,
    issueDate,
    expirationDate,
    status: enumFromForm(formData, "status", SETTABLE_LICENSE_STATUSES),
    bondNumber: bondNumber || null,
  };
}

export async function createCompanyLicense(formData: FormData): Promise<ActionResult> {
  // `requireCompanyContext()` stays OUTSIDE the boundary on purpose: it
  // redirects an unauthenticated caller, and a redirect is a thrown control
  // signal, not a failure to render under a form. See ./shared's runAction.
  const context = await requireCompanyContext();
  return runAction(async () => {
    const refusal = ownerRefusal(context, "Only the account owner can add a licence");
    if (refusal) return refusal;
    const { company } = context;

    const fields = licenceFieldsFromForm(formData);
    if ("ok" in fields) return fields;

    // The same licence entered twice in two jurisdictions is legitimate (a
    // number is only unique within the body that issued it), so this checks
    // the pair, not the number alone.
    const existing = await prisma.companyLicense.findFirst({
      where: {
        companyId: company.id,
        licenseNumber: fields.licenseNumber,
        jurisdictionName: fields.jurisdictionName,
      },
    });
    if (existing) {
      return actionFail(`${fields.jurisdictionName} licence ${fields.licenseNumber} is already recorded.`);
    }

    await prisma.companyLicense.create({ data: { companyId: company.id, ...fields } });

    revalidatePath("/settings");
    revalidatePath("/compliance");
    return actionOk;
  });
}

export async function updateCompanyLicense(
  licenseId: string,
  formData: FormData,
): Promise<ActionResult> {
  // Outside the boundary for the reason createCompanyLicense's is.
  const context = await requireCompanyContext();
  return runAction(async () => {
    const refusal = ownerRefusal(context, "Only the account owner can edit a licence");
    if (refusal) return refusal;
    const { company } = context;

    const licence = await prisma.companyLicense.findUnique({ where: { id: licenseId } });
    if (!licence || licence.companyId !== company.id) {
      return actionFail("That licence no longer exists.");
    }

    const fields = licenceFieldsFromForm(formData);
    if ("ok" in fields) return fields;

    const clash = await prisma.companyLicense.findFirst({
      where: {
        companyId: company.id,
        licenseNumber: fields.licenseNumber,
        jurisdictionName: fields.jurisdictionName,
        id: { not: licenseId },
      },
    });
    if (clash) {
      return actionFail(`${fields.jurisdictionName} licence ${fields.licenseNumber} is already recorded.`);
    }

    await prisma.companyLicense.update({ where: { id: licenseId }, data: fields });

    revalidatePath("/settings");
    revalidatePath("/compliance");
    return actionOk;
  });
}

export async function deleteCompanyLicense(licenseId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const refusal = ownerRefusal(context, "Only the account owner can remove a licence");
  if (refusal) return refusal;
  const { company } = context;

  const licence = await prisma.companyLicense.findUnique({ where: { id: licenseId } });
  if (!licence || licence.companyId !== company.id) {
    return actionFail("That licence no longer exists.");
  }

  await prisma.companyLicense.delete({ where: { id: licenseId } });

  revalidatePath("/settings");
  revalidatePath("/compliance");
  return actionOk;
}
