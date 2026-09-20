import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { dataTour } from "../lib/dataTour";

/**
 * /contacts empty state, on the EMPTY persona (never mutated by any spec
 * — see lib/personas.ts). Opening the form is asserted; nothing is
 * submitted, so this spec is read-only and safe to run in any order.
 */
test("contacts empty state shows its box, and Add a contact opens the form", async ({ page }) => {
  await signInAs(page, PERSONAS.empty.email);
  await page.goto("/contacts");

  const empty = page.locator(dataTour("contacts-empty"));
  await expect(empty).toBeVisible();
  await expect(empty.getByText("No contacts yet")).toBeVisible();

  // EmptyState's own action button (EmptyStateButtons.tsx's
  // OpenFormButton, data-opens="contacts-add") — a SECOND "Add a contact"
  // button distinct from ContactForm's own collapsed one, which is why
  // this is targeted by its data-opens attribute rather than by role/name
  // (both share the visible text, and role+name alone would match two
  // elements). Pressing it presses ContactForm's real button for real,
  // per OpenFormButton's own doc comment.
  await page.locator('[data-opens="contacts-add"]').click();

  await expect(page.getByRole("heading", { name: "Add a contact" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save contact" })).toBeVisible();
});
