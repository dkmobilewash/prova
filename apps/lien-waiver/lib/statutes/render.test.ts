import { describe, expect, it } from "vitest";
import { FORMS, fillable } from "./forms";
import { printedText, segmentForm, unfill, type Fills } from "./render";
import type { SlotId } from "./types";

/**
 * "A test fails if the rendered form text differs from the stored statutory
 * text by even one character, excluding the fill-in blanks."
 *
 * This is that test, for every one of the sixteen forms, three ways: with
 * nothing filled, with every blank filled, and with hostile fills that look
 * like the statute's own punctuation. The PDF test (lib/pdf.test.ts) makes
 * the same assertion of the text read back out of the file.
 */

const EVERY_FILL: Fills = {
  project: "Mesa Medical Office Building",
  jobNumber: "24-117",
  checkMaker: "Acme Builders Inc.",
  amount: "48,250.00",
  payee: "Desert Drywall LLC",
  owner: "Mesa Medical Partners LP",
  jobLocation: "1234 E Main St, Mesa, AZ 85203",
  jobDescription: "Interior framing and drywall, 1234 E Main St",
  customer: "Acme Builders Inc.",
  throughDate: "09/30/2026",
  disputedAmount: "3,100.00",
  signedDate: "10/08/2026",
  companyName: "Desert Drywall LLC",
  signature: "THIS MUST NEVER PRINT",
  signerTitle: "President",
  invoiceNumber: "PA-07",
  paymentPeriod: "09/01/2026 - 09/30/2026",
  priorWaiverDates: "08/31/2026",
  priorUnpaidAmounts: "12,000.00",
};

/** Fills built out of the characters the blanks themselves are made of. A
 * renderer that found its blanks by searching the PRINTED text would trip
 * over these. */
const HOSTILE: Fills = Object.fromEntries(
  Object.keys(EVERY_FILL).map((slot) => [slot, "___ ...... (owner) $"]),
) as Fills;

describe.each(FORMS.map((form) => [`${form.state} ${form.form}`, form] as const))("%s", (_name, form) => {
  const paragraphs = segmentForm(form);

  it("prints the statute's text exactly when nothing is filled in", () => {
    paragraphs.forEach((paragraph, i) => {
      const printed = printedText(paragraph, {}, fillable);
      // California labels print without their (empty) trailing blank, which
      // is the empty string -- so this holds for every style.
      expect(printed).toBe(form.paragraphs[i].text);
    });
  });

  it.each([
    ["every blank filled", EVERY_FILL],
    ["fills made of blank characters", HOSTILE],
  ] as const)("differs from the statute only in its blanks: %s", (_label, fills) => {
    paragraphs.forEach((paragraph, i) => {
      const printed = printedText(paragraph, fills, fillable);
      expect(unfill(paragraph, printed, fills, fillable)).toBe(form.paragraphs[i].text);
    });
  });

  it("puts every fillable value somewhere on the form, and never prints a signature", () => {
    const all = paragraphs.map((paragraph) => printedText(paragraph, EVERY_FILL, fillable)).join("\n");
    for (const ref of form.slots) {
      if (ref.slot === "signature") continue;
      expect(all, `${ref.slot} missing`).toContain(EVERY_FILL[ref.slot as SlotId]!);
    }
    expect(all).not.toContain("THIS MUST NEVER PRINT");
  });

  it("has a signature line, and a notice if it is unconditional", () => {
    expect(form.slots.some((ref) => ref.slot === "signature")).toBe(true);
    const unconditional = form.form.startsWith("UNCONDITIONAL");
    expect(form.paragraphs.some((paragraph) => paragraph.role === "notice")).toBe(
      // California prints a notice on all four; the other states only on the
      // unconditional forms.
      unconditional || form.state === "CA",
    );
  });
});

describe("unfill catches a changed character", () => {
  it("fails when a single statutory character differs", () => {
    const form = FORMS.find((candidate) => candidate.state === "TX" && candidate.form === "UNCONDITIONAL_FINAL")!;
    const paragraph = segmentForm(form).find((candidate) => printedText(candidate, {}, fillable).includes("The signer"))!;
    const original = printedText(paragraph, EVERY_FILL, fillable);
    const printed = original.replace("The signer", "The signor");
    // The control has to have changed something, or it proves nothing.
    expect(printed).not.toBe(original);
    expect(() => unfill(paragraph, printed, EVERY_FILL, fillable)).toThrow(/diverges/);
  });
});
