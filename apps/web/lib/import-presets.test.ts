import { describe, expect, it } from "vitest";
import { IMPORT_PRESETS, matchPreset, presetMapping } from "./import-presets";

/**
 * Preset DETECTION only — whether a file's headers earn the "looks like
 * vendor X" banner, and whether a detected preset resolves to the right
 * column indexes. The header text itself (`fieldHeaders`) is vendor
 * knowledge read off Sage 100 Contractor's own documentation; see the
 * sourcing note on `IMPORT_PRESETS` in ./import-presets.ts. This file does
 * not re-verify that text is correct, only that the matching MACHINERY
 * behaves — the same separation lib/spreadsheet-import.test.ts keeps
 * between "the parser works" and "the alias words are sensible".
 */

describe("matchPreset", () => {
  it("detects the Sage 100 Contractor job list from its own two verified headers", () => {
    const preset = matchPreset("jobs", ["Job Name", "Client", "Contract Amount"]);
    expect(preset?.id).toBe("sage100contractor-jobs");
  });

  it("detects case- and punctuation-insensitively, in any column order", () => {
    const preset = matchPreset("jobs", ["client", "JOB NAME", "Notes"]);
    expect(preset?.id).toBe("sage100contractor-jobs");
  });

  it("does NOT detect on one matching header alone — below minMatches", () => {
    // "Client" alone is any CRM's export; on its own it must not claim a
    // specific vendor.
    expect(matchPreset("jobs", ["Client", "Amount"])).toBeNull();
    expect(matchPreset("jobs", ["Job Name", "Amount"])).toBeNull();
  });

  it("does not detect a preset for the wrong kind, even with the right headers", () => {
    expect(matchPreset("clients", ["Job Name", "Client"])).toBeNull();
    expect(matchPreset("crew", ["Job Name", "Client"])).toBeNull();
  });

  it("detects the Sage 100 Contractor cost-code list from Cost Code# and Description", () => {
    const preset = matchPreset("costCodes", ["Cost Code#", "Description", "Unit", "Division"]);
    expect(preset?.id).toBe("sage100contractor-costcodes");
  });

  it("finds nothing on headers that share no vocabulary with any preset", () => {
    expect(matchPreset("jobs", ["Project Title", "Owner", "Whatever"])).toBeNull();
    expect(matchPreset("costCodes", ["Number", "Text"])).toBeNull();
  });

  it("ships no preset for Foundation Software — unverified, so none is offered (see the note in import-presets.ts)", () => {
    expect(IMPORT_PRESETS.some((p) => /foundation/i.test(p.vendorLabel))).toBe(false);
  });
});

describe("presetMapping", () => {
  it("resolves a preset's known headers to THIS file's actual column indexes", () => {
    const preset = matchPreset("jobs", ["Contract#", "Client", "Job Name"])!;
    expect(preset).toBeTruthy();
    const mapping = presetMapping(preset, ["Contract#", "Client", "Job Name"]);
    expect(mapping).toEqual({ client: 1, name: 2 });
  });

  it("leaves out a preset field this particular file doesn't have", () => {
    const preset = IMPORT_PRESETS.find((p) => p.id === "sage100contractor-jobs")!;
    // "Job Name" is missing from this header row, even though it's what
    // triggered detection on a different file.
    const mapping = presetMapping(preset, ["Client", "Address 1"]);
    expect(mapping).toEqual({ client: 0 });
  });
});

describe("every preset's minMatches is achievable and meaningful", () => {
  for (const preset of IMPORT_PRESETS) {
    it(`${preset.id}: minMatches does not exceed how many headers it actually names`, () => {
      const named = Object.keys(preset.fieldHeaders).length;
      expect(named).toBeGreaterThan(0);
      expect(preset.minMatches).toBeGreaterThan(0);
      expect(preset.minMatches).toBeLessThanOrEqual(named);
    });

    it(`${preset.id}: detects when exactly minMatches of its headers are present, not fewer`, () => {
      const headers = Object.values(preset.fieldHeaders) as string[];
      const short = headers.slice(0, preset.minMatches - 1);
      const enough = headers.slice(0, preset.minMatches);
      if (short.length > 0) {
        expect(matchPreset(preset.kind, short)?.id).not.toBe(preset.id);
      }
      expect(matchPreset(preset.kind, enough)?.id).toBe(preset.id);
    });
  }
});
