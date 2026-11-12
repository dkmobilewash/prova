"use server";

import { Buffer } from "node:buffer";
import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { unitPriceFromCost } from "@/lib/bid-recap";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { standardsFrom } from "@/lib/estimating/assemblyStandards";
import { applyCatalogPrices, priceNeeds, ratesFrom } from "@/lib/estimating/catalogPrices";
import { catalogByMaterial, catalogFor } from "@/lib/estimating/materialKey";
import { chosenRows, materialLabelFor, planPriceList, priceListTable, readRow, type ColumnMap, type Picks } from "@/lib/estimating/priceList";
import { actionFail, ownerRefusal, type ActionResultWith } from "./shared";
import { pdfRows } from "@/lib/estimating/pdfRows";
import { looksLikeEmail } from "@prova/integrations";

const NO_ESTIMATING = "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";
const PDF_PAGES_MAX = 20;
const TEXT_MAX = 900_000;

/**
 * A price list sent as a PDF, read from its TEXT LAYER and handed back as the same CSV text a
 * spreadsheet becomes, so the preview, the column mapping and the import are one path. A scanned
 * quote has no text layer and says so; nothing here reads pixels.
 */
export async function readPriceListPdf(formData: FormData): Promise<ActionResultWith<{ text: string }>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING) as ActionResultWith<never>;
  const file = formData.get("file");
  if (!(file instanceof File) || !/\.pdf$/i.test(file.name)) return actionFail("Choose a PDF.") as ActionResultWith<never>;
  if (file.size > 3_500_000) return actionFail("That PDF is over 3.5 MB. Export the quote as a spreadsheet instead.") as ActionResultWith<never>;
  try {
    const doc = await openPlanPdf(Buffer.from(await file.arrayBuffer()));
    const rows: string[][] = [];
    for (let page = 1; page <= Math.min(doc.pageCount, PDF_PAGES_MAX); page += 1) rows.push(...pdfRows((await doc.pageText(page)).items));
    if (rows.flat().join("").trim().length < 20) return actionFail("This PDF has no readable text — it is probably a scan. Ask the supplier for the spreadsheet or a typed PDF.") as ActionResultWith<never>;
    const csv = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
    return { ok: true, value: { text: rows.map((cells) => cells.map(csv).join(",")).join("\n") } };
  } catch {
    return actionFail("That PDF could not be read. Export the quote as a spreadsheet instead.") as ActionResultWith<never>;
  }
}

export type PriceListImportInput = { vendorName: string; quotedOn: string; text: string; map: ColumnMap; picks: Picks; contactEmail?: string };
export type PriceListImportResult = { quotes: number; prices: number; linked: number; priced: number; jobs: number; noMarkup: number };

/**
 * ── A SUPPLIER'S PRICE LIST INTO THE PRICE BOOK, AND FROM THERE INTO EVERY WAITING ESTIMATE ──
 *
 * Owner only, like every other re-pricing of the catalog. Re-reads the text and re-matches every
 * row here (the preview is a claim); checks every pick against the rows actually offered. Writes:
 * each priced row as a `VendorPriceQuote` in the supplier's own words and unit; each matched or
 * picked material as a catalog entry in the estimate's unit (cost = the converted price, price =
 * through the company's markup when it is set); then `applyCatalogPrices`. An unmatched row prices
 * nothing — it is kept as a quote, for reference, and that is all.
 */
