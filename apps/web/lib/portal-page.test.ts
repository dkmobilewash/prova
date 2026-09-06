import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The client portal, driven as the page — not as a static grep of it.
 *
 * These call the real server components with the database faked, so what is
 * asserted is the query the page ACTUALLY issues and the branch it actually
 * takes. Both defects fixed here are invisible to a typecheck and to every
 * existing test: a missing `where` clause on an include, and a missing read
 * of a status column.
 *
 * The portal has no login. The token in the URL is the entire access
 * control, so the tests that matter most are the ones proving a token
 * CANNOT reach past what it is for.
 */

const notFoundError = new Error("NEXT_NOT_FOUND");

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw notFoundError;
  },
}));

type Row = Record<string, unknown>;

const db = { contacts: [] as Row[], jobs: [] as Row[] };

/** Every argument the page hands to prisma, kept so the include can be
 * asserted rather than assumed. */
const jobFindUniqueArgs: Row[] = [];

const prisma = {
  contact: {
    findUnique: async ({ where, include }: { where: { portalToken: string }; include?: Row }) => {
      const contact = db.contacts.find((c) => c.portalToken === where.portalToken);
      if (!contact) return null;
      if (!include) return contact;
      return {
        ...contact,
        company: { name: "Ours Drywall" },
        jobs: db.jobs.filter((j) => j.contactId === contact.id),
      };
    },
  },
  job: {
    findUnique: async (args: { where: { id: string }; include: Row }) => {
      jobFindUniqueArgs.push(args);
      const job = db.jobs.find((j) => j.id === args.where.id);
      if (!job) return null;
      return {
        ...job,
        company: { name: "Ours Drywall" },
        contact: { name: "Pat GC" },
        lineItems: [],
        changeOrders: [],
        signatureRequests: [],
        invoices: [],
      };
    },
  },
};

vi.mock("@prova/db", () => ({ prisma }));

const { default: PortalPage } = await import("../app/portal/[token]/page");
const { default: PortalJobPage } = await import("../app/portal/[token]/jobs/[jobId]/page");

beforeEach(() => {
  jobFindUniqueArgs.length = 0;
  db.contacts = [
    { id: "con_a", name: "Pat GC", status: "ACTIVE", portalToken: "tok_a" },
    { id: "con_b", name: "Other GC", status: "ACTIVE", portalToken: "tok_b" },
    { id: "con_gone", name: "Former GC", status: "INACTIVE", portalToken: "tok_gone" },
  ];
  db.jobs = [
    { id: "job_a", contactId: "con_a", contactId_: null, name: "Tower B", status: "ESTIMATE", scope: null, lineItems: [] },
    { id: "job_b", contactId: "con_b", name: "Someone else's job", status: "ESTIMATE", scope: null, lineItems: [] },
  ];
});

const params = (token: string) => Promise.resolve({ token });
const jobParams = (token: string, jobId: string) => Promise.resolve({ token, jobId });

describe("what a portal token can reach", () => {
  it("opens for a live contact", async () => {
    await expect(PortalPage({ params: params("tok_a") })).resolves.toBeTruthy();
  });

  it("is dead once the contact is marked INACTIVE", async () => {
    // The app's own way of saying "we are no longer working with these
    // people" did nothing at all to their link. It kept returning every job,
    // price and invoice balance.
    await expect(PortalPage({ params: params("tok_gone") })).rejects.toThrow(notFoundError);
  });

  it("is dead on the JOB page too, not only the index", async () => {
    // A GC bookmarks a job. A gate that only ran on the index would be no
    // gate at all.
    db.jobs[0].contactId = "con_gone";
    await expect(
      PortalJobPage({ params: jobParams("tok_gone", "job_a") }),
    ).rejects.toThrow(notFoundError);
  });

  it("cannot read another contact's job", async () => {
    // The token for contact A, aimed at contact B's job id.
    await expect(
      PortalJobPage({ params: jobParams("tok_a", "job_b") }),
    ).rejects.toThrow(notFoundError);
  });

  it("404s a token that never existed", async () => {
    await expect(PortalPage({ params: params("tok_invented") })).rejects.toThrow(notFoundError);
  });
});

describe("what the GC is shown about change orders", () => {
  it("asks the database for APPROVED ones only", async () => {
    await PortalJobPage({ params: jobParams("tok_a", "job_a") });

    expect(jobFindUniqueArgs).toHaveLength(1);
    const include = jobFindUniqueArgs[0].include as { changeOrders: { where?: { status?: string } } };

    // Without this filter the GC's own portal showed them our DRAFTS — the
    // ones never sent — and the ones VOIDED before we ever asked, plus the
    // numbering gaps that reveal both. It is the only surface where the
    // client sees the sub's unsent internal state.
    expect(
      include.changeOrders.where?.status,
      "the portal must filter change orders to APPROVED",
    ).toBe("APPROVED");
  });
});
