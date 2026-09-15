import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * send_email against a fake Prisma and a fake email config. It is HANDOFF,
 * so there is no execute to pin; what is pinned is that the card sends
 * nothing and can carry nothing the model made up — the address is read
 * off the Contact row or the card is refused, a name matching nobody or
 * several people is a refusal or a chip row rather than a guess, and the
 * payload the composer prefills from holds exactly the fields
 * lib/ask/drafts.ts reads back.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findMany: vi.fn(), findFirst: vi.fn() },
    contact: { findMany: vi.fn(), findFirst: vi.fn() },
  },
  setupProblem: vi.fn<() => string | null>(() => null),
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@prova/integrations", () => ({ emailSetupProblem: fake.setupProblem }));

const { sendEmailCommand } = await import("./messages");
const { schemaInput } = await import("../commands");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-11" };
const turner = { id: "c-1", name: "Turner Construction", email: "pm@turner.example", _count: { jobs: 3 } };
const turnerNoEmail = { id: "c-2", name: "Turner Brothers", email: null, _count: { jobs: 0 } };
const riverside = { id: "job-1", name: "Riverside Plaza", status: "IN_PROGRESS", contact: { name: "Turner Construction" } };
const annex = { id: "job-2", name: "Riverside Annex", status: "IN_PROGRESS", contact: { name: "Turner Construction" } };

beforeEach(() => {
  fake.prisma.job.findMany.mockReset();
  fake.prisma.job.findFirst.mockReset();
  fake.prisma.contact.findMany.mockReset();
  fake.prisma.contact.findFirst.mockReset();
  fake.setupProblem.mockReset();
  fake.setupProblem.mockReturnValue(null);
});

const noReads = () => {
  expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
  expect(fake.prisma.job.findFirst).not.toHaveBeenCalled();
  expect(fake.prisma.contact.findMany).not.toHaveBeenCalled();
  expect(fake.prisma.contact.findFirst).not.toHaveBeenCalled();
};

