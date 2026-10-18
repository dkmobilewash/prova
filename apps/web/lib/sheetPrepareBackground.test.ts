import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PREPARING A DRAWING SET MUST SURVIVE THE USER LOOKING AT ANOTHER TAB.
 *
 * pdf.js schedules each chunk of a render with `requestAnimationFrame`, and a
 * hidden tab never fires one — so the render stops dead and never resumes.
 * From the installed pdfjs-dist 4.10.38, not from memory:
 *
 *   useRequestAnimationFrame: !intentPrint              (pdf.mjs:16971)
 *   _scheduleNext() { this._useRequestAnimationFrame
 *       ? window.requestAnimationFrame(...)             // frozen when hidden
 *       : Promise.resolve().then(this._nextBound) }     // a microtask
 *
 * So `intent: "print"` is the switch, and it has nothing to do with printing.
 *
 * **Measured, not feared.** On 2026-10-05, preparing a real 113-sheet set
 * froze on sheet 17: `document.visibilityState` was `"hidden"` and a probe
 * `requestAnimationFrame` did not fire within four seconds. The button still
 * read *"Preparing sheet 17 of 113…"*, so it looked like it was working — the
 * failure mode this repo cares most about.
 *
 * It matters because of how long the job is. Half an hour on a real set means
 * nobody watches the tab, so without this the feature does not complete for
 * anybody, ever.
 *
 * **Nothing else here can see it.** No test in this repo renders a PDF or has
 * a tab to hide; typecheck, lint and a full build are green either way.
 */

const SURFACE = join(__dirname, "..", "components", "SheetPinSurface.tsx");

function code(): string {
  return readFileSync(SURFACE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("sheet preparation keeps going in a background tab", () => {
  it("renders every sheet with the print intent", () => {
    const text = code();
    const renders = text.match(/\.render\(\{[^}]*\}\)/g) ?? [];

    // Size assertion first: a census that parses nothing passes everything.
    expect(renders.length, "no pdf.js render call found — this census is guarding nothing").toBe(1);

    expect(
      renders[0],
      'the sheet render dropped intent: "print". pdf.js then schedules on requestAnimationFrame, ' +
        "which never fires in a hidden tab — preparation freezes mid-set while the button still " +
        'says "Preparing sheet N of M…". Measured: froze on sheet 17 of 113 on 2026-10-05.',
    ).toMatch(/intent:\s*"print"/);
  });

  it("keeps the explanation, so the intent is not tidied away as a printing mistake", () => {
    // `intent: "print"` on something nobody prints reads like a copy-paste
    // error. Without the reason beside it, the next person removes it and the
    // job silently stops finishing again.
    expect(
      readFileSync(SURFACE, "utf8"),
      "the print intent no longer explains itself — it reads as a mistake and will be removed",
    ).toMatch(/requestAnimationFrame/);
  });
});
