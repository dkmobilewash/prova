import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import resolveConfig from "tailwindcss/resolveConfig";
import { describe, expect, it } from "vitest";
import tailwindConfig from "../../tailwind.config";

/**
 * The E2E health check (health.ts) fails a page that shows one of a fixed
 * list of crash sentences. A list like that has the failure mode CLAUDE.md
 * documents for every census in this repo: if the wording it looks for
 * stops being the wording the app renders, the check goes green about
 * nothing — a page can crash all it likes in words the list does not know.
 *
 * So this pins the list to its sources, as TEXT, in the unit suite (which
 * runs on every push — the E2E suite does not). If PageLoadError's copy is
 * rewritten, this fails and points at the two places to change together.
 *
 * Read as text rather than imported: health.ts imports @playwright/test,
 * which has no business loading inside vitest, and the check is about the
 * literal strings anyway.
 */
const webRoot = path.resolve(__dirname, "../..");
const healthSource = readFileSync(path.join(__dirname, "health.ts"), "utf8");
const boundarySource = readFileSync(path.join(webRoot, "components/PageLoadError.tsx"), "utf8");
/**
 * The two shell components, WITH THEIR COMMENTS REMOVED — and that is not
 * tidiness, it is the trap this repo has already paid for once (#185: a
 * census disarmed by a comment quoting its own pattern). The first draft of
 * the drawer check passed while the attribute it was looking for had been
 * deleted from the JSX, because the comment explaining the attribute
 * quoted it. An attribute in a comment is not rendered to anybody.
 */
