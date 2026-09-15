import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * log_bid_invitation against a fake Prisma and a faked core.
 *
 * What is pinned is what a person would be hurt by if it drifted: that the
 * contact on the card was resolved by the app from the name given and a
 * name matching nobody is a refusal pointing at /contacts, never a guess;
 * that the trade tag comes from the person's own word and a word naming
 * none or several of the five is a chip row; that the due date is parsed
 * from their words against THEIR today with the same three outcomes the
 * schedule command has; that every field the row will carry is on the
 * card, including the amount it will not; and on execute the exact
 * arguments the core receives, with the option that turns a twin into a
 * link.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    contact: { findMany: vi.fn(), findFirst: vi.fn() },
    bidInvitation: { findFirst: vi.fn() },
  },
  createBidInvitationRecord: vi.fn(),
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@/lib/estimating/bid-invitation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/estimating/bid-invitation")>()),
  createBidInvitationRecord: fake.createBidInvitationRecord,
}));

const { logBidInvitationCommand, readTrade, NO_TRADE_TAG } = await import("./bids");
const { schemaInput } = await import("../commands");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-11" };
const turner = { id: "c-1", name: "Turner Construction", email: "pm@turner.example", _count: { jobs: 3 } };
const turnerBros = { id: "c-2", name: "Turner Brothers", email: null, _count: { jobs: 0 } };

beforeEach(() => {
  fake.prisma.contact.findMany.mockReset();
  fake.prisma.contact.findFirst.mockReset();
  fake.prisma.bidInvitation.findFirst.mockReset();
  fake.prisma.bidInvitation.findFirst.mockResolvedValue(null);
  fake.createBidInvitationRecord.mockReset();
});

const line = (result: { kind: string; preview?: { label: string; value: string }[] }, label: string) =>
  result.preview?.find((l) => l.label === label)?.value;