describe("send_email", () => {
  it("is a T4 HANDOFF to /messages, offered on MANAGE_JOBS, with no address anywhere in its schema", () => {
    expect(sendEmailCommand.mode).toBe("HANDOFF");
    expect(sendEmailCommand.tier).toBe("T4_OUTWARD");
    expect(sendEmailCommand.execute).toBeUndefined();
    expect(sendEmailCommand.core).toBeUndefined();
    expect(sendEmailCommand.handoffHref!("abc")).toBe("/messages?draft=abc");
    expect(sendEmailCommand.capability).toBe("MANAGE_JOBS");
    expect(sendEmailCommand.action).toBe("sendOutboundEmail");
    for (const key of Object.keys(sendEmailCommand.input_schema.properties)) {
      expect(key.toLowerCase(), key).not.toMatch(/address|email/);
    }
  });

  it("drops an address the model supplies, from the model and from a chip alike", () => {
    const fromModel = schemaInput(
      sendEmailCommand,
      { recipientName: "Turner", body: "The studs are three weeks late.", toAddress: "made-up@example.test", email: "x@y" },
      "model",
    );
    expect(fromModel).toEqual({ recipientName: "Turner", body: "The studs are three weeks late." });
    const fromChip = schemaInput(
      sendEmailCommand,
      { body: "The studs are three weeks late.", contactId: "c-1", toAddress: "made-up@example.test" },
      "continuation",
    );
    expect(fromChip).toEqual({ body: "The studs are three weeks late.", contactId: "c-1" });
  });

  it("refuses before any read when sending is not set up, pointing at the page that says what to fix", async () => {
    fake.setupProblem.mockReturnValue("Email sending is missing its API key.");
    const result = await sendEmailCommand.resolve(ctx, { recipientName: "Turner", body: "The studs are late." });
    expect(result).toEqual({ kind: "refuse", reason: "Email sending is missing its API key.", href: "/messages" });
    noReads();
  });

  it("asks for the message before it reads anything", async () => {
    const result = await sendEmailCommand.resolve(ctx, { recipientName: "Turner" });
    expect(result.kind).toBe("need");
    noReads();
  });

  it("asks who it is to when neither a contact nor a job was named", async () => {
    const result = await sendEmailCommand.resolve(ctx, { body: "The studs are three weeks late." });
    expect(result.kind).toBe("need");
    if (result.kind !== "need") throw new Error("unreachable");
    expect(result.missing).toMatch(/who the email is to/);
    noReads();
  });

  it("refuses a name that matches no contact, and says where to add them — never an invented address", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([]);
    const result = await sendEmailCommand.resolve(ctx, { recipientName: "Skanska", body: "The studs are late." });
    expect(result).toEqual({
      kind: "refuse",
      reason: 'No contact matches "Skanska". Add them, with an email address, first.',
      href: "/contacts",
    });
  });

  it("offers chips on contactId when the name matches two contacts", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner, turnerNoEmail]);
    const result = await sendEmailCommand.resolve(ctx, { recipientName: "Turner", body: "The studs are late." });
    expect(result.kind).toBe("clarify");
    if (result.kind !== "clarify") throw new Error("unreachable");
    expect(result.field).toBe("contactId");
    expect(result.question).toBe("Which Turner?");
    expect(result.options.map((o) => o.value)).toEqual(["c-1", "c-2"]);
  });

  it("refuses a contact with no email on file and links their page rather than guessing one", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turnerNoEmail]);
    const result = await sendEmailCommand.resolve(ctx, { recipientName: "Turner Brothers", body: "The studs are late." });
    expect(result).toEqual({
      kind: "refuse",
      reason: "Turner Brothers has no email address on file. Add one on their contact page first.",
      href: "/contacts/c-2",
    });
  });

  it("prefills the recipient from the contact row and the message from the person's words; derives the subject and says so", async () => {
    fake.prisma.contact.findMany.mockResolvedValue([turner]);
    const result = await sendEmailCommand.resolve(ctx, {
      recipientName: "Turner",
      body: "The studs are three weeks late.",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({
      contactId: "c-1",
      toName: "Turner Construction",
      toAddress: "pm@turner.example",
      jobId: null,
      jobName: null,
      subject: "The studs are three weeks late",
      body: "The studs are three weeks late.",
    });
    expect(result.preview.map((l) => l.label)).toEqual(["To", "Subject", "Message", "Goes out"]);
    expect(result.preview[0].value).toBe("Turner Construction · pm@turner.example");
    expect(result.preview.at(-1)?.value).toMatch(/press Send on the composer/);
    expect(result.warnings).toEqual(["Subject taken from the message. Change it on the composer if it should read differently."]);
    expect(result.existing).toBeUndefined();
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("goes to the job's GC when only the job was named", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.job.findFirst.mockResolvedValue({ contact: { id: "c-1", name: "Turner Construction", email: "pm@turner.example" } });
    const result = await sendEmailCommand.resolve(ctx, {
      jobName: "Riverside",
      subject: "Pay app 3",
      body: "Pay app 3 went out Tuesday.",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({
      contactId: "c-1",
      toName: "Turner Construction",
      toAddress: "pm@turner.example",
      jobId: "job-1",
      jobName: "Riverside Plaza",
      subject: "Pay app 3",
      body: "Pay app 3 went out Tuesday.",
    });
    expect(result.preview.map((l) => l.label)).toEqual(["To", "Job", "Subject", "Message", "Goes out"]);
    expect(result.warnings).toEqual([]);
    expect(fake.prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job-1", companyId: "co-1" },
      select: { contact: { select: { id: true, name: true, email: true } } },
    });
    expect(fake.prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("asks which job before the recipient when the job name matches two", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside, annex]);
    const result = await sendEmailCommand.resolve(ctx, { jobName: "Riverside", body: "Pay app 3 went out Tuesday." });
    expect(result.kind).toBe("clarify");
    if (result.kind !== "clarify") throw new Error("unreachable");
    expect(result.field).toBe("jobId");
    expect(fake.prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("uses the named contact, not the job's GC, when both were given", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.contact.findMany.mockResolvedValue([
      { id: "c-9", name: "ABC Supply", email: "orders@abc.example", _count: { jobs: 0 } },
    ]);
    const result = await sendEmailCommand.resolve(ctx, {
      jobName: "Riverside",
      recipientName: "ABC Supply",
      body: "Hold the board delivery until Monday.",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved.contactId).toBe("c-9");
    expect(result.resolved.toAddress).toBe("orders@abc.example");
    expect(result.resolved.jobId).toBe("job-1");
    expect(fake.prisma.job.findFirst).not.toHaveBeenCalled();
  });

  it("accepts a chip's contactId and jobId and re-asserts both in-company", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-2", name: "Riverside Annex" });
    fake.prisma.contact.findFirst.mockResolvedValue({ id: "c-1", name: "Turner Construction", email: "pm@turner.example" });
    const result = await sendEmailCommand.resolve(ctx, { contactId: "c-1", jobId: "job-2", body: "The studs are late." });
    expect(result.kind).toBe("ready");
    expect(fake.prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { id: "c-1", companyId: "co-1" },
      select: { id: true, name: true, email: true },
    });
    expect(fake.prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job-2", companyId: "co-1" },
      select: { id: true, name: true },
    });
    expect(fake.prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("refuses a chip contactId that is not this company's", async () => {
    fake.prisma.contact.findFirst.mockResolvedValue(null);
    const result = await sendEmailCommand.resolve(ctx, { contactId: "someone-elses", body: "The studs are late." });
    expect(result).toEqual({ kind: "refuse", reason: "That contact isn't on your account." });
  });
});
