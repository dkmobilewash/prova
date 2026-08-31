"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, assertOwner, type ActionResult } from "./shared";

/** Vendor price quotes — what a supplier said something costs, on a date.
 *
 * Actions here RETURN their failures. Production redacts thrown Server
 * Action messages to an opaque digest, and every guard below is a sentence
 * telling somebody what to fix. `lib/actions/submittals.ts` is the
 * reference for the pattern.
 *
 * Nothing in this module writes to a job, a line item or a cost entry. A
 * quote is reference data for pricing work; job cost has exactly one home
 * and it is `CostEntry`.
 */

class InputError extends Error {}

const SOURCES = ["QUOTE", "INVOICE", "PRICE_LIST", "VERBAL"] as const;

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

/** Stored at UTC midnight so comparisons are calendar-day comparisons. */
function optionalDate(formData: FormData, key: string, label: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new InputError(`${label} is not a valid date`);
  return date;
}

function requiredDate(formData: FormData, key: string, label: string): Date {
  const date = optionalDate(formData, key, label);
  if (!date) throw new InputError(`${label} is required`);
  return date;
}

/** A price, as a string for Prisma's Decimal.
 *
 * Rejects a negative outright: there is no such thing as a vendor paying
 * you per square foot, and a stray minus sign would make that vendor the
 * cheapest on the comparison forever. Zero is allowed — "included, no
 * charge" is a real thing on a quote. */
function unitPriceFromForm(formData: FormData): string {
  const raw = required(formData, "unitPrice", "Unit price");
  const value = Number(raw);
  if (Number.isNaN(value)) throw new InputError(`"${raw}" is not a number`);
  if (value < 0) throw new InputError("A unit price can't be negative");
  return raw;
}

function sourceFromForm(formData: FormData): (typeof SOURCES)[number] {
  const raw = text(formData, "source");
  if (!SOURCES.includes(raw as (typeof SOURCES)[number])) {
    throw new InputError("Pick where this price came from");
  }
  return raw as (typeof SOURCES)[number];
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

/** Everything a quote needs, validated together.
 *
 * The two cross-field rules both catch a typo that would otherwise poison
 * a derived figure rather than showing up as an obvious error:
 *
 * - A `validUntil` BEFORE `quotedOn` describes a price that expired before
 *   it was given. It would read as permanently expired and quietly drop
 *   out of every comparison, with nothing on screen saying why.
 * - A catalog entry from another company would link this price to a
 *   template its owner never sees, and the id arrives from a form.
 */
async function fields(formData: FormData, companyId: string) {
  const vendorId = required(formData, "vendorId", "Vendor");
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || vendor.companyId !== companyId) {
    throw new InputError("Vendor not found");
  }

  const catalogEntryIdRaw = text(formData, "catalogEntryId");
  let catalogEntryId: string | null = null;
  if (catalogEntryIdRaw) {
    const entry = await prisma.lineItemCatalogEntry.findUnique({
      where: { id: catalogEntryIdRaw },
    });
    if (!entry || entry.companyId !== companyId) {
      throw new InputError("Catalog item not found");
    }
    catalogEntryId = entry.id;
  }

  const quotedOn = requiredDate(formData, "quotedOn", "Quoted on");
  const validUntil = optionalDate(formData, "validUntil", "Valid until");
  if (validUntil && validUntil < quotedOn) {
    throw new InputError("A quote can't expire before the day it was given");
  }

  return {
    vendorId: vendor.id,
    catalogEntryId,
    description: required(formData, "description", "Description"),
    unit: text(formData, "unit") || null,
    unitPrice: unitPriceFromForm(formData),
    quotedOn,
    validUntil,
    source: sourceFromForm(formData),
    notes: text(formData, "notes") || null,
  };
}

/** Records a price a vendor gave you. */
export async function createVendorPriceQuote(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    await prisma.vendorPriceQuote.create({
      data: {
        companyId: company.id,
        recordedByUserId: user.id,
        ...(await fields(formData, company.id)),
      },
    });
    revalidatePath("/vendors/pricing");
    return ok;
  });
}

/** Edits a quote in place.
 *
 * Everything is editable, deliberately: unlike an RFI or a submittal, a
 * quote is not correspondence anyone was sent and nothing is numbered off
 * it. It is a note about what someone told you, and the common repair is
 * fixing a mistyped price before a bid goes out on it.
 *
 * Every field is always submitted, so an empty optional field means "not
 * set" rather than "leave alone" — the same rule as every other edit form
 * here. */
export async function updateVendorPriceQuote(
  quoteId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const existing = await prisma.vendorPriceQuote.findUnique({ where: { id: quoteId } });
    if (!existing || existing.companyId !== company.id) return fail("Price quote not found");

    await prisma.vendorPriceQuote.update({
      where: { id: quoteId },
      data: await fields(formData, company.id),
    });
    revalidatePath("/vendors/pricing");
    return ok;
  });
}

/** Removes a quote. Owner-only, matching every other company-level record
 * deletion. Deleting one changes what "current" and "cheapest" mean, which
 * is why it asks twice in the UI and is gated here. */
export async function deleteVendorPriceQuote(quoteId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    // assertOwner THROWS, and a thrown message is redacted in production —
    // so it is caught and returned like every other guard here.
    try {
      assertOwner(context, "Only the account owner can remove a price quote");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }
    const { company } = context;

    const existing = await prisma.vendorPriceQuote.findUnique({ where: { id: quoteId } });
    if (!existing || existing.companyId !== company.id) return fail("Price quote not found");

    await prisma.vendorPriceQuote.delete({ where: { id: quoteId } });
    revalidatePath("/vendors/pricing");
    return ok;
  });
}
