import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Editing a logged bid's dates, against a real Postgres.
 *
 * The claim: an addendum moves the due date, the user edits it once, and every
 * flag that depends on it — the Due-soon list, the MISSED / overdue mark, the
 * gone-cold standing — is correct on the next read WITHOUT a second write,
 * because they are derived from `dueDate` and never stored. The unit tests
 * cover the arithmetic with hand-written rows; this covers the part nothing
 * else executes: the real action, the real column round-trip (a UTC-midnight
 * Date and an Int minute), the real readers.
 */

let companyId = "";
let otherCompanyId = "";
let contactId = "";

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => ({ company: { id: companyId } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/agents/onEvent", () => ({ runAgentAfterResponse: () => {} }));

const { createBidInvitation, updateBidInvitationDetails } = await import("@/lib/actions/estimating");
const { loadBidPipeline } = await import("@/lib/bid-pipeline-query");
const { bidsDueSoon } = await import("@/lib/bids-due-soon");
const { bidStanding } = await import("@/lib/bid-standing");

const TODAY = "2026-10-25";
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const dueSoonRows = async () =>
  bidsDueSoon(
    await prisma.bidInvitation.findMany({
      where: { companyId, status: "INVITED", dueDate: { gte: utc(TODAY) } },
      select: {
        id: true,
        projectName: true,
        status: true,
        dueDate: true,
        dueMinute: true,
        walkDate: true,
        walkMinute: true,
        rfiCutoffDate: true,
        contact: { select: { name: true } },
      },
    }),
    TODAY,
  );

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Bid Dates Co" } })).id;
  otherCompanyId = (await prisma.company.create({ data: { name: "Someone Else Co" } })).id;
  contactId = (await prisma.contact.create({ data: { companyId, name: "Acme GC" } })).id;
});

afterAll(async () => {
  await prisma.bidInvitation.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.bidProject.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
});

