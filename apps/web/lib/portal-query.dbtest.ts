import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { loadPortalContact, loadPortalJob } from "@/lib/portal-query";

/**
 * WHAT THE GC PORTAL MAY READ, AGAINST A REAL POSTGRES.
 *
 * WHY THIS FILE HAS TO EXIST AND A PURE TEST WILL NOT DO. Every claim
 * `lib/portal-query.ts` makes is a claim about a `where` clause or a
 * `select`, and neither is visible to a test that does not talk to a
 * database — the same reason `job-media-sharing.dbtest.ts` gives for
 * itself: "every claim this feature makes is a claim about a `where`
 * clause, and a pure test structurally cannot see one". The portal has no
 * auth at all; the token in the URL is the whole credential and the URL
 * gets forwarded. So these clauses are the security boundary, and an
 * unproven security fix is the thing this repo exists to avoid shipping.
 *
 * THE LAST CASE IS THE ONE THAT WILL CATCH THE NEXT REGRESSION. The first
 * three assert behaviour that a reviewer could also see in a diff. The
 * fourth reads the KEYS that actually came back, because the failure this
 * module was written after was not a wrong filter — it was `company: true`
 * fetching a whole row for one field, which no behavioural test can
 * notice. A type cannot catch it either: widening a `select` widens the
 * derived type with it and everything still compiles. Only counting the
 * keys on the object does.
 *
 * Named `.dbtest.ts` so the normal suite does not collect it. CI's own
 * `dbtest` job (ci.yml, a postgres:16 service) runs it — note that
 * `gc-surface-tokens.dbtest.ts`'s header still says "CI has no database",
 * which was true when it was written and is not now.
 */

const ctx = { companyId: "", contactId: "", otherContactId: "", jobId: "", estimateJobId: "", otherJobId: "" };
const TOKEN = "portal-query-dbtest-token";
const OTHER_TOKEN = "portal-query-dbtest-other";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Portal Query Test Co" } });
  ctx.companyId = company.id;

  const contact = await prisma.contact.create({
    data: { companyId: company.id, name: "Portal GC", portalToken: TOKEN },
  });
  ctx.contactId = contact.id;

  const other = await prisma.contact.create({
    data: { companyId: company.id, name: "Other GC", portalToken: OTHER_TOKEN },
  });
  ctx.otherContactId = other.id;

  // A contracted job with one priced line and one cost-only budget line.
  const job = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      name: "Awarded Job",
      status: "CONTRACTED",
      lineItems: {
        create: [
          { description: "Metal stud framing", quantity: "100", unit: "LF", unitPrice: "42.50" },
          // The disclosure: jobs.prisma calls a null unitPrice "a cost-only
          // budget line (general conditions, overhead, contingency)".
          { description: "Contingency — GC is slow to answer RFIs", quantity: "1", unitPrice: null },
        ],
      },
    },
  });
  ctx.jobId = job.id;

  // Work this GC has NOT awarded, with a live number on it.
  const estimate = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      name: "Bid In Progress",
      status: "ESTIMATE",
      lineItems: { create: [{ description: "Drywall", quantity: "1", unitPrice: "999999" }] },
    },
  });
  ctx.estimateJobId = estimate.id;

  // Another GC's job, same company.
  const otherJob = await prisma.job.create({
    data: { companyId: company.id, contactId: other.id, name: "Someone Else's Job", status: "CONTRACTED" },
  });
  ctx.otherJobId = otherJob.id;
});

afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { job: { companyId: ctx.companyId } } });
  await prisma.job.deleteMany({ where: { companyId: ctx.companyId } });
  await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
  await prisma.company.delete({ where: { id: ctx.companyId } });
  await prisma.$disconnect();
});

describe("the portal never shows work this GC has not awarded", () => {
  it("leaves an ESTIMATE job off the list entirely", async () => {
    const contact = await loadPortalContact(TOKEN);
    expect(contact).not.toBeNull();
    const names = contact!.jobs.map((job) => job.name);
    expect(names).toContain("Awarded Job");
    expect(
      names,
      "a job still being priced for this GC reached their portal, with its running total beside it",
    ).not.toContain("Bid In Progress");
  });

  it("refuses the estimate by its own id too, not just in the list", async () => {
    /* The list and the per-job read are two separate clauses, and closing
       only the list would remove the link while leaving the page. That is
       not hypothetical: estimates WERE listed until this change, so a GC
       who opened their portal last week has the URL in their history. */
    expect(
      await loadPortalJob(ctx.contactId, ctx.estimateJobId),
      "an unawarded job was still openable by its own URL",
    ).toBeNull();
  });
});

