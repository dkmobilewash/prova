import { describe, expect, it, vi } from "vitest";

/**
 * pay_application_status, warranty_obligations and outbound_messages.
 *
 * Each carries one distinction that changes what somebody does:
 *
 *   - a DISPUTED pay application is not a slow one. Chasing it as though it
 *     were is how a fortnight is lost;
 *   - a job with no warranty period recorded is not a job out of warranty.
 *     Saying "you are clear" from an empty field is the one answer that
 *     tool must never give;
 *   - SENT is not DELIVERED, and the LATEST event is what counts — a
 *     message that bounced after being sent is bounced, and reading the
 *     first event calls it sent.
 */

const TODAY = "2026-09-17";

const INVOICES = [
  {
    number: 4,
    description: "Pay app 4",
    amount: 82_400,
    status: "SUBMITTED",
    issuedAt: new Date("2026-08-28T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
  },
  {
    // A dispute, not a delay. The row that changes what somebody does.
    number: 3,
    description: "Pay app 3",
    amount: 41_000,
    status: "DISPUTED",
    issuedAt: new Date("2026-07-30T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
  },
  {
    number: 2,
    description: "Pay app 2",
    amount: 55_000,
    status: "PAID",
    issuedAt: new Date("2026-06-30T00:00:00.000Z"),
    job: { name: "Northgate Apartments" },
  },
];

const JOBS = [
  {
    // In force until 2027-03-01, with one open callback.
    name: "Cedar Park Elementary",
    warrantyPeriod: { startsOn: new Date("2026-03-01T00:00:00.000Z"), months: 12 },
    warrantyServiceRequests: [
      { reportedOn: new Date("2026-09-01T00:00:00.000Z"), resolvedOn: null, description: "Ceiling tile sagging" },
      { reportedOn: new Date("2026-05-02T00:00:00.000Z"), resolvedOn: new Date("2026-05-10T00:00:00.000Z"), description: "Door sticking" },
    ],
  },
  {
    // Warranty ran out in January.
    name: "Harborview Clinic",
    warrantyPeriod: { startsOn: new Date("2025-01-15T00:00:00.000Z"), months: 12 },
    warrantyServiceRequests: [],
  },
  {
    // Callbacks reported and NO warranty period on file. Must read as
    // unrecorded — not as out of warranty.
    name: "Riverside Medical",
    warrantyPeriod: null,
    warrantyServiceRequests: [
      { reportedOn: new Date("2026-09-10T00:00:00.000Z"), resolvedOn: null, description: "Crack at head-of-wall" },
    ],
  },
  {
    // Nothing at all — filtered out entirely rather than reported as clear.
    name: "Lakeshore Retail",
    warrantyPeriod: null,
    warrantyServiceRequests: [],
  },
];

const MESSAGES = [
  {
    // Sent, then BOUNCED. Reading the first event calls this sent.
    toAddress: "pm@turner.example",
    toName: "Dana Pratt",
    subject: "Lien waiver — Riverside pay app 4",
    createdAt: new Date("2026-09-14T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
    events: [
      { type: "BOUNCED", occurredAt: new Date("2026-09-14T00:05:00.000Z"), detail: "550 5.1.1 mailbox unavailable" },
      { type: "SENT", occurredAt: new Date("2026-09-14T00:01:00.000Z"), detail: null },
    ],
  },
  {
    toAddress: "ap@halvorsen.example",
    toName: null,
    subject: "Invoice 2",
    createdAt: new Date("2026-09-12T00:00:00.000Z"),
    job: { name: "Northgate Apartments" },
    events: [
      { type: "DELIVERED", occurredAt: new Date("2026-09-12T00:02:00.000Z"), detail: null },
      { type: "SENT", occurredAt: new Date("2026-09-12T00:01:00.000Z"), detail: null },
    ],
  },
  {
    // Nothing back yet. Must NOT be reported as sent.
    toAddress: "office@brackett.example",
    toName: null,
    subject: "COI renewal",
    createdAt: new Date("2026-09-16T00:00:00.000Z"),
    job: null,
    events: [],
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    invoice: { findMany: async () => INVOICES },
    outboundMessage: { findMany: async () => MESSAGES },
    job: {
      findMany: async () => JOBS,
      findFirst: async ({ where }: { where: { name?: { contains?: string } } }) => {
        const wanted = (where.name?.contains ?? "").toLowerCase();
        return JOBS.some((job) => job.name.toLowerCase().includes(wanted)) ? { id: "job-1" } : null;
      },
    },
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => TODAY }));

async function ask(name: string, input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, name as any, input);
}

describe("pay_application_status", () => {
  it("counts a DISPUTED application apart from a slow one", async () => {
    // The distinction that changes what somebody does. Folded together,
    // "two outstanding" sends somebody to chase a conversation.
    expect((await ask("pay_application_status")).summary).toEqual({
      applications: 3,
      awaitingApproval: 1,
      awaitingApprovalTotal: 82_400,
      disputed: 1,
      disputedTotal: 41_000,
    });
  });

  it("says how long each has been sitting", async () => {
    const rows = (await ask("pay_application_status")).data as {
      application: string;
      daysSinceIssued: number | null;
    }[];
    expect(rows.find((row) => row.application.startsWith("#4"))!.daysSinceIssued).toBe(20);
  });

  it("filters to one job, and names a job that does not exist", async () => {
    const typo = await ask("pay_application_status", { jobName: "Rivrside" });
    expect(typo.unavailable).toContain("No job matches");

    const rows = (await ask("pay_application_status", { jobName: "Northgate" })).data as { job: string }[];
    expect(rows.every((row) => row.job === "Northgate Apartments")).toBe(true);
  });
});

describe("warranty_obligations", () => {
  it("derives the end date from the start and the months", async () => {
    const rows = (await ask("warranty_obligations")).data as {
      job: string;
      warrantyEndsOn: string | null;
      warranty: string;
    }[];
    const cedar = rows.find((row) => row.job === "Cedar Park Elementary")!;
    expect(cedar.warrantyEndsOn).toBe("2027-03-01");
    expect(cedar.warranty).toBe("in force");
  });

  it("marks one that has run out", async () => {
    const rows = (await ask("warranty_obligations")).data as { job: string; warranty: string }[];
    expect(rows.find((row) => row.job === "Harborview Clinic")!.warranty).toBe("expired");
  });

  it("says UNRECORDED, never 'out of warranty', when nothing is on file", async () => {
    // The finding. "You're clear" read off an empty field is the one answer
    // this tool must not give.
    const rows = (await ask("warranty_obligations")).data as { job: string; warranty: string }[];
    expect(rows.find((row) => row.job === "Riverside Medical")!.warranty).toBe("unrecorded");
  });

  it("counts open callbacks apart from resolved ones, and dates the oldest", async () => {
    const rows = (await ask("warranty_obligations")).data as {
      job: string;
      callbacks: number;
      openCallbacks: number;
      oldestOpenCallbackReportedOn: string | null;
    }[];
    expect(rows.find((row) => row.job === "Cedar Park Elementary")).toMatchObject({
      callbacks: 2,
      openCallbacks: 1,
      oldestOpenCallbackReportedOn: "2026-09-01",
    });
  });

  it("leaves out a job with nothing recorded rather than calling it clear", async () => {
    const rows = (await ask("warranty_obligations")).data as { job: string }[];
    expect(rows.some((row) => row.job === "Lakeshore Retail")).toBe(false);
  });
});

describe("outbound_messages", () => {
  it("reports the LATEST event, so a bounce after a send reads as bounced", async () => {
    // Reading the first event calls this sent, and somebody waits for a
    // reply to an email that never arrived.
    const rows = (await ask("outbound_messages")).data as {
      subject: string | null;
      latestEvent: string | null;
      failureReason: string | null;
    }[];
    const bounced = rows.find((row) => row.subject?.startsWith("Lien waiver"))!;
    expect(bounced.latestEvent).toBe("BOUNCED");
    expect(bounced.failureReason).toBe("550 5.1.1 mailbox unavailable");
  });

  it("says null, not SENT, when nothing has come back yet", async () => {
    // "Sent" would claim the provider confirmed something it has not.
    const rows = (await ask("outbound_messages")).data as { subject: string | null; latestEvent: string | null }[];
    expect(rows.find((row) => row.subject === "COI renewal")!.latestEvent).toBeNull();
  });

  it("counts delivered apart from what needs somebody", async () => {
    expect((await ask("outbound_messages")).summary).toEqual({
      messages: 3,
      delivered: 1,
      needingAttention: 1,
      noEventYet: 1,
    });
  });

  it("reports opens without ever concluding from their absence", async () => {
    // Image-blocking makes a missing OPEN meaningless. `opened` is reported
    // and no summary figure is derived from not having one.
    const result = await ask("outbound_messages");
    const rows = result.data as { opened: boolean }[];
    expect(rows.every((row) => row.opened === false)).toBe(true);
    expect(Object.keys(result.summary!)).not.toContain("unopened");
    expect(Object.keys(result.summary!)).not.toContain("opened");
  });
});