describe("log_bid_invitation", () => {
  it("is a T1 draft, DIRECT over the lifted core, on MANAGE_ESTIMATING, standing in for createBidInvitation", () => {
    expect(logBidInvitationCommand.tier).toBe("T1_DRAFT");
    expect(logBidInvitationCommand.mode).toBe("DIRECT");
    expect(logBidInvitationCommand.core).toBe("createBidInvitationRecord");
    expect(logBidInvitationCommand.action).toBe("createBidInvitation");
    expect(logBidInvitationCommand.capability).toBe("MANAGE_ESTIMATING");
    expect(logBidInvitationCommand.button).toBe("Log invitation");
    expect(logBidInvitationCommand.continuationKeys).toEqual(["contactId"]);
    expect(Object.keys(logBidInvitationCommand.input_schema.properties)).toEqual([
      "contactName",
      "projectName",
      "trade",
      "dueDate",
      "notes",
    ]);
    // No amount anywhere in the schema: the record's one figure is not
    // on the form and not on the card.
    for (const key of Object.keys(logBidInvitationCommand.input_schema.properties)) {
      expect(key.toLowerCase(), key).not.toMatch(/amount|price|email|address/);
    }
  });

  it("keeps the person's words as words, and drops an id or a tag the model sends", async () => {
    const input = schemaInput(
      logBidInvitationCommand,
      { contactName: "Turner", projectName: "Riverside", trade: "drywall", dueDate: "October 3", contactId: "forged", tradeScope: "EIFS", companyId: "x" },
      "model",
    );
    expect(input).toEqual({ contactName: "Turner", projectName: "Riverside", trade: "drywall", dueDate: "October 3" });
  });

  it("asks for the contact and the project before it reads anything", async () => {
    const result = await logBidInvitationCommand.resolve(ctx, { trade: "drywall" });
    expect(result).toEqual({
      kind: "need",
      missing: "which GC or contact sent the invitation, and the project it is for, as the GC named it",
    });
    expect(fake.prisma.contact.findMany).not.toHaveBeenCalled();
    expect(fake.prisma.contact.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a name that matches no contact, pointing at /contacts — never a new contact, never a guess", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([]);
    const result = await logBidInvitationCommand.resolve(ctx, { contactName: "Skanska", projectName: "Main St" });
    expect(result).toEqual({
      kind: "refuse",
      reason: 'No contact matches "Skanska". Add them on the contacts page first, then ask again.',
      href: "/contacts",
    });
    expect(fake.createBidInvitationRecord).not.toHaveBeenCalled();
  });

  it("offers chips when the name matches several contacts", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner, turnerBros]);
    const result = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner", projectName: "Riverside" });
    expect(result.kind).toBe("clarify");
    if (result.kind !== "clarify") throw new Error("unreachable");
    expect(result.field).toBe("contactId");
    expect(result.question).toBe("Which Turner?");
    expect(result.options.map((o) => o.value)).toEqual(["c-1", "c-2"]);
  });

  it("re-asserts a chip's contact in-company, and refuses one that is not", async () => {
    fake.prisma.contact.findFirst.mockResolvedValue(null);
    const result = await logBidInvitationCommand.resolve(ctx, { contactId: "c-elsewhere", projectName: "Riverside" });
    expect(result).toEqual({ kind: "refuse", reason: "That contact isn't on your account." });
    expect(fake.prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { id: "c-elsewhere", companyId: "co-1" },
      select: { id: true, name: true },
    });
    expect(fake.prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("puts every field the row will carry on the card, with the person's words decided by code", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner]);
    const result = await logBidInvitationCommand.resolve(ctx, {
      contactName: "Turner",
      projectName: "Riverside",
      trade: "drywall",
      dueDate: "October 3",
      notes: "walk-through Tuesday",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.preview).toEqual([
      { label: "From", value: "Turner Construction" },
      { label: "Project", value: "Riverside" },
      { label: "Trade", value: "Metal framing / drywall" },
      { label: "Due", value: "Oct 3, 2026 (Saturday)" },
      { label: "Notes", value: "walk-through Tuesday" },
      { label: "Status", value: "Invited" },
      { label: "Bid amount", value: "none yet — entered when you mark the bid submitted" },
    ]);
    expect(result.resolved).toEqual({
      contactId: "c-1",
      contactName: "Turner Construction",
      projectName: "Riverside",
      tradeScope: "METAL_FRAMING_DRYWALL",
      dueDate: "2026-10-03",
      notes: "walk-through Tuesday",
    });
    expect(result.warnings).toEqual([]);
    expect(result.existing).toBeUndefined();
  });

  it("allows no trade and no due date, as the form does, and warns that neither can be added afterwards", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner]);
    const result = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner", projectName: "Riverside" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(line(result, "Trade")).toBe("no trade tag");
    expect(line(result, "Due")).toBe("not set");
    expect(line(result, "Notes")).toBe("none");
    expect(result.resolved).toMatchObject({ tradeScope: null, dueDate: null, notes: null });
    expect(result.warnings).toEqual([
      "No trade given, so this bid won't show under a trade filter on the bids page. The tag can't be added afterwards.",
      "No due date. It can't be added afterwards, so say it now if the GC gave one.",
    ]);
  });

  it("carries the resolver's duplicate-contact warning onto the card", async () => {
    const twin = { ...turner, id: "c-1b", _count: { jobs: 0 } };
    fake.prisma.contact.findMany.mockResolvedValue([turner, twin]);
    const result = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner Construction", projectName: "Riverside", trade: "drywall", dueDate: "October 3" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved.contactId).toBe("c-1");
    expect(result.warnings).toEqual(["Reusing the Turner Construction record with 3 jobs; 1 identical duplicate exists on /contacts."]);
  });

  it("offers the five tags and 'no tag' as chips when the trade word names none of them", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner]);
    const result = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner", projectName: "Riverside", trade: "insulation" });
    expect(result).toEqual({
      kind: "clarify",
      field: "trade",
      question: '"insulation" isn\'t one of the five trade tags — which should this bid carry?',
      options: [
        { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
        { value: "LATH_PLASTER", label: "Lath & plaster" },
        { value: "EIFS", label: "EIFS" },
        { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
        { value: "FIREPROOFING", label: "Fireproofing" },
        { value: "NONE", label: "No trade tag" },
      ],
    });
  });

  it("offers only the trades named as chips when the word names more than one", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner]);
    const result = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner", projectName: "Riverside", trade: "drywall and ceilings" });
    expect(result).toEqual({
      kind: "clarify",
      field: "trade",
      question: '"drywall and ceilings" names more than one trade — which tag should this bid carry?',
      options: [
        { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
        { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
      ],
    });
  });

  it("takes a trade chip's tag, and the 'no tag' chip, on the re-run without warning", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner]);
    const tagged = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner", projectName: "Riverside", trade: "EIFS", dueDate: "October 3" });
    expect(tagged.kind).toBe("ready");
    if (tagged.kind !== "ready") throw new Error("unreachable");
    expect(tagged.resolved.tradeScope).toBe("EIFS");
    const untagged = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner", projectName: "Riverside", trade: NO_TRADE_TAG, dueDate: "October 3" });
    expect(untagged.kind).toBe("ready");
    if (untagged.kind !== "ready") throw new Error("unreachable");
    expect(untagged.resolved.tradeScope).toBeNull();
    expect(line(untagged, "Trade")).toBe("no trade tag");
    expect(untagged.warnings).toEqual([]);
  });

  it("asks again, quoting the words, when the due date is not one the parser knows — never a guess", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner]);
    const result = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner", projectName: "Riverside", trade: "drywall", dueDate: "sometime next month" });
    expect(result).toEqual({
      kind: "need",
      missing: 'the bid due date as a calendar day — "sometime next month" isn\'t one this app can read. Say it like "October 3", "10/3/2026" or "next Friday"',
    });
    expect(fake.createBidInvitationRecord).not.toHaveBeenCalled();
  });

  it("asks for the date itself when the phrase is relative — a new record has nothing to count from", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner]);
    const result = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner", projectName: "Riverside", trade: "drywall", dueDate: "a week later" });
    expect(result).toEqual({
      kind: "need",
      missing: 'the due date itself — "a week later" is counted from a date this invitation doesn\'t have yet. Say it like "October 3" or "next Friday"',
    });
  });

  it("offers both years as chips for a month-day that has already passed this year", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner]);
    const result = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner", projectName: "Riverside", trade: "drywall", dueDate: "September 1" });
    expect(result).toEqual({
      kind: "clarify",
      field: "dueDate",
      question: '"September 1" has already passed this year — which due date?',
      options: [
        { value: "2026-09-01", label: "Sep 1, 2026 (Tuesday)", detail: "10 days ago" },
        { value: "2027-09-01", label: "Sep 1, 2027 (Wednesday)", detail: "in 355 days" },
      ],
    });
  });

  it("takes a chip's ISO day on the re-run and warns when it has already passed", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner]);
    const result = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner", projectName: "Riverside", trade: "drywall", dueDate: "2026-09-01" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(line(result, "Due")).toBe("Sep 1, 2026 (Tuesday)");
    expect(result.warnings).toEqual(["That due date, Sep 1, 2026 (Tuesday), has already passed."]);
  });

  it("reads 'next Friday' against the person's own today, with the weekday on the card", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner]);
    // 2026-09-11 is a Friday; the next one strictly after is the 18th.
    const result = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner", projectName: "Riverside", trade: "drywall", dueDate: "next Friday" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(line(result, "Due")).toBe("Sep 18, 2026 (Friday)");
    expect(result.resolved.dueDate).toBe("2026-09-18");
  });

  it("links an open invitation from the same contact for the same project instead of offering a button", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner]);
    fake.prisma.bidInvitation.findFirst.mockResolvedValue({ id: "bid-open", projectName: "Riverside Plaza" });
    const result = await logBidInvitationCommand.resolve(ctx, { contactName: "Turner", projectName: "riverside plaza", trade: "drywall", dueDate: "October 3" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(fake.prisma.bidInvitation.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: "co-1",
        contactId: "c-1",
        projectName: { equals: "riverside plaza", mode: "insensitive" },
        status: { in: ["INVITED", "SUBMITTED"] },
      },
      select: { id: true, projectName: true },
    });
    expect(result.existing).toEqual({
      label: "Turner Construction already has an open bid invitation for Riverside Plaza",
      href: "/bids",
    });
  });
});