describe("bid dates, end to end", () => {
  it("create stores the due time, job walk and RFI cutoff", async () => {
    const result = await createBidInvitation(
      contactId,
      form({
        projectName: "Oak Ave Lofts",
        dueDate: "2026-10-29",
        dueTime: "14:00",
        walkDate: "2026-10-27",
        walkTime: "09:30",
        rfiCutoffDate: "2026-10-26",
      }),
    );
    expect(result).toEqual({ ok: true });
    const row = await prisma.bidInvitation.findFirstOrThrow({ where: { companyId, projectName: "Oak Ave Lofts" } });
    expect(row.dueMinute).toBe(840);
    expect(row.walkMinute).toBe(570);
    expect(row.dueDate?.toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(row.walkDate?.toISOString()).toBe("2026-10-27T00:00:00.000Z");
    expect(row.rfiCutoffDate?.toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  it("an addendum moves the due date: Due soon, overdue and standing all recompute from the one edit", async () => {
    const created = await prisma.bidInvitation.create({
      data: { companyId, contactId, projectName: "Elm St Clinic", dueDate: utc("2026-10-20"), status: "INVITED" },
    });
    // Before the edit the bid is past its date: absent from Due soon, MISSED, overdue.
    expect((await dueSoonRows()).map((r) => r.projectName)).not.toContain("Elm St Clinic");
    let pipeline = await loadBidPipeline(companyId, TODAY);
    expect(pipeline.live.find((b) => b.id === created.id)?.overdue).toBe(true);
    expect(bidStanding({ id: created.id, projectName: "x", contactName: "x", status: "INVITED", dueDate: "2026-10-20" }, TODAY).standing).toBe("MISSED");

    // Addendum 1 moves it out a week and adds a time.
    const edited = await updateBidInvitationDetails(
      created.id,
      form({ projectName: "Elm St Clinic", dueDate: "2026-10-28", dueTime: "15:00" }),
    );
    expect(edited).toEqual({ ok: true });

    const after = await dueSoonRows();
    const row = after.find((r) => r.projectName === "Elm St Clinic");
    expect(row).toMatchObject({ daysLeft: 3, dueMinute: 900, dueIso: "2026-10-28" });
    pipeline = await loadBidPipeline(companyId, TODAY);
    const live = pipeline.live.find((b) => b.id === created.id)!;
    expect(live.overdue).toBe(false);
    expect(live.dueDate).toBe("2026-10-28");
    expect(bidStanding({ ...live, contactName: "x", status: "INVITED" }, TODAY).standing).toBe("DUE_SOON");
  });

  it("a SUBMITTED bid's gone-cold flag follows the edited date", async () => {
    const created = await prisma.bidInvitation.create({
      data: { companyId, contactId, projectName: "Pine Rd School", dueDate: utc("2026-08-01"), status: "SUBMITTED" },
    });
    const standing = async () => {
      const live = (await loadBidPipeline(companyId, TODAY)).live.find((b) => b.id === created.id)!;
      return bidStanding({ ...live, status: "SUBMITTED" }, TODAY).standing;
    };
    expect(await standing()).toBe("COLD");
    expect(
      await updateBidInvitationDetails(created.id, form({ projectName: "Pine Rd School", dueDate: "2026-10-10" })),
    ).toEqual({ ok: true });
    expect(await standing()).toBe("FINE");
  });

  it("editing replaces every field: clearing the walk and time clears the columns, name/trade/amount/notes save", async () => {
    const created = await prisma.bidInvitation.create({
      data: {
        companyId,
        contactId,
        projectName: "Cedar Court",
        dueDate: utc("2026-11-02"),
        dueMinute: 600,
        walkDate: utc("2026-10-28"),
        walkMinute: 540,
        rfiCutoffDate: utc("2026-10-30"),
      },
    });
    const result = await updateBidInvitationDetails(
      created.id,
      form({
        projectName: "  Cedar Court Phase 2  ",
        tradeScope: "EIFS",
        bidAmount: "125000.50",
        notes: "Addendum 2",
        dueDate: "2026-11-09",
      }),
    );
    expect(result).toEqual({ ok: true });
    const row = await prisma.bidInvitation.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ projectName: "Cedar Court Phase 2", tradeScope: "EIFS", notes: "Addendum 2" });
    expect(row.bidAmount?.toString()).toBe("125000.5");
    expect(row.dueDate?.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(row.dueMinute).toBeNull();
    expect(row.walkDate).toBeNull();
    expect(row.walkMinute).toBeNull();
    expect(row.rfiCutoffDate).toBeNull();
    // The GC and the status are not this action's to change.
    expect(row.contactId).toBe(contactId);
    expect(row.status).toBe("INVITED");
  });

  it("refuses, as a sentence, a time with no day, a blank name, and another company's bid", async () => {
    const created = await prisma.bidInvitation.create({ data: { companyId, contactId, projectName: "Fir Way" } });
    expect(await updateBidInvitationDetails(created.id, form({ projectName: "Fir Way", dueTime: "14:00" }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/due date/),
    });
    expect(await updateBidInvitationDetails(created.id, form({ projectName: "   " }))).toMatchObject({
      ok: false,
      error: "Project name is required",
    });
    const otherContact = await prisma.contact.create({ data: { companyId: otherCompanyId, name: "Other GC" } });
    const foreign = await prisma.bidInvitation.create({
      data: { companyId: otherCompanyId, contactId: otherContact.id, projectName: "Not Yours" },
    });
    expect(await updateBidInvitationDetails(foreign.id, form({ projectName: "Hijacked" }))).toEqual({
      ok: false,
      error: "Bid invitation not found",
    });
    expect((await prisma.bidInvitation.findUniqueOrThrow({ where: { id: foreign.id } })).projectName).toBe("Not Yours");
    // Nothing was written by the refusals.
    expect((await prisma.bidInvitation.findUniqueOrThrow({ where: { id: created.id } })).projectName).toBe("Fir Way");
  });
});
