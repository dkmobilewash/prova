"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { QuickBooksApiError } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { IMPORT_COLLIDED, IMPORT_TX_OPTIONS, isWriteConflict } from "@/lib/import-shared";
import {
  QBO_LINK_TYPES,
  planQuickBooksImport,
  quickBooksSummarySentence,
  type ExistingForQuickBooks,
  type QuickBooksPlan,
} from "@/lib/quickbooks-import";
import {
  QuickBooksImportNotConnectedError,
  QuickBooksImportReconnectError,
  pullFromQuickBooks,
} from "@/lib/quickbooks-import-pull";
import { isUniqueConstraintError, ownerRefusal, type ActionResultWith } from "./shared";

/**
 * The QuickBooks import on /settings: preview and confirm.
 *
 * The same arrangement as the Jobber import (lib/actions/jobber.ts), which is
 * the same arrangement as the spreadsheet import: NOTHING THE BROWSER SENDS
 * DECIDES WHAT IS WRITTEN. Neither action takes an argument. Preview reads
 * QuickBooks and plans against this company's rows; Confirm reads QuickBooks
 * AGAIN and plans again, the read of what already exists inside the
 * Serializable transaction that writes (lib/import-shared.ts). A big
 * QuickBooks company never travels browser -> server, so the 1 MB Server
 * Action body limit cannot bite.
 *
 * READ-ONLY TOWARD QUICKBOOKS. The only QuickBooks functions reachable from
 * here are the three `read*ForImport` queries (GET) and the token refresh the
 * invoice push already uses. quickbooksImport.test.ts fails if an
 * accounting-API request made by either action is anything but a GET.
 *
 * GUARDS, all RETURNED (production redacts a thrown Server Action message),
 * every one before anything is read:
 *   1. MANAGE_COMPLIANCE, the capability /settings demands — the page's door
 *      and the action's door must agree (action-capability-guards.test.ts).
 *   2. Owner only, like the rest of the QuickBooks section.
 *   3. MANAGE_JOBS (clients) and MANAGE_ESTIMATING (the catalog) — the
 *      capabilities that own what is created. An owner holds both today; they
 *      are here so the import still answers to them the day the owner check
 *      is loosened.
 *
 * Every read and write is scoped to the SESSION's company, links included —
 * another company connected to the same QuickBooks company has its own rows
 * and its own links, and they are never read.
 */

export type QuickBooksImportSummary = {
  clientsAdded: number;
  vendorsAdded: number;
  catalogAdded: number;
  alreadyThere: number;
  message: string;
};

function refuse(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const NOT_YOUR_FUNCTION = "QuickBooks settings aren't part of your job function. Ask the account owner.";

/** Guards 2 and 3. Guard 1 is written in each action's own body, where
 * action-capability-guards.test.ts reads it. */
function guard(
  context: Awaited<ReturnType<typeof requireCompanyContext>>,
): { companyId: string } | { ok: false; error: string } {
  const refusal = ownerRefusal(context, "Only the account owner can import from QuickBooks.");
  if (refusal) return refusal;
  if (!can(context, "MANAGE_JOBS")) {
    return refuse("Adding clients isn't part of your job function. Ask the account owner.");
  }
  if (!can(context, "MANAGE_ESTIMATING")) {
    return refuse("Adding to the catalog isn't part of your job function. Ask the account owner.");
  }
  return { companyId: context.company.id };
}

/** QuickBooks-side failures as sentences. Anything else is a genuine bug and
 * is rethrown, so it is redacted in production as a bug should be. */
function explain(error: unknown): string | null {
  if (error instanceof QuickBooksImportNotConnectedError || error instanceof QuickBooksImportReconnectError) {
    return error.message;
  }
  if (error instanceof QuickBooksApiError) {
    return `Couldn't read from QuickBooks just now. ${error.detail}`;
  }
  return null;
}

type Reader = Pick<typeof prisma, "contact" | "vendor" | "lineItemCatalogEntry" | "quickBooksEntityLink">;

async function readExisting(companyId: string, client: Reader = prisma): Promise<ExistingForQuickBooks> {
  const [contacts, vendors, catalog, links] = await Promise.all([
    client.contact.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    client.vendor.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    client.lineItemCatalogEntry.findMany({
      where: { companyId },
      select: { id: true, description: true },
      orderBy: { createdAt: "asc" },
    }),
    client.quickBooksEntityLink.findMany({
      where: { companyId },
      select: { entityType: true, entityId: true, qboId: true },
    }),
  ]);
  const of = (type: string) =>
    links.filter((link) => link.entityType === type).map((link) => ({ entityId: link.entityId, qboId: link.qboId }));
  return {
    contacts,
    vendors,
    catalog,
    links: { contact: of(QBO_LINK_TYPES.contact), vendor: of(QBO_LINK_TYPES.vendor), catalog: of(QBO_LINK_TYPES.catalog) },
    pushItemIds: links.filter((link) => link.entityType === "Item").map((link) => link.qboId),
  };
}

/** Read and plan. Writes nothing of the import's — not a row, not a link,
 * not a log line. (A token refresh may update the connection row; that is
 * the credential, the same as any other QuickBooks call.) */
export async function previewQuickBooksImport(): Promise<ActionResultWith<QuickBooksPlan>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return refuse(NOT_YOUR_FUNCTION);
  const guarded = guard(context);
  if ("ok" in guarded) return guarded;
  try {
    const pull = await pullFromQuickBooks(guarded.companyId);
    const existing = await readExisting(guarded.companyId);
    return { ok: true, value: planQuickBooksImport(pull, existing) };
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return refuse(sentence);
    throw error;
  }
}

