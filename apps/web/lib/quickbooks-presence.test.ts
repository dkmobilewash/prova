import { describe, expect, it } from "vitest";
import { QuickBooksApiError } from "@prova/integrations";
import { documentPresence } from "./quickbooks-presence";

/**
 * These tests exist because the function they cover is the only thing
 * standing between a deleted QuickBooks invoice and a duplicate one.
 *
 * The caller clears an entity link on GONE and on nothing else, and a
 * cleared link turns the next push into a CREATE. So every case that is not
 * a definite "this record is not there" has to come back as something the
 * caller will ignore — including the cases that would need a QuickBooks
 * outage to reproduce by hand, which is the whole reason the getter is
 * injected rather than called directly.
 */

const gone = (status: number, detail: string) => () =>
  Promise.reject(new QuickBooksApiError(status, detail));

describe("asking QuickBooks whether a document is still there", () => {
  it("PRESENT when the read comes back with a record", async () => {
    expect(await documentPresence(async () => ({ Id: "146", SyncToken: "3" }))).toBe("PRESENT");
  });

  it("GONE on Intuit's 400 + Object Not Found, which is what a delete really returns", async () => {
    expect(
      await documentPresence(gone(400, "Object Not Found : Something went wrong")),
    ).toBe("GONE");
  });

  it("GONE on a plain 404 whatever the body says", async () => {
    expect(await documentPresence(gone(404, "no idea"))).toBe("GONE");
  });

  /* Everything below here must NOT be GONE. Each one is a way the check can
     fail to get an answer, and treating "no answer" as "deleted" is the bug
     this whole module was written to make impossible. */

  it("UNKNOWN when the token has expired — an outage is not a deletion", async () => {
    expect(await documentPresence(gone(401, "AuthenticationFailed"))).toBe("UNKNOWN");
  });

  it("UNKNOWN when QuickBooks is down", async () => {
    expect(await documentPresence(gone(503, "Service Unavailable"))).toBe("UNKNOWN");
  });

  it("UNKNOWN when throttled", async () => {
    expect(await documentPresence(gone(429, "Too Many Requests"))).toBe("UNKNOWN");
  });

  it("UNKNOWN when the network never reached Intuit at all", async () => {
    // Not a QuickBooksApiError — no status, no detail to match on. The
    // branch that a `catch (e) { return "GONE" }` would have swallowed.
    expect(
      await documentPresence(() => Promise.reject(new TypeError("fetch failed"))),
    ).toBe("UNKNOWN");
  });

  it("UNKNOWN on a success carrying no id, rather than reading it as absence", async () => {
    expect(await documentPresence(async () => ({}))).toBe("UNKNOWN");
    expect(await documentPresence(async () => null)).toBe("UNKNOWN");
    expect(await documentPresence(async () => undefined)).toBe("UNKNOWN");
  });

  it("never answers GONE for a refusal that is about the payload", async () => {
    // A stale-token refusal reaching the PROBE would mean the document is
    // there to be stale about. It must not clear anything.
    for (const detail of [
      "Stale Object Error : You and Craig Carlson were working on this at the same time.",
      "Required parameter Line.SalesItemLineDetail is missing",
      "Invalid Reference Id : Product/Service assigned to this transaction has been deleted.",
    ]) {
      expect(await documentPresence(gone(400, detail)), detail).toBe("UNKNOWN");
    }
  });
});
