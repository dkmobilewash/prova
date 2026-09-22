import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { dataTour } from "../lib/dataTour";
import { expectHealthy } from "../lib/health";
import { expectFitsTheViewport } from "../lib/viewport";

/**
 * THE SCREENS A FOREMAN OPENS WITH ONE HAND ON A LADDER — daily field
 * reports and punch lists — at 375px, which is the only viewport that
 * matters for them. An office uses `/estimating` at a desk; nobody stands
 * on a deck filling in a punch list on a 27-inch monitor.
 *
 * **NEVER EXECUTED BY ITS AUTHOR, and that is stated here rather than left
 * to be discovered.** Both pages are behind `auth.protect()`, so running
 * them needs the `striking-jaybird` DEVELOPMENT Clerk instance's keys,
 * which the session that wrote this file did not have and correctly could
 * not obtain. What it does have behind it is not nothing: every locator
 * below is lifted verbatim from `specs/field-reports.spec.ts` and
 * `specs/punch-lists.spec.ts`, which walk the same two pages on the same
 * persona at desktop width, and the only assertion added is the width one.
 * So the navigation is as proven as those are; the width is the open
 * question, and it is open in the honest direction — this may well go RED
 * the first time it runs, and a red here is a finding about the product,
 * not about the spec.
 *
 * This is the same discipline `specs/known-bad-inputs.spec.ts` states in
 * its own header ("as of this file's first commit these cases FAIL on
 * main, because the fix had not merged"): say what has and has not been
 * run, in the file, so nobody reads a green suite as a claim nobody made.
 *
 * Both run on the EMPTY persona, which no spec mutates, so they are
 * read-only and order-independent like the empty-state specs they mirror.
 */

test("daily field reports are usable at 375px", async ({ page }) => {
  await signInAs(page, PERSONAS.empty.email);
  await page.goto("/field-reports");

  const empty = page.locator(dataTour("field-reports-empty"));
  await expect(empty).toBeVisible();
  await expect(empty.getByText("No field reports yet")).toBeVisible();

  // Rendered, and rendered without a boundary, BEFORE the width is read:
  // a page that crashed has no horizontal overflow either.
  await expectHealthy(page, "/field-reports at 375px");
  await expectFitsTheViewport(page, "/field-reports");
});

test("punch lists are usable at 375px", async ({ page }) => {
  await signInAs(page, PERSONAS.empty.email);
  await page.goto("/punch-lists");

  const empty = page.locator(dataTour("punch-empty"));
  await expect(empty).toBeVisible();
  await expect(empty.getByText("No punch items yet")).toBeVisible();

  // The primary action is a LINK to /jobs/new, and on a phone a link that
  // renders off the right edge is a dead end rather than a small
  // inconvenience — there is no window to widen.
  await expect(empty.getByRole("link", { name: "Create a job" })).toBeVisible();

  await expectHealthy(page, "/punch-lists at 375px");
  await expectFitsTheViewport(page, "/punch-lists");
});