export async function importPriceList(input: PriceListImportInput): Promise<ActionResultWith<PriceListImportResult>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING) as ActionResultWith<never>;
  const { company, ...user } = context;
  const refusal = ownerRefusal(user, "Only the account owner can re-price the catalog.");
  if (refusal) return refusal as ActionResultWith<never>;
  const companyId = company.id;

  const vendorName = String(input.vendorName ?? "").trim().slice(0, 120);
  if (vendorName === "") return actionFail("Name the supplier, so every price says where it came from.") as ActionResultWith<never>;
  // Where "Send PO to supplier" sends their orders. Optional: blank keeps whatever the supplier had.
  const contactEmail = String(input.contactEmail ?? "").trim().slice(0, 200);
  if (contactEmail !== "" && !looksLikeEmail(contactEmail)) return actionFail(`"${contactEmail}" doesn't look like an email address.`) as ActionResultWith<never>;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.quotedOn))) return actionFail("Enter the date on the quote.") as ActionResultWith<never>;
  const quotedOn = new Date(`${input.quotedOn}T00:00:00.000Z`);
  if (Number.isNaN(quotedOn.getTime()) || quotedOn.getTime() > Date.now() + 86_400_000) return actionFail("The quote date can't be in the future.") as ActionResultWith<never>;
  const text = String(input.text ?? "");
  if (text.length > TEXT_MAX) return actionFail("That list is too big to import in one go — split it.") as ActionResultWith<never>;

  const defaults = await prisma.companyBidDefaults.findUnique({ where: { companyId } });
  const standards = standardsFrom(defaults?.assemblyStandards, defaults?.defaultWastePercent == null ? null : Number(defaults.defaultWastePercent));
  const table = priceListTable(text);
  const width = Math.max(1, ...table.rows.map((r) => r.cells.length));
  const inRange = (i: number | null) => i === null || (Number.isInteger(i) && i >= 0 && i < width);
  const map = input.map;
  if (!map || !inRange(map.item) || !inRange(map.price) || !inRange(map.size) || !inRange(map.unit) || map.item === null || map.price === null) {
    return actionFail("Say which column is the item and which is the price.") as ActionResultWith<never>;
  }
  const rows = table.rows.map((r) => readRow(r, map, standards.tapeRollLf));
  if (rows.length === 0) return actionFail("There are no rows under the header to import.") as ActionResultWith<never>;
  const needs = await priceNeeds(prisma, companyId);
  const plan = planPriceList(rows, needs);
  const chosen = chosenRows(plan, { byKey: input.picks?.byKey ?? {}, byGroup: input.picks?.byGroup ?? {} });
  if (typeof chosen === "string") return actionFail(chosen) as ActionResultWith<never>;
  const rowAt = new Map(rows.map((r) => [r.line, r]));
  const rates = ratesFrom(defaults);
  const priceOf = (cost: number) => (rates === null ? null : unitPriceFromCost({ quantity: 1, unitCost: cost, costCategory: "MATERIAL" }, rates));

  const result = await prisma.$transaction(
    async (tx) => {
      const found = await tx.vendor.findFirst({ where: { companyId, name: { equals: vendorName, mode: "insensitive" } }, select: { id: true } });
      if (found && contactEmail !== "") await tx.vendor.update({ where: { id: found.id }, data: { email: contactEmail } });
      const vendor = found ?? (await tx.vendor.create({ data: { companyId, name: vendorName, email: contactEmail || null }, select: { id: true } }));
      const entries = await tx.lineItemCatalogEntry.findMany({ where: { companyId }, select: { id: true, description: true, unit: true } });
      const catalog = catalogByMaterial(entries);
      const entryForLine = new Map<number, string>();
      const upsert = async (description: string, unit: string, cost: number) => {
        const found = catalogFor(catalog, { description, unit }) ?? entries.find((e) => e.description.toLowerCase() === description.toLowerCase())?.id ?? null;
        const data = { defaultBudgetedUnitCost: cost.toFixed(2), defaultUnitPrice: priceOf(cost) };
        if (found) {
          await tx.lineItemCatalogEntry.update({ where: { id: found }, data });
          return found;
        }
        const made = await tx.lineItemCatalogEntry.create({ data: { companyId, description, unit, costCategory: "MATERIAL", ...data }, select: { id: true } });
        entries.push({ id: made.id, description, unit });
        return made.id;
      };
      for (const { key, line } of chosen) {
        const row = rowAt.get(line)!;
        const label = materialLabelFor(key, standards.tapeRollLf) + (row.studLengthFt ? ` (${row.studLengthFt} ft)` : "");
        entryForLine.set(line, await upsert(label, row.ourUnit!, row.ourPrice!));
      }
      // A need the drawing left imprecise gets its own entry, named for the need, linked to its parts directly:
      // its words cannot match anything by themselves, which is exactly why a person picked.
      const direct: { componentIds: string[]; entryId: string }[] = [];
      for (const [group, line] of Object.entries(input.picks?.byGroup ?? {})) {
        const need = needs.find((n) => n.group === group)!;
        const row = rowAt.get(line)!;
        // Named for the need and NOT the row: the row's words (a gauge) would make this read as the same
        // material as the row's own entry, and two entries for one material price neither. The quote keeps the row's words.
        // A row that already priced its own material is that entry; the need's parts point at it, one price, one source.
        const entryId = entryForLine.get(line) ?? (await upsert(`${need.label} (picked from ${vendorName}, row ${line})`.slice(0, 200), need.unit ?? row.ourUnit!, row.ourPrice!));
        entryForLine.set(line, entryId);
        direct.push({ componentIds: need.componentIds, entryId });
      }
      let quotes = 0;
      for (const row of rows) {
        if (row.price === null) continue;
        await tx.vendorPriceQuote.create({
          data: {
            companyId,
            vendorId: vendor.id,
            catalogEntryId: entryForLine.get(row.line) ?? null,
            description: row.description.slice(0, 500),
            unit: row.unit,
            unitPrice: row.price.toFixed(2),
            quotedOn,
            source: "PRICE_LIST",
            notes: row.how.slice(0, 500),
            recordedByUserId: user.id,
          },
        });
        quotes += 1;
      }
      const applied = await applyCatalogPrices(tx, companyId, direct);
      return { quotes, prices: new Set(entryForLine.values()).size, ...applied };
    },
    { timeout: 60_000 },
  );
  revalidatePath("/catalog");
  revalidatePath("/jobs", "layout");
  return { ok: true, value: result };
}
