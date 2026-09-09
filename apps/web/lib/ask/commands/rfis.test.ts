import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * raise_rfi against a fake Prisma. It is HANDOFF, so there is no execute
 * to pin; what is pinned is the payload the page will prefill from, that
 * no date is ever in it, that a topic without a question is asked about
 * rather than padded into one, and where the card sends the person.
 */
const fake = vi.hoisted(() => ({
  prisma: { job: { findMany: vi.fn(), findFirst: vi.fn() } },
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { raiseRfiCommand, subjectFromQuestion } = await import("./rfis");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-09" };
const riverside = { id: "job-1", name: "Riverside Plaza", status: "IN_PROGRESS", contact: { name: "Turner" } };
const maple = { id: "job-2", name: "Riverside Annex", status: "IN_PROGRESS", contact: { name: "Turner" } };

beforeEach(() => {
  fake.prisma.job.findMany.mockReset();
  fake.prisma.job.findFirst.mockReset();
});

describe("raise_rfi", () => {
  it("is a HANDOFF to /rfis and nothing else", () => {
    expect(raiseRfiCommand.mode).toBe("HANDOFF");
    expect(raiseRfiCommand.execute).toBeUndefined();
    expect(raiseRfiCommand.core).toBeUndefined();
    expect(raiseRfiCommand.handoffHref!("abc")).toBe("/rfis?draft=abc");
    expect(raiseRfiCommand.capability).toBe("MANAGE_JOBS");
  });

  it("asks which job before it reads anything", async () => {
    const result = await raiseRfiCommand.resolve(ctx, { question: "Is the head-of-wall rated?" });
    expect(result.kind).toBe("need");
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("asks for the question when given only a topic, naming the topic", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    const result = await raiseRfiCommand.resolve(ctx, { jobName: "Riverside", subject: "head-of-wall detail" });
    expect(result.kind).toBe("need");
    if (result.kind !== "need") throw new Error("unreachable");
    expect(result.missing).toContain("head-of-wall detail");
  });

  it("offers chips when the name matches two jobs", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside, maple]);
    const result = await raiseRfiCommand.resolve(ctx, { jobName: "Riverside", question: "Which detail governs?" });
    expect(result.kind).toBe("clarify");
    if (result.kind !== "clarify") throw new Error("unreachable");
    expect(result.field).toBe("jobId");
    expect(result.options.map((o) => o.value)).toEqual(["job-1", "job-2"]);
  });

  it("prefills the job, subject, question and references, and never a date", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    const result = await raiseRfiCommand.resolve(ctx, {
      jobName: "Riverside",
      subject: "Head-of-wall at rated corridor",
      question: "A-501/3 shows a deflection track; the spec calls for a fire-rated head-of-wall. Which governs?",
      drawingReference: "A-501 / 3",
      specSection: "09 21 16",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({
      jobId: "job-1",
      jobName: "Riverside Plaza",
      subject: "Head-of-wall at rated corridor",
      question: "A-501/3 shows a deflection track; the spec calls for a fire-rated head-of-wall. Which governs?",
      drawingReference: "A-501 / 3",
      specSection: "09 21 16",
    });
    expect(Object.keys(result.resolved)).not.toContain("sentOn");
    expect(Object.keys(result.resolved)).not.toContain("dueBy");
    expect(result.preview.map((l) => l.label)).toEqual(["Job", "Subject", "Question", "Drawing", "Spec section", "Date sent"]);
    expect(result.preview.at(-1)?.value).toMatch(/set on the form/);
    expect(result.warnings).toEqual([]);
  });

  it("takes the subject from the question when none was given, and says so on the card", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    const result = await raiseRfiCommand.resolve(ctx, {
      jobName: "Riverside",
      question: "Does the rated corridor head-of-wall use the deflection track on A-501 or the spec's fire-rated assembly?",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    const subject = result.resolved.subject as string;
    expect(subject.length).toBeLessThanOrEqual(81);
    expect(subject.endsWith("…")).toBe(true);
    expect(result.warnings[0]).toMatch(/Subject taken from the question/);
    expect(result.resolved.drawingReference).toBeNull();
    expect(result.resolved.specSection).toBeNull();
  });

  it("accepts a chip's jobId and re-asserts it in-company", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-2", name: "Riverside Annex" });
    const result = await raiseRfiCommand.resolve(ctx, { jobId: "job-2", question: "Which sheet governs the soffit?" });
    expect(result.kind).toBe("ready");
    expect(fake.prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: "job-2", companyId: "co-1" },
      select: { id: true, name: true },
    });
  });
});

describe("subjectFromQuestion", () => {
  it("returns a short question whole, minus its punctuation", () => {
    expect(subjectFromQuestion("Which detail governs?")).toBe("Which detail governs");
  });

  it("cuts a long question at a word boundary under 80 characters", () => {
    const subject = subjectFromQuestion(
      "The architect's reflected ceiling plan and the mechanical drawings disagree on the soffit height in corridor 2; which one do we build to?",
    );
    expect(subject.length).toBeLessThanOrEqual(81);
    expect(subject.endsWith("…")).toBe(true);
    expect(subject).not.toMatch(/\s…$/);
  });
});
