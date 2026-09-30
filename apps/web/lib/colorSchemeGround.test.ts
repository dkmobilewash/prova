/**
 * THE BROWSER PAINTS CONTROLS TOO, AND FOR A MONTH IT WAS PAINTING THEM FOR
 * A LIGHT PAGE.
 *
 * THE DEFECT. `globals.css` had no `color-scheme`, so every control the
 * BROWSER draws — rather than our CSS — kept its light-mode appearance on a
 * page whose ground is `#0f0f0f`. Measured in real Chromium, the calendar
 * glyph on `<input type="date">` is painted `#000000`: **1.1:1 against the
 * field it sits on**, where this project's own UI rules set 3:1 as the floor
 * for non-text. Not dim — indistinguishable. The pick-a-date button on 112
 * date fields was rendering the whole time and could not be seen.
 *
 * WHY NO TEST IN THIS REPO COULD HAVE FOUND IT, which is the honest frame
 * for what this file does and does not do. The screen suite renders in
 * happy-dom, which does no layout and no painting; `theme-contrast.test.ts`
 * reads OUR colour pairs out of OUR class strings, and this glyph is in a
 * shadow root we never wrote. The measurement came from screenshotting the
 * control in real Chromium and sampling pixels, and it is recorded in
 * `globals.css` beside the fix rather than here, because a number a test
 * cannot re-derive belongs next to the code it justifies.
 *
 * So this file does not measure contrast. It holds the two things that make
 * an UNCONDITIONAL declaration correct, and they are what a later sweep
 * would break:
 *
 *   ONE — the declaration exists, at `:root`, and says `dark`. A fix nothing
 *   asserts is this repo's "written, documented, and never called" shape
 *   wearing a stylesheet.
 *
 *   TWO — THE DIFFERENTIAL, and the reason a root declaration is not a
 *   sweep. Five printable documents in this app sit on white paper: WH-347,
 *   DAS-140, DAS-142, the photo report, the union remittance, the pay
 *   application. Each is a white CARD inside the dark shell rather than a
 *   white PAGE, and each has zero browser-painted controls — so nothing on
 *   them is reached by a declaration about controls. Put a date field on one
 *   and `color-scheme: dark` would paint a dark-mode control on paper going
 *   to a GC or the state. This test fails then, naming the file, instead of
 *   the document going out looking wrong.
 *
 * Comments are stripped before every structural read, and that is
 * load-bearing rather than ritual here: the fix's own comment block in
 * `globals.css` spells `color-scheme: dark` while explaining it, so a
 * raw-text read would pass on a stylesheet where the declaration had been
 * commented out — the #185 shape, and the exact mutation checked below.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../tailwind.config";

const appDir = fileURLToPath(new URL("..", import.meta.url));

/** CSS comments out. There is no `//` form in a stylesheet, so one
 * expression is the whole of it. */
const withoutCssComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

/** TSX comments out — both forms, `:` guarded so a `https://` in a string
 * is not read as the start of one. Same pair `theme-contrast.test.ts` uses. */
const withoutTsComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Every control whose appearance the BROWSER owns, not our CSS. `text`,
 * `email`, `tel` and `password` are deliberately absent: they are a box we
 * paint entirely, which is why the probe used one as its negative control. */
const BROWSER_PAINTED =
  /type=\{?["'`](date|datetime-local|time|month|week|number|file|checkbox|radio|range|color)["'`]|<select[\s>]/g;

/** The light grounds this app actually uses, enumerated rather than guessed
 * at across the whole Tailwind scale: `bg-white` and `bg-slate-100` are the
 * only two present, and a ground that is not here is not a ground this
 * check has ever seen. A new one shows up as an unlisted class rather than
 * as silence, because the count assertion below is over FILES rather than
 * over this pattern. */
const LIGHT_GROUND = /\bbg-(?:white|(?:slate|gray|neutral|zinc|stone)-(?:50|100|200))\b/;

/** Every .tsx whose classes reach the app, roots derived from Tailwind's
 * `content` for the reason `theme-contrast.test.ts` spells out at length:
 * nothing is ever missing from a directory you do not walk. */
function componentFiles(): string[] {
  const globs = (Array.isArray(config.content) ? config.content : []) as string[];
  const roots = globs.map((glob) => {
    const star = glob.indexOf("*");
    return resolve(appDir, star === -1 ? glob : glob.slice(0, star));
  });

  expect(
    roots.length,
    "tailwind.config.ts declares no `content` globs, so this census would scan " +
      "nothing and pass everything below it",
  ).toBe(globs.length);
  expect(roots.length).toBeGreaterThanOrEqual(3);
  for (const root of roots) {
    expect(
      statSync(root, { throwIfNoEntry: false })?.isDirectory() ?? false,
      `${root} is a content glob root that does not exist — a root resolving to ` +
        "nothing removes files from this check without removing them from the build",
    ).toBe(true);
  }

  const walk = (dir: string, out: string[] = []) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (name.endsWith(".tsx")) out.push(full);
    }
    return out;
  };
  return roots.flatMap((root) => walk(root));
}

/** Memoised, and called INSIDE a test rather than at module scope.
 *
 * The first version ran `componentFiles()` while the module loaded, so a
 * `content` glob pointing at a directory that does not exist failed
 * COLLECTION — vitest printed `no tests` and the run was red with nothing
 * naming the cause. That is the shape CLAUDE.md refuses outright: a check
 * whose failure is indistinguishable from never having run. Now the scope
 * assertions belong to a test with a message. */
let cached: string[] | null = null;
const files = () => (cached ??= componentFiles());

const globalsCss = withoutCssComments(
  readFileSync(resolve(appDir, "app/globals.css"), "utf8"),
);

