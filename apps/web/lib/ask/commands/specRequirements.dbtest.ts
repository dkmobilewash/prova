import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";

/**
 * Ask's spec answers against real rows: a spec book's section and a drawing's notes on one job,
 * each item named by its source; Level 5 and the stud gauge said as the code read them; "not in my
 * estimate" matched against the job's own lines; a job with nothing read told where to read it; and
 * another company's job never reached.
 */
const { HANDLERS } = await import("../handlers");

let companyId = "", otherCompanyId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "ASK-SPEC Co" } })).id;
  otherCompanyId = (await prisma.company.create({ data: { name: "ASK-SPEC Other" } })).id;
  const gc = await prisma.contact.create({ data: { companyId, name: "ASK-SPEC GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: gc.id, name: "ASK-SPEC Baker", status: "ESTIMATE" } });
  await prisma.job.create({ data: { companyId, contactId: gc.id, name: "ASK-SPEC Unread", status: "ESTIMATE" } });
  const otherGc = await prisma.contact.create({ data: { companyId: otherCompanyId, name: "GC" } });
  const theirs = await prisma.job.create({ data: { companyId: otherCompanyId, contactId: otherGc.id, name: "ASK-SPEC Baker Theirs" } });

  const empty = { products: [], studs: [], boards: [], fireRatings: [], ceilings: [], finishLevels: [], priceDrivers: [], requirements: [], reason: "" };
  const reading = (facts: object) => ({ facts: { ...empty, ...facts }, readingReason: "test", pagesCharged: 0, model: "test", promptVersion: "test" });

  // A spec book's 09 21 16, read.
  const book = await prisma.specBook.create({ data: { jobId: job.id, fileUrl: "local:manual.pdf" } });
  await prisma.bidSpecSection.create({
    data: {
      jobId: job.id,
      specBookId: book.id,
      sectionNumber: "09 21 16",
      title: "GYPSUM BOARD ASSEMBLIES",
      pageFrom: 7,
      pageTo: 9,
      tradeReadings: {
        create: reading({
          boards: [{ kind: "Type X", thickness: "5/8 inch", where: "at all fire-rated assemblies", quote: "Type X: 5/8 inch, at all fire-rated assemblies." }],
          finishLevels: [{ level: 5, where: "main lobby", quote: "Level 5 finish at the main lobby." }],
        }),
      },
    },
  });
  // The plan set's printed notes: its own "book", whose file is the plan's.
  await prisma.takeoffPlan.create({ data: { companyId, jobId: job.id, fileUrl: "local:plans.pdf" } });
  const drawings = await prisma.specBook.create({ data: { jobId: job.id, fileUrl: "local:plans.pdf" } });
  await prisma.bidSpecSection.create({
    data: {
      jobId: job.id,
      specBookId: drawings.id,
      sectionNumber: "09 22 16",
      title: "Notes on sheet A100",
      pageFrom: 3,
      pageTo: 3,
      tradeReadings: { create: reading({ studs: [{ gauge: "20GA", depth: '3-5/8"', spacing: '16" O.C.', quote: 'ALL INTERIOR STUD WALLS TO BE 3-5/8" 20GA. @ 16" O.C.' }] }) },
    },
  });
  await prisma.jobLineItem.create({ data: { jobId: job.id, description: 'C8B — 5/8" Type X gypsum board' } });
  // Their job has a read section too; it must never be reached.
  await prisma.bidSpecSection.create({ data: { jobId: theirs.id, sectionNumber: "09 21 16", tradeReadings: { create: reading({ finishLevels: [{ level: 5, where: null, quote: "q" }] }) } } });
});

afterAll(async () => {
  await prisma.takeoffPlan.deleteMany({ where: { companyId } });
  await prisma.jobLineItem.deleteMany({ where: { job: { companyId } } });
  await prisma.job.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await prisma.$disconnect();
});

describe("Ask: what the spec says on a job", () => {
  it("board, with the section it came from and a link to the job's Specs page", async () => {
    const r = await HANDLERS.spec_requirements(companyId, { jobName: "ask-spec baker", topic: "board" });
    const data = r.data as { board: { kind: string; source: string }[]; sources: string[]; open: string };
    expect(data.board).toEqual([expect.objectContaining({ kind: "Type X", source: "09 21 16" })]);
    expect(data.sources).toEqual(["09 21 16", "09 22 16, sheet A100"]);
    expect(r.citations.at(-1)?.href).toMatch(/\/jobs\/.+\/specs$/);
  });

  it("Level 5 anywhere, and the stud gauge from a drawing's sheet, read by code", async () => {
    const level = (await HANDLERS.spec_requirements(companyId, { jobName: "ask-spec baker", topic: "finish_level" })).data as { level5Anywhere: boolean };
    expect(level.level5Anywhere).toBe(true);
    const studs = (await HANDLERS.spec_requirements(companyId, { jobName: "ask-spec baker", topic: "studs" })).data as { lightestGaugeAllowed: number; studs: { source: string }[] };
    expect(studs.lightestGaugeAllowed).toBe(20);
    expect(studs.studs[0].source).toBe("09 22 16, sheet A100");
  });

  it("not in my estimate: the job's own lines, matched by their words", async () => {
    const data = (await HANDLERS.spec_requirements(companyId, { jobName: "ask-spec baker", topic: "not_in_estimate" })).data as {
      notOnEstimate: { item: string; source: string }[];
      onEstimate: { item: string }[];
    };
    expect(data.onEstimate.map((o) => o.item)).toEqual(["Type X board at all fire-rated assemblies"]);
    expect(data.notOnEstimate).toEqual(
      expect.arrayContaining([
        { item: "Level 5 finish at main lobby", source: "09 21 16" },
        { item: "20 ga studs", source: "09 22 16, sheet A100" },
      ]),
    );
  });

  it("says where to read a spec on a job with none, and never reaches another company's job", async () => {
    const unread = await HANDLERS.spec_requirements(companyId, { jobName: "ask-spec unread" });
    expect(unread.unavailable).toMatch(/No spec has been read on ASK-SPEC Unread yet/);
    const theirs = await HANDLERS.spec_requirements(companyId, { jobName: "ask-spec baker theirs" });
    expect(theirs.unavailable).toMatch(/No job matches/);
  });
});
