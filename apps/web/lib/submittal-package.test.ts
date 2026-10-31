import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { drawnStrings } from "./pdfDrawnStrings.testutil";
import {
  buildSubmittalPackage,
  coverPageCount,
  packageSummary,
  parsePackageContents,
  readPackageContents,
  submittalPackageFileName,
  type SubmittalCover,
} from "./submittal-package";

const cover: SubmittalCover = {
  companyName: "Drywall Co",
  gcName: "Acme General",
  jobName: "Riverside Clinic",
  submittalNumber: 12,
  revisionNumber: 2,
  title: "Fire-rated gypsum board",
  description: null,
  specSection: "09 29 00",
  drawingReference: "A-501",
  sentOn: "2026-10-30",
};

async function pdf(pages: number, label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`${label} p${i + 1}`, { x: 50, y: 700, size: 10, font });
  return doc.save();
}

describe("the submittal package", () => {
  it("puts the cover first, then each file in the person's order, and lists names and pages", async () => {
    const built = await buildSubmittalPackage(cover, [
      { name: "board.pdf", bytes: await pdf(3, "BOARD") },
      { name: "track.pdf", bytes: await pdf(2, "TRACK") },
    ]);
    expect(built.contents).toEqual({
      files: [
        { name: "board.pdf", pages: 3 },
        { name: "track.pdf", pages: 2 },
      ],
      totalPages: 6,
    });
    const strings = await drawnStrings(built.bytes as Uint8Array);
    for (const fact of ["SUBMITTAL 12, REVISION 2", "Fire-rated gypsum board", "Drywall Co", "Acme General", "Riverside Clinic", "09 29 00", "A-501", "2026-10-30", "REVIEWER'S STAMP"]) {
      expect(strings, fact).toContain(fact);
    }
    expect(strings.indexOf("SUBMITTAL 12, REVISION 2")).toBeLessThan(strings.indexOf("BOARD p1"));
    expect(strings.indexOf("BOARD p3")).toBeLessThan(strings.indexOf("TRACK p1"));
    expect(strings).not.toContain("NOT-DRAWN");
    // Contents row: board starts on page 2 (after the cover), track on 5.
    const at = strings.indexOf("track.pdf");
    expect(strings.slice(at, at + 3)).toEqual(["track.pdf", "2", "5"]);
  });

  it("writes no certification wording on the cover", async () => {
    const built = await buildSubmittalPackage(cover, [{ name: "a.pdf", bytes: await pdf(1, "A") }]);
    expect((await drawnStrings(built.bytes as Uint8Array)).join(" ")).not.toMatch(/certif|warrant|hereby|complies/i);
  });

  it("leaves a blank, not a guess, where a fact is missing", async () => {
    const built = await buildSubmittalPackage({ ...cover, specSection: null, sentOn: null }, [{ name: "a.pdf", bytes: await pdf(1, "A") }]);
    const strings = await drawnStrings(built.bytes as Uint8Array);
    expect(strings).toContain("SPEC SECTION:");
    expect(strings).not.toContain("2026-10-30");
  });

  it("names a file it left out and builds nothing from nothing usable", async () => {
    const mixed = await buildSubmittalPackage(cover, [
      { name: "good.pdf", bytes: await pdf(1, "G") },
      { name: "photo.jpg", bytes: new Uint8Array([1, 2, 3, 4, 5, 6]) },
    ]);
    expect(mixed.contents?.files.map((f) => f.name)).toEqual(["good.pdf"]);
    expect(mixed.skipped).toMatchObject([{ name: "photo.jpg", reason: "NOT_A_PDF" }]);
    const none = await buildSubmittalPackage(cover, [{ name: "photo.jpg", bytes: new Uint8Array([1, 2, 3, 4, 5, 6]) }]);
    expect(none).toMatchObject({ bytes: null, contents: null });
  });

  it("runs a long list onto a second cover page, and the page numbers allow for it", async () => {
    const one = await pdf(1, "X");
    const parts = Array.from({ length: 30 }, (_, i) => ({ name: `f${i + 1}.pdf`, bytes: one }));
    const built = await buildSubmittalPackage(cover, parts);
    expect(coverPageCount(22)).toBe(1);
    expect(coverPageCount(23)).toBe(2);
    expect(coverPageCount(66)).toBe(2);
    expect(coverPageCount(67)).toBe(3);
    expect(built.contents?.totalPages).toBe(32);
    const strings = await drawnStrings(built.bytes as Uint8Array);
    const at = strings.indexOf("f1.pdf");
    expect(strings.slice(at, at + 3)).toEqual(["f1.pdf", "1", "3"]);
    const last = strings.indexOf("f30.pdf");
    expect(strings.slice(last, last + 3)).toEqual(["f30.pdf", "1", "32"]);
  });

  it("does not throw on a title or file name Helvetica cannot encode", async () => {
    const built = await buildSubmittalPackage({ ...cover, title: "耐火 board — type X" }, [{ name: "日本語.pdf", bytes: await pdf(1, "A") }]);
    expect(built.bytes).not.toBeNull();
    expect(built.contents?.files[0].name).toBe("日本語.pdf");
  });
});

describe("the stored list", () => {
  const good = { files: [{ name: "a.pdf", pages: 3 }], totalPages: 4 };

  it("reads blank as no package, and round-trips a real list", () => {
    expect(parsePackageContents("")).toBeNull();
    expect(parsePackageContents(JSON.stringify(good))).toEqual(good);
  });

  it("refuses anything else at the form, and shows nothing for it on render", () => {
    for (const bad of ["{", "[]", "{}", '{"files":[],"totalPages":1}', JSON.stringify({ files: [{ name: "", pages: 1 }], totalPages: 1 }), JSON.stringify({ files: [{ name: "a", pages: 0 }], totalPages: 1 }), JSON.stringify({ files: [{ name: "a", pages: 1.5 }], totalPages: 1 }), JSON.stringify({ files: [{ name: "x".repeat(256), pages: 1 }], totalPages: 1 }), JSON.stringify({ files: Array(201).fill({ name: "a", pages: 1 }), totalPages: 1 })]) {
      expect(parsePackageContents(bad), bad).toBeUndefined();
    }
    expect(readPackageContents({ files: "x" })).toBeNull();
    expect(readPackageContents(null)).toBeNull();
  });

  it("keeps only names and page counts, dropping anything extra", () => {
    expect(parsePackageContents(JSON.stringify({ files: [{ name: "a.pdf", pages: 1, bytes: "AAAA" }], totalPages: 2 }))).toEqual({ files: [{ name: "a.pdf", pages: 1 }], totalPages: 2 });
  });

  it("summarises for the register", () => {
    expect(packageSummary({ files: [{ name: "a.pdf", pages: 3 }, { name: "b.pdf", pages: 1 }], totalPages: 5 })).toBe("2 files, 5 pages: a.pdf (3 p), b.pdf (1 p)");
    expect(packageSummary({ files: [{ name: "a.pdf", pages: 1 }], totalPages: 2 })).toBe("1 file, 2 pages: a.pdf (1 p)");
  });

  it("names the download after the job, submittal and revision", () => {
    expect(submittalPackageFileName({ jobName: "Riverside / Clinic", submittalNumber: 12, revisionNumber: 2 })).toBe("Riverside-Clinic-submittal-12-rev-2.pdf");
  });
});
