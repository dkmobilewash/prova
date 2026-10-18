import { describe, expect, it } from "vitest";
import { isHeld, pinCount, pinsOn, stillHeld, type HeldPin } from "./sheet-pin-display";
import type { SheetRow } from "./types";

/**
 * The rules that decide whether a foreman in a basement believes the app
 * saved anything.
 *
 * These are here rather than in a screen test because the screen harness can
 * read text and cannot tap, so none of this is reachable from there — and
 * "it looked right when I tried it" is not a check.
 */

// 42x30 — a D-size sheet. y runs 0..0.714, never 0..1.
function sheet(id: string, pins: SheetRow["pins"] = []): SheetRow {
  return {
    id,
    pageNumber: 1,
    label: "A-201",
    widthPt: 3024,
    heightPt: 2160,
    imageUrl: "https://blob.example/a201.png",
    imageWidthPx: 2000,
    setName: "Architectural",
    revisionLabel: "R2",
    pins,
  };
}

function serverPin(id: string, note: string | null) {
  return {
    id,
    x: 0.3,
    y: 0.2,
    kind: "NOTE" as const,
    note,
    mediaId: null,
    punchItemId: null,
    punchItemDescription: null,
  };
}

function heldPin(id: string, pageId: string, note: string): HeldPin {
  return { ...serverPin(id, note), pageId };
}

describe("a pin placed with no signal is on the drawing", () => {
  it("draws what the office has and what this phone is holding, as one list", () => {
    const page = sheet("pg_1", [serverPin("s1", "From the office")]);
    const shown = pinsOn(page, [heldPin("h1", "pg_1", "Just placed")]);
    expect(shown.map((pin) => pin.note)).toEqual(["From the office", "Just placed"]);
  });

  it("does not put another sheet's held pin on this one", () => {
    // The screen can be moved between sheets while the queue is still full.
    const page = sheet("pg_1");
    expect(pinsOn(page, [heldPin("h1", "pg_2", "Elsewhere")])).toHaveLength(0);
  });

  it("COUNTS a held pin on the tab, so the number moves when the tap registers", () => {
    // A number that does not move is how somebody decides the tap did nothing
    // and taps again — and no create is idempotent from the user's side.
    const page = sheet("pg_1", [serverPin("s1", "One")]);
    expect(pinCount(page, [])).toBe(1);
    expect(pinCount(page, [heldPin("h1", "pg_1", "Two")])).toBe(2);
  });

  it("knows which pins are still this phone's", () => {
    const held = [heldPin("h1", "pg_1", "Mine")];
    expect(isHeld("h1", held)).toBe(true);
    expect(isHeld("s1", held)).toBe(false);
  });
});

describe("letting go once the office has it", () => {
  it("stops holding a pin that has landed", () => {
    const after = stillHeld([sheet("pg_1", [serverPin("s1", "Hold this wall")])], [
      heldPin("h1", "pg_1", "Hold this wall"),
    ]);
    expect(after).toHaveLength(0);
  });

  it("keeps holding one that has not", () => {
    const after = stillHeld([sheet("pg_1", [serverPin("s1", "Something else")])], [
      heldPin("h1", "pg_1", "Hold this wall"),
    ]);
    expect(after).toHaveLength(1);
  });

  it("does not let the SAME WORDS on a DIFFERENT SHEET release it", () => {
    // The match is page AND words. Matching on words alone would drop a pin
    // the server has never seen, which is the one outcome this queue exists
    // to prevent.
    const after = stillHeld([sheet("pg_2", [serverPin("s1", "Hold this wall")])], [
      heldPin("h1", "pg_1", "Hold this wall"),
    ]);
    expect(after).toHaveLength(1);
  });

  it("keeps holding everything when the server has nothing yet", () => {
    const after = stillHeld([sheet("pg_1")], [heldPin("h1", "pg_1", "Hold this wall")]);
    expect(after).toHaveLength(1);
  });

  it("releases ONE held pin per landed pin, not all with the same words", () => {
    // THE BUG THIS TEST FOUND. The first version matched against a Set, so one
    // returning pin released every held pin with the same words on the same
    // sheet — silently dropping a pin the office had never seen, which is the
    // exact failure the queue exists to prevent. Two notes with identical
    // words are not a contrived case: "Patch here" twice on one sheet is a
    // normal morning.
    const after = stillHeld([sheet("pg_1", [serverPin("s1", "Same")])], [
      heldPin("h1", "pg_1", "Same"),
      heldPin("h2", "pg_1", "Same"),
    ]);
    expect(after, "one landed pin released both — an unsent pin was dropped").toHaveLength(1);
  });

  it("releases both once both have landed", () => {
    const after = stillHeld([sheet("pg_1", [serverPin("s1", "Same"), serverPin("s2", "Same")])], [
      heldPin("h1", "pg_1", "Same"),
      heldPin("h2", "pg_1", "Same"),
    ]);
    expect(after).toHaveLength(0);
  });
});
