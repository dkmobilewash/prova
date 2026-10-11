import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * THE LICENCE NUMBER AND CITY AS A PERSON TYPES THEM, EXECUTED.
 *
 * `subListing.dbtest.ts` proves what an IMPORT writes. This is the other half
 * and it needs its own file, because the two paths deliberately disagree:
 *
 *   - the import, having nobody to ask, stores null for anything it cannot read;
 *   - the form REFUSES, because the box is labelled on screen as the number a
 *     public-register lookup joins on, nothing downstream reviews it, and the
 *     person who can fix it is the one looking at the box. A value that cannot
 *     join, displayed under that label, is a promise the data cannot keep.
 *
 * The refusal must be a RETURNED `{ ok: false, error }` and not a throw: this app
 * runs with production Server Action errors redacted, so a thrown refusal reaches
 * a real user as a digest and a dead button. `lib/ownerRefusalCensus.test.ts`
 * guards the owner case of that rule by reading source; this executes it.
 *
 * And the quiet one worth more than it looks: editing a lead through the form
 * must leave the three PROVENANCE columns alone. They say which document
 * introduced this lead, there are no boxes for them, and a `data:` object that
 * grew them would set every one to null on the first save — a silent erasure
 * with no error and nothing on screen.
 */

const context = {
  // `assertSalesAccess` reads both off the CONTEXT rather than off the row, so
  // the mock has to carry them — see the note in subListing.dbtest.ts, where
  // leaving `isProvaOperator` out failed six tests against a company that had it.
  company: { id: "", isProvaOperator: true },
  id: "",
  role: "OWNER" as string,
};
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, unstable_cache: (fn: unknown) => fn }));

const { createSalesLead, updateSalesLead } = await import("./sales");

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: "Prova Operator Co (lead fields)", isProvaOperator: true },
  });
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `slf_${stamp}`,
      email: `slf_${stamp}@example.test`,
      role: "OWNER",
    },
  });
  context.company.id = company.id;
  context.id = user.id;
});

afterAll(async () => {
  await prisma.salesLeadSignal.deleteMany({ where: { companyId: context.company.id } });
  await prisma.salesLead.deleteMany({ where: { companyId: context.company.id } });
  await prisma.user.deleteMany({ where: { companyId: context.company.id } });
  await prisma.company.deleteMany({ where: { id: context.company.id } });
});

const lead = (companyName: string) =>
  prisma.salesLead.findFirst({ where: { companyId: context.company.id, companyName } });

describe("typing a licence number in", () => {
  it("stores the digits, with or without the classification around them", async () => {
    expect(
      await createSalesLead(form({ companyName: "Typed Bare Co", licenceNumber: "884201" })),
    ).toEqual({ ok: true });
    expect((await lead("Typed Bare Co"))?.licenceNumber).toBe("884201");

    expect(
      await createSalesLead(
        form({ companyName: "Typed Classed Co", licenceNumber: " C-35 884202 ", city: "Rialto, CA" }),
      ),
    ).toEqual({ ok: true });
    const classed = await lead("Typed Classed Co");
    // The class is a fact about the scope of work, not about who holds the
    // licence, and it is not part of the join key.
    expect(classed?.licenceNumber).toBe("884202");
    expect(classed?.city).toBe("Rialto, CA");
  });

  it("leaves the column null when the box is empty, which is most leads", async () => {
    expect(await createSalesLead(form({ companyName: "No Licence Co" }))).toEqual({ ok: true });
    const row = await lead("No Licence Co");
    expect(row?.licenceNumber).toBeNull();
    expect(row?.city).toBeNull();
  });

  /**
   * RETURNED, NOT THROWN, and the lead is not created at all. A mutation that
   * drops the refusal and stores null instead leaves the first assertion red; one
   * that throws rather than returning leaves the second red, because `runAction`'s
   * boundary is what turns an `InputError` into a sentence a form can render.
   */
  it("refuses something that is not a licence number and writes nothing", async () => {
    const result = await createSalesLead(
      form({ companyName: "Rejected Co", licenceNumber: "ask Dave" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/2 to 7 digits/);
    expect(await lead("Rejected Co")).toBeNull();
  });

  it("refuses two numbers rather than silently taking the first", async () => {
    const result = await createSalesLead(
      form({ companyName: "Two Numbers Co", licenceNumber: "884201 / 990099" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("884201");
      expect(result.error).toContain("990099");
    }
    expect(await lead("Two Numbers Co")).toBeNull();
  });
});

describe("editing a lead the import created", () => {
  /**
   * The whole reason the licence is editable rather than import-only: an import
   * can put the wrong number on a lead — a listing misprints one, or a row was
   * attached to the wrong company — and a join key nobody can correct looks up as
   * somebody else for good.
   */
  it("corrects a wrong licence, and clears it when the box is emptied", async () => {
    const imported = await prisma.salesLead.create({
      data: {
        companyId: context.company.id,
        companyName: "Imported Co",
        licenceNumber: "111222",
        city: "Fontana, CA",
        registrationNumber: "1000012345",
        listedByGc: "Swinerton Builders",
        listedOnProject: "Lincoln Elementary Modernization",
      },
    });

    expect(
      await updateSalesLead(
        imported.id,
        form({ companyName: "Imported Co", licenceNumber: "C-9 884203", city: "Fontana, CA" }),
      ),
    ).toEqual({ ok: true });
    expect((await prisma.salesLead.findUnique({ where: { id: imported.id } }))?.licenceNumber).toBe(
      "884203",
    );

    expect(
      await updateSalesLead(imported.id, form({ companyName: "Imported Co", city: "" })),
    ).toEqual({ ok: true });
    const cleared = await prisma.salesLead.findUnique({ where: { id: imported.id } });
    expect(cleared?.licenceNumber).toBeNull();
    expect(cleared?.city).toBeNull();
  });

  /**
   * AND THE THREE COLUMNS THE FORM MUST NOT TOUCH. There are no boxes for the
   * registration, the GC or the project, so a `data:` object that included them
   * would read empty strings off a FormData that never carried them and null all
   * three on the first save — no error, nothing on screen, and the record of
   * where this lead came from gone.
   *
   * Asserted after the edit above has already run twice against this same row, so
   * it is the state the form actually left behind rather than a fresh fixture.
   */
  it("leaves the provenance columns exactly as the import wrote them", async () => {
    const row = await lead("Imported Co");
    expect(row?.registrationNumber).toBe("1000012345");
    expect(row?.listedByGc).toBe("Swinerton Builders");
    expect(row?.listedOnProject).toBe("Lincoln Elementary Modernization");
  });
});
