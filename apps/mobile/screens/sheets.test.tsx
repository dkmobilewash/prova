import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import type { SheetRow } from "@/lib/types";
import { deviceStore, goOffline } from "./setup";
import { mount } from "./render";

/**
 * A plan sheet on the phone, with pins on it.
 *
 * **READ WHAT THIS CAN AND CANNOT SEE FIRST.** These render in happy-dom,
 * which does no layout and returns zeros from `getBoundingClientRect`. So
 * nothing here can check that a pin lands where somebody tapped, that the
 * image fills the width, or that a 56pt button is 56pt. That is a phone or a
 * simulator's job, and CLAUDE.md's `expo-router` entry is the standing lesson
 * about mistaking a passing census for a working screen.
 *
 * What these DO pin is the part that is logic rather than pixels: the
 * coordinate a tap is stored as, the difference between "no sheets" and
 * "could not load", and a sheet nobody has prepared being SAID rather than
 * hidden.
 */

beforeEach(async () => {
  deviceStore.clear();
  await goOffline();
});

async function open() {
  const { default: Sheets } = await import("@/app/sheets/[jobId]");
  return mount(<Sheets />);
}

function cacheSheets(rows: unknown[]) {
  deviceStore.set("prova.cache.sheets.job_1", JSON.stringify({ rows, at: "2026-10-04T12:00:00.000Z" }));
}

// 42x30 — a D-size sheet, so `y` runs 0..0.714. A square fixture would let an
// axis mistake through, which is the whole defect this feature can have.
const SHEET: SheetRow = {
  id: "pg_1",
  pageNumber: 1,
  label: "A-201",
  widthPt: 3024,
  heightPt: 2160,
  imageUrl: "https://blob.example/a201.png",
  imageWidthPx: 2000,
  setName: "Architectural",
  revisionLabel: "R2",
  pins: [],
};

describe("what the sheet screen shows", () => {
  it("renders the pins' WORDS, not just dots on an image", async () => {
    // A mark on a drawing is a dot of colour and nothing else. The list under
    // it is where a pin says which kind it is and what it points at — the half
    // a colour cannot carry, and the half a screen reader gets.
    cacheSheets([
      {
        ...SHEET,
        pins: [
          { id: "p1", x: 0.4, y: 0.3, kind: "NOTE", note: "Hold this wall", mediaId: null,
            punchItemId: null, punchItemDescription: null },
          { id: "p2", x: 0.6, y: 0.5, kind: "PUNCH", note: null, mediaId: null,
            punchItemId: "pi_1", punchItemDescription: "Patch soffit at grid C" },
        ],
      },
    ]);
    const screen = await open();
    expect(screen.text()).toContain("Hold this wall");
    expect(screen.text()).toContain("Patch soffit at grid C");
    expect(screen.text()).toContain("Note");
    expect(screen.text()).toContain("Punch");
  });

  it("says a sheet is not ready rather than showing an empty frame", async () => {
    // A null imageUrl means nobody has prepared it at the office yet. Rendering
    // a blank box would read as a drawing with nothing on it.
    cacheSheets([{ ...SHEET, imageUrl: null, imageWidthPx: null }]);
    const screen = await open();
    expect(screen.text()).toMatch(/isn't ready for the phone/i);
  });

  it("tells 'no sheets' apart from 'could not load'", async () => {
    // The distinction every cached list screen keeps: a list that could not
    // load must never claim nothing is wrong.
    cacheSheets([]);
    expect((await open()).text()).toMatch(/no sheets yet/i);

    deviceStore.clear();
    vi.spyOn(api, "listSheets").mockRejectedValue(new Error("offline"));
    expect((await open()).text()).toMatch(/can't load|couldn't load/i);
  });

  it("names a pin whose target was deleted instead of dropping it", async () => {
    cacheSheets([
      {
        ...SHEET,
        pins: [{ id: "p1", x: 0.2, y: 0.2, kind: "PUNCH", note: null, mediaId: null,
                 punchItemId: null, punchItemDescription: null }],
      },
    ]);
    expect((await open()).text()).toMatch(/was removed/i);
  });
});
