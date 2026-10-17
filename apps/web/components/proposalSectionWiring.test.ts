import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ── THE PANEL MUST ACTUALLY READ THE SECTIONS, AND NO TEST HERE RENDERS IT ──
 *
 * `proposalSections.test.ts` proves the grouping is right: order, indices,
 * unassigned last, a dangling id treated as unassigned. It says NOTHING about
 * whether the panel uses any of it.
 *
 * That gap is measured rather than assumed. With the heading forced to null —
 * the feature removed, every group back in one flat list — the whole suite
 * passed: **2,542 tests, green**. `TakeoffPlanViewer` is a pdf.js client
 * component that nothing in this repo renders, so the panel is invisible to
 * every instrument here. Same family as the `expo-router` entry in CLAUDE.md,
 * where three fixes shipped green and none of them rendered.
 *
 * So this is a source census, with the limits of one stated rather than
 * implied: it proves the wiring is PRESENT. It cannot prove the heading
 * appears above the right rows, and a person clicking is still the instrument
 * for that.
 *
 * It is mutation-tested against the two regressions that are actually
 * plausible here, because a census nobody has tried to break is decoration:
 *
 *   | mutation                                   | result     |
 *   | map reverted to `shownGroups.map(`          | RED, by name |
 *   | `heading:` forced to a constant null        | RED, by name |
 *
 * Both of those pass `tsc`, pass lint, and pass every other test in the repo.
 */

const VIEWER = resolve(__dirname, "TakeoffPlanViewer.tsx");

/**
 * Comments stripped, because this file's own prose quotes the very strings it
 * forbids — the #767 scar, twice paid in one file, and the reason
 * `clerkMountGate.test.ts` does the same.
 */
function code(): string {
  const raw = readFileSync(VIEWER, "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

describe("the found-walls panel reads its sections", () => {
  it("can see the viewer at all", () => {
    // The scope assertion. A census over a file it failed to read passes every
    // downstream check by having nothing to look at.
    expect(code().length).toBeGreaterThan(10_000);
    expect(code()).toContain("found-walls");
  });

  it("iterates the SECTIONED order, not the flat group list", () => {
    const source = code();
    expect(source).toMatch(/\bordered\.map\(/);
    // And the flat list is no longer rendered directly. `shownGroups` still
    // exists — `ordered` is built from it, and `FoundWalls` draws the overlay
    // from it — so this forbids only the panel's own iteration of it.
    expect(source).not.toMatch(/\bshownGroups\.map\(/);
  });

  it("builds that order from `proposalSections`, with headings decided by `showsHeadings`", () => {
    const source = code();
    expect(source).toContain("proposalSections(shownGroups, takeoffItems)");
    expect(source).toContain("showsHeadings(sections)");
  });

  it("sets the heading on the FIRST entry of a section and nowhere else", () => {
    // The mutation this exists for: `heading: null` removes the feature while
    // leaving every other line in place, and nothing else in the repo notices.
    expect(code()).toMatch(/heading:\s*withHeadings && within === 0 \? section : null/);
  });

  it("names the unassigned pile rather than drawing a nameless heading", () => {
    // A section with no item is the recoverable state `proposalMatch` produces
    // when it REFUSES a tie, and it has to say so on screen or it reads as
    // detection having missed those walls.
    expect(code()).toContain('heading.name ?? "Unassigned walls"');
  });

  it("passes the items in from the workspace, or the panel has nothing to group by", () => {
    // The prop exists on the viewer AND is handed over. Either half alone is
    // the "written, documented, and never called" shape from CLAUDE.md.
    expect(code()).toContain("takeoffItems");
    const workspace = readFileSync(resolve(__dirname, "TakeoffWorkspace.tsx"), "utf8");
    // `matchableItems`, not the raw items: an item stores the wall-type ID it
    // points at and the drawing prints that type's CODE, so the loader joins
    // the two. Handing the raw list over would leave every tag match dead
    // while every other assertion here still passed.
    expect(workspace).toContain("takeoffItems={data.matchableItems}");
  });
});
