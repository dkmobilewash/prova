import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pinContentProblem, type SheetPinKind } from "./sheet-pins";

/**
 * EVERY PIN KIND THE SCREEN OFFERS MUST SEND WHAT THE ACTION DEMANDS.
 *
 * This is the defect that shipped and sat there: the viewer rendered three
 * buttons — photo, punch, note — and `save()` sent `kind`, `x`, `y` and (for a
 * note) the text. `pinContentProblem` refuses a PHOTO pin without a `mediaId`
 * and a PUNCH pin without a `punchItemId`, and nothing ever sent either. **Two
 * of the three buttons could not succeed on any click**, and every check in
 * this repo was green: typecheck, 9,000 tests, lint, a full production build,
 * and the e2e journey, which never clicks them.
 *
 * It is the family this repo keeps meeting from new angles. A completeness
 * test proves the shared list is whole; a scope test proves the walk reaches
 * every file. **Neither can notice two pieces of code that disagree.** So this
 * asserts the CONTRACT between them: the rule module says what each kind
 * needs, the component is read for what it sends, and the two must match.
 *
 * The decisive mutation is to delete a `data.set(...)` line — which is exactly
 * what the broken version looked like, and it goes red here.
 */

const VIEWER = join(__dirname, "..", "components", "SheetPinViewer.tsx");

function code(): string {
  return readFileSync(VIEWER, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** What the rule module demands of each kind, derived by ASKING it rather than
 * by restating it here — a second copy of the rule would drift from the first
 * and this test would then be guarding the copy. */
function requiredField(kind: SheetPinKind): "mediaId" | "punchItemId" | "note" | null {
  const nothing = pinContentProblem(kind, { mediaId: null, punchItemId: null, note: null });
  if (!nothing) return null;
  for (const field of ["mediaId", "punchItemId"] as const) {
    if (!pinContentProblem(kind, { [field]: "x" })) return field;
  }
  if (!pinContentProblem(kind, { note: "something" })) return "note";
  throw new Error(`${kind} refuses every single-field attempt — this helper no longer models the rule`);
}

describe("the sheet pin screen sends what the action requires", () => {
  const text = code();

  /** The kinds the screen actually offers, read from the screen. */
  const offered = (text.match(/\(\["PHOTO", "PUNCH", "NOTE"\] as const\)/) ? ["PHOTO", "PUNCH", "NOTE"] : []) as SheetPinKind[];

  it("offers the three kinds, so this census is not guarding a screen that changed", () => {
    // Size and scope: if the button list is rewritten, this test must fail
    // loudly rather than silently check nothing.
    expect(offered, "the kind buttons are not where this census thinks they are").toEqual(["PHOTO", "PUNCH", "NOTE"]);
  });

  for (const kind of ["PHOTO", "PUNCH", "NOTE"] as SheetPinKind[]) {
    it(`sends the field a ${kind} pin cannot be saved without`, () => {
      const field = requiredField(kind);
      if (field === null) return; // a kind that needs nothing extra
      expect(
        text,
        `a ${kind} pin is refused without "${field}", and the screen never sets it. That button cannot ` +
          "succeed on any click — which is exactly how photo and punch shipped broken, with every check green.",
      ).toMatch(new RegExp(`data\\.set\\("${field}"`));
    });
  }

  it("ENFORCES the rule on the server, not only in the screen", () => {
    // Found by mutation while writing this file: deleting the action's
    // `pinContentProblem` call left the WHOLE suite green. A Server Action
    // answers whoever posts to it, so the screen sending the right fields is
    // a convenience and the action checking them is the actual rule. Both
    // halves need pinning or the pair can drift apart again, which is the
    // defect this whole file exists for.
    const action = readFileSync(join(__dirname, "actions", "sheetPins.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // PER ACTION, NOT PER FILE. The first draft matched the whole file, and a
    // mutation removing the placement check from `createSheetPin` stayed GREEN
    // because `createPunchItemAtPin` calls it too. A rule enforced somewhere
    // in a file is not a rule enforced where it matters.
    const bodies: Record<string, string> = {};
    for (const name of ["createSheetPin", "createPunchItemAtPin"]) {
      const start = action.indexOf(`export async function ${name}(`);
      expect(start, `${name} is gone — this census is guarding nothing`).toBeGreaterThan(-1);
      const next = action.indexOf("export async function ", start + 1);
      bodies[name] = action.slice(start, next === -1 ? undefined : next);
    }

    expect(
      bodies.createSheetPin,
      "createSheetPin no longer checks what the pin points at. A photo pin with no photo would be " +
        "accepted by anything that posts to the action directly.",
    ).toMatch(/pinContentProblem\(/);
    for (const [name, body] of Object.entries(bodies)) {
      expect(body, `${name} no longer refuses a pin placed off the sheet`).toMatch(/pinPlacementProblem\(/);
    }
  });

  it("raises a new punch item through the action that also pins it", () => {
    // Two calls would leave an item with no pin whenever the second failed,
    // and nobody goes back and tidies that.
    expect(text, "raising an item at a point no longer goes through one action").toMatch(
      /createPunchItemAtPin\(page\.id,/,
    );
  });
});
