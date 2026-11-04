import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
// Plain .mjs so `node scripts/add-plan-sets.mjs` runs it bare; tested from
// here because this is where vitest lives (same as seed-company-target).
import { readPlanPageCount } from "../scripts/plan-page-count.mjs";

/** A made-up three-page PDF whose trailer names an /Encrypt dictionary — the owner-encrypted shape, no real plan. */
async function ownerEncrypted(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i += 1) doc.addPage([612, 792]);
  doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: "Standard", V: 1, R: 2, P: -44 }));
  return doc.save({ useObjectStreams: false });
}

describe("reading a plan set's page count for the ingest", () => {
  it("the fixture really is encrypted: pdf-lib's default load refuses it", async () => {
    await expect(PDFDocument.load(await ownerEncrypted())).rejects.toThrow(/encrypted/i);
  });

  it("counts the pages of an owner-encrypted set instead of throwing", async () => {
    expect(await readPlanPageCount(await ownerEncrypted())).toEqual({ ok: true, pageCount: 3 });
  });

  it("returns the reason for a file that is not a PDF at all, never a throw", async () => {
    const read = await readPlanPageCount(new TextEncoder().encode("not a pdf"));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason.length).toBeGreaterThan(0);
  });

  it("the ingest script counts through it and reports NOT READY rather than dying", () => {
    const code = readFileSync(new URL("../scripts/add-plan-sets.mjs", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toContain("readPlanPageCount(bytes)");
    expect(code).not.toMatch(/PDFDocument\.load/);
    expect(code).toMatch(/if \("unreadable" in one\) \{[\s\S]{0,200}?NOT READY[\s\S]{0,120}?continue;/);
  });
});
