/**
 * Every surface that draws annotation marks puts the photograph in the same
 * box, the same way. Issue #256.
 *
 * WHY THIS IS A SOURCE-TEXT TEST AND NOT A RENDERING ONE. A mark is stored
 * as a fraction of a 4:3 box with the photograph letterboxed inside it
 * (`JOB_MEDIA_MARK_BOX_ASPECT`). Whether a given surface honours that is a
 * question about LAYOUT, and this repo's unit environment does no layout at
 * all — `getBoundingClientRect` returns zeros in happy-dom, so a test that
 * rendered these components and measured them would agree with itself no
 * matter what the classes said. The geometry was settled by measurement in
 * real Chromium instead (the numbers are in `changelog.d` and on the
 * constant). What a laptop CAN check in a second is the two class-level
 * facts that measurement established, so that is what this checks.
 *
 * What went wrong without it: `JobMediaCard` and `PortalJobPhotos` cropped
 * the photograph to fill the box (`object-cover`) while the editor
 * letterboxed it into the same box, so the same fraction sat over a
 * different part of the picture on each. Nothing failed. Three comments
 * said the geometry was already handled, which is why it survived review —
 * a comment is not a check, and this file is the check.
 *
 * THE SET IS ASSERTED, NOT JUST ITS MEMBERS. The scan derives which files
 * render `<JobMediaMarks`, and a derived set has two failure modes: wrong,
 * and empty. Only the first looks like a failure. So the discovered paths
 * are compared against a literal list that cannot drift with the pattern —
 * a fifth surface fails here until somebody adds it deliberately, and a
 * pattern that matches nothing fails instead of passing vacuously.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

/** Every surface that may render marks, by hand. Adding one means measuring
 *  it, not editing this list to make the test pass. */
const EXPECTED_SURFACES = [
  "app/(app)/jobs/[id]/photo-report/page.tsx",
  "components/JobMediaAnnotator.tsx",
  "components/JobMediaCard.tsx",
  "components/PortalJobPhotos.tsx",
].sort();

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

/** Files that RENDER the overlay — the component's own file and the tests
 *  that mention it are excluded by looking for the JSX open tag. */
function surfaceFiles(): string[] {
  return sourceFiles(join(webRoot, "app"))
    .concat(sourceFiles(join(webRoot, "components")))
    .filter((f) => /<JobMediaMarks[\s/>]/.test(readFileSync(f, "utf8")))
    .map((f) => relative(webRoot, f))
    .sort();
}

function read(rel: string): string {
  return readFileSync(join(webRoot, rel), "utf8");
}

describe("the surfaces that render annotation marks", () => {
  it("is exactly the set that has been measured", () => {
    const found = surfaceFiles();
    expect(
      found,
      `The files rendering <JobMediaMarks> are not the ones this test knows about. A new surface has to put the photograph in a 4:3 box with object-contain or the marks land on the wrong part of it (issue #256) — measure it, then add it here.`,
    ).toEqual(EXPECTED_SURFACES);
  });

  it("found something at all, so an empty scan cannot pass every check below", () => {
    // The census guard from CLAUDE.md: a pattern matching nothing satisfies
    // every "none of them is wrong" assertion in this file.
    expect(surfaceFiles().length).toBe(4);
  });

  it("gives every one of them a 4:3 box", () => {
    const missing = EXPECTED_SURFACES.filter((rel) => !read(rel).includes("aspect-[4/3]"));
    expect(
      missing,
      `No aspect-[4/3] box in ${missing.join(", ")}. Marks are fractions of a 4:3 box; a box of any other ratio moves every mark already stored.`,
    ).toEqual([]);
  });

  it("letterboxes the photograph rather than cropping it, on all of them", () => {
    // `object-cover` is the whole of issue #256 — the box was right on all
    // four and the FIT was wrong on two. Checked as an absence across the
    // file rather than only on the photo element: these files render a
    // video and a voice note in the same box, and all of them are
    // object-contain, so a single cover anywhere is a regression.
    const cropping = EXPECTED_SURFACES.filter((rel) => read(rel).includes("object-cover"));
    expect(
      cropping,
      `object-cover in ${cropping.join(", ")}. A cropped photo in the mark box puts a different part of the picture under the same fraction — measured at 31px out on a 16:9 photo and 89px on a 3:4 one. Use object-contain.`,
    ).toEqual([]);

    const notContaining = EXPECTED_SURFACES.filter((rel) => !read(rel).includes("object-contain"));
    expect(notContaining, `No object-contain in ${notContaining.join(", ")}.`).toEqual([]);
  });

  it("lets nobody tell the overlay what ratio to use", () => {
    // The `aspect` prop was four callers restating one constant, and the
    // one that computed it was computing 4/3 from a 4:3 div while its
    // comment claimed it measured the photo.
    const passingAspect = EXPECTED_SURFACES.filter((rel) =>
      /<JobMediaMarks[^>]*\saspect=/.test(read(rel)),
    );
    expect(
      passingAspect,
      `${passingAspect.join(", ")} passes an aspect prop to JobMediaMarks. The ratio is JOB_MEDIA_MARK_BOX_ASPECT and the component owns it.`,
    ).toEqual([]);
  });

  it("keeps the editor's own measured surface the definition of the box", () => {
    // `pointAt` divides by this element's rect, so its ratio IS the stored
    // coordinate space. If it ever stops being the 4:3 box, every mark in
    // the database is silently re-aimed.
    const src = read("components/JobMediaAnnotator.tsx");
    const surface = src.match(/ref=\{surfaceRef\}[\s\S]{0,400}?className="([^"]*)"/);
    expect(surface, "could not find the annotator's surfaceRef element").not.toBeNull();
    expect(
      surface?.[1],
      "The annotator's measured surface must be the 4:3 box — pointAt divides by its rect.",
    ).toContain("aspect-[4/3]");
    expect(
      src.includes("aspectRatio:"),
      "The annotator declares its ratio with the same aspect-[4/3] class as every other surface, so one grep finds all four.",
    ).toBe(false);
  });
});
