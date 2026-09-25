import type { Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";

/**
 * Signs `page` in as one of the four seeded personas (see personas.ts),
 * through Clerk's own testing helper — not through any shortcut this repo
 * added. `clerk.signIn({ page, emailAddress })` finds the user by email
 * server-side and completes a ticket-strategy sign-in; Clerk's docs
 * require navigating to an UNPROTECTED page that still loads Clerk before
 * calling it, which is why every caller lands on `/sign-in` first rather
 * than a protected route middleware.ts would bounce before Clerk's client
 * ever initializes.
 */
export async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: email });
  await failOnSessionTask(page, email);
}

/**
 * A Clerk SESSION TASK parks the session before the app ever renders, and
 * it does not look like a configuration problem from the outside — it
 * looks like every spec in the suite hanging.
 *
 * 2026-09-24, the first run where seeding succeeded: all six users were
 * created and every one landed on
 *
 *     /sign-in/tasks/choose-organization?redirect_url=/dashboard
 *
 * which renders 0 visible characters, because THIS APP DOES NOT USE CLERK
 * ORGANIZATIONS — tenancy is Prova's own `Company`, adopted by verified
 * email in `lib/auth.ts`. Clerk made "Membership required" the default for
 * instances with Organizations enabled on 2025-08-22; that setting routes
 * every signed-in user through `choose-organization` and disables personal
 * accounts.
 *
 * What that cost without this check: `1. sign in` timed out after 120
 * SECONDS and reported a URL mismatch, and 23 other specs failed
 * downstream with `toBeVisible` and timeouts that each looked like their
 * own bug. One instance setting, twenty-four failure messages, none of
 * them naming it.
 *
 * So this fails in milliseconds and says the sentence. Same move as
 * `describeClerkSeedFailure` one layer later: the suite's job when it
 * cannot run is to say why, not to time out.
 */
export async function failOnSessionTask(page: Page, email: string): Promise<void> {
  const url = page.url();
  const match = /\/sign-in\/tasks(?:\/([\w-]+))?/.exec(url);
  if (!match) return;

  const task = match[1] ?? "(unnamed)";
  throw new Error(
    [
      `e2e: Clerk parked this session on a SESSION TASK before the app rendered.`,
      `  persona: ${email}`,
      `  task:    ${task}`,
      `  url:     ${url}`,
      "",
      "Sign-in itself worked. Clerk is holding the session until a task is",
      "completed, and the app renders nothing at that route — so every spec",
      "downstream fails on its own assertion and none of them names this.",
      "",
      task === "choose-organization"
        ? [
            "This one is an INSTANCE SETTING, and this app cannot satisfy it:",
            "Prova does not use Clerk organizations at all — tenancy is its own",
            "`Company` model, adopted by verified email in lib/auth.ts.",
            "",
            "Clerk made 'Membership required' the default for instances with",
            "Organizations enabled on 2025-08-22, and that setting forces every",
            "session through choose-organization and disables personal accounts.",
            "",
            "Fix it on the instance, not here: Clerk Dashboard → Configure →",
            "Organizations → membership 'optional' (which restores personal",
            "accounts). Name the instance first — the suite's keys are the",
            "DEVELOPMENT ones, and production is a different instance whose",
            "setting has to be read separately.",
          ].join("\n")
        : "Read the task name above against the instance's Configure settings.",
    ].join("\n"),
  );
}
