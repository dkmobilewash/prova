import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { dataTour } from "../lib/dataTour";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { expectFitsTheViewport } from "../lib/viewport";

/**
 * THE SCREENS A FOREMAN OPENS WITH ONE HAND ON A LADDER — daily field
 * reports and punch lists — at 375px, which is the only viewport that
 * matters for them. An office uses `/estimating` at a desk; nobody stands
 * on a deck filling in a punch list on a 27-inch monitor.
 *
 * **IT HAS NOW RUN, AND WHAT IT FOUND WAS NEITHER PAGE.** This header used
 * to say the file had never been executed by its author — no
 * `striking-jaybird` keys — and that the width assertion was the open
 * question. The keys arrived, both tests went red on every run for days,
 * and the red was in the line NOBODY had doubted: `expectHealthy` asked for
 * the desktop rail's `navigation "Main"` landmark, and below Tailwind's
 * `md` that rail is `display: none` by design. Neither page was at fault
 * and neither was the width check, which never got to run. The shell check
 * is width-aware now (lib/health.ts, `expectShellNavigation`) and requires
 * the phone shell's own navigation at this width instead — proved by
 * `specs/shell-nav.mobile.spec.ts`, which opens it.
 *
 * Kept in the header because the prediction it made was half right in a way
 * worth remembering: "a red here is a finding about the product, not about
 * the spec" was the honest posture, and it was still wrong. A first run can
 * be red about the instrument.
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
  // Attached before the first navigation: `expectHealthy` only fails on an
  // uncaught exception when it is handed a monitor, and a health check with
  // no monitor never looks at what the browser threw at all.
  const monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.empty.email);
  await page.goto("/field-reports");

  const empty = page.locator(dataTour("field-reports-empty"));
  await expect(empty).toBeVisible();
  await expect(empty.getByText("No field reports yet")).toBeVisible();

  // Rendered, and rendered without a boundary, BEFORE the width is read:
  // a page that crashed has no horizontal overflow either.
  await expectHealthy(page, "/field-reports at 375px", { monitor });
  await expectFitsTheViewport(page, "/field-reports");
});

test("punch lists are usable at 375px", async ({ page }) => {
  const monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.empty.email);
  await page.goto("/punch-lists");

  const empty = page.locator(dataTour("punch-empty"));
  await expect(empty).toBeVisible();
  await expect(empty.getByText("No punch items yet")).toBeVisible();

  // The primary action is a LINK to /jobs/new, and on a phone a link that
  // renders off the right edge is a dead end rather than a small
  // inconvenience — there is no window to widen.
  await expect(empty.getByRole("link", { name: "Create a job" })).toBeVisible();

  await expectHealthy(page, "/punch-lists at 375px", { monitor });
  await expectFitsTheViewport(page, "/punch-lists");
});
