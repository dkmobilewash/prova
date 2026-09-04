import { QuickBooksApiError } from "@prova/integrations";
import { isMissingDocumentError } from "@/lib/quickbooks-sync";

/**
 * Does QuickBooks still have this document?
 *
 * THE POINT OF THIS MODULE IS THAT A STRING NO LONGER DECIDES.
 *
 * Clearing a QuickBooksEntityLink is the one recovery in this codebase that
 * can produce a DUPLICATE document: with no link the next push builds a
 * CREATE rather than an update. So "was it deleted in QuickBooks" has to be
 * answered by QuickBooks, not by pattern-matching Intuit's prose — which is
 * localised, changes without notice, and on 2026-09-03 came back as
 * `Stale Object Error` for an invoice that had in fact been deleted.
 *
 * It lives in its own file, rather than beside its callers in
 * lib/actions/quickbooks.ts, for one reason: that file is `"use server"`,
 * where only exported async functions are allowed and a helper cannot be
 * imported by a test. This decision is now the safety property of the whole
 * recovery path, and a safety property nobody can write a test against is
 * one taken on faith. Here the getter is injected, so every branch —
 * including the ones that need a QuickBooks outage to reproduce — is
 * reachable from a unit test with no sandbox.
 */

/**
 * Three answers, and the difference between the last two is the whole
 * safety property:
 *
 *   GONE     a definite "there is no such record" came back.
 *            ONLY this may clear a link.
 *   PRESENT  we read it. Whatever the push failed on, it was not absence.
 *   UNKNOWN  we could not find out — the network, an expired token, a shape
 *            we do not recognise. Callers must treat this exactly like
 *            PRESENT: change nothing.
 *
 * UNKNOWN is deliberately not folded into either neighbour. "We failed to
 * confirm it exists" and "we confirmed it does not" are the same sentence
 * to a careless reader and opposite instructions to this code — one leaves
 * a confusing message, the other puts a second invoice in somebody's books.
 */
export type DocumentPresence = "GONE" | "PRESENT" | "UNKNOWN";

/**
 * Read-only by construction: the caller passes a getter, so there is no way
 * for this to write to QuickBooks even if it is called from the wrong place.
 */
export async function documentPresence(
  read: () => Promise<{ Id?: string } | null | undefined>,
): Promise<DocumentPresence> {
  try {
    const doc = await read();
    // A success carrying no id is NOT proof of absence. Intuit answers a
    // missing document with a Fault, so an empty body here means something
    // we do not understand — and "do not understand" must never clear a
    // link.
    return doc?.Id ? "PRESENT" : "UNKNOWN";
  } catch (error) {
    if (
      error instanceof QuickBooksApiError &&
      // 404 is the honest case. Intuit mostly does not use it — a missing
      // document comes back as 400 with fault 610 "Object Not Found" — so
      // both are accepted, and anything else is UNKNOWN rather than a
      // reason to delete something.
      (error.status === 404 || isMissingDocumentError(error.detail))
    ) {
      return "GONE";
    }
    return "UNKNOWN";
  }
}
