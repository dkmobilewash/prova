import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EsignNotFound from "@/app/esign/not-found";
import PortalNotFound from "@/app/portal/not-found";

/**
 * The 404 a general contractor sees.
 *
 * `/portal` and `/esign` had no `not-found.tsx` of their own — `(app)`'s is
 * scoped to the signed-in route group — so every `notFound()` on the two
 * routes an outside company can actually reach rendered Next's stock
 * developer 404. Nothing failed, no test went red, and nobody signed in
 * could see it: the page only appears to somebody holding a dead link.
 *
 * These render the real page components, so a future edit that empties one,
 * links it back into the app, or explains too much fails here.
 */

const renderPage = (page: () => React.JSX.Element) =>
  renderToStaticMarkup(createElement(page));

const PAGES: [string, () => React.JSX.Element][] = [
  ["/portal", PortalNotFound],
  ["/esign", EsignNotFound],
];

describe("the public 404 renders at all", () => {
  it.each(PAGES)("%s has a page and it is not empty", (route, page) => {
    const html = renderPage(page);
    // The stock Next 404 is what this replaces; an empty render would be a
    // worse version of the same problem, so the length floor is asserted
    // rather than assumed from "it didn't throw".
    expect(html.length, `${route} renders something`).toBeGreaterThan(200);
    expect(html).toContain("This link doesn&#x27;t open anything");
    expect(html).toContain("Ask the person who sent it");
  });
});

describe("it offers a signed-out reader no way into the app", () => {
  it.each(PAGES)("%s renders no link of any kind", (route, page) => {
    const html = renderPage(page);
    // `(app)/not-found.tsx` offers "Back to jobs" and "Line item catalog".
    // For a GC those are two doors into a product they have no account for
    // — a dead link turned into a dead end behind a login wall. The way out
    // of this page is a person, not a URL.
    expect(html, `${route} has no anchor`).not.toContain("<a ");
    expect(html, `${route} has no href`).not.toContain("href");
    expect(html.toLowerCase()).not.toContain("sign in");
    expect(html.toLowerCase()).not.toContain("dashboard");
  });
});

describe("it does not say whether the link ever worked", () => {
  /**
   * `/portal/[token]`, `/portal/[token]/jobs/[jobId]` and `/esign/[token]`
   * all 404 identically for a token that never existed, one that was
   * revoked, a contact set INACTIVE, an expired signature request and a job
   * belonging to another contact — deliberately, so a dead link does not
   * confirm it once opened something. Three guards, in three files, none of
   * which mentions this page. The friendly copy edit that says "this link
   * has expired" undoes all three from here, which is why the words are
   * asserted rather than left to review.
   */
  const DISCLOSING = ["expired", "expire", "revoked", "no longer", "deleted", "inactive"];

  it("the forbidden list is not empty, so this is a real check", () => {
    expect(DISCLOSING.length).toBeGreaterThan(0);
  });

  it.each(PAGES)("%s uses none of them", (route, page) => {
    const text = renderPage(page).toLowerCase();
    // Control: prove the text was actually read before asserting absences.
    expect(text, `${route} says something about a link`).toContain("link");
    for (const word of DISCLOSING) {
      expect(text, `${route} must not say "${word}"`).not.toContain(word);
    }
  });
});
