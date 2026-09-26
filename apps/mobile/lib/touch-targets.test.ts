import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hitTarget, hitTargetPrimary } from "./theme";

/**
 * Every control a gloved thumb has to hit is at least `hitTarget` tall.
 *
 * The floor moved from Apple's 44 to **48** on 2026-09-26 (Diego): these
 * users are in gloves and Android's own floor is 48dp, so 44 — the
 * smallest target a bare fingertip can hit on a phone held still — is
 * not the posture this app is used in. Primary actions run to
 * `hitTargetPrimary`.
 *
 * WHY A TEST AND NOT A CODE REVIEW. Nothing else here can see it: a
 * screen test renders in happy-dom, which does no layout and returns
 * zeros from `getBoundingClientRect`, so a 38pt row and a 48pt one are
 * the same DOM. The same blind spot shipped a 1.35-POINT line height on
 * five screens. This is a source census for the same reason the radius
 * and gap censuses are.
 *
 * What it can and cannot see, stated plainly: it reads the height a
 * component DECLARES. A component that declares nothing and inherits its
 * height from padding is invisible to it, which is why the parse is
 * pinned to the set of components that render a `Pressable` and the
 * count of those is asserted.
 */

const COMPONENTS = join(__dirname, "..", "components");

/**
 * Pressable components that do NOT declare their own height, with the
 * reason each is allowed to. Anything here is a decision; anything
 * missing from here is a bug.
 */
const NO_OWN_HEIGHT: Record<string, string> = {
  "PressableScale.tsx": "a press ANIMATION wrapper — it has no box of its own and takes the child's",
  "SyncStatus.tsx": "a status line that is tappable, sized by the row it sits in",
  "Sheet.tsx": "a modal container; the 5pt declaration is its grab handle, not a target",
  "SignaturePad.tsx": "a drawing surface — the target IS the paper, 160pt tall",
  "FloatingCaptureButton.tsx": "declares 56 directly: a circle, where width and height are one decision",
};

/**
 * NOT YET MIGRATED — emptied by PR 2 (Dynamic Type + touch targets).
 * Each entry is a real defect with a real user behind it, not a
 * whitelist: the reason says what has to be DECIDED, because in both
 * cases a bigger number alone is the wrong fix.
 */
const DEBT: Record<string, string> = {
  "DateField.tsx":
    "the calendar day cell is 38pt in a 7-column grid — going to 48 makes the month 60pt taller, which is a layout decision rather than a number (PR 2)",
  "JobSections.tsx":
    "the in-page tab strip hardcodes 44 rather than the token; it is a scrolling strip where 48 costs vertical room on every job screen (PR 2)",
};

function componentFiles(): string[] {
  return readdirSync(COMPONENTS)
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((f) => join(COMPONENTS, f))
    .filter((f) => statSync(f).isFile());
}

describe("what a gloved thumb has to hit", () => {
  it("holds the floor at 48 and primary at 56", () => {
    // The numbers themselves, so that "raise the floor" cannot quietly
    // become "lower it" in a refactor.
    expect(hitTarget).toBeGreaterThanOrEqual(48);
    expect(hitTargetPrimary).toBeGreaterThanOrEqual(56);
  });

  it("declares at least the floor on every pressable component", () => {
    const pressables = componentFiles().filter((f) => readFileSync(f, "utf8").includes("<Pressable"));
    // A walk that stopped matching would pass every assertion below.
    expect(pressables.length, "no pressable components found at all").toBeGreaterThan(6);

    const offenders: string[] = [];
    for (const file of pressables) {
      const name = file.slice(COMPONENTS.length + 1);
      if (NO_OWN_HEIGHT[name] || DEBT[name]) continue;
      const text = readFileSync(file, "utf8");

      // `hitTarget`/`hitTargetPrimary` by name are correct by
      // construction; a literal has to clear the floor on its own.
      const named = /(minHeight|height): hitTarget(Primary)?\b/.test(text);
      const literals = [...text.matchAll(/minHeight: (\d+)/g)].map((m) => Number(m[1]));
      const ok = named || (literals.length > 0 && literals.every((h) => h >= hitTarget));
      if (!ok) offenders.push(`${name}${literals.length ? ` (${literals.join(", ")})` : " (declares no height)"}`);
    }

    expect(
      offenders,
      `these are below the ${hitTarget}pt floor, or declare no height and are not in a list: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps both lists honest — every entry exists and still needs to be there", () => {
    for (const [name, reason] of Object.entries({ ...NO_OWN_HEIGHT, ...DEBT })) {
      const text = readFileSync(join(COMPONENTS, name), "utf8");
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(20);
      expect(text.includes("<Pressable"), `${name} no longer has a pressable — drop the entry`).toBe(true);
    }
  });

  it("names the debt rather than hiding it", () => {
    // Deliberately asserts the debt is SMALL and known, not that it is
    // zero: PR 1 raises the floor, PR 2 empties this. A silent whitelist
    // is how a floor stops being a floor.
    expect(Object.keys(DEBT).length).toBeLessThanOrEqual(2);
  });
});
