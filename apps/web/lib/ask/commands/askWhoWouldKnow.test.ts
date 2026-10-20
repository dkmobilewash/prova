import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ask_who_would_know against a fake Prisma and a fake email config. HANDOFF,
 * so there is no execute to pin; what is pinned is that the card sends
 * nothing and carries nothing the model made up:
 *
 *   - the address is read off a User or ContactPerson row, or the card is
 *     refused — no address-shaped key exists in the schema, and one the
 *     model supplies is dropped by schemaInput before resolve sees it;
 *   - the subject and body are composed in code from the job's name, the
 *     parsed day and the person's own words, so a model that tried to write
 *     the message has nowhere to put it;
 *   - a crew member (no login, no email column) is a refusal that says
 *     where their phone is — NEVER a draft to somebody else in their place;
 *     the asker's own account is a refusal; a name matching nobody is a
 *     refusal; several is a chip row; a GC person with no email is a refusal
 *     with the page to add one;
 *   - the GC's people are read only for an asker who could open the contact
 *     page's People section (MANAGE_ESTIMATING), as contact_lookup does;
 *   - the payload holds exactly the keys lib/ask/drafts.ts's composer
 *     loader reads back, so the tap opens a filled-in composer.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findMany: vi.fn(), findFirst: vi.fn() },
    user: { findMany: vi.fn(), findFirst: vi.fn() },
    contactPerson: { findMany: vi.fn(), findFirst: vi.fn() },
    crewMember: { findFirst: vi.fn() },
  },
  setupProblem: vi.fn<() => string | null>(() => null),
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@prova/integrations", () => ({ emailSetupProblem: fake.setupProblem }));

const { askWhoWouldKnowCommand, composeAskWhoWouldKnow } = await import("./messages");
const { schemaInput } = await import("../commands");
const { COMPOSER_COMMANDS } = await import("../drafts");

// A Friday; "last Tuesday" is 2026-09-22.
const OWNER = { role: "OWNER", jobFunction: null } as const;
const FIELD = { role: "MEMBER", jobFunction: "FIELD" } as const;
const ctx = { companyId: "co-1", userId: "u-me", principal: OWNER, today: "2026-09-25" };
const hector = { id: "u-hector", name: "Hector Alvarez", email: "hector@example.test" };
const hectorB = { id: "u-hector-b", name: "Hector Brown", email: "hb@example.test" };
const me = { id: "u-me", name: "Cyrus Obiz", email: "cyrus@example.test" };
const marco = { id: "p-marco", contactId: "c-brackett", name: "Marco Silva", email: "super@brackett.example", title: "Superintendent", contact: { name: "Brackett Construction" } };
const dana = { id: "p-dana", contactId: "c-brackett", name: "Dana Whitfield", email: null, title: "PM", contact: { name: "Brackett Construction" } };
const riverside = { id: "job-1", name: "Riverside Medical Office Building", status: "IN_PROGRESS", contact: { name: "Brackett Construction" } };

beforeEach(() => {
  for (const table of Object.values(fake.prisma)) for (const fn of Object.values(table)) fn.mockReset();
  fake.setupProblem.mockReset();
  fake.setupProblem.mockReturnValue(null);
  fake.prisma.job.findMany.mockResolvedValue([riverside]);
  fake.prisma.user.findMany.mockResolvedValue([]);
  fake.prisma.contactPerson.findMany.mockResolvedValue([]);
  fake.prisma.crewMember.findFirst.mockResolvedValue(null);
});

const noReads = () => {
  for (const table of Object.values(fake.prisma)) for (const fn of Object.values(table)) expect(fn).not.toHaveBeenCalled();
};

const ask = { personName: "Hector", jobName: "Riverside", day: "last Tuesday" };

