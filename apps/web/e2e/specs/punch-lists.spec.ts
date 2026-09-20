import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { dataTour } from "../lib/dataTour";

/** /punch-lists empty state, on the EMPTY persona (zero jobs) — the
 * primary action is "Create a job" rather than "Add an item" specifically
 * because there is no job yet to attach an item to. */
test("punch lists empty state shows its box and primary action", async ({ page }) => {
  await signInAs(page, PERSONAS.empty.email);
  await page.goto("/punch-lists");

  const empty = page.locator(dataTour("punch-empty"));
  await expect(empty).toBeVisible();
  await expect(empty.getByText("No punch items yet")).toBeVisible();
  await expect(empty.getByRole("link", { name: "Create a job" })).toHaveAttribute("href", "/jobs/new");
});
