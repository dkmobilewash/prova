import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A RENEWAL ALERT'S LINK HAS TO LAND ON THE THING IT IS ABOUT.
 *
 * THE DEFECT THIS CAME OUT OF. `lib/renewals.ts` sent licence, insurance
 * and bond expiries to `/settings` — a 900-line page with ten sections,
 * only five of which had an `id`. So "Licence 8821 — expires in 9 days"
 * dropped the reader at the top of a page and left them to scroll for the
 * section, on the one screen where the whole point is to act quickly.
 *
 * WHY A TEST RATHER THAN JUST THE FIX. An `href` with a fragment fails
 * SILENTLY: `/settings#licences` with no matching `id` scrolls nowhere and
 * renders no error, which is indistinguishable from the anchor working on a
 * page the reader has not scrolled yet. It is the same shape as the alert
 * that pointed at `/compliance` — a real route that cannot do the thing —
 * except that this one IS mechanically checkable, because the fragment
 * names an element that either exists or does not.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. It cannot tell whether the section
 * the anchor lands on is the RIGHT one — `#licences` resolving to the
 * bonding section would pass. That is the semantic half, and no census here
 * can see it; the reason each href points where it does is written beside it
 * in renewals.ts.
 *
 * Comments are stripped before both reads, because renewals.ts and this
 * file both quote `/settings` while explaining the bug.
 */

const appDir = resolve(new URL("..", import.meta.url).pathname);
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function read(relative: string): string {
  const full = resolve(appDir, relative);
  expect(
    statSync(full, { throwIfNoEntry: false })?.isFile() ?? false,
    `${relative} does not exist — this census would be about nothing`,
  ).toBe(true);
  return strip(readFileSync(full, "utf8"));
}

const renewals = read("lib/renewals.ts");
const settings = read("app/(app)/settings/page.tsx");

describe("every settings anchor a renewal points at exists", () => {
  it("finds the hrefs at all, so a pattern that stopped matching fails here", () => {
    // SIZE, against a second expression that shares no regex with the one
    // below: count the RenewalSource entries, and require at least as many
    // hrefs as there are kinds that link into settings. Nothing is ever
    // broken in an empty list of links.
    const hrefs = [...renewals.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length, "no hrefs parsed out of renewals.ts").toBeGreaterThanOrEqual(4);
    expect(
      hrefs.filter((href) => href.startsWith("/settings")).length,
      "renewals.ts links nothing into /settings, which was true of none of the " +
        "four renewal kinds when this was written",
    ).toBeGreaterThanOrEqual(3);
  });

  it("points every /settings link at a section that has that id", () => {
    const ids = new Set(
      [...settings.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]),
    );
    expect(ids.size, "no id attributes parsed out of the settings page").toBeGreaterThan(3);

    const broken: string[] = [];
    for (const [, href] of renewals.matchAll(/href:\s*"(\/settings[^"]*)"/g)) {
      const fragment = href.includes("#") ? href.slice(href.indexOf("#") + 1) : null;
      if (fragment === null) {
        broken.push(`${href} — lands at the top of a ten-section page`);
      } else if (!ids.has(fragment)) {
        broken.push(`${href} — no element on the settings page has id="${fragment}"`);
      }
    }

    expect(
      broken,
      "These renewal links do not land on their section:\n  " +
        broken.join("\n  ") +
        "\n\nA fragment with no matching id scrolls nowhere and reports nothing, " +
        "which reads exactly like a working anchor on a page you have not scrolled. " +
        "Either add the id to the section in app/(app)/settings/page.tsx or point " +
        "the href at one that exists.",
    ).toEqual([]);
  });
});