describe("the browser's own controls follow the page", () => {
  it("declares color-scheme: dark at :root, in a declaration rather than a comment", () => {
    // `:root` specifically, not `body`: the scrollbar and the form controls
    // are resolved against the ROOT element's computed value, and a
    // declaration on `body` leaves the canvas out of it.
    const rootBlocks = [...globalsCss.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(
      rootBlocks.length,
      "globals.css declares no `:root` block at all, so this test is parsing nothing",
    ).toBeGreaterThan(0);

    const declared = rootBlocks.filter((body) => /color-scheme\s*:\s*dark\b/.test(body));
    expect(
      declared.length,
      "No `:root { color-scheme: dark }` in globals.css. Without it the browser " +
        "paints its own controls for a LIGHT page on this app's #0f0f0f ground — " +
        "measured, the date field's calendar glyph is #000000 at 1.1:1, which is " +
        "invisible rather than merely dim. Comments are stripped before this read, " +
        "so the paragraph in globals.css explaining the fix cannot satisfy it.",
    ).toBe(1);
  });

  it("declares it once, and never declares the opposite", () => {
    // The "is there a second one" half. A per-component `color-scheme:
    // light` would be a second, quieter answer to the same question, free to
    // disagree with the root — and the way this gets undone is somebody
    // adding one to make a single white card look right.
    // Captured plainly and filtered in JS rather than with a negative
    // lookahead: `(?!dark\b)` after `\s*` lets the engine backtrack onto the
    // space and match ` dark`, so the first version of this line reported the
    // correct declaration as an offender. A clever pattern that is wrong
    // about its own subject is worse than a dull one.
    const values = [...globalsCss.matchAll(/color-scheme\s*:\s*([a-z-]+)/g)].map((m) => m[1]);
    expect(
      values.length,
      "no color-scheme declaration parsed at all, so this test is about nothing",
    ).toBeGreaterThan(0);
    const light = values.filter((value) => value !== "dark");
    expect(
      light,
      `globals.css declares color-scheme ${light.join(", ")} as well as dark. ` +
        "This app has no light mode — no `darkMode` in tailwind.config.ts and no " +
        "`data-theme` anywhere — so a second value is a disagreement, not a variant.",
    ).toEqual([]);

    const inComponents = files()
      .filter((full) => /colorScheme|color-scheme/.test(withoutTsComments(readFileSync(full, "utf8"))))
      .map((full) => relative(appDir, full));
    expect(
      inComponents,
      `${inComponents.join(", ")} sets a color scheme of its own. One declaration, ` +
        "at :root in globals.css — see its comment for why unconditional is a fact " +
        "about this app rather than a shortcut.",
    ).toEqual([]);
  });

  it("keeps every browser-painted control off the white printable documents", () => {
    // THE DIFFERENTIAL. This is what makes the root declaration safe: a
    // control the browser paints dark, on paper, going to a GC or the state.
    const offenders: string[] = [];
    const dateFiles: string[] = [];
    let withControls = 0;

    for (const full of files()) {
      const code = withoutTsComments(readFileSync(full, "utf8"));
      const controls = [...code.matchAll(BROWSER_PAINTED)].map((m) => m[1] ?? "select");
      if (controls.length > 0) withControls += 1;
      if (controls.includes("date")) dateFiles.push(relative(appDir, full));
      if (controls.length > 0 && LIGHT_GROUND.test(code)) {
        offenders.push(`${relative(appDir, full)}: ${[...new Set(controls)].join(", ")}`);
      }
    }

    /* SIZE — and the FIRST version of this assertion was green under the
     * mutation it was written for, which is why it reads the way it does.
     *
     * It compared "files holding ANY browser-painted control" against "files
     * holding a date input". Those are different sets and the first is much
     * the larger, so breaking the `date` arm of the pattern left the
     * inequality comfortably true: 112 date fields stopped being seen and the
     * census passed. A size assertion has to be about the SAME SUBJECT as the
     * thing it guards, or it is decoration.
     *
     * So the two counts are now over one subject — which files the census
     * sees a DATE input in — reached by two expressions that share nothing.
     * An equality rather than a floor, because any difference means one of
     * them is wrong about the same question. */
    const dateFilesIndependent = files()
      .filter((full) => /type=\{?["'`]date["'`]/.test(withoutTsComments(readFileSync(full, "utf8"))))
      .map((full) => relative(appDir, full))
      .sort();

    expect(
      dateFilesIndependent.length,
      "no file in the app renders a date input, which cannot be true — the " +
        "second expression has drifted too and nothing below it can fail",
    ).toBeGreaterThan(20);
    expect(
      dateFiles.sort(),
      "The census and an independent read disagree about which files hold a date " +
        "input, so one of the two patterns has drifted. Every assertion below is " +
        "about a set that is no longer the right set.",
    ).toEqual(dateFilesIndependent);
    expect(withControls).toBeGreaterThanOrEqual(dateFilesIndependent.length);

    expect(
      offenders,
      "These put a control the BROWSER paints on a light ground:\n  " +
        offenders.join("\n  ") +
        "\n\n`:root { color-scheme: dark }` in globals.css tells the browser to " +
        "paint its controls for a dark page, which is right everywhere in this app " +
        "EXCEPT here. The five printable documents (WH-347, DAS-140, DAS-142, the " +
        "photo report, the union remittance, the pay application) are white cards " +
        "inside the dark shell and have no such controls, which is exactly why one " +
        "declaration at the root is correct. Putting one on white paper breaks that: " +
        "either keep the control on the app's own dark ground, or give that card its " +
        "own `color-scheme: light` AND update this test to say which document has it " +
        "and why.",
    ).toEqual([]);
  });
});
