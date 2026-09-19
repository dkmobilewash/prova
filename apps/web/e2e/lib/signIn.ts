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
}