/** Map created rows back to their QuickBooks ids by the name that was
 * written. Names are unique within one plan's create list (the planner
 * refuses a second record with the same key), so this is exact; a row that
 * does not map is a bug, thrown so the whole transaction rolls back. */
function idsByName<T extends { id: string }>(
  created: T[],
  nameOf: (row: T) => string,
  rows: { qboId: string; name: string }[],
): { entityId: string; qboId: string }[] {
  const idOf = new Map(created.map((row) => [nameOf(row), row.id]));
  if (idOf.size !== rows.length) throw new Error("QuickBooks import: created rows do not match the plan");
  return rows.map((row) => {
    const entityId = idOf.get(row.name);
    if (!entityId) throw new Error("QuickBooks import: a created row has no id");
    return { entityId, qboId: row.qboId };
  });
}

/** Read again, plan again inside the transaction, write what the plan
 * creates with a link to the QuickBooks record each came from, and log it. */
export async function confirmQuickBooksImport(): Promise<ActionResultWith<QuickBooksImportSummary>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return refuse(NOT_YOUR_FUNCTION);
  const guarded = guard(context);
  if ("ok" in guarded) return guarded;
  const { companyId } = guarded;

  let pull;
  try {
    pull = await pullFromQuickBooks(companyId);
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return refuse(sentence);
    throw error;
  }

  try {
    const summary = await prisma.$transaction(async (tx) => {
      const existing = await readExisting(companyId, tx);
      const plan = planQuickBooksImport(pull, existing);
      const now = new Date();
      const links: { entityType: string; entityId: string; qboId: string }[] = [];

      if (plan.clients.create.length > 0) {
        const created = await tx.contact.createManyAndReturn({
          data: plan.clients.create.map((row) => ({
            companyId,
            name: row.name,
            email: row.email,
            phone: row.phone,
            address: row.address,
          })),
          select: { id: true, name: true },
        });
        for (const link of idsByName(created, (row) => row.name, plan.clients.create)) {
          links.push({ entityType: QBO_LINK_TYPES.contact, ...link });
        }
      }

      if (plan.vendors.create.length > 0) {
        const created = await tx.vendor.createManyAndReturn({
          data: plan.vendors.create.map((row) => ({
            companyId,
            name: row.name,
            contactName: row.contactName,
            email: row.email,
            phone: row.phone,
            notes: row.notes,
          })),
          select: { id: true, name: true },
        });
        for (const link of idsByName(created, (row) => row.name, plan.vendors.create)) {
          links.push({ entityType: QBO_LINK_TYPES.vendor, ...link });
        }
      }

      if (plan.catalog.create.length > 0) {
        const created = await tx.lineItemCatalogEntry.createManyAndReturn({
          data: plan.catalog.create.map((row) => ({
            companyId,
            description: row.description,
            defaultUnitPrice: row.unitPrice != null ? row.unitPrice.toFixed(2) : null,
            defaultBudgetedUnitCost: row.unitCost != null ? row.unitCost.toFixed(2) : null,
          })),
          select: { id: true, description: true },
        });
        const rows = plan.catalog.create.map((row) => ({ qboId: row.qboId, name: row.description }));
        for (const link of idsByName(created, (row) => row.description, rows)) {
          links.push({ entityType: QBO_LINK_TYPES.catalog, ...link });
        }
      }

      if (links.length > 0) {
        await tx.quickBooksEntityLink.createMany({
          // Read from QuickBooks moments ago, inside this import — so
          // verified now, and never pushed.
          data: links.map((link) => ({ companyId, ...link, lastVerifiedAt: now })),
        });
      }

      const added = {
        clients: plan.clients.create.length,
        vendors: plan.vendors.create.length,
        catalog: plan.catalog.create.length,
      };
      const alreadyThere = plan.clients.existing.length + plan.vendors.existing.length + plan.catalog.existing.length;
      const message = quickBooksSummarySentence(added, alreadyThere);

      // The log row and the summary it feeds, together or not at all. It is
      // the same log the invoice push writes, so "Recent sync activity" on
      // /settings says an import happened and what it added.
      await tx.quickBooksSyncAttempt.create({
        data: {
          companyId,
          entityType: "Import",
          entityId: companyId,
          idempotencyKey: `import:${now.toISOString()}`,
          outcome: "SUCCEEDED",
          summary: message,
          attemptedByUserId: context.id,
        },
      });

      return {
        clientsAdded: added.clients,
        vendorsAdded: added.vendors,
        catalogAdded: added.catalog,
        alreadyThere,
        message,
      };
    }, IMPORT_TX_OPTIONS);

    revalidatePath("/settings");
    revalidatePath("/settings/import");
    revalidatePath("/contacts");
    revalidatePath("/vendors");
    revalidatePath("/catalog");
    revalidatePath("/dashboard");
    return { ok: true, value: summary };
  } catch (error) {
    if (isWriteConflict(error)) return refuse(IMPORT_COLLIDED);
    // Two imports racing past Serializable onto a link's unique index —
    // the index is the last line, and it held.
    if (isUniqueConstraintError(error)) return refuse(IMPORT_COLLIDED);
    throw error;
  }
}