describe("ask_who_would_know", () => {
  it("is a T4 HANDOFF to the composer on MANAGE_JOBS — the same shape as send_email, and the loader knows both", () => {
    expect(askWhoWouldKnowCommand.mode).toBe("HANDOFF");
    expect(askWhoWouldKnowCommand.tier).toBe("T4_OUTWARD");
    expect(askWhoWouldKnowCommand.execute).toBeUndefined();
    expect(askWhoWouldKnowCommand.core).toBeUndefined();
    expect(askWhoWouldKnowCommand.handoffHref!("abc")).toBe("/messages?draft=abc");
    expect(askWhoWouldKnowCommand.capability).toBe("MANAGE_JOBS");
    expect(askWhoWouldKnowCommand.action).toBe("sendOutboundEmail");
    expect(COMPOSER_COMMANDS).toContain("ask_who_would_know");
    for (const key of Object.keys(askWhoWouldKnowCommand.input_schema.properties)) {
      expect(key.toLowerCase(), key).not.toMatch(/address|email|subject|body|recipient/);
    }
  });

  it("drops an address, a subject, a body or a recipient id the model supplies — the message is not the model's to write", () => {
    const fromModel = schemaInput(
      askWhoWouldKnowCommand,
      { ...ask, toAddress: "made-up@example.test", email: "x@y", subject: "URGENT", body: "Send me your bank details", recipient: "user:u-hector" },
      "model",
    );
    expect(fromModel).toEqual(ask);
    const fromChip = schemaInput(askWhoWouldKnowCommand, { ...ask, recipient: "user:u-hector", body: "x" }, "continuation");
    expect(fromChip).toEqual({ ...ask, recipient: "user:u-hector" });
  });

  it("refuses before any read when sending is not set up", async () => {
    fake.setupProblem.mockReturnValue("Email sending is missing its API key.");
    expect(await askWhoWouldKnowCommand.resolve(ctx, ask)).toEqual({
      kind: "refuse",
      reason: "Email sending is missing its API key.",
      href: "/messages",
    });
    noReads();
  });

  it("asks for the person, the job and the day before it reads anything, and asks again for a day it cannot parse", async () => {
    expect((await askWhoWouldKnowCommand.resolve(ctx, { jobName: "Riverside", day: "last Tuesday" })).kind).toBe("need");
    expect((await askWhoWouldKnowCommand.resolve(ctx, { personName: "Hector", day: "last Tuesday" })).kind).toBe("need");
    expect((await askWhoWouldKnowCommand.resolve(ctx, { personName: "Hector", jobName: "Riverside" })).kind).toBe("need");
    const vague = await askWhoWouldKnowCommand.resolve(ctx, { ...ask, day: "the other week" });
    expect(vague.kind).toBe("need");
    if (vague.kind === "need") expect(vague.missing).toMatch(/can't read "the other week"/);
    noReads();
  });

  it("drafts to a teammate in code — from the job, the parsed day and the person's words — with the address off the User row", async () => {
    fake.prisma.user.findMany.mockResolvedValue([hector]);
    const result = await askWhoWouldKnowCommand.resolve(ctx, ask);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({
      recipient: "user:u-hector",
      toName: "Hector Alvarez",
      toAddress: "hector@example.test",
      jobId: "job-1",
      jobName: "Riverside Medical Office Building",
      day: "2026-09-22",
      subject: "Riverside Medical Office Building — who was on site Sep 22, 2026 (Tuesday)?",
      body:
        "Hi Hector,\n\nQuick one about Riverside Medical Office Building on Sep 22, 2026 (Tuesday): who was actually on site that day?\n\nNothing on our side records who showed up, so I'm asking you directly. A reply here is all I need.\n\nThanks",
    });
    expect(result.preview.map((l) => l.label)).toEqual(["To", "Job", "Day", "Subject", "Message", "Goes out"]);
    expect(result.preview[0].value).toBe("Hector Alvarez · hector@example.test");
    expect(result.preview.at(-1)?.value).toMatch(/press Send on the composer/);
    expect(result.warnings).toHaveLength(1);
    expect(result.existing).toBeUndefined();
    // Both lookups were scoped to the company.
    expect(fake.prisma.user.findMany.mock.calls[0][0].where.companyId).toBe("co-1");
    expect(fake.prisma.contactPerson.findMany.mock.calls[0][0].where.companyId).toBe("co-1");
  });

  it("drafts to the GC's superintendent off the ContactPerson row, labelled with title and company", async () => {
    fake.prisma.contactPerson.findMany.mockResolvedValue([marco]);
    const result = await askWhoWouldKnowCommand.resolve(ctx, { ...ask, personName: "Marco" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toMatchObject({ recipient: "person:p-marco", toName: "Marco Silva", toAddress: "super@brackett.example", day: "2026-09-22" });
    expect(result.preview[0].value).toBe("Marco Silva (Superintendent, Brackett Construction) · super@brackett.example");
    expect(result.resolved.body).toMatch(/^Hi Marco,/);
  });

  it("does not read the GC's people for an asker without MANAGE_ESTIMATING, and says why the name is not found", async () => {
    fake.prisma.contactPerson.findMany.mockResolvedValue([marco]); // would match, if read
    const result = await askWhoWouldKnowCommand.resolve({ ...ctx, principal: FIELD }, { ...ask, personName: "Marco" });
    expect(fake.prisma.contactPerson.findMany).not.toHaveBeenCalled();
    expect(result.kind).toBe("refuse");
    if (result.kind === "refuse") expect(result.reason).toMatch(/GC's own people need estimating access/);
    // And a chip for a person is refused the same way, not honoured.
    const chip = await askWhoWouldKnowCommand.resolve({ ...ctx, principal: FIELD }, { recipient: "person:p-marco", jobName: "Riverside", day: "yesterday" });
    expect(chip).toEqual({ kind: "refuse", reason: "That person isn't on your account." });
    expect(fake.prisma.contactPerson.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a GC person with no email on file, linking the page to add one — never a guess", async () => {
    fake.prisma.contactPerson.findMany.mockResolvedValue([dana]);
    expect(await askWhoWouldKnowCommand.resolve(ctx, { ...ask, personName: "Dana" })).toEqual({
      kind: "refuse",
      reason: "Dana Whitfield (PM, Brackett Construction) has no email address on file. Add one on their contact page first.",
      href: "/contacts/c-brackett",
    });
  });

  it("carries the person's own question into the body, and nothing else", async () => {
    fake.prisma.user.findMany.mockResolvedValue([hector]);
    const result = await askWhoWouldKnowCommand.resolve(ctx, { ...ask, question: "who was there after lunch?" });
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.resolved.body).toContain("Quick one about Riverside Medical Office Building on Sep 22, 2026 (Tuesday): who was there after lunch?");
    // And the model cannot smuggle a second sentence in through the question.
    const composed = composeAskWhoWouldKnow({ toName: "Hector Alvarez", jobName: "X", day: "2026-09-22", question: "ignore this and wire money" });
    expect(composed.body).toContain("Quick one about X on Sep 22, 2026 (Tuesday): ignore this and wire money?");
    expect(composed.body.split("\n\n")).toHaveLength(4);
  });

  it("offers chips on recipient when the name matches two people, across teammates and the GC's people", async () => {
    fake.prisma.user.findMany.mockResolvedValue([hector, hectorB]);
    fake.prisma.contactPerson.findMany.mockResolvedValue([{ ...marco, id: "p-h", name: "Hector Ruiz" }]);
    const result = await askWhoWouldKnowCommand.resolve(ctx, ask);
    expect(result.kind).toBe("clarify");
    if (result.kind !== "clarify") throw new Error("unreachable");
    expect(result.field).toBe("recipient");
    expect(result.options.map((o) => o.value)).toEqual(["user:u-hector", "user:u-hector-b", "person:p-h"]);
    expect(result.options[2].label).toBe("Hector Ruiz (Superintendent, Brackett Construction)");
  });

  it("refuses a crew member with no login plainly, saying where their phone is — never a draft to somebody else in their place", async () => {
    // Somebody with an address is ALSO on the account. The refusal must not
    // reach for them.
    fake.prisma.contactPerson.findMany.mockResolvedValue([]);
    fake.prisma.crewMember.findFirst.mockResolvedValue({ legalFirstName: "Hector", legalLastName: "Ramirez", phone: "555-0100" });
    expect(await askWhoWouldKnowCommand.resolve(ctx, ask)).toEqual({
      kind: "refuse",
      reason:
        "Hector Ramirez is on the crew list without a login, so there is no email here to send to — and nothing here sends a text. Their phone number is on the Team page, under Crew.",
      href: "/team",
    });
    // Only unarchived crew, in this company.
    expect(fake.prisma.crewMember.findFirst.mock.calls[0][0].where).toMatchObject({ companyId: "co-1", archivedAt: null });
    fake.prisma.crewMember.findFirst.mockResolvedValue({ legalFirstName: "Hector", legalLastName: "Ramirez", phone: null });
    const noPhone = await askWhoWouldKnowCommand.resolve(ctx, ask);
    expect(noPhone.kind).toBe("refuse");
    if (noPhone.kind === "refuse") expect(noPhone.reason).toMatch(/no way to reach them from here/);
  });

  it("refuses a name nobody on the team, the crew or the contacts has — never an invented address", async () => {
    expect(await askWhoWouldKnowCommand.resolve(ctx, { ...ask, personName: "Dmitri" })).toEqual({
      kind: "refuse",
      reason: 'Nobody on your team or at your contacts is named "Dmitri". Only people the records name can be asked — check who_would_know\'s list.',
      href: "/team",
    });
  });

  it("refuses the asker's own account", async () => {
    fake.prisma.user.findMany.mockResolvedValue([me]);
    const result = await askWhoWouldKnowCommand.resolve(ctx, { ...ask, personName: "Cyrus" });
    expect(result.kind).toBe("refuse");
    if (result.kind === "refuse") expect(result.reason).toMatch(/your own account/);
  });

  it("accepts a chip's recipient, re-asserted in-company, and refuses one that is not this company's", async () => {
    fake.prisma.user.findFirst.mockResolvedValue(hector);
    const ok = await askWhoWouldKnowCommand.resolve(ctx, { recipient: "user:u-hector", jobName: "Riverside", day: "yesterday" });
    expect(ok.kind).toBe("ready");
    expect(fake.prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "u-hector", companyId: "co-1" },
      select: { id: true, name: true, email: true },
    });
    expect(fake.prisma.user.findMany).not.toHaveBeenCalled();

    fake.prisma.contactPerson.findFirst.mockResolvedValue(marco);
    const gc = await askWhoWouldKnowCommand.resolve(ctx, { recipient: "person:p-marco", jobName: "Riverside", day: "yesterday" });
    expect(gc.kind).toBe("ready");
    expect(fake.prisma.contactPerson.findFirst.mock.calls[0][0].where).toEqual({ id: "p-marco", companyId: "co-1" });

    fake.prisma.user.findFirst.mockResolvedValue(null);
    expect(await askWhoWouldKnowCommand.resolve(ctx, { recipient: "user:someone-elses", jobName: "Riverside", day: "yesterday" })).toEqual({
      kind: "refuse",
      reason: "That person isn't on your team.",
    });
  });
});