const railSource = codeOnly(readFileSync(path.join(webRoot, "components/Sidebar.tsx"), "utf8"));
const drawerSource = codeOnly(readFileSync(path.join(webRoot, "components/MobileNav.tsx"), "utf8"));

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The markers, lifted out of health.ts's `CRASH_MARKERS = [ … ]` literal. */
function markersInSource(): string[] {
  const block = healthSource.match(/export const CRASH_MARKERS = \[([\s\S]*?)\] as const;/);
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("e2e crash markers", () => {
  const markers = markersInSource();

  it("were actually parsed out of health.ts (the check cannot be about an empty list)", () => {
    expect(markers.length).toBeGreaterThanOrEqual(8);
  });

  it("include the wording this app's own error boundary renders", () => {
    // JSX escapes the apostrophe; compare against the rendered form.
    const rendered = boundarySource.replace(/&apos;/g, "'");
    for (const sentence of ["This page didn't load", "Something went wrong reading your data", "If you report this, include reference"]) {
      expect(rendered, `PageLoadError.tsx no longer renders "${sentence}" — update it and CRASH_MARKERS together`).toContain(sentence);
      expect(markers, `CRASH_MARKERS lost "${sentence}"`).toContain(sentence);
    }
  });

  it("include Next's stock boundary and the redacted Server Action sentence", () => {
    for (const sentence of ["Application error", "Digest:", "Server Components render"]) {
      expect(markers).toContain(sentence);
    }
  });

  it("are not words a healthy page uses", () => {
    // A marker that appears in ordinary copy would make every healthy page
    // fail — the opposite failure, and just as useless. `Digest:` with the
    // colon and capital is checked here because the alerts feature does
    // say "digest".
    const appCopy = ["app", "components"].flatMap((dir) => readTsx(path.join(webRoot, dir)));
    // The boundaries themselves are the one place this wording belongs:
    // app/**/error.tsx, global-error.tsx, and the two shared boundary
    // components they render (PageLoadError, PublicRouteError).
    const withoutBoundary = appCopy.filter((file) => !/(?:^|\/)(?:global-)?error\.tsx$/.test(file) && !/[A-Za-z]Error\.tsx$/.test(file));
    for (const marker of markers) {
      // Only COPY is scanned — string literals and JSX text. A comment
      // quoting Next's stock page (CompanySetupGate.tsx) or a prop named
      // `sendMyAlertDigest: () =>` (SendDigestButton.tsx) both contain a
      // marker's characters and neither is ever on screen.
      const offenders = withoutBoundary.filter((file) => copyOf(readFileSync(file, "utf8")).includes(marker));
      expect(offenders, `"${marker}" appears in ordinary app copy, so a healthy page would fail the health check`).toEqual([]);
    }
  });
});

/**
 * THE OTHER HALF OF health.ts THAT IS A STRING MATCHED AGAINST THE APP —
 * the signed-in shell's navigation, which the crash markers' own argument
 * applies to word for word. A landmark name this check looks for and the
 * app has stopped rendering is a check about nothing, and that is not
 * hypothetical here: asking every signed-in page for the DESKTOP rail's
 * landmark is what made both field-screens.mobile specs red for days at
 * 375px, where that rail is `display: none` by design.
 *
 * Three things are pinned, each to a source that cannot drift with
 * health.ts:
 *
 *   - the breakpoint, to what Tailwind's own config resolves `md` to. The
 *     `md:` classes in Sidebar.tsx and MobileNav.tsx are that number; a
 *     copy of it in a Playwright helper is a second opinion waiting to be
 *     wrong.
 *   - the rail's name, to the `aria-label` in Sidebar.tsx;
 *   - the drawer button's name AND the drawer landmark's name, to
 *     MobileNav.tsx. The drawer carrying the SAME name as the rail is the
 *     point rather than a coincidence: the two are never in the
 *     accessibility tree at once (`hidden md:block` against `md:hidden`),
 *     so one name across both shapes is what makes "the shell's main
 *     navigation" a single idea.
 */
describe("e2e shell-navigation check", () => {
  /** A `const NAME = 768;` or `const NAME = "text";` out of health.ts's source. */
  function constantInHealth(name: string): string {
    const match = healthSource.match(new RegExp(`export const ${name} = (?:"([^"]+)"|(\\d+))`));
    expect(match, `health.ts no longer declares ${name} — this check cannot be about a value it did not find`).not.toBeNull();
    return match![1] ?? match![2];
  }

  it("uses Tailwind's own `md` breakpoint, not a number of its own", () => {
    const screens = resolveConfig(tailwindConfig).theme?.screens as Record<string, string> | undefined;
    expect(screens?.md, "tailwind resolved no `md` screen — the whole rail/drawer switch is that media query").toBeDefined();
    expect(
      `${constantInHealth("RAIL_BREAKPOINT_PX")}px`,
      "health.ts's RAIL_BREAKPOINT_PX and Tailwind's `md` disagree, so the E2E shell check would ask the " +
        "wrong shell for its navigation somewhere between the two",
    ).toBe(screens!.md);
  });

  it("looks for the landmark the desktop rail actually renders", () => {
    const name = constantInHealth("RAIL_NAV_NAME");
    expect(
      railSource,
      `Sidebar.tsx no longer renders aria-label="${name}" — update it and health.ts's RAIL_NAV_NAME together`,
    ).toContain(`aria-label="${name}"`);
  });

  it("looks for the button and the landmark the phone drawer actually renders", () => {
    const button = constantInHealth("DRAWER_BUTTON_NAME");
    expect(
      drawerSource,
      `MobileNav.tsx no longer renders aria-label="${button}" — at phone width that button IS the navigation, ` +
        "and health.ts's DRAWER_BUTTON_NAME is how every signed-in mobile check finds it",
    ).toContain(`aria-label="${button}"`);
    // The drawer's own landmark carries the rail's name, so `navigation
    // "Main"` means the same thing at both widths. components/
    // MobileNav.test.ts asserts this on the RENDERED markup; this line is
    // here so the two names cannot be changed apart.
    expect(
      drawerSource,
      'the phone drawer\'s <nav> must carry the rail\'s own aria-label — an unnamed landmark is announced as bare "navigation"',
    ).toContain(`aria-label="${constantInHealth("RAIL_NAV_NAME")}"`);
  });
});

/**
 * The parts of a .tsx file a person can see: string literals (including
 * template literals) and JSX text between tags, with comments removed
 * first. Coarse on purpose — this is a scan for rendered copy, not a
 * parser — and the boundary file's own wording is asserted separately
 * above, so a false negative here costs little while a false positive
 * (a type name, a comment) would fail a healthy page's health check.
 */
function copyOf(source: string): string {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const literals = withoutComments.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
  const jsxText = [...withoutComments.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]);
  return [...literals, ...jsxText].join("\n");
}

function readTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...readTsx(full));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}