describe("log_bid_invitation execute", () => {
  const payload = {
    contactId: "c-1",
    contactName: "Turner Construction",
    projectName: "Riverside",
    tradeScope: "METAL_FRAMING_DRYWALL",
    dueDate: "2026-10-03",
    notes: "walk-through Tuesday",
  };

  it("calls the core with the card's fields as UTC midnight and nulls, asking it to link a twin", async () => {
    fake.createBidInvitationRecord.mockResolvedValue({
      ok: true,
      value: { bidInvitationId: "bid-1", contactName: "Turner Construction", alreadyExisted: false },
    });
    const result = await logBidInvitationCommand.execute(ctx, payload);
    expect(fake.createBidInvitationRecord).toHaveBeenCalledWith(
      "co-1",
      {
        contactId: "c-1",
        projectName: "Riverside",
        dueDate: new Date("2026-10-03T00:00:00.000Z"),
        notes: "walk-through Tuesday",
        tradeScope: "METAL_FRAMING_DRYWALL",
      },
      { reuseOpenDuplicate: true },
    );
    expect(result).toEqual({
      ok: true,
      message: "Logged Turner Construction's invitation to bid on Riverside, due Oct 3, 2026 (Saturday).",
      created: { label: "Riverside · Turner Construction", href: "/bids", targetType: "BidInvitation", targetId: "bid-1" },
      revalidate: ["/contacts/c-1"],
    });
  });

  it("says nothing new was logged when the core linked an open twin", async () => {
    fake.createBidInvitationRecord.mockResolvedValue({
      ok: true,
      value: { bidInvitationId: "bid-open", contactName: "Turner Construction", alreadyExisted: true },
    });
    const result = await logBidInvitationCommand.execute(ctx, { ...payload, dueDate: null, tradeScope: null, notes: null });
    expect(fake.createBidInvitationRecord.mock.calls[0][1]).toEqual({
      contactId: "c-1",
      projectName: "Riverside",
      dueDate: null,
      notes: null,
      tradeScope: null,
    });
    expect(result).toMatchObject({
      ok: true,
      message: "Turner Construction already has an open bid invitation for Riverside; nothing new was logged.",
      created: { targetId: "bid-open" },
    });
  });

  it("passes the core's refusal through as the card's sentence", async () => {
    fake.createBidInvitationRecord.mockResolvedValue({ ok: false, error: "Contact not found" });
    const result = await logBidInvitationCommand.execute(ctx, payload);
    expect(result).toEqual({ ok: false, error: "Contact not found" });
  });

  it("refuses a card this code did not write — a bad tag or a bad day — without calling the core", async () => {
    for (const bad of [{ tradeScope: "PAINTING" }, { dueDate: "October 3" }, { contactId: 42 }, { tradeScope: undefined }]) {
      const result = await logBidInvitationCommand.execute(ctx, { ...payload, ...bad });
      expect(result, JSON.stringify(bad)).toEqual({ ok: false, error: "That card can't be executed. Ask again." });
    }
    expect(fake.createBidInvitationRecord).not.toHaveBeenCalled();
  });
});

