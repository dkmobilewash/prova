import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";

/**
 * Invariant: a failed save keeps what you typed.
 *
 * Forced with a REAL server-side refusal, not a client-side HTML5
 * validation block (the "name" field has `required`, so an empty name
 * never reaches the server at all — that would test the browser, not the
 * app). `createContact` (apps/web/lib/actions/company.ts) parses
 * "paymentTermsDays" with `Number(...)` and throws `InputError('"paymentTermsDays"
 * must be a number')` on anything non-numeric; `runAction` (lib/actions/shared.ts)
 * turns that into a real `{ ok: false, error }` ActionResult. ContactForm.tsx
 * only calls `formRef.current?.reset()` on the SUCCESS path, so on failure
 * the typed values are simply never touched — this spec proves that,
 * rather than assuming it from reading the component.
 *
 * Runs on MAIN (never mutated elsewhere): the contact is never created,
 * because the whole point is that this submission is refused.
 */
test("a failed contact save keeps what was typed", async ({ page }) => {
  await signInAs(page, PERSONAS.main.email);
  await page.goto("/contacts");

  /* `[data-opens="contacts-add"]` WAS HERE AND COULD NEVER HAVE MATCHED,
     which is the direct cost of a suite nothing invokes: this spec has
     never run, so nothing ever said so.

     That attribute is on EmptyStateButtons.tsx's OpenFormButton, inside the
     `<EmptyState>` that app/(app)/contacts/page.tsx renders only when
     `contacts.length === 0`. This spec runs on MAIN, and MAIN is seeded
     with a contact (seedDatabase.ts). So the empty state is not on the
     page, the locator matches nothing, and the run dies here on a 10s
     timeout — one line before the assertion the task flagged as stale.

     That assertion is in fact still CORRECT: `standingTermsFromForm` in
     lib/actions/company.ts still throws `InputError('"paymentTermsDays"
     must be a number')`, `runAction` still turns it into
     `{ ok: false, error }`, and ContactForm.tsx still renders
     `result.error` verbatim. Checked against main 2026-09-21. The stale
     thing was the way IN.

     ContactForm's own collapsed button is always rendered, whatever the
     list contains, so it is what this spec presses. specs/contacts.spec.ts
     keeps the attribute selector and is right to: it runs on EMPTY, where
     both buttons exist and role+name alone would match two elements. */
  await page.getByRole("button", { name: "Add a contact" }).click();

  const nameInput = page.locator('input[name="name"]');
  const typedName = `ZZ-E2E Keep Typed ${Date.now()}`;
  await nameInput.fill(typedName);
  await page.locator('input[name="paymentTermsDays"]').fill("abc");

  await page.getByRole("button", { name: "Save contact" }).click();

  // The IDEA, not the wording. This asserted `"paymentTermsDays" must be a
  // number` — the sentence the app stopped saying on 2026-09-21, when one
  // parser (lib/numeric-input.ts) took over and started naming the field as
  // the screen labels it instead of reading back the form key. The spec kept
  // asserting the old string and could only fail.
  //
  // The full sentence is pinned in `lib/actions/company.dbtest.ts`, which is
  // the right place for it: a unit test can assert punctuation without being
  // brittle about where a line wrapped. Here the question is only whether a
  // refusal reached the screen at all, so match on the idea.
  await expect(page.getByText(/Payment terms has to be a whole number/)).toBeVisible();
  await expect(nameInput).toHaveValue(typedName);
  await expect(page.locator('input[name="paymentTermsDays"]')).toHaveValue("abc");
});