describe("the portal never prints a cost-only budget line on the contract", () => {
  it("returns the priced line and not the contingency line", async () => {
    const job = await loadPortalJob(ctx.contactId, ctx.jobId);
    expect(job).not.toBeNull();
    const descriptions = job!.lineItems.map((item) => item.description);
    expect(descriptions).toContain("Metal stud framing");
    expect(
      descriptions,
      "a cost-only budget line reached the GC's contract — it publishes how the bid is " +
        'structured, and "—" in a price column reads as free',
    ).not.toContain("Contingency — GC is slow to answer RFIs");
  });

  it("removes rows without moving money", async () => {
    // The whole safety of the filter rests on this: ContractSummary sums
    // `unitPrice != null ? quantity * unitPrice : 0`, so the excluded lines
    // were already contributing zero. Computed here the same way, over what
    // the loader actually returns.
    const job = await loadPortalJob(ctx.contactId, ctx.jobId);
    const total = job!.lineItems.reduce(
      (sum, item) => sum + (item.unitPrice != null ? Number(item.quantity) * Number(item.unitPrice) : 0),
      0,
    );
    expect(total).toBe(4250);
  });
});

describe("the two contract totals are built from one population", () => {
  it("excludes cost-only lines from the index list as well as the contract", async () => {
    /* They agreed before this change only because `Number(null)` is 0 — the
       index had no null check and ContractSummary does. Excluding the rows
       in both selects means neither total leans on that coercion, and this
       asserts the index sees the same lines the job page does. */
    const contact = await loadPortalContact(TOKEN);
    const job = contact!.jobs.find((entry) => entry.name === "Awarded Job")!;
    expect(job.lineItems).toHaveLength(1);
    const total = job.lineItems.reduce(
      (sum, item) => sum + (item.unitPrice != null ? Number(item.quantity) * Number(item.unitPrice) : 0),
      0,
    );
    expect(total).toBe(4250);
  });
});

describe("a token reaches only its own contact's work", () => {
  it("returns null for another contact's job", async () => {
    expect(await loadPortalJob(ctx.contactId, ctx.otherJobId)).toBeNull();
  });

  it("returns null once the link is revoked, the same as an unknown token", async () => {
    await prisma.contact.update({
      where: { id: ctx.contactId },
      data: { portalRevokedAt: new Date() },
    });
    expect(await loadPortalContact(TOKEN)).toBeNull();
    expect(await loadPortalContact("no-such-token-at-all")).toBeNull();
    await prisma.contact.update({ where: { id: ctx.contactId }, data: { portalRevokedAt: null } });
  });
});

describe("nothing comes back that the page does not render", () => {
  it("fetches one field of Company, not the row that carries a credential", async () => {
    const job = await loadPortalJob(ctx.contactId, ctx.jobId);
    // `company: true` used to pull `intakeEmailToken` — "the unguessable
    // half of this company's inbound intake address… The token IS the
    // routing" — into an unauthenticated page's props. This is the
    // assertion that notices it coming back.
    expect(Object.keys(job!.company)).toEqual(["name"]);
    expect(Object.keys(job!.contact)).toEqual(["name"]);
  });

  it("fetches only the amount of each payment, and only the number of an origin change order", async () => {
    const job = await loadPortalJob(ctx.contactId, ctx.jobId);
    for (const invoice of job!.invoices) {
      for (const payment of invoice.payments) {
        expect(Object.keys(payment)).toEqual(["amount"]);
      }
    }
    for (const item of job!.lineItems) {
      if (item.originChangeOrder) expect(Object.keys(item.originChangeOrder)).toEqual(["number"]);
    }
  });

  it("names every field the index returns for a job, so a widening shows up here", async () => {
    const contact = await loadPortalContact(TOKEN);
    const job = contact!.jobs.find((entry) => entry.name === "Awarded Job")!;
    expect(Object.keys(job).sort()).toEqual(["id", "lineItems", "name", "status"]);
    expect(Object.keys(job.lineItems[0]).sort()).toEqual(["quantity", "unitPrice"]);
  });
});
