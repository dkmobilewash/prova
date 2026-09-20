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

  await page.locator('[data-opens="contacts-add"]').click();

  const nameInput = page.locator('input[name="name"]');
  const typedName = `ZZ-E2E Keep Typed ${Date.now()}`;
  await nameInput.fill(typedName);
  await page.locator('input[name="paymentTermsDays"]').fill("abc");

  await page.getByRole("button", { name: "Save contact" }).click();

  await expect(page.getByText('"paymentTermsDays" must be a number')).toBeVisible();
  await expect(nameInput).toHaveValue(typedName);
  await expect(page.locator('input[name="paymentTermsDays"]')).toHaveValue("abc");
});
