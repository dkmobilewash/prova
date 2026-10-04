import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { E2E_TAG } from "../lib/seedDatabase";

/**
 * A PORTAL TOKEN IS A BEARER CREDENTIAL, AND A FIELD MEMBER MUST NOT SEE ONE.
 *
 * `Contact.portalToken` IS the GC's identity on `/portal/<token>` — no
 * password, no expiry, no rotation — and that page renders the contract line
 * items and total, the change orders, and every invoice with its payments and
 * retainage-adjusted balance. Before this PR, `enablePortalAccess` checked no
 * capability at all, and the whole Client portal section rendered for anybody
 * who could open the contact page. A FIELD crew member on a phone in a jobsite
 * trailer could mint a stranger a permanent link to the company's billing.
 *
 * `action-capability-guards` and `portalCredentialCensus` prove the ACTION is
 * guarded, and the unit suite executes the refusal. Neither can see what a
 * browser PAINTS. Gating the action while still rendering the token would pass
 * every one of them and still put the credential on a screen that must not
 * carry it — so this spec asserts the only thing those cannot: that the string
 * is not on the page.
 *
 * WHY THE OWNER CASE IS ASSERTED FIRST, and it is not decoration. A spec that
 * only looked for an absent heading would pass just as happily if the contact
 * page were broken, if the seed had no contact, or if the selector were
 * misspelled — the vacuous shape CLAUDE.md names repeatedly. The control
 * proves the section DOES render on this exact contact for a viewer who holds
 * MANAGE_BILLING, before the FIELD test proves it does not for one who does
 * not. If test 1 fails, fix the harness before reading test 2 at all.
 *
 * IT MUTATES NOTHING. Both tests only LOOK. The suite's own discipline is that
 * nothing mutates MAIN's contact or job rows (see `lib/personas.ts`), and
 * enabling a portal would write `portalToken` to the shared seeded contact —
 * so the enable/revoke/re-enable round trip is deliberately NOT here. That
 * path is covered by the unit suite and by the PR's own click-list; this file
 * covers the half a test can see and a person cannot easily prove: that a
 * credential is absent from a rendered page.
 *
 * FIELD is a second User inside MAIN's company (role MEMBER, jobFunction
 * FIELD), not its own company — the same arrangement `money-rail-gate.spec.ts`
 * relies on. A viewer in an EMPTY company would prove nothing, because there
 * would be no contact to withhold a portal for.
 */

/** MAIN's one seeded contact. Reached through the list rather than by id,
 *  because the id is generated and the spec must not read the database. */
const SEEDED_GC = `${E2E_TAG} General Contractor`;

async function openSeededContact(page: import("@playwright/test").Page) {
  await page.goto("/contacts");
  const row = page.getByRole("link", { name: new RegExp(SEEDED_GC) });
  await expect(
    row,
    `the seeded contact "${SEEDED_GC}" is not in the list — the seed regressed, ` +
      "and nothing below this line proves anything about the gate",
  ).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/\/contacts\/[^/]+$/);
}

test.describe("Client portal: MANAGE_BILLING gates the credential, not just the button", () => {
  test("an OWNER sees the Client portal section (positive control)", async ({
    page,
  }) => {
    await signInAs(page, PERSONAS.main.email);
    await openSeededContact(page);

    await expect(
      page.getByRole("heading", { name: "Client portal" }),
      "the owner cannot see the Client portal section either — the hiding is too " +
        "wide, and the FIELD assertion below would pass for the wrong reason",
    ).toBeVisible();
  });

  test("a FIELD-function member sees no Client portal section at all", async ({
    page,
  }) => {
    await signInAs(page, PERSONAS.field.email);
    await openSeededContact(page);

    await expect(
      page.getByRole("heading", { name: "Client portal" }),
      "the Client portal heading is on the page for a FIELD member. Greyed out, " +
        "buttonless or otherwise — it must not be there in any form, because two " +
        "of its three branches print the token itself.",
    ).toHaveCount(0);
  });

  test("the token string is nowhere in a FIELD member's page", async ({
    page,
  }) => {
    /* The assertion the heading check cannot make. A refactor that renamed the
       heading, or moved the link out from under it, would leave the heading
       test green with the credential still painted. This looks for the thing
       that actually matters. */
    await signInAs(page, PERSONAS.field.email);
    await openSeededContact(page);

    const body = await page.locator("body").innerText();
    expect(
      body.includes("/portal/"),
      "a portal link is readable on the contact page by somebody who may not " +
        "issue one. The credential is the string, not the button.",
    ).toBe(false);
  });

  test("the FIELD member really is restricted (control on the control)", async ({
    page,
  }) => {
    /* Step 9 of the PR's click-list, automated. If the suite ever signs the
       FIELD persona in as somebody else — a seed change, a Clerk mix-up — the
       three tests above would pass while proving nothing at all, because an
       owner's page simply would not be under test. `Payment reliability` is
       withheld on the SAME capability, so its presence here means we are
       looking at the wrong account. */
    await signInAs(page, PERSONAS.field.email);
    await openSeededContact(page);

    await expect(
      page.getByRole("heading", { name: "Payment reliability" }),
      "Payment reliability is visible, so this viewer holds MANAGE_BILLING — " +
        "the persona is wrong and the gate assertions above are vacuous",
    ).toHaveCount(0);
  });
});
