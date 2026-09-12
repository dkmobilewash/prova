import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The lifted core against a fake Prisma. What only a database can prove —
 * that the write lands with the form's own fields and that an open twin
 * is linked rather than doubled — is in lib/actions/ask.dbtest.ts. What is
 * pinned here is the order of the refusals, that each arrives as a
 * sentence before any write, that the contact is asserted in-company in
 * the read itself, and that the duplicate check runs only when asked for
 * — so the form keeps its behaviour.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    contact: { findFirst: vi.fn() },
    bidInvitation: { findFirst: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { CONTACT_NOT_FOUND, PROJECT_NAME_REQUIRED, createBidInvitationRecord } = await import("./bid-invitation");

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const turner = { id: "c-1", name: "Turner Construction" };

beforeEach(() => {
  fake.prisma.contact.findFirst.mockReset();
  fake.prisma.bidInvitation.findFirst.mockReset();
  fake.prisma.bidInvitation.create.mockReset();
});

describe("createBidInvitationRecord", () => {
  it("refuses a blank project name in the action's own words, before any read", async () => {
    const result = await createBidInvitationRecord("co-1", { contactId: "c-1", projectName: "   " });
    expect(result).toEqual({ ok: false, error: PROJECT_NAME_REQUIRED });
    expect(PROJECT_NAME_REQUIRED).toBe("Project name is required");
    expect(fake.prisma.contact.findFirst).not.toHaveBeenCalled();
    expect(fake.prisma.bidInvitation.create).not.toHaveBeenCalled();
  });

  it("asserts the contact in-company in the read itself, and refuses in the action's own words", async () => {
    fake.prisma.contact.findFirst.mockResolvedValue(null);
    const result = await createBidInvitationRecord("co-1", { contactId: "c-9", projectName: "Riverside" });
    expect(result).toEqual({ ok: false, error: CONTACT_NOT_FOUND });
    expect(CONTACT_NOT_FOUND).toBe("Contact not found");
    expect(fake.prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { id: "c-9", companyId: "co-1" },
      select: { id: true, name: true },
    });
    expect(fake.prisma.bidInvitation.create).not.toHaveBeenCalled();
  });

  it("writes exactly the form's fields, trimmed, with nulls for what was not given", async () => {
    fake.prisma.contact.findFirst.mockResolvedValue(turner);
    fake.prisma.bidInvitation.create.mockResolvedValue({ id: "bid-1" });
    const result = await createBidInvitationRecord("co-1", {
      contactId: "c-1",
      projectName: "  Riverside  ",
      dueDate: utc("2026-10-03"),
      notes: "  walk-through Tuesday ",
      tradeScope: "METAL_FRAMING_DRYWALL",
    });
    expect(fake.prisma.bidInvitation.create).toHaveBeenCalledWith({
      data: {
        companyId: "co-1",
        contactId: "c-1",
        projectName: "Riverside",
        dueDate: utc("2026-10-03"),
        notes: "walk-through Tuesday",
        tradeScope: "METAL_FRAMING_DRYWALL",
        bidAmount: null,
      },
      select: { id: true },
    });
    expect(result).toEqual({
      ok: true,
      value: { bidInvitationId: "bid-1", contactName: "Turner Construction", alreadyExisted: false },
    });
    // Not asked for, so not looked for: the form's twin-tolerant behaviour.
    expect(fake.prisma.bidInvitation.findFirst).not.toHaveBeenCalled();
  });

  it("passes an empty note, an unset date and an untagged trade through as nulls", async () => {
    fake.prisma.contact.findFirst.mockResolvedValue(turner);
    fake.prisma.bidInvitation.create.mockResolvedValue({ id: "bid-2" });
    await createBidInvitationRecord("co-1", { contactId: "c-1", projectName: "Riverside", notes: "  ", dueDate: null });
    expect(fake.prisma.bidInvitation.create.mock.calls[0][0].data).toMatchObject({
      dueDate: null,
      notes: null,
      tradeScope: null,
      bidAmount: null,
    });
  });

  it("with reuseOpenDuplicate, links an open invitation for the same contact and project instead of writing", async () => {
    fake.prisma.contact.findFirst.mockResolvedValue(turner);
    fake.prisma.bidInvitation.findFirst.mockResolvedValue({ id: "bid-open" });
    const result = await createBidInvitationRecord(
      "co-1",
      { contactId: "c-1", projectName: "riverside" },
      { reuseOpenDuplicate: true },
    );
    expect(fake.prisma.bidInvitation.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: "co-1",
        contactId: "c-1",
        projectName: { equals: "riverside", mode: "insensitive" },
        status: { in: ["INVITED", "SUBMITTED"] },
      },
      select: { id: true },
    });
    expect(result).toEqual({
      ok: true,
      value: { bidInvitationId: "bid-open", contactName: "Turner Construction", alreadyExisted: true },
    });
    expect(fake.prisma.bidInvitation.create).not.toHaveBeenCalled();
  });

  it("with reuseOpenDuplicate and no open twin, writes as usual", async () => {
    fake.prisma.contact.findFirst.mockResolvedValue(turner);
    fake.prisma.bidInvitation.findFirst.mockResolvedValue(null);
    fake.prisma.bidInvitation.create.mockResolvedValue({ id: "bid-3" });
    const result = await createBidInvitationRecord(
      "co-1",
      { contactId: "c-1", projectName: "Riverside" },
      { reuseOpenDuplicate: true },
    );
    expect(result).toEqual({
      ok: true,
      value: { bidInvitationId: "bid-3", contactName: "Turner Construction", alreadyExisted: false },
    });
    expect(fake.prisma.bidInvitation.create).toHaveBeenCalledTimes(1);
  });
});
