import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { dataTour } from "../lib/dataTour";

/** /field-reports empty state, on the EMPTY persona (zero jobs, no
 * ?job= filter) — title is "No field reports yet" and the primary action
 * is "Create a job". */
test("field reports empty state shows its box and primary action", async ({ page }) => {
  await signInAs(page, PERSONAS.empty.email);
  await page.goto("/field-reports");

  const empty = page.locator(dataTour("field-reports-empty"));
  await expect(empty).toBeVisible();
  await expect(empty.getByText("No field reports yet")).toBeVisible();
  await expect(empty.getByRole("link", { name: "Create a job" })).toHaveAttribute("href", "/jobs/new");
});