describe("readTrade", () => {
  it.each([
    ["drywall", "METAL_FRAMING_DRYWALL"],
    ["metal framing", "METAL_FRAMING_DRYWALL"],
    ["studs", "METAL_FRAMING_DRYWALL"],
    ["Metal framing / drywall", "METAL_FRAMING_DRYWALL"],
    ["plaster", "LATH_PLASTER"],
    ["stucco", "LATH_PLASTER"],
    ["Lath & plaster", "LATH_PLASTER"],
    ["EIFS", "EIFS"],
    ["ceilings", "ACOUSTICAL_CEILINGS"],
    ["ACT", "ACOUSTICAL_CEILINGS"],
    ["acoustical ceilings", "ACOUSTICAL_CEILINGS"],
    ["fireproofing", "FIREPROOFING"],
    ["spray fireproofing", "FIREPROOFING"],
    ["ACOUSTICAL_CEILINGS", "ACOUSTICAL_CEILINGS"],
  ])("reads %s as %s", (words, scope) => {
    expect(readTrade(words)).toEqual({ kind: "one", scope });
  });

  it.each(["none", "NONE", "no tag", "no trade tag", "untagged"])("reads %s as no tag", (words) => {
    expect(readTrade(words)).toEqual({ kind: "one", scope: null });
  });

  it("names both trades when a phrase carries two, and none when it carries none", () => {
    expect(readTrade("framing and ceilings")).toEqual({ kind: "several", scopes: ["METAL_FRAMING_DRYWALL", "ACOUSTICAL_CEILINGS"] });
    expect(readTrade("insulation")).toEqual({ kind: "unknown" });
    expect(readTrade("painting")).toEqual({ kind: "unknown" });
    // Word boundaries: "contract" is not ACT, "boarding" is not board.
    expect(readTrade("contract")).toEqual({ kind: "unknown" });
    expect(readTrade("boarding")).toEqual({ kind: "unknown" });
  });
});
