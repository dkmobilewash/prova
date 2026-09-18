"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { TOO_LARGE_MESSAGE, dateFromDay, importTooLarge } from "@/lib/spreadsheet-import";
import { IMPORT_COLLIDED, IMPORT_TX_OPTIONS, isWriteConflict } from "@/lib/import-shared";
import { toIsoDate } from "@/lib/compliance-expiry";
import { serverToday } from "@/lib/serverToday";
import { coiNotes, planCoiImport, readCoiExport } from "@/lib/mycoi/import";
import { ownerRefusal, type ActionResultWith } from "./shared";

/**
 * Confirming a myCOI export import on /settings/import.
 *
 * The page previews with nothing written. This writes exactly what the
 * preview showed as "will be added", deciding it again here from the pasted
 * text and a fresh read of this company's certificates, inside the same
 * Serializable transaction that writes — the reasons are in
 * lib/import-shared.ts. The browser's rows are never trusted, and nothing
 * in the file can name a company: every read and write is scoped to the
 * session's `companyId`.
 *
 * GUARDS, in order, all RETURNED (production redacts a thrown message):
 *   1. Owner only — the same page guard /settings/import already has, and
 *      the same reason: bulk-writing records is administration.
 *   2. MANAGE_COMPLIANCE — the capability that owns compliance documents.
 *      An owner holds it today; it is here so the import still answers to
 *      it the day the owner check is loosened.
 *
 * WHAT IT NEVER WRITES: anything saying "expired". A certificate's standing
 * is its `expiresAt` against today, derived on every read.
 */

export type CoiImportSummary = { created: number; alreadyThere: number; skipped: number; message: string };

type CoiImportResult = ActionResultWith<CoiImportSummary>;

function fail(error: string): Extract<CoiImportResult, { ok: false }> {
  return { ok: false, error };
}

export async function importMyCoiExport(formData: FormData): Promise<CoiImportResult> {
  const context = await requireCompanyContext();
  const refusal = ownerRefusal(context, "Only the account owner can import certificates of insurance.");
  if (refusal) return refusal;
  if (!can(context, "MANAGE_COMPLIANCE")) {
    return fail("Compliance isn't part of your job function. Ask the account owner.");
  }
  const text = String(formData.get("csv") ?? "");
  if (!text.trim()) return fail("Paste your myCOI export, or choose the CSV file, before confirming.");
  if (importTooLarge(text)) return fail(TOO_LARGE_MESSAGE);
  const companyId = context.company.id;
  const importedOn = serverToday();

  try {
    const summary = await prisma.$transaction(async (tx) => {
      const [certificates, vendors, contacts] = await Promise.all([
        tx.complianceDocument.findMany({
          where: { companyId, type: "CERTIFICATE_OF_INSURANCE" },
          select: { partyName: true, coverageType: true, expiresAt: true },
        }),
        tx.vendor.findMany({ where: { companyId }, select: { name: true } }),
        tx.contact.findMany({ where: { companyId }, select: { name: true, accountType: true } }),
      ]);
      const plan = planCoiImport(
        readCoiExport(text),
        certificates.map((row) => ({
          partyName: row.partyName,
          coverageType: row.coverageType,
          expiresOn: toIsoDate(row.expiresAt),
        })),
        {
          vendors: vendors.map((vendor) => vendor.name),
          subsAndSuppliers: contacts
            .filter((contact) => contact.accountType === "SUBCONTRACTOR" || contact.accountType === "VENDOR")
            .map((contact) => contact.name),
        },
      );

      if (plan.create.length > 0) {
        await tx.complianceDocument.createMany({
          data: plan.create.map((row) => ({
            companyId,
            type: "CERTIFICATE_OF_INSURANCE" as const,
            partyName: row.vendorName,
            coverageType: row.coverage,
            // myCOI holds the certificate, so it is on file — received, not
            // requested. Whether it is still GOOD is the date's job.
            status: "RECEIVED" as const,
            effectiveDate: row.effectiveDate ? dateFromDay(row.effectiveDate) : null,
            expiresAt: dateFromDay(row.expiresOn),
            notes: coiNotes(row, importedOn),
          })),
        });
      }

      const created = plan.create.length;
      const parts = [
        created === 0
          ? "Nothing new to add — every certificate in that file is already here."
          : `Added ${created} ${created === 1 ? "certificate" : "certificates"}.`,
      ];
      if (plan.existing.length > 0) {
        parts.push(`${plan.existing.length} ${plan.existing.length === 1 ? "was" : "were"} already here and left alone.`);
      }
      if (plan.problems.length > 0) {
        parts.push(`${plan.problems.length} ${plan.problems.length === 1 ? "row was" : "rows were"} skipped — see the problems listed.`);
      }
      return { created, alreadyThere: plan.existing.length, skipped: plan.problems.length, message: parts.join(" ") };
    }, IMPORT_TX_OPTIONS);

    revalidatePath("/settings/import");
    revalidatePath("/compliance");
    revalidatePath("/vendors");
    return { ok: true, value: summary };
  } catch (err) {
    if (isWriteConflict(err)) return fail(IMPORT_COLLIDED);
    throw err;
  }
}
