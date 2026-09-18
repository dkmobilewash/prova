import { prisma } from "@prova/db";
import {
  QuickBooksApiError,
  readCustomersForImport,
  readItemsForImport,
  readVendorsForImport,
} from "@prova/integrations";
import { QUICKBOOKS_PULL_LIMIT, type QuickBooksPull } from "@/lib/quickbooks-import";
import { accessTokenFor } from "@/lib/quickbooks-token";

/**
 * Reading one company's QuickBooks for the import: the token, then three
 * read-only queries.
 *
 * The token comes from the SAME code the invoice push uses
 * (lib/quickbooks-token.ts), refresh included, so the import cannot hold a
 * second opinion about whether the connection works. That refresh is the
 * one database write reading QuickBooks can cause, and it is to the
 * credential row, not to anything the import brings in.
 *
 * The connection is looked up by the SESSION's company id, passed in by
 * the action — never by anything the browser sent.
 */

export class QuickBooksImportNotConnectedError extends Error {
  constructor() {
    super("QuickBooks isn't connected. Press Connect QuickBooks first.");
    this.name = "QuickBooksImportNotConnectedError";
  }
}

export class QuickBooksImportReconnectError extends Error {
  constructor() {
    super(
      "QuickBooks stopped accepting C Stream's access — this happens when the app is disconnected inside QuickBooks, or about every 100 days. Disconnect and connect QuickBooks again.",
    );
    this.name = "QuickBooksImportReconnectError";
  }
}

export async function pullFromQuickBooks(
  companyId: string,
  options: { pageSize?: number; limit?: number } = {},
): Promise<QuickBooksPull> {
  const token = await accessTokenFor(companyId);
  if (!token) {
    // accessTokenFor answers null both for "never connected" and for "the
    // refresh was refused" — the second is recorded on the connection row
    // as NEEDS_REAUTH, which is how the two are told apart here.
    const connection = await prisma.quickBooksConnection.findUnique({
      where: { companyId },
      select: { id: true },
    });
    throw connection ? new QuickBooksImportReconnectError() : new QuickBooksImportNotConnectedError();
  }
  const read = { limit: options.limit ?? QUICKBOOKS_PULL_LIMIT, pageSize: options.pageSize };
  try {
    // One after another rather than all at once: Intuit rate-limits per
    // company, and three parallel page loops is how a big account earns 429s.
    const customers = await readCustomersForImport(token.realmId, token.accessToken, read);
    const vendors = await readVendorsForImport(token.realmId, token.accessToken, read);
    const items = await readItemsForImport(token.realmId, token.accessToken, read);
    return {
      customers: customers.rows,
      vendors: vendors.rows,
      items: items.rows,
      truncated: { customers: customers.truncated, vendors: vendors.truncated, items: items.truncated },
    };
  } catch (error) {
    // 401 on a token that looked fresh: revoked on Intuit's side.
    if (error instanceof QuickBooksApiError && error.status === 401) throw new QuickBooksImportReconnectError();
    throw error;
  }
}
