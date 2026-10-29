import { describe, expect, it } from "vitest";
import { takeoffSheetVerdict } from "./takeoffSheet";

const verdict = (title: string, viewNames?: string[], sheetNumber = "A101") =>
  takeoffSheetVerdict({ sheetNumber, title, viewNames });

describe("whether a sheet is worth taking off", () => {
  it("offers a floor plan", () => {
    const got = verdict("LEVEL 1 FLOOR PLAN");
    expect(got.worthMeasuring).toBe(true);
    expect(got.why).toBeNull();
  });

  it("REFUSES A PARTITION TYPES SHEET, which is the convincing phantom", () => {
    // A wall type drawn in section is two parallel lines a wall-thickness
    // apart, repeated down the sheet — a textbook wall by every measurement
    // this repo takes, and hundreds of feet of it.
    const got = verdict("PARTITION TYPES", undefined, "A130");
    expect(got.worthMeasuring).toBe(false);
    expect(got.skipAutomatically).toBe(true);
    expect(got.why).toMatch(/no floor plan here/i);
  });

  it("refuses a details sheet", () => {
    const got = verdict("PLAN DETAILS", undefined, "A140");
    expect(got.worthMeasuring).toBe(false);
    expect(got.why).toMatch(/detail/i);
  });

  it("refuses elevations, sections and schedules by title", () => {
    for (const title of [
      "EXTERIOR ELEVATIONS",
      "BUILDING SECTIONS",
      "DOOR SCHEDULE",
      "REFLECTED CEILING PLAN",
      "LIFE SAFETY PLAN",
      "ROOF PLAN",
    ]) {
      expect(verdict(title).worthMeasuring, `${title} was offered`).toBe(false);
    }
  });

  it("refuses a sheet whose every DRAWING is captioned as something else", () => {
    // The title block may say nothing useful while the captions are explicit.
    const got = verdict("SHEET 12", [
      "RR 105 - EAST ELEV.",
      "RR 105 - SOUTH ELEV.",
      "WALL SECTION",
    ]);
    expect(got.worthMeasuring).toBe(false);
    expect(got.why).toMatch(/elevation/i);
  });

  it("A CAPTIONED PLAN BEATS A TITLE THAT SAYS OTHERWISE", () => {
    // The drawing is better evidence than the sheet's name: a DETAILS sheet
    // carrying an enlarged plan has a plan on it, and that plan is what
    // somebody opened the sheet for.
    const got = verdict("PLAN DETAILS", ["RESTROOM - ENLARGED PLAN", "WALL SECTION"], "A140");
    expect(got.worthMeasuring).toBe(true);
    expect(got.skipAutomatically).toBe(false);
  });

  it("says nothing about a title it does not recognise", () => {
    // Refusing here would quietly remove the feature from every sheet an
    // office names in its own shorthand.
    const got = verdict("SHEET 12 OF 40");
    expect(got.worthMeasuring).toBe(true);
    expect(got.why).toBeNull();
  });

  it("gives a reason a person can act on, never a bare flag", () => {
    // The viewer's own note: a control that disappears reads as "this feature
    // does not exist". The reason is what the tooltip says instead.
    const got = verdict("PARTITION TYPES", undefined, "A130");
    expect(got.why ?? "").toMatch(/[a-z]{4,}/);
    expect(got.why ?? "").not.toMatch(/^skipped$/i);
  });

  it("is advisory: a refusal still reports that a person may override", () => {
    // `worthMeasuring` false must not be read as "cannot". The caller keeps
    // the button; this only says not to invite the press or make it
    // automatically.
    const got = verdict("PARTITION TYPES", undefined, "A130");
    expect(got.skipAutomatically).toBe(true);
    expect(got).not.toHaveProperty("forbidden");
  });
});

describe("the sheet-only words — the pilot of 2026-10-29", () => {
  it("skips code, FF&E, ceiling, fire-protection, demolition and assemblies sheets automatically", () => {
    for (const [number, title] of [["G-101", "FIRST FLOOR CODE FOOTPRINT PLAN"], ["A-102", "OVERALL FIRST FLOOR FFE PLAN"], ["A111", "LEVEL 1 CEILING PLAN"], ["A-105", "LEVEL 1 DEMOLITION PLAN"], ["A601", "ROOF/CEILING/FLOOR ASSEMBLIES"], ["FP-101", "FIRE PROTECTION PLAN"]] as const) {
      const verdict = takeoffSheetVerdict({ sheetNumber: number, title });
      expect(verdict.skipAutomatically, `${number} ${title}`).toBe(true);
      expect(verdict.why, title).toMatch(/there is no floor plan here/);
    }
  });
  it("still offers a floor plan, and a captioned plan still beats the words", () => {
    expect(takeoffSheetVerdict({ sheetNumber: "A-101", title: "OVERALL FIRST FLOOR PLAN" }).skipAutomatically).toBe(false);
    expect(takeoffSheetVerdict({ sheetNumber: "A-102", title: "FFE PLAN", viewNames: ["ENLARGED PLAN"] }).skipAutomatically).toBe(false);
  });
});
