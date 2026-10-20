import { expect, type Locator, type Page } from "@playwright/test";

/**
 * "See it, then click into it" (the declutter, 2026-10-13/14) put forms and
 * row detail one click down. A spec that reaches straight for a field inside
 * one now waits on something that is not on screen and times out — not an
 * assertion failure, a 30-second silence (#774: the proposals step and
 * wage-rates.spec.ts). So the spec presses what a person presses first.
 *
 * Never `startOpen` in the app to make a spec pass: that undoes the declutter.
 */

/**
 * Press a collapsed form's opener — a `CollapsedForm` button, or a client
 * toggle like the bid recap's "Edit rates" — and wait for what it reveals.
 *
 * Both of those are client state. `CollapsedForm` does not even RENDER its
 * children until opened, and a press that lands before hydration has no
 * handler to run, so the press is retried until `revealed` is on screen. The
 * check is on `revealed`, never on the opener going away: a `CollapsedForm`
 * opener and the form's own submit button often carry the same words
 * ("Create invoice", "Add line item", "Add clause"), so "a button with that
 * name" is satisfied either side of the press. Already open is fine — the
 * press is skipped and the reveal is still asserted.
 */
export async function openCollapsed(scope: Page | Locator, opener: string, revealed: Locator): Promise<void> {
  const button = scope.getByRole("button", { name: opener, exact: true });
  await expect(async () => {
    if (await revealed.isVisible()) return;
    await button.click({ timeout: 2_000 });
    await expect(revealed).toBeVisible({ timeout: 2_000 });
  }, `pressing "${opener}" should reveal what it hides`).toPass({ timeout: 15_000 });
}

/**
 * Open one native `<details>` — `Disclosure`'s row, card and plain variants.
 * Native, so it opens with or without hydration; the summary is pressed only
 * when closed, because a second press closes it again.
 *
 * Address a row by its group `name` (`details[name="bid"]`, `"estimate-line"`,
 * `"cost-line"`, `"pay-app"`, `"proposal-clause"`), never by a role query
 * inside it: `getByRole` skips what a closed `<details>` hides, so a `has:`
 * filter built from one matches nothing until the row is already open.
 */
export async function openDisclosure(details: Locator): Promise<void> {
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator(":scope > summary").click();
  }
  await expect(details, "the disclosure should be open").toHaveJSProperty("open", true);
}
