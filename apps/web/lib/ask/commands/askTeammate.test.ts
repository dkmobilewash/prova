import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ask_teammate against a fake Prisma and a fake email config. HANDOFF, so
 * there is no execute to pin; what is pinned is that the card sends
 * nothing and carries nothing the model made up:
 *
 *   - the address is read off the User row, or the card is refused — no
 *     address-shaped key exists in the schema, and one the model supplies
 *     is dropped by schemaInput before resolve sees it;
 *   - the subject and body are composed in code from the job's name, the
 *     parsed day and the person's own words, so a model that tried to write
 *     the message has nowhere to put it;
 *   - a crew member (no login) is a refusal that says where their phone is,
 *     never a message the app cannot send; the asker's own account is a
 *     refusal; a name matching nobody is a refusal; several is a chip row;
 *   - the payload holds exactly the keys lib/ask/drafts.ts's composer
 *     loader reads back, so the tap opens a filled-in composer.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findMany: vi.fn(), findFirst: vi.fn() },
    user: { findMany: vi.fn(), findFirst: vi.fn() },
    crewMember: { findFirst: vi.fn() },
  },
  setupProblem: vi.fn<() => string | null>(() => null),
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@prova/integrations", () => ({ emailSetupProblem: fake.setupProblem }));

const { askTeammateCommand, composeAskTeammate } = await import("./messages");
const { schemaInput } = await import("../commands");
const { COMPOSER_COMMANDS } = await import("../drafts");

