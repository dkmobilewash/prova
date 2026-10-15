import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { storableText } from "./planPdf";

/**
 * THE ONE INSTRUMENT THAT COULD SEE THIS DEFECT.
 *
 * Three sheets of a real 60-sheet set could not be read, every attempt, and all
 * anybody saw was "This page could not be read. Nothing about it was saved." —
 * the sentence `runner.ts` writes when a stage throws, deliberately generic
 * because a thrown error's own text can carry a connection string. The real one
 * was in the runtime log:
 *
 *   PostgresError 22021: invalid byte sequence for encoding "UTF8": 0x00
 *   at saveSheetText → prisma.planSheetText.upsert()
 *
 * Every other instrument said those pages were fine, BECAUSE THEY ARE. pdfjs
 * reads all three in 2-5ms. They are the cheapest pages in the set — 47 text
 * items, 76 segments. The real stage, run against the real file with in-memory
 * ports, returns `ok` for every one of them. A unit test of `storableText` is
 * worth having and would not have caught this either, because the thing that
 * refused was not the code.
 *
 * So the first case here does not test our code at all: it proves POSTGRES
 * refuses the raw value. Without it the second case is vacuous — a write
 * succeeding proves nothing if the unsanitised one would also have succeeded,
 * and "the database would have taken it anyway" is exactly the assumption that
 * let this ship.
 */

const ids: { companies: string[] } = { companies: [] };

afterEach(async () => {
  for (const companyId of ids.companies) {
    await prisma.takeoffPlan.deleteMany({ where: { job: { companyId } } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  }
  ids.companies = [];
});

async function aPlan() {
  const company = await prisma.company.create({ data: { name: "ZZ Sheet Text Co" } });
  ids.companies.push(company.id);
  const contact = await prisma.contact.create({
    data: { companyId: company.id, name: "ZZ GC" },
  });
  const job = await prisma.job.create({
    data: { companyId: company.id, name: "ZZ Sheet Text Job", status: "ESTIMATE", contactId: contact.id },
  });
  return prisma.takeoffPlan.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      fileUrl: "https://example.invalid/x.pdf",
      fileName: "x.pdf",
    },
  });
}

/** The title block of the sheet that failed, shape and all, with its NUL. */
const AS_IT_CAME_OFF_THE_SHEET = `A-501\u0000PARTITION TYPES SCALE: 3" = 1'-0"\u0000`;

describe("a title block that carries a NUL byte", () => {
  it("IS REFUSED BY POSTGRES RAW — the defect, reproduced", async () => {
    const plan = await aPlan();
    await expect(
      prisma.planSheetText.create({
        data: {
          planId: plan.id,
          pageNumber: 22,
          hasTextLayer: true,
          titleBlockText: AS_IT_CAME_OFF_THE_SHEET,
          widthPt: 2592,
          heightPt: 1728,
          rotation: 0,
        },
      }),
      "Postgres accepted a NUL byte, so this whole file is measuring nothing",
    ).rejects.toThrow();
  });

  it("is stored once sanitised, with the sheet number intact", async () => {
    const plan = await aPlan();
    const row = await prisma.planSheetText.create({
      data: {
        planId: plan.id,
        pageNumber: 22,
        hasTextLayer: true,
        titleBlockText: storableText(AS_IT_CAME_OFF_THE_SHEET),
        widthPt: 2592,
        heightPt: 1728,
        rotation: 0,
      },
    });
    // Stored, and still says what the sheet says — a fix that dropped the text
    // would also pass a "did it write" assertion.
    expect(row.titleBlockText).toContain("A-501");
    expect(row.titleBlockText).toContain("PARTITION TYPES");
    expect(row.titleBlockText).not.toContain("\u0000");

    const read = await prisma.planSheetText.findUnique({ where: { id: row.id } });
    expect(read?.titleBlockText).toBe(storableText(AS_IT_CAME_OFF_THE_SHEET));
  });
});
