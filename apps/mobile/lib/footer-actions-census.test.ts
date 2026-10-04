import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE BOTTOM ACTION BAR HAS EXACTLY ONE IMPLEMENTATION, AND SOMETHING CALLS IT.
 *
 * On 2026-09-26 the app ran on a real iPhone for the first time and the Time
 * screen's primary action — "Log time", the thing the screen exists for —
 * rendered **40pt wide with no visible label**, under the 48pt floor this repo
 * enforces on every other control. Three screens had each hand-rolled the same
 * footer out of the same three styles:
 *
 *     footerRow:  { flexDirection: "row", gap: 8, alignItems: "center" }
 *     footerMain: { flex: 1 }
 *
 * React Native defaults `flexShrink` to 0, so intrinsically-sized secondaries
 * keep their width and the `flex: 1` primary absorbs the entire deficit. With
 * ONE secondary (photos, reports) it is fine, and both were confirmed fine on
 * the device. With TWO (time) the primary is crushed. The pattern was never
 * wrong; it had a capacity nobody had named, and nothing anywhere said so.
 *
 * THIS FILE IS THE SECOND OF THE TWO GUARDS CLAUDE.md ASKS FOR. A test that
 * `FooterActions` lays out correctly proves the shared thing is right; it
 * cannot see a screen that stopped using it, because *nothing is ever missing
 * from a list nobody imports*. So this one asks the other question — **is
 * there a second implementation** — and the discriminator is free: a style key
 * named `footerRow` or `footerMain` is the signature of a hand-rolled bar,
 * because the component now owns those names and no caller needs them.
 *
 * WHAT IT CANNOT SEE, said plainly: it reads source text, so it cannot tell
 * you any button's width. Nothing here can — the screen suite renders in
 * happy-dom, which does no layout and returns zeros from
 * `getBoundingClientRect`, the same blindness that shipped a 1.35-POINT line
 * height on five screens. The 40pt came off a phone. This is a COUNT standing
 * in for a width, exactly as `rowActionsCensus.test.ts` caps a delete label at
 * 12 characters and says so.
 */

const ROOTS = [join(__dirname, "..", "app"), join(__dirname, "..", "components")];
const MOBILE = join(__dirname, "..");

/** The component that owns the layout, and the only file allowed to name it. */
const OWNER = "components/FooterActions.tsx";

/**
 * Screens that render a bottom action bar. Their presence in the walk is the
 * SCOPE control — `app/time/[jobId].tsx` is two directories deep, and the one
 * file that carried the defect is exactly the one a non-recursive walk would
 * miss. A census that cannot reach the bug is not a census.
 */
const KNOWN_CALLERS = ["app/time/[jobId].tsx", "app/photos/[jobId].tsx", "app/reports/[jobId].tsx"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx") && !full.includes(".test.")) out.push(full);
  }
  return out;
}

function sources(): { path: string; text: string }[] {
  return ROOTS.flatMap(walk).map((path) => ({
    path: relative(MOBILE, path),
    text: readFileSync(path, "utf8"),
  }));
}

describe("the bottom action bar", () => {
  it("scans a set that actually contains the screens it is about", () => {
    // The size-and-scope assertion, and it is not decoration. A pattern that
    // matches nothing passes every assertion below it, because nothing is ever
    // missing from an empty list. Both roots must exist and the walk must
    // reach two levels down.
    const found = sources().map((s) => s.path);
    expect(found.length, "the walk returned no files at all — the roots moved").toBeGreaterThan(20);
    for (const caller of [...KNOWN_CALLERS, OWNER]) {
      expect(found, `${caller} was not in the scanned set, so nothing below this can see it`).toContain(caller);
    }
  });

  it("has exactly one implementation — nobody hand-rolls the row", () => {
    const offenders = sources()
      .filter((s) => s.path !== OWNER)
      .filter((s) => /\bfooter(Row|Main)\b/.test(s.text))
      .map((s) => s.path);
    expect(
      offenders,
      `These lay out their own bottom bar: ${offenders.join(", ")}. That is how "Log time" ` +
        `shipped 40pt wide — the pattern holds at one secondary and crushes the primary at two. ` +
        `Use <FooterActions>, which decides the capacity for you.`,
    ).toEqual([]);
  });

  it("is actually called, rather than written and admired", () => {
    // "Written, documented, and never called" is a recurring shape in this
    // repo. A component nothing imports is dead code that typechecks.
    const callers = sources()
      .filter((s) => s.path !== OWNER)
      .filter((s) => s.text.includes("<FooterActions"))
      .map((s) => s.path);
    for (const caller of KNOWN_CALLERS) {
      expect(callers, `${caller} no longer renders <FooterActions>`).toContain(caller);
    }
  });

  it("keeps the capacity decision in the component, where a caller cannot get it wrong", () => {
    // The whole point of the extraction: the number of secondaries decides the
    // layout, and that decision lives in one place. If this literal moves, the
    // rendering test in `screens/footer-actions.test.tsx` is what proves the
    // behaviour — this only proves the decision is still the component's.
    const owner = readFileSync(join(MOBILE, OWNER), "utf8");
    expect(
      owner,
      "FooterActions no longer branches on how many secondaries it was given, so every " +
        "caller is back to being responsible for a capacity nothing tells them about",
    ).toMatch(/secondary\.length\s*>\s*1/);
  });
});