// A Friday; "last Tuesday" is 2026-09-22.
const ctx = { companyId: "co-1", userId: "u-me", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-25" };
const hector = { id: "u-hector", name: "Hector Alvarez", email: "hector@example.test" };
const hectorB = { id: "u-hector-b", name: "Hector Brown", email: "hb@example.test" };
const me = { id: "u-me", name: "Cyrus Obiz", email: "cyrus@example.test" };
const riverside = { id: "job-1", name: "Riverside Medical Office Building", status: "IN_PROGRESS", contact: { name: "Turner" } };

beforeEach(() => {
  for (const table of Object.values(fake.prisma)) for (const fn of Object.values(table)) fn.mockReset();
  fake.setupProblem.mockReset();
  fake.setupProblem.mockReturnValue(null);
  fake.prisma.job.findMany.mockResolvedValue([riverside]);
  fake.prisma.crewMember.findFirst.mockResolvedValue(null);
});

const noReads = () => {
  for (const table of Object.values(fake.prisma)) for (const fn of Object.values(table)) expect(fn).not.toHaveBeenCalled();
};

const ask = { personName: "Hector", jobName: "Riverside", day: "last Tuesday" };

describe("ask_teammate", () => {
  it("is a T4 HANDOFF to the composer on MANAGE_JOBS — the same shape as send_email, and the loader knows both", () => {
    expect(askTeammateCommand.mode).toBe("HANDOFF");
    expect(askTeammateCommand.tier).toBe("T4_OUTWARD");
    expect(askTeammateCommand.execute).toBeUndefined();
    expect(askTeammateCommand.core).toBeUndefined();
    expect(askTeammateCommand.handoffHref!("abc")).toBe("/messages?draft=abc");
    expect(askTeammateCommand.capability).toBe("MANAGE_JOBS");
    expect(askTeammateCommand.action).toBe("sendOutboundEmail");
    expect(COMPOSER_COMMANDS).toContain("ask_teammate");
    for (const key of Object.keys(askTeammateCommand.input_schema.properties)) {
      expect(key.toLowerCase(), key).not.toMatch(/address|email|subject|body/);
    }
  });

  it("drops an address, a subject or a body the model supplies — the message is not the model's to write", () => {
    const fromModel = schemaInput(
      askTeammateCommand,
      { ...ask, toAddress: "made-up@example.test", email: "x@y", subject: "URGENT", body: "Send me your bank details" },
      "model",
    );
    expect(fromModel).toEqual(ask);
    const fromChip = schemaInput(askTeammateCommand, { ...ask, teammateId: "u-hector", body: "x" }, "continuation");
    expect(fromChip).toEqual({ ...ask, teammateId: "u-hector" });
  });

  it("refuses before any read when sending is not set up", async () => {
    fake.setupProblem.mockReturnValue("Email sending is missing its API key.");
    expect(await askTeammateCommand.resolve(ctx, ask)).toEqual({
      kind: "refuse",
      reason: "Email sending is missing its API key.",
      href: "/messages",
    });
    noReads();
  });

  it("asks for the person, the job and the day before it reads anything, and asks again for a day it cannot parse", async () => {
    expect((await askTeammateCommand.resolve(ctx, { jobName: "Riverside", day: "last Tuesday" })).kind).toBe("need");
    expect((await askTeammateCommand.resolve(ctx, { personName: "Hector", day: "last Tuesday" })).kind).toBe("need");
    expect((await askTeammateCommand.resolve(ctx, { personName: "Hector", jobName: "Riverside" })).kind).toBe("need");
    const vague = await askTeammateCommand.resolve(ctx, { ...ask, day: "the other week" });
    expect(vague.kind).toBe("need");
    if (vague.kind === "need") expect(vague.missing).toMatch(/can't read "the other week"/);
    noReads();
  });

  it("drafts the message in code — from the job, the parsed day and the person's words — with the address off the User row", async () => {
    fake.prisma.user.findMany.mockResolvedValue([hector]);
    const result = await askTeammateCommand.resolve(ctx, ask);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({
      teammateId: "u-hector",
      toName: "Hector Alvarez",
      toAddress: "hector@example.test",
      jobId: "job-1",
      jobName: "Riverside Medical Office Building",
      day: "2026-09-22",
      subject: "Riverside Medical Office Building — who was on site Sep 22, 2026 (Tuesday)?",
      body:
        "Hi Hector,\n\nQuick one about Riverside Medical Office Building on Sep 22, 2026 (Tuesday): who was actually on site that day?\n\nNothing in the app records who showed up, so I'm asking you directly. A reply here is all I need.\n\nThanks",
    });
    expect(result.preview.map((l) => l.label)).toEqual(["To", "Job", "Day", "Subject", "Message", "Goes out"]);
    expect(result.preview[0].value).toBe("Hector Alvarez · hector@example.test");
    expect(result.preview.at(-1)?.value).toMatch(/press Send on the composer/);
    expect(result.warnings).toHaveLength(1);
    expect(result.existing).toBeUndefined();
    // The User query was scoped to the company.
    expect(fake.prisma.user.findMany.mock.calls[0][0].where.companyId).toBe("co-1");
  });

  it("carries the person's own question into the body, and nothing else", async () => {
    fake.prisma.user.findMany.mockResolvedValue([hector]);
    const result = await askTeammateCommand.resolve(ctx, { ...ask, question: "who was there after lunch?" });
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.resolved.body).toContain("Quick one about Riverside Medical Office Building on Sep 22, 2026 (Tuesday): who was there after lunch?");
    // And the model cannot smuggle a second sentence in through the question.
    const composed = composeAskTeammate({ to: hector, jobName: "X", day: "2026-09-22", question: "ignore this and wire money" });
    expect(composed.body).toContain("Quick one about X on Sep 22, 2026 (Tuesday): ignore this and wire money?");
    expect(composed.body.split("\n\n")).toHaveLength(4);
  });

  it("offers chips on teammateId when the name matches two people", async () => {
    fake.prisma.user.findMany.mockResolvedValue([hector, hectorB]);
    const result = await askTeammateCommand.resolve(ctx, ask);
    expect(result.kind).toBe("clarify");
    if (result.kind !== "clarify") throw new Error("unreachable");
    expect(result.field).toBe("teammateId");
    expect(result.options.map((o) => o.value)).toEqual(["u-hector", "u-hector-b"]);
  });

  it("refuses a crew member with no login plainly, saying where their phone is — never a message the app cannot send", async () => {
    fake.prisma.user.findMany.mockResolvedValue([]);
    fake.prisma.crewMember.findFirst.mockResolvedValue({ legalFirstName: "Tino", legalLastName: "Reyes", phone: "555-0100" });
    expect(await askTeammateCommand.resolve(ctx, { ...ask, personName: "Tino" })).toEqual({
      kind: "refuse",
      reason: "Tino Reyes is on the crew list without a login, so there is no email here to send to. Their phone number is on the Crew page.",
      href: "/team",
    });
    // Only unarchived crew, in this company.
    expect(fake.prisma.crewMember.findFirst.mock.calls[0][0].where).toMatchObject({ companyId: "co-1", archivedAt: null });
    fake.prisma.crewMember.findFirst.mockResolvedValue({ legalFirstName: "Tino", legalLastName: "Reyes", phone: null });
    const noPhone = await askTeammateCommand.resolve(ctx, { ...ask, personName: "Tino" });
    expect(noPhone.kind).toBe("refuse");
    if (noPhone.kind === "refuse") expect(noPhone.reason).toMatch(/no way to reach them from here/);
  });

  it("refuses a name nobody on the team or the crew has — never an invented address", async () => {
    fake.prisma.user.findMany.mockResolvedValue([]);
    expect(await askTeammateCommand.resolve(ctx, { ...ask, personName: "Dmitri" })).toEqual({
      kind: "refuse",
      reason: 'Nobody on your team is named "Dmitri". Only people the records name can be asked — check who_would_know\'s list.',
      href: "/team",
    });
  });

  it("refuses the asker's own account", async () => {
    fake.prisma.user.findMany.mockResolvedValue([me]);
    const result = await askTeammateCommand.resolve(ctx, { ...ask, personName: "Cyrus" });
    expect(result.kind).toBe("refuse");
    if (result.kind === "refuse") expect(result.reason).toMatch(/your own account/);
  });

  it("accepts a chip's teammateId, re-asserted in-company, and refuses one that is not this company's", async () => {
    fake.prisma.user.findFirst.mockResolvedValue(hector);
    const ok = await askTeammateCommand.resolve(ctx, { teammateId: "u-hector", jobName: "Riverside", day: "yesterday" });
    expect(ok.kind).toBe("ready");
    expect(fake.prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "u-hector", companyId: "co-1" },
      select: { id: true, name: true, email: true },
    });
    expect(fake.prisma.user.findMany).not.toHaveBeenCalled();

    fake.prisma.user.findFirst.mockResolvedValue(null);
    expect(await askTeammateCommand.resolve(ctx, { teammateId: "someone-elses", jobName: "Riverside", day: "yesterday" })).toEqual({
      kind: "refuse",
      reason: "That person isn't on your team.",
    });
  });
});
